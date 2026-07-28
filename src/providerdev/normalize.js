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
//   pass 1d - liftPathItemParameters: merge path-item-level `parameters`
//             into each operation's own `parameters` array so stackql's
//             request builder (which only reads op-level params) binds
//             path templates correctly
//   pass 1e - stripNonRootServers: remove `servers` overrides at path-item
//             and operation level so the document-level `servers` is the
//             single source of truth. stackql's single-base-URL execution
//             model can't honour per-op routing, and these overrides
//             frequently encode placeholder hostnames that DNS-fail when
//             dialled literally
//   pass 1f - wrapBareArrayResponses: rewrite operations whose 2xx
//             response schema is a top-level `type: array` into an
//             object envelope `{ <wrapperKey>: [...] }` and synthesise
//             the matching wrapper schema in `components.schemas`. Marks
//             the operation with `x-stackql-bare-array-wrap` so the
//             generate step can emit a transform.body and objectKey on
//             the resource method. Without the wrap the row projector
//             has no enclosing key to latch onto and SELECT returns 0
//             rows even when the API responds with a non-empty array.
//   pass 2  - walkAllOf / flattenAllOf: merge all allOf arrays into a
//             single schema, resolving $refs with cycle protection

import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import yaml from 'js-yaml';
import pluralize from 'pluralize';

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

// pass 1d: OpenAPI 3 lets a path item declare `parameters` once at the
// path-item level so they apply to every operation under that path. Some
// downstream consumers (stackql's request builder included) only read
// each operation's own `parameters`, which silently drops the shared
// path-item params and leaves `{name}` templates unbound in the URL. Lift
// the path-item-level entries onto every operation, deduplicated by
// (name, in) with operation-level winning per the OpenAPI 3 spec.

const PATH_ITEM_OPERATIONS = new Set([
  'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace',
]);

function paramDedupKey(param, root) {
  if (!isPlainObject(param)) return null;
  if (typeof param.name === 'string' && typeof param.in === 'string') {
    return `${param.in}\0${param.name}`;
  }
  if (typeof param.$ref === 'string') {
    const resolved = resolveRef(param.$ref, root);
    if (isPlainObject(resolved) && typeof resolved.name === 'string' && typeof resolved.in === 'string') {
      return `${resolved.in}\0${resolved.name}`;
    }
    return `$ref\0${param.$ref}`;
  }
  return null;
}

export function liftPathItemParameters(doc, stats) {
  if (!isPlainObject(doc) || !isPlainObject(doc.paths)) return;
  for (const pathObj of Object.values(doc.paths)) {
    if (!isPlainObject(pathObj)) continue;
    const pathParams = pathObj.parameters;
    if (!Array.isArray(pathParams) || pathParams.length === 0) continue;

    for (const [key, op] of Object.entries(pathObj)) {
      if (!PATH_ITEM_OPERATIONS.has(key)) continue;
      if (!isPlainObject(op)) continue;

      const opParams = Array.isArray(op.parameters) ? op.parameters : [];
      const seen = new Set();
      for (const p of opParams) {
        const k = paramDedupKey(p, doc);
        if (k) seen.add(k);
      }
      const merged = [...opParams];
      for (const p of pathParams) {
        const k = paramDedupKey(p, doc);
        if (k && seen.has(k)) continue;
        if (k) seen.add(k);
        merged.push(deepClone(p));
        if (stats) stats.pathParamsLifted++;
      }
      op.parameters = merged;
    }

    delete pathObj.parameters;
  }
}

// pass 1e: OpenAPI 3 lets a path item or operation declare its own
// `servers` list, overriding the document-level server. stackql's request
// builder runs against a single base URL per provider, and in practice
// these overrides almost always encode placeholder hostnames or
// per-deployment endpoints the spec author never expected to be hit
// literally - dialling them produces DNS failures. Strip every non-root
// `servers` block so the document-level value is the single source of
// truth. The doc-level `servers` array is left untouched.

export function stripNonRootServers(doc, stats) {
  if (!isPlainObject(doc) || !isPlainObject(doc.paths)) return;
  for (const pathObj of Object.values(doc.paths)) {
    if (!isPlainObject(pathObj)) continue;
    if ('servers' in pathObj) {
      delete pathObj.servers;
      if (stats) stats.serversStripped++;
    }
    for (const [key, op] of Object.entries(pathObj)) {
      if (!PATH_ITEM_OPERATIONS.has(key)) continue;
      if (!isPlainObject(op)) continue;
      if ('servers' in op) {
        delete op.servers;
        if (stats) stats.serversStripped++;
      }
    }
  }
}

// pass 1f: stackql's row projector expects an object-with-array shape
// (e.g. `{ data: [...] }`) so each item becomes a row and the enclosing
// key acts as the objectKey. An operation whose 200 response is a bare
// `type: array` has nowhere to attach an objectKey and SELECT returns
// 0 rows. Rewrite each such response to `$ref` a synthesised wrapper
// schema and tag the operation with `x-stackql-bare-array-wrap` so the
// generate step can emit the matching transform.body / objectKey.

const SCALAR_ITEM_TYPES = new Set(['string', 'integer', 'number', 'boolean']);
const VERB_PREFIXES = [
  'list_all', 'get_all', 'fetch_all', 'find_all',
  'list', 'get', 'fetch', 'find', 'index', 'enumerate', 'retrieve',
];

function camelToSnakeLocal(name) {
  if (typeof name !== 'string' || name.length === 0) return '';
  const s1 = name.replace(/([a-z0-9])([A-Z][a-z]+)/g, '$1_$2');
  return s1.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/-/g, '_');
}

// Best-effort: snake-case the operationId and strip a leading verb
// prefix (`list`, `get`, `fetchAll`, ...) so what's left is the noun
// the wrapper key should be derived from. Examples:
//   listContexts        -> contexts
//   getKekNames         -> kek_names
//   getAllUsers         -> users
//   getSchemasIdsSubjects -> schemas_ids_subjects
// Falls back to '' when the operationId is just a verb, in which case
// callers substitute 'items'.
function deriveWrapperKey(operationId) {
  if (typeof operationId !== 'string' || operationId.length === 0) return '';
  let snake = camelToSnakeLocal(operationId);
  for (const verb of VERB_PREFIXES) {
    if (snake === verb) return '';
    if (snake.startsWith(verb + '_')) {
      snake = snake.slice(verb.length + 1);
      break;
    }
  }
  return snake;
}

function pascalCase(operationId) {
  if (typeof operationId !== 'string' || operationId.length === 0) return '';
  return operationId.charAt(0).toUpperCase() + operationId.slice(1);
}

// Resolve a top-level $ref once. If the schema is a $ref to a component
// schema, return the resolved schema and the original ref string so
// callers can decide whether to leave the original component alone.
function resolveTopLevelSchema(schema, root) {
  if (!isPlainObject(schema)) return { schema: null, ref: null };
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, root);
    return { schema: isPlainObject(target) ? target : null, ref: schema.$ref };
  }
  return { schema, ref: null };
}

function isScalarItems(items) {
  if (!isPlainObject(items)) return false;
  if (typeof items.$ref === 'string') return false;
  if (isPlainObject(items.properties)) return false;
  if (Array.isArray(items.allOf) || Array.isArray(items.oneOf) || Array.isArray(items.anyOf)) return false;
  return typeof items.type === 'string' && SCALAR_ITEM_TYPES.has(items.type);
}

function buildWrapperSchema(wrapperKey, columnName, originalArraySchema, scalar) {
  if (scalar) {
    const itemType = originalArraySchema.items?.type || 'string';
    return {
      type: 'object',
      properties: {
        [wrapperKey]: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              [columnName]: { type: itemType },
            },
          },
        },
      },
    };
  }
  return {
    type: 'object',
    properties: {
      [wrapperKey]: {
        type: 'array',
        items: deepClone(originalArraySchema.items || { type: 'object' }),
      },
    },
  };
}

function deepEqualLocal(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqualLocal(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqualLocal(a[k], b[k])) return false;
  }
  return true;
}

// Per-operation wrap. Returns true when a wrap was applied (or was
// already in place idempotently); false when the operation shape did
// not match. Mutates `op`, `mediaTypeObj.schema`, and `doc.components.schemas`.
function tryWrapOperationResponse(op, doc, overrides, stats, log) {
  if (!isPlainObject(op) || !isPlainObject(op.responses)) return false;

  // Fast path for idempotent re-runs: marker already present.
  if (isPlainObject(op['x-stackql-bare-array-wrap'])) {
    return true;
  }

  const successCodes = Object.keys(op.responses)
    .filter(c => /^2\d\d$/.test(c))
    .sort();
  if (successCodes.length === 0) return false;

  let didWrap = false;
  for (const code of successCodes) {
    const resp = op.responses[code];
    if (!isPlainObject(resp) || !isPlainObject(resp.content)) continue;
    for (const [mediaType, mediaObj] of Object.entries(resp.content)) {
      if (!isPlainObject(mediaObj) || !isPlainObject(mediaObj.schema)) continue;
      const { schema: resolved } = resolveTopLevelSchema(mediaObj.schema, doc);
      if (!resolved || resolved.type !== 'array') continue;

      const operationId = op.operationId;
      if (typeof operationId !== 'string' || operationId.length === 0) {
        if (log) log.warn(`bare-array response with no operationId at ${mediaType} - skipping wrap`);
        continue;
      }

      const override = overrides && overrides[operationId];
      const derivedKey = (override && override.wrapperKey) || deriveWrapperKey(operationId) || 'items';
      const scalar = isScalarItems(resolved.items);
      const columnName = scalar
        ? ((override && override.columnName) || pluralize.singular(derivedKey) || 'value')
        : null;

      const wrapperName = `${pascalCase(operationId)}Response`;
      doc.components = doc.components || {};
      doc.components.schemas = doc.components.schemas || {};
      const wrapperSchema = buildWrapperSchema(derivedKey, columnName, resolved, scalar);

      const existing = doc.components.schemas[wrapperName];
      if (existing !== undefined && !deepEqualLocal(existing, wrapperSchema)) {
        if (log) log.warn(`wrapper schema name '${wrapperName}' already in use with a different body - skipping wrap for ${operationId}`);
        continue;
      }
      doc.components.schemas[wrapperName] = wrapperSchema;

      mediaObj.schema = { $ref: `#/components/schemas/${wrapperName}` };

      op['x-stackql-bare-array-wrap'] = {
        wrapperKey: derivedKey,
        wrapperName,
        mediaType,
        scalar,
        ...(scalar ? { columnName } : {}),
      };

      if (stats) stats.bareArrayWrapped++;
      didWrap = true;
      break;
    }
    if (didWrap) break;
  }
  return didWrap;
}

export function wrapBareArrayResponses(doc, opts, stats) {
  if (!isPlainObject(doc) || !isPlainObject(doc.paths)) return;
  const overrides = (opts && isPlainObject(opts.bareArrayOverrides)) ? opts.bareArrayOverrides : null;
  const log = (opts && opts.log) || null;
  for (const pathObj of Object.values(doc.paths)) {
    if (!isPlainObject(pathObj)) continue;
    for (const [key, op] of Object.entries(pathObj)) {
      if (!PATH_ITEM_OPERATIONS.has(key)) continue;
      tryWrapOperationResponse(op, doc, overrides, stats, log);
    }
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
export function normalizeDocument(doc, opts = {}) {
  const stats = {
    allOfFlattened: 0,
    oneOfRenamed: 0,
    anyOfRenamed: 0,
    stripped: [],
    opaqueConverted: [],
    pathParamsLifted: 0,
    serversStripped: 0,
    bareArrayWrapped: 0,
  };
  if (!doc || typeof doc !== 'object') return stats;
  renameVariants(doc, stats);
  stripMisplacedSchemaKeywords(doc, stats);
  convertOpaqueObjectsToStrings(doc, stats);
  liftPathItemParameters(doc, stats);
  stripNonRootServers(doc, stats);
  wrapBareArrayResponses(doc, opts, stats);
  walkAllOf(doc, doc, new Set(), stats);
  return stats;
}

function processFile(filePath, verbose, opts = {}) {
  const raw = readFileSync(filePath, 'utf8');
  const doc = yaml.load(raw);
  if (!doc || typeof doc !== 'object') {
    if (verbose) console.log(`Skipping ${filePath}: not a YAML object`);
    return null;
  }
  const log = {
    warn: (msg) => console.warn(`${filePath}: ${msg}`),
  };
  const stats = normalizeDocument(doc, { ...opts, log });
  const out = yaml.dump(doc, { lineWidth: -1, noRefs: true });
  writeFileSync(filePath, out, 'utf8');
  const touched =
    stats.allOfFlattened > 0 ||
    stats.oneOfRenamed > 0 ||
    stats.anyOfRenamed > 0 ||
    stats.stripped.length > 0 ||
    stats.opaqueConverted.length > 0 ||
    stats.pathParamsLifted > 0 ||
    stats.serversStripped > 0 ||
    stats.bareArrayWrapped > 0;
  if (verbose || touched) {
    console.log(
      `${filePath}: flattened ${stats.allOfFlattened} allOf, renamed ${stats.oneOfRenamed} oneOf / ${stats.anyOfRenamed} anyOf; stripped ${stats.stripped.length} misplaced keyword(s); converted ${stats.opaqueConverted.length} opaque object(s) to string; lifted ${stats.pathParamsLifted} path-item parameter(s) onto operations; stripped ${stats.serversStripped} non-root servers block(s); wrapped ${stats.bareArrayWrapped} bare-array response(s)`
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
 * consumption. See module header for the passes applied.
 *
 * @param {Object} options
 * @param {string} options.apiDir - directory containing .yaml/.yml files
 * @param {boolean} [options.verbose=false] - log per-pass detail
 * @param {Object} [options.bareArrayOverrides] - per-operationId override
 *   map for the wrapBareArrayResponses pass: { <operationId>: { wrapperKey?, columnName? } }
 * @returns {Promise<Object>} aggregate stats across all files
 */
export async function normalize({ apiDir, verbose = false, bareArrayOverrides = null } = {}) {
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
    pathParamsLifted: 0,
    serversStripped: 0,
    bareArrayWrapped: 0,
    filesProcessed: 0,
  };

  if (entries.length === 0) {
    console.log(`No YAML files found in ${apiDir}`);
    return aggregate;
  }

  console.log(`Normalizing ${entries.length} file(s) under ${apiDir}`);
  for (const f of entries) {
    const full = join(apiDir, f);
    const s = processFile(full, verbose, { bareArrayOverrides });
    if (!s) continue;
    aggregate.filesProcessed++;
    aggregate.allOfFlattened += s.allOfFlattened;
    aggregate.oneOfRenamed += s.oneOfRenamed;
    aggregate.anyOfRenamed += s.anyOfRenamed;
    aggregate.stripped.push(...s.stripped);
    aggregate.opaqueConverted.push(...s.opaqueConverted);
    aggregate.pathParamsLifted += s.pathParamsLifted;
    aggregate.serversStripped += s.serversStripped;
    aggregate.bareArrayWrapped += s.bareArrayWrapped;
  }
  console.log(`Done. Processed ${aggregate.filesProcessed} file(s).`);
  return aggregate;
}
