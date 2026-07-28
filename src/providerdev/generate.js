import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import csv from 'csv-parser';
import logger from '../logger.js';
import { createReadStream } from 'fs';
import { camelToSnake } from '../utils.js';

/**
 * Load manifest from CSV file
 * @param {string} configPath - Path to CSV config file
 * @returns {Promise<Object>} - Manifest object
 */
async function loadManifest(configPath) {
  const manifest = {};
  
  return new Promise((resolve, reject) => {
    createReadStream(configPath)
      .pipe(csv())
      .on('data', (row) => {
        const key = `${row.filename}::${row.path}::${row.verb}`;
        manifest[key] = row;
      })
      .on('end', () => {
        resolve(manifest);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

/**
 * Load specification from YAML or JSON file
 * @param {string} filepath - Path to specification file
 * @returns {Object} - Loaded specification
 */
function loadSpec(filepath) {
  const content = fs.readFileSync(filepath, 'utf-8');
  if (filepath.endsWith('.json')) {
    return JSON.parse(content);
  }
  return yaml.load(content);
}

/**
 * Write specification to file
 * @param {string} filepath - Output file path
 * @param {Object} data - Data to write
 */
function writeSpec(filepath, data) {
  fs.writeFileSync(filepath, yaml.dump(data, { sortKeys: false }));
}

/**
 * Encode reference path
 * @param {string} path - HTTP path
 * @param {string} verb - HTTP verb
 * @returns {string} - Encoded reference path
 */
function encodeRefPath(path, verb) {
  const encodedPath = path.replace(/\//g, '~1');
  return `#/paths/${encodedPath}/${verb}`;
}

/**
 * Get success response information
 * @param {Object} operation - Operation object
 * @returns {Object} - Response information
 */
function getSuccessResponseInfo(operation) {
  const responses = operation.responses || {};
  const twoXxCodes = Object.keys(responses)
    .filter(code => code.startsWith('2'))
    .sort();

  if (twoXxCodes.length === 0) {
    throw new Error('No 2xx response found, openAPIDocKey is required');
  }

  const lowest2xx = twoXxCodes[0];
  const content = responses[lowest2xx]?.content || {};
  const mediaTypes = Object.keys(content);

  // Default to 'application/json' if mediaType is not found
  const mediaType = mediaTypes.length > 0 ? mediaTypes[0] : 'application/json';

  return {
    mediaType,
    openAPIDocKey: lowest2xx
  };
}

/**
 * Convert string to snake_case
 * @param {string} name - String to convert
 * @returns {string} - Converted string
 */
function snakeCase(name) {
  return name.replace(/-/g, '_');
}

/**
 * Count the number of path parameters in a path
 * @param {string} path - HTTP path
 * @returns {number} - Number of path parameters
 */
function countPathParams(path) {
  // Match all path parameters like {param_name}
  const matches = path.match(/\{[^}]+\}/g);
  return matches ? matches.length : 0;
}

/**
 * Sort operations from most specific to least specific based on path parameters
 * @param {Object} resources - Resources object containing methods and sqlVerbs
 * @param {Object} spec - Full OpenAPI specification
 * @returns {Object} - Resources with sorted sqlVerbs
 */
function sortOperationsBySpecificity(resources, spec) {
  // For each resource
  for (const resourceName in resources) {
    const resource = resources[resourceName];
    const methods = resource.methods;
    
    // Create a map of method references to their specificity (path param count)
    const methodSpecificityMap = {};
    
    // For each method, find its operation ref and count path params
    for (const methodName in methods) {
      const method = methods[methodName];
      const operationRef = method.operation.$ref;
      
      // Extract path and verb from the reference
      // Reference format: '#/paths/{encodedPath}/{verb}'
      const refParts = operationRef.split('/');
      const verb = refParts.pop();
      // Remove '#/paths/' and the verb, then decode the path
      const encodedPath = refParts.slice(2).join('/');
      const path = encodedPath.replace(/~1/g, '/');
      
      // Count path parameters
      const paramCount = countPathParams(path);
      
      // Store the method reference and its path parameter count
      const methodRef = `#/components/x-stackQL-resources/${resourceName}/methods/${methodName}`;
      methodSpecificityMap[methodRef] = paramCount;
    }
    
    // For each SQL verb, sort the operations by specificity
    for (const verbName in resource.sqlVerbs) {
      const operations = resource.sqlVerbs[verbName];
      
      if (operations && operations.length > 0) {
        // Sort operations from most specific (more path params) to least specific
        operations.sort((a, b) => {
          const aRef = a.$ref;
          const bRef = b.$ref;
          return methodSpecificityMap[bRef] - methodSpecificityMap[aRef];
        });
      }
    }
  }
  
  return resources;
}

/**
 * Rename all path parameter names (in: path only) to snake_case as a
 * preprocessing step before x-stackQL-resources is generated.
 *
 * Three passes:
 *   1. components/parameters — rename the `name` field where in === 'path'
 *      (component keys / $ref paths are left untouched)
 *   2. Inline parameters at path-item and operation level — same rule
 *   3. Rebuild spec.paths with snake_case {placeholder} tokens in the keys
 *
 * Returns { spec, pathKeyMap } where pathKeyMap maps each new path string to
 * its original string (used so the CSV manifest lookup still works).
 *
 * @param {Object} spec - OpenAPI spec (mutated in place for parameter names;
 *                        spec.paths is replaced with a new object)
 * @returns {{ spec: Object, pathKeyMap: Object }}
 */
function normalizePathParamNames(spec) {
  const validVerbs = ['get', 'post', 'put', 'patch', 'delete'];

  // Pass 1: components/parameters
  for (const compParam of Object.values(spec.components?.parameters || {})) {
    if (compParam.in === 'path' && compParam.name) {
      compParam.name = camelToSnake(compParam.name);
    }
  }

  // Pass 2: inline parameters at path-item and operation level
  for (const pathItem of Object.values(spec.paths || {})) {
    for (const param of pathItem.parameters || []) {
      if (!param.$ref && param.in === 'path' && param.name) {
        param.name = camelToSnake(param.name);
      }
    }
    for (const verb of validVerbs) {
      for (const param of pathItem[verb]?.parameters || []) {
        if (!param.$ref && param.in === 'path' && param.name) {
          param.name = camelToSnake(param.name);
        }
      }
    }
  }

  // Pass 3: rename {placeholder} tokens in path URL strings and rebuild
  // spec.paths with the new keys
  const newPaths = {};
  const pathKeyMap = {}; // newPath → originalPath

  for (const [originalPath, pathItem] of Object.entries(spec.paths || {})) {
    const newPath = originalPath.replace(
      /\{([^}]+)\}/g,
      (_, paramName) => `{${camelToSnake(paramName)}}`
    );
    newPaths[newPath] = pathItem;
    if (newPath !== originalPath) {
      pathKeyMap[newPath] = originalPath;
    }
  }

  spec.paths = newPaths;
  return { spec, pathKeyMap };
}

/**
 * Dedent a YAML fragment that lives at the resource-key indentation level
 * (typically 4 spaces because the fragment is intended to be spliced under
 * `components.x-stackQL-resources`). Detects the smallest leading indent
 * across non-blank lines and strips that many leading spaces from every
 * line, so the result parses as a top-level YAML mapping.
 * @param {string} text
 * @returns {string}
 */
function dedentYamlFragment(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const m = line.match(/^( *)\S/);
    if (!m) continue;
    if (m[1].length < minIndent) minIndent = m[1].length;
    if (minIndent === 0) break;
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) return text;
  return lines.map(l => l.slice(minIndent)).join('\n');
}

/**
 * Read and parse `<viewsDir>/<serviceName>/views.yaml` if it exists.
 * Returns a plain object mapping view name -> view body, or null if no
 * fragment is present. Throws on parse errors so the generate run fails
 * loudly rather than silently dropping views.
 * @param {string} viewsDir - root views directory
 * @param {string} serviceName - service folder name (snake_case)
 * @returns {Object|null}
 */
export function loadServiceViews(viewsDir, serviceName) {
  if (!viewsDir) return null;
  const viewsFile = path.join(viewsDir, serviceName, 'views.yaml');
  if (!fs.existsSync(viewsFile)) return null;
  const raw = fs.readFileSync(viewsFile, 'utf-8');
  const dedented = dedentYamlFragment(raw);
  const parsed = yaml.load(dedented);
  if (parsed === null || parsed === undefined) return null;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`views fragment ${viewsFile} must parse to a YAML mapping at the top level`);
  }
  return parsed;
}

/**
 * Splice view entries into a service spec's `components.x-stackQL-resources`
 * map. Existing API-derived entries always win on key collision so a view
 * cannot silently overwrite a real resource; collisions are reported via
 * the supplied logger. If an existing entry is deep-equal to the incoming
 * view body, treat as an idempotent re-run and skip silently.
 *
 * Mutates `spec` in place. Returns counts for logging.
 *
 * @param {Object} spec - service spec (mutated)
 * @param {Object} views - parsed view map (name -> body)
 * @param {Object} log - logger with .info/.warn methods
 * @param {string} serviceName - for log messages
 * @returns {{ merged: number, skippedIdempotent: number, collisions: string[] }}
 */
export function mergeViewsIntoSpec(spec, views, log, serviceName) {
  const result = { merged: 0, skippedIdempotent: 0, collisions: [] };
  if (!views || typeof views !== 'object') return result;
  if (!spec.components) spec.components = {};
  if (!spec.components['x-stackQL-resources']) spec.components['x-stackQL-resources'] = {};
  const target = spec.components['x-stackQL-resources'];

  for (const [viewName, viewBody] of Object.entries(views)) {
    if (Object.prototype.hasOwnProperty.call(target, viewName)) {
      const existing = target[viewName];
      if (deepEqual(existing, viewBody)) {
        result.skippedIdempotent++;
        continue;
      }
      result.collisions.push(viewName);
      log.warn(`⚠️ View '${viewName}' collides with existing resource in ${serviceName}; keeping the existing entry`);
      continue;
    }
    target[viewName] = viewBody;
    result.merged++;
  }
  return result;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Build the Go-template transform.body string for a bare-array response
 * wrap. Two flavours: scalar items get a per-item wrap into a
 * single-column row; object items just rename the outer array under
 * the wrapper key.
 * @param {Object} wrap - { wrapperKey, scalar, columnName? }
 * @returns {string} - Go template body
 */
function buildBareArrayTransformBody(wrap) {
  const { wrapperKey, scalar, columnName } = wrap;
  if (scalar) {
    return [
      `{{- $wrapped := printf "{\\"items\\":%s}" . -}}`,
      `{{- $parsed := jsonMapFromString $wrapped -}}`,
      `{{- $items := index $parsed "items" -}}`,
      `{"${wrapperKey}":[{{- range $i, $v := $items -}}{{- if $i -}},{{- end -}}{"${columnName}":"{{- $v -}}"}{{- end -}}]}`,
    ].join('\n');
  }
  return [
    `{{- $wrapped := printf "{\\"${wrapperKey}\\":%s}" . -}}`,
    `{{- $wrapped -}}`,
  ].join('\n');
}

/**
 * Apply bare-array-wrap follow-through: when the OpenAPI operation has
 * the `x-stackql-bare-array-wrap` marker (set by normalize's pass 1f),
 * attach `objectKey` and a Go-template `transform` to the resource
 * method, and strip the marker from the operation so it does not
 * persist in the written spec.
 * @param {Object} methodEntry - resource method entry being built
 * @param {Object} operation - the OpenAPI operation
 */
export function applyBareArrayWrap(methodEntry, operation) {
  if (!operation || typeof operation !== 'object') return;
  const wrap = operation['x-stackql-bare-array-wrap'];
  if (!wrap || typeof wrap !== 'object') return;

  methodEntry.response = methodEntry.response || {};
  methodEntry.response.objectKey = `$.${wrap.wrapperKey}`;
  // overrideMediaType + schema_override tell stackql's response pipeline
  // that the runtime payload should be re-typed against the synthesised
  // wrapper schema. Without these the transform never fires and the row
  // projector hits the original bare-array payload.
  const mediaType = wrap.mediaType || methodEntry.response.mediaType || 'application/json';
  methodEntry.response.overrideMediaType = mediaType;
  if (wrap.wrapperName) {
    methodEntry.response.schema_override = {
      $ref: `#/components/schemas/${wrap.wrapperName}`,
    };
  }
  methodEntry.response.transform = {
    body: buildBareArrayTransformBody(wrap),
    type: 'golang_template_text_v0.3.0',
  };

  delete operation['x-stackql-bare-array-wrap'];
}

/**
 * Generate StackQL provider extensions
 * @param {Object} options - Options for generation
 * @returns {Promise<boolean>} - Success status
 */
export async function generate(options) {
  const {
    inputDir,
    outputDir,
    configPath,
    providerId,
    servers = null,
    providerConfig = null,
    serviceConfig = null,
    naiveReqBodyTranslate = false,
    updatePathParamNames = false,
    skipFiles = [],
    viewsDir = null,
    verbose = false
  } = options;

  const version = 'v00.00.00000';
  const servicesPath = path.join(outputDir, version, 'services');
  
  // Create directories
  fs.mkdirSync(servicesPath, { recursive: true });
  
  // Clean all files in services output dir
  try {
    const files = fs.readdirSync(servicesPath);
    for (const file of files) {
      const filePath = path.join(servicesPath, file);
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
    }
    logger.info(`🧹 Cleared all files in ${servicesPath}`);
  } catch (error) {
    logger.error(`Failed to clear files in ${servicesPath}: ${error.message}`);
    return false;
  }
  
  // Delete provider.yaml file
  const providerManifestFile = path.join(outputDir, version, 'provider.yaml');
  if (fs.existsSync(providerManifestFile)) {
    fs.unlinkSync(providerManifestFile);
    logger.info(`🧹 Deleted ${providerManifestFile}`);
  }
  
  // Load manifest
  let manifest;
  try {
    manifest = await loadManifest(configPath);
  } catch (error) {
    logger.error(`Failed to load manifest: ${error.message}`);
    return false;
  }
  
  // Parse serviceConfig if provided
  let serviceConfigJson = null;
  if (serviceConfig) {
    try {
      serviceConfigJson = JSON.parse(serviceConfig);
    } catch (error) {
      logger.error(`❌ Failed to parse service config JSON: ${error.message}`);
      return false;
    }
  }

  const providerServices = {};

  try {
    const files = fs.readdirSync(inputDir);
    
    for (const filename of files) {

      const filePath = path.join(inputDir, filename);
      
      // Skip directories
      if (fs.statSync(filePath).isDirectory()) {
        logger.info(`📁 Skipping directory: ${filename}`);
        continue;
      }
  
      if (skipFiles.includes(filename)) {
        logger.info(`⭐️ Skipping ${filename} (matched --skip)`);
        continue;
      }
      
      if (!filename.endsWith('.yaml') && !filename.endsWith('.yml') && !filename.endsWith('.json')) {
        continue;
      }
      
      const baseName = path.basename(filename, path.extname(filename));
      const serviceName = snakeCase(baseName);

      console.log(`processing service: ${serviceName}`);

      const specPath = path.join(inputDir, filename);
      let spec = loadSpec(specPath);

      // Preprocessing: convert path parameter names to snake_case
      let pathKeyMap = {};
      if (updatePathParamNames) {
        ({ spec, pathKeyMap } = normalizePathParamNames(spec));
      }

      // Initialize resources object with defaultdict-like behavior
      const resources = {};

      // Define valid HTTP verbs to process
      const validVerbs = ['get', 'post', 'put', 'patch', 'delete'];      
      
      for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
        for (const [verb, operation] of Object.entries(pathItem)) {
          // Only process valid HTTP verbs
          if (!validVerbs.includes(verb)) {
            continue;
          }

          if (typeof operation !== 'object' || operation === null) {
            continue;
          }
          
          const operationId = operation.operationId;
          if (!operationId) {
            continue;
          }
          
          const originalPathKey = pathKeyMap[pathKey] || pathKey;
          const manifestKey = `${filename}::${originalPathKey}::${verb}`;
          const entry = manifest[manifestKey];
          if (!entry) {
            logger.error(`❌ ERROR: ${filename} → ${operationId} not found in manifest`);
            return false;
          }

          /**
           * `skip_this_resource` sentinel: when the manifest row's
           * stackql_resource_name equals this literal, bypass registration
           * under components.x-stackQL-resources without mutating the spec.
           * Needed for operations that can't be registered as StackQL methods
           * (e.g. endpoints with no 2xx response such as 302-only downloads)
           * or vendor-specific operations the provider doesn't want to expose,
           * while still leaving the raw operation in spec.paths.
           */
          if (entry.stackql_resource_name === 'skip_this_resource') {
            logger.info(`Skipping operation ${filename} -> ${operationId} (marked skip_this_resource)`);
            continue;
          }

          const resource = entry.stackql_resource_name;
          const method = entry.stackql_method_name;
          const sqlverb = entry.stackql_verb;

          // Error and exit if any required mapping fields are missing
          const missingMappings = [];
          if (!resource) missingMappings.push('resource');
          if (!method) missingMappings.push('method_name');
          if (!sqlverb) missingMappings.push('stackql_verb');
          if (missingMappings.length > 0) {
            logger.error(`❌ ${filename}/${operationId} is not mapped to a ${missingMappings.join(', ')}`);
            return false;
          }

          // Initialize resource if it doesn't exist
          if (!resources[resource]) {
            resources[resource] = {
              id: `${providerId}.${serviceName}.${resource}`,
              name: resource,
              title: resource.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              methods: {},
              sqlVerbs: { 
                select: [], 
                insert: [], 
                update: [], 
                delete: [], 
                replace: [] 
              }
            };
          }
          
          const pathRef = encodeRefPath(pathKey, verb);
          const responseInfo = getSuccessResponseInfo(operation);
          
          const methodEntry = {};

          // Add requestBodyTranslate config for methods with request bodies
          if (naiveReqBodyTranslate && ['post', 'put', 'patch'].includes(verb)) {
            // Check if the operation actually has a request body
            if (operation.requestBody) {
              methodEntry.config = {
                requestBodyTranslate: {
                  algorithm: 'naive'
                }
              };
            }
          }

          methodEntry.operation = { $ref: pathRef };
          methodEntry.response = responseInfo;

          // Add objectKey to the response info if it exists in the manifest and is for a GET operation
          if (entry.stackql_object_key && verb === 'get') {
            methodEntry.response.objectKey = entry.stackql_object_key;
          }

          // If normalize's wrapBareArrayResponses marked this operation,
          // attach the matching transform.body and objectKey here. The
          // wrap is authoritative — it overrides any CSV-supplied
          // objectKey because the wrapper schema dictates the shape.
          applyBareArrayWrap(methodEntry, operation);

          resources[resource].methods[method] = methodEntry;
          if (sqlverb && sqlverb === 'exec') {
            logger.info(`exec method skipped:  ${resource}.${method}`);
          } else if (sqlverb && resources[resource].sqlVerbs[sqlverb]) {
            resources[resource].sqlVerbs[sqlverb].push({
              $ref: `#/components/x-stackQL-resources/${resource}/methods/${method}`
            });
          } else if (sqlverb) {
            logger.warn(`⚠️ Unknown SQL verb '${sqlverb}' for ${resource}.${method}, skipping`);
          }
        }
      }
      
      // Sort operations by specificity before injecting into spec
      const sortedResources = sortOperationsBySpecificity(resources, spec);
      
      // Inject into spec
      if (!spec.components) {
        spec.components = {};
      }
      spec.components['x-stackQL-resources'] = sortedResources;

      // Splice convenience views from <viewsDir>/<serviceName>/views.yaml,
      // if any. Existing API-derived resources always win on key collision.
      if (viewsDir) {
        let serviceViews = null;
        try {
          serviceViews = loadServiceViews(viewsDir, serviceName);
        } catch (err) {
          logger.error(`❌ Failed to load views for ${serviceName}: ${err.message}`);
          return false;
        }
        if (serviceViews) {
          const mergeStats = mergeViewsIntoSpec(spec, serviceViews, logger, serviceName);
          if (mergeStats.merged > 0 || mergeStats.collisions.length > 0 || (verbose && mergeStats.skippedIdempotent > 0)) {
            logger.info(`📐 ${serviceName}: merged ${mergeStats.merged} view(s), ${mergeStats.skippedIdempotent} idempotent skip(s), ${mergeStats.collisions.length} collision(s)`);
          }
        } else if (verbose) {
          logger.info(`📐 ${serviceName}: no views fragment under ${viewsDir}`);
        }
      }

      // Inject servers if provided
      if (servers) {
        try {
          const serversJson = JSON.parse(servers);
          spec.servers = serversJson;
        } catch (error) {
          logger.error(`❌ Failed to parse servers JSON: ${error.message}`);
          return false;
        }
      }

      // Inject x-stackQL-config if serviceConfig is provided
      if (serviceConfigJson) {
        spec['x-stackQL-config'] = serviceConfigJson;
      }

      // Write enriched spec (always as YAML, ensuring .yaml extension)
      const outputFilename = filename.endsWith('.json') 
        ? filename.replace(/\.json$/, '.yaml') 
        : filename;
      const outputPath = path.join(servicesPath, outputFilename);
      writeSpec(outputPath, spec);
      logger.info(`✅ Wrote enriched spec: ${outputPath}`);
      
      // Add providerService entry
      const info = spec.info || {};
      const specTitle = info.title || `${serviceName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} API`;
      const specDescription = info.description || `TODO: add description for ${serviceName}`;
      
      providerServices[serviceName] = {
        id: `${serviceName}:${version}`,
        name: serviceName,
        preferred: true,
        service: {
          $ref: `${providerId}/${version}/services/${outputFilename}`
        },
        title: specTitle,
        version: version,
        description: specDescription
      };
    }
    
    // Write provider.yaml
    const providerYaml = {
      id: providerId,
      name: providerId,
      version: version,
      providerServices: providerServices,
    };
    
    if (providerConfig) {
      try {
        const providerConfigJson = JSON.parse(providerConfig);
        providerYaml.config = providerConfigJson;
      } catch (error) {
        logger.error(`❌ Failed to parse provider config JSON: ${error.message}`);
        return false;
      }
    }
    
    writeSpec(path.join(outputDir, version, 'provider.yaml'), providerYaml);
    logger.info(`📦 Wrote provider.yaml to ${outputDir}/${version}/provider.yaml`);
    
    return true;
  } catch (error) {
    logger.error(`Failed to generate provider: ${error.message}`);
    return false;
  }
}