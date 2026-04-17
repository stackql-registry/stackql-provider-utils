// @stackql/provider-utils/src/providerdev/normalize.js
//
// Reshape OpenAPI spec files in place so they can be consumed by stackql's
// relational analyzer. stackql cannot represent polymorphism or opaque
// objects as SQL columns, so we lower the spec client-side:
//
//   pass 1  - renameVariants: oneOf/anyOf -> allOf at top-level schemas
//             and their direct properties, plus request/response body
//             schemas and their direct properties (shallow only)
//   pass 1b - stripMisplacedSchemaKeywords: delete scalar-valued schema
//             keywords that landed inside a `properties` map due to
//             upstream indentation bugs
//   pass 1c - convertOpaqueObjectsToStrings: rewrite `type: object`
//             schemas with no defined structure to `type: string` so
//             stackql exposes them as JSON-blob columns
//   pass 2  - walkAllOf / flattenAllOf: merge all allOf arrays into a
//             single schema, resolving $refs with cycle protection

import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import yaml from 'js-yaml';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function resolveRef(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = root;
  for (const p of parts) {
    if (!isPlainObject(node) && !Array.isArray(node)) return null;
    node = node[p];
    if (node === undefined) return null;
  }
  return node;
}

function deepClone(v) {
  if (Array.isArray(v)) return v.map(deepClone);
  if (isPlainObject(v)) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = deepClone(v[k]);
    return o;
  }
  return v;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function mergeSchemas(target, source) {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    if (!(key in target)) {
      target[key] = deepClone(sv);
      continue;
    }
    const tv = target[key];
    if (key === 'required' && Array.isArray(tv) && Array.isArray(sv)) {
      target[key] = uniq([...tv, ...sv]);
    } else if (key === 'properties' && isPlainObject(tv) && isPlainObject(sv)) {
      for (const pk of Object.keys(sv)) {
        if (!(pk in tv)) tv[pk] = deepClone(sv[pk]);
      }
    } else if (isPlainObject(tv) && isPlainObject(sv)) {
      mergeSchemas(tv, sv);
    }
  }
  return target;
}

// pass 1: rename oneOf/anyOf to allOf at the limited set of sites the
// analyzer cares about. Shallow by design - deeper polymorphism is left
// alone because the analyzer does not descend into it.

function renameVariantsInNode(node, stats) {
  if (!isPlainObject(node)) return;
  for (const keyword of ['oneOf', 'anyOf']) {
    if (Array.isArray(node[keyword])) {
      node.allOf = node[keyword];
      delete node[keyword];
      if (stats) stats[keyword === 'oneOf' ? 'oneOfRenamed' : 'anyOfRenamed']++;
    }
  }
  if (isPlainObject(node.properties)) {
    for (const prop of Object.values(node.properties)) {
      if (!isPlainObject(prop)) continue;
      for (const keyword of ['oneOf', 'anyOf']) {
        if (Array.isArray(prop[keyword])) {
          prop.allOf = prop[keyword];
          delete prop[keyword];
          if (stats) stats[keyword === 'oneOf' ? 'oneOfRenamed' : 'anyOfRenamed']++;
        }
      }
    }
  }
}

export function renameVariants(doc, stats) {
  if (isPlainObject(doc.components) && isPlainObject(doc.components.schemas)) {
    for (const schema of Object.values(doc.components.schemas)) {
      renameVariantsInNode(schema, stats);
    }
  }
  if (isPlainObject(doc.paths)) {
    for (const pathObj of Object.values(doc.paths)) {
      if (!isPlainObject(pathObj)) continue;
      for (const method of Object.values(pathObj)) {
        if (!isPlainObject(method)) continue;
        const reqContent = method.requestBody?.content;
        if (isPlainObject(reqContent)) {
          for (const mediaType of Object.values(reqContent)) {
            if (isPlainObject(mediaType?.schema)) {
              renameVariantsInNode(mediaType.schema, stats);
            }
          }
        }
        if (isPlainObject(method.responses)) {
          for (const resp of Object.values(method.responses)) {
            if (!isPlainObject(resp?.content)) continue;
            for (const mediaType of Object.values(resp.content)) {
              if (isPlainObject(mediaType?.schema)) {
                renameVariantsInNode(mediaType.schema, stats);
              }
            }
          }
        }
      }
    }
  }
}

// pass 1b: scalar-valued keys inside a `properties` map that share a name
// with a schema keyword are upstream indentation bugs - a legitimate
// property definition is always an object. A property literally named
// after a keyword with an object value is left alone.

const SCHEMA_KEYWORD_SIBLINGS = new Set([
  'type', 'required', 'description', 'title', 'format',
  'minItems', 'maxItems', 'minimum', 'maximum', 'default',
  'nullable', 'readOnly', 'writeOnly', 'deprecated',
  'additionalProperties', 'patternProperties',
]);

export function stripMisplacedSchemaKeywords(node, stats, path = '') {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      stripMisplacedSchemaKeywords(node[i], stats, `${path}/${i}`);
    }
    return;
  }
  if (!isPlainObject(node)) return;
  if (isPlainObject(node.properties)) {
    for (const key of Object.keys(node.properties)) {
      if (!SCHEMA_KEYWORD_SIBLINGS.has(key)) continue;
      const val = node.properties[key];
      if (!isPlainObject(val) && !Array.isArray(val)) {
        delete node.properties[key];
        stats.stripped.push(`${path}/properties/${key}=${JSON.stringify(val)}`);
      }
    }
    // Recurse into each property VALUE as a schema node, not the
    // properties map itself - otherwise a property literally named
    // `properties` would be mis-treated as another properties map.
    for (const [pk, pv] of Object.entries(node.properties)) {
      stripMisplacedSchemaKeywords(pv, stats, `${path}/properties/${pk}`);
    }
  }
  for (const k of Object.keys(node)) {
    if (k === 'properties') continue;
    stripMisplacedSchemaKeywords(node[k], stats, `${path}/${k}`);
  }
}

// pass 1c: an object schema with no defined structure is unqueryable as
// SQL columns. Rewrite it to type:string so stackql exposes it as a
// JSON-blob column instead of failing DESCRIBE.

const OPAQUE_OBJECT_STRUCTURE_KEYS = [
  'properties', 'additionalProperties', 'patternProperties',
  'allOf', 'oneOf', 'anyOf', '$ref',
];

export function convertOpaqueObjectsToStrings(node, stats, path = '') {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      convertOpaqueObjectsToStrings(node[i], stats, `${path}/${i}`);
    }
    return;
  }
  if (!isPlainObject(node)) return;

  if (node.type === 'object' && !OPAQUE_OBJECT_STRUCTURE_KEYS.some(k => k in node)) {
    node.type = 'string';
    const note = '(opaque JSON object)';
    node.description = node.description ? `${node.description} ${note}` : note;
    stats.opaqueConverted.push(path || '<root>');
    return;
  }

  for (const k of Object.keys(node)) {
    convertOpaqueObjectsToStrings(node[k], stats, `${path}/${k}`);
  }
}

// pass 2: collapse every allOf into a single merged schema.

function flattenAllOf(allOfArr, root, seenRefs, stats) {
  const merged = {};
  for (const member of allOfArr) {
    let resolved = member;
    if (isPlainObject(member) && typeof member.$ref === 'string') {
      if (seenRefs.has(member.$ref)) continue;
      const target = resolveRef(member.$ref, root);
      if (!target) {
        merged.$ref_unresolved = merged.$ref_unresolved || [];
        merged.$ref_unresolved.push(member.$ref);
        continue;
      }
      const nextSeen = new Set(seenRefs);
      nextSeen.add(member.$ref);
      resolved = walkAllOf(deepClone(target), root, nextSeen, stats);
    } else {
      resolved = walkAllOf(deepClone(member), root, seenRefs, stats);
    }
    if (isPlainObject(resolved)) {
      if (Array.isArray(resolved.allOf)) {
        const inner = flattenAllOf(resolved.allOf, root, seenRefs, stats);
        delete resolved.allOf;
        mergeSchemas(resolved, inner);
      }
      mergeSchemas(merged, resolved);
    }
  }
  return merged;
}

export function walkAllOf(node, root, seenRefs, stats) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = walkAllOf(node[i], root, seenRefs, stats);
    return node;
  }
  if (!isPlainObject(node)) return node;

  if (Array.isArray(node.allOf)) {
    const flattened = flattenAllOf(node.allOf, root, seenRefs, stats);
    delete node.allOf;
    mergeSchemas(node, flattened);
    if (stats) stats.allOfFlattened++;
  }

  for (const k of Object.keys(node)) {
    node[k] = walkAllOf(node[k], root, seenRefs, stats);
  }
  return node;
}

// Run every pass on a single parsed YAML document, mutating it in place.
export function normalizeDocument(doc) {
  const stats = {
    allOfFlattened: 0,
    oneOfRenamed: 0,
    anyOfRenamed: 0,
    stripped: [],
    opaqueConverted: [],
  };
  if (!doc || typeof doc !== 'object') return stats;
  renameVariants(doc, stats);
  stripMisplacedSchemaKeywords(doc, stats);
  convertOpaqueObjectsToStrings(doc, stats);
  walkAllOf(doc, doc, new Set(), stats);
  return stats;
}

function processFile(filePath, verbose) {
  const raw = readFileSync(filePath, 'utf8');
  const doc = yaml.load(raw);
  if (!doc || typeof doc !== 'object') {
    if (verbose) console.log(`Skipping ${filePath}: not a YAML object`);
    return null;
  }
  const stats = normalizeDocument(doc);
  const out = yaml.dump(doc, { lineWidth: -1, noRefs: true });
  writeFileSync(filePath, out, 'utf8');
  const touched =
    stats.allOfFlattened > 0 ||
    stats.oneOfRenamed > 0 ||
    stats.anyOfRenamed > 0 ||
    stats.stripped.length > 0 ||
    stats.opaqueConverted.length > 0;
  if (verbose || touched) {
    console.log(
      `${filePath}: flattened ${stats.allOfFlattened} allOf, renamed ${stats.oneOfRenamed} oneOf / ${stats.anyOfRenamed} anyOf; stripped ${stats.stripped.length} misplaced keyword(s); converted ${stats.opaqueConverted.length} opaque object(s) to string`
    );
    if (verbose && stats.stripped.length > 0) {
      for (const s of stats.stripped) console.log(`  - strip: ${s}`);
    }
    if (verbose && stats.opaqueConverted.length > 0) {
      for (const s of stats.opaqueConverted) console.log(`  - opaque: ${s}`);
    }
  }
  return stats;
}

/**
 * Normalize every OpenAPI YAML file under apiDir in place for stackql
 * consumption. See module header for the 4 passes applied.
 *
 * @param {Object} options
 * @param {string} options.apiDir - directory containing .yaml/.yml files
 * @param {boolean} [options.verbose=false] - log per-pass detail
 * @returns {Promise<Object>} aggregate stats across all files
 */
export async function normalize({ apiDir, verbose = false } = {}) {
  if (!apiDir || typeof apiDir !== 'string') {
    throw new Error('normalize: `apiDir` is required');
  }
  const stat = statSync(apiDir);
  if (!stat.isDirectory()) {
    throw new Error(`normalize: ${apiDir} is not a directory`);
  }

  const entries = readdirSync(apiDir).filter(f => {
    const ext = extname(f).toLowerCase();
    return ext === '.yaml' || ext === '.yml';
  });

  const aggregate = {
    allOfFlattened: 0,
    oneOfRenamed: 0,
    anyOfRenamed: 0,
    stripped: [],
    opaqueConverted: [],
    filesProcessed: 0,
  };

  if (entries.length === 0) {
    console.log(`No YAML files found in ${apiDir}`);
    return aggregate;
  }

  console.log(`Normalizing ${entries.length} file(s) under ${apiDir}`);
  for (const f of entries) {
    const full = join(apiDir, f);
    const s = processFile(full, verbose);
    if (!s) continue;
    aggregate.filesProcessed++;
    aggregate.allOfFlattened += s.allOfFlattened;
    aggregate.oneOfRenamed += s.oneOfRenamed;
    aggregate.anyOfRenamed += s.anyOfRenamed;
    aggregate.stripped.push(...s.stripped);
    aggregate.opaqueConverted.push(...s.opaqueConverted);
  }
  console.log(`Done. Processed ${aggregate.filesProcessed} file(s).`);
  return aggregate;
}
