// src/providerdev/analyze.js
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import logger from '../logger.js';
import { camelToSnake } from '../utils.js';
import { createReadStream } from 'fs';
import csv from 'csv-parser';

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
 * Extract main 2xx response schema reference
 * @param {Object} responseObj - Response object
 * @returns {string} - Schema reference name
 */
function extractMain2xxResponse(responseObj) {
  for (const [code, response] of Object.entries(responseObj)) {
    if (code.startsWith('2')) {
      const content = response.content || {};
      const appJson = content['application/json'] || {};
      const schema = appJson.schema || {};

      // Case 1: Direct $ref
      if (schema.$ref) {
        return schema.$ref.split('/').pop();
      }

      // Case 2: Array of items
      if (schema.type === 'array') {
        const items = schema.items || {};
        if (items.$ref) {
          return items.$ref.split('/').pop();
        }
      }
      
      return '';
    }
  }
  return '';
}

/**
 * Detect if an object should have an objectKey and determine what it should be
 * @param {Object} spec - Full OpenAPI spec
 * @param {Object} operation - Operation object
 * @returns {string} - Suggested objectKey or empty string if none
 */
function detectObjectKey(spec, operation) {
  // Only applicable for GET operations
  if (!operation || !operation.responses) {
    return '';
  }
  
  // Check for explicit x-stackql-objectKey first
  if (operation['x-stackql-objectKey']) {
    return operation['x-stackql-objectKey'];
  }
  
  let responseObject = null;
  let responseCode = null;
  
  // Find the first 2xx response
  for (const [code, response] of Object.entries(operation.responses)) {
    if (code.startsWith('2')) {
      responseCode = code;
      // Handle direct response or reference
      if (response.$ref) {
        // Resolve reference
        const refParts = response.$ref.split('/');
        const componentType = refParts[2];
        const responseName = refParts[3];
        responseObject = spec.components?.[componentType]?.[responseName];
      } else {
        responseObject = response;
      }
      break;
    }
  }
  
  if (!responseObject) {
    return '';
  }
  
  // Get the schema from the response
  let schema = null;
  
  // If it's a direct response object
  if (responseObject.content?.['application/json']?.schema) {
    schema = responseObject.content['application/json'].schema;
  } 
  
  // If the schema is a reference, resolve it
  if (schema && schema.$ref) {
    const refParts = schema.$ref.split('/');
    const componentType = refParts[2];
    const schemaName = refParts[3];
    schema = spec.components?.[componentType]?.[schemaName];
  }
  
  // Handle allOf case (like in the droplets_list example)
  if (schema && schema.allOf) {
    // Look at the first object in allOf that has properties
    for (const subSchema of schema.allOf) {
      if (subSchema.properties && Object.keys(subSchema.properties).length === 1) {
        const key = Object.keys(subSchema.properties)[0];
        return `$.${key}`;
      }
    }
  }
  
  // Handle direct properties case (like in the droplets_get example)
  if (schema && schema.properties) {
    // If there's only one property at the top level, and it's not a primitive
    const propKeys = Object.keys(schema.properties);
    if (propKeys.length === 1) {
      const key = propKeys[0];
      const prop = schema.properties[key];
      
      // Check if the property is an object or array, not a primitive
      if (prop.$ref || 
          prop.type === 'object' || 
          prop.type === 'array' ||
          (prop.properties && Object.keys(prop.properties).length > 0)) {
        return `$.${key}`;
      }
    }
  }
  
  return '';
}

/**
 * Map HTTP verb to SQL verb
 * @param {string} httpVerb - HTTP verb (get, post, put, etc)
 * @returns {string} - Corresponding SQL verb
 */
function mapToSqlVerb(httpVerb) {
  const verbMap = {
    'get': 'select',
    'post': 'insert',
    'delete': 'delete',
    'put': 'replace',
    'patch': 'update'
  };
  
  return verbMap[httpVerb] || 'exec';
}

/**
 * Find existing mapping in x-stackQL-resources
 * @param {Object} spec - OpenAPI spec
 * @param {string} pathRef - Reference to path item
 * @returns {Object} - Mapping info (resource, method, verb)
 */
function findExistingMapping(spec, pathRef) {
  const stackQLResources = spec.components?.['x-stackQL-resources'] || {};
  
  for (const [resourceName, resource] of Object.entries(stackQLResources)) {
    // Check methods
    for (const [methodName, method] of Object.entries(resource.methods || {})) {
      if (method.operation?.$ref === pathRef) {
        logger.info(`Found mapping for ${pathRef}: ${resourceName}.${methodName}`);
        // Find SQL verb for this method
        let sqlVerb = 'exec'; // Default if no explicit mapping
        
        for (const [verb, methods] of Object.entries(resource.sqlVerbs || {})) {
          for (const methodRef of methods) {
            if (methodRef.$ref === `#/components/x-stackQL-resources/${resourceName}/methods/${methodName}`) {
              sqlVerb = verb;
              break;
            }
          }
        }
        
        // Get objectKey if present
        const objectKey = method.response?.objectKey || '';
        
        return {
          resourceName,
          methodName,
          sqlVerb,
          objectKey
        };
      }
    }
  }

  logger.info(`No mapping for ${pathRef}`);
  
  return {
    resourceName: '',
    methodName: '',
    sqlVerb: '',
    objectKey: ''
  };
}

/**
 * Escape and sanitize a CSV field value
 * @param {string} value - Field value to escape
 * @returns {string} - Escaped value
 */
function escapeCsvField(value) {
  if (!value) return '';
  
  // If the value contains commas, double quotes, or newlines, wrap it in quotes
  // and escape any existing double quotes by doubling them
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  
  return value;
}

/**
 * Analyze OpenAPI specs and generate mapping CSV
 * @param {Object} options - Options for analysis
 * @returns {Promise<boolean>} - Success status
 */
export async function analyze(options) {
  const {
    inputDir,
    outputDir
  } = options;

  try {
    // In the analyze function
    const outputPath = path.join(outputDir, 'all_services.csv');

    // Check if output file already exists
    let fileExists = false;
    if (fs.existsSync(outputPath)) {
      logger.info(`Output file already exists: ${outputPath}`);
      fileExists = true;
    } else if (!fs.existsSync(outputDir)) {
      logger.info(`Output directory does not exist. Creating: ${outputDir}`);
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // get existing mappings
    const existingMappings = {};
    if (fileExists) {
      try {
        await new Promise((resolve, reject) => {
          createReadStream(outputPath)
            .pipe(csv())
            .on('data', (row) => {
              if (row.operationId) {
                const key = `${row.filename}::${row.operationId}`;
                existingMappings[key] = {
                  resourceName: row.stackql_resource_name || '',
                  methodName: row.stackql_method_name || '',
                  sqlVerb: row.stackql_verb || '',
                  objectKey: row.stackql_object_key || ''
                };
              }
            })
            .on('end', () => {
              logger.info(`Loaded ${Object.keys(existingMappings).length} mappings from existing CSV`);
              resolve();
            })
            .on('error', (error) => {
              logger.error(`Failed to load existing CSV: ${error.message}`);
              reject(error);
            });
        });
      } catch (error) {
        logger.error(`Error processing CSV: ${error.message}`);
      }
    }

    // Create write stream - append if file exists
    const writer = fs.createWriteStream(outputPath, { 
      encoding: 'utf8',
      flags: fileExists ? 'a' : 'w'  // Use 'a' for append if file exists, 'w' for write if new
    });

    // Only write header if creating a new file
    if (!fileExists) {
      writer.write('filename,path,operationId,formatted_op_id,verb,response_object,tags,formatted_tags,stackql_resource_name,stackql_method_name,stackql_verb,stackql_object_key,op_description\n');
    }
    
    const files = fs.readdirSync(inputDir);
    
    for (const filename of files) {
      if (!filename.endsWith('.yaml') && !filename.endsWith('.yml') && !filename.endsWith('.json')) {
        continue;
      }
      
      const filepath = path.join(inputDir, filename);
      const spec = loadSpec(filepath);
      
      const relevantVerbs = ["get", "put", "post", "patch", "delete"];
      
      for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
        for (const [verb, operation] of Object.entries(pathItem)) {
          if (typeof operation !== 'object' || operation === null) {
            continue;
          }
          if(!relevantVerbs.includes(verb)) {
            logger.info(`Skipping irrelevant operation: ${verb}`);
            continue;
          }

          // Then in the operation processing loop:
          const operationId = operation.operationId || '';
          // Check if operation is already mapped in CSV
          const mappingKey = `${filename}::${operationId}`;
          if (operationId && existingMappings[mappingKey]) {
            const mapping = existingMappings[mappingKey];
            if (mapping.resourceName && mapping.methodName && mapping.sqlVerb) {
              logger.info(`Skipping already mapped operation: ${mappingKey} (${mapping.resourceName}.${mapping.methodName} - ${mapping.sqlVerb})`);
              continue; // Skip to next operation
            } else {
              logger.warn(`Operation ${mappingKey} found in CSV but has incomplete mapping`);
            }
          }

          // Format operationId as snake_case
          const formattedOpId = operationId ? camelToSnake(operationId) : '';
          
          const responseObj = operation.responses || {};
          const responseRef = extractMain2xxResponse(responseObj);
          const tagsList = operation.tags || [];
          const tagsStr = tagsList.join('|');
          
          // Format tags as snake_case
          const formattedTags = tagsList.map(tag => camelToSnake(tag)).join('|');
          
          // Construct the path reference as it would appear in x-stackQL-resources
          const encodedPath = pathKey.replace(/\//g, '~1');
          const pathRef = `#/paths/${encodedPath}/${verb}`;
          
          // Find existing mapping if available
          let { resourceName, methodName, sqlVerb, objectKey } = findExistingMapping(spec, pathRef);
          
          // Check for explicit x-stackql-resource in operation
          if (operation['x-stackql-resource']) {
            resourceName = operation['x-stackql-resource'];
          }
          
          // Check for explicit x-stackql-method in operation
          if (operation['x-stackql-method']) {
            methodName = operation['x-stackql-method'];
          }
          
          // CHANGE 1: Default methodName to formattedOpId if not found
          if (!methodName) {
            methodName = formattedOpId;
          }
          
          // Check for explicit x-stackql-verb or x-stackql-sqlVerb in operation
          if (operation['x-stackql-verb']) {
            sqlVerb = operation['x-stackql-verb'];
          } else if (operation['x-stackql-sqlVerb']) {
            sqlVerb = operation['x-stackql-sqlVerb'];
          }
          
          // CHANGE 2: Default sqlVerb based on HTTP verb if not found
          if (!sqlVerb) {
            sqlVerb = mapToSqlVerb(verb);
          }

          // CHANGE 3: Detect and set objectKey for GET operations if not already set
          if (!objectKey && verb === 'get') {
            objectKey = detectObjectKey(spec, operation);
          }
          
          // Get operation description
          const opDescription = operation.summary || operation.description || '';
          
          // Escape fields that might contain commas, quotes, or other special characters
          const escapedFields = {
            filename: escapeCsvField(filename),
            path: escapeCsvField(pathKey),
            operationId: escapeCsvField(operationId),
            formattedOpId: escapeCsvField(formattedOpId),
            verb: escapeCsvField(verb),
            responseRef: escapeCsvField(responseRef),
            tagsStr: escapeCsvField(tagsStr),
            formattedTags: escapeCsvField(formattedTags),
            resourceName: escapeCsvField(resourceName),
            methodName: escapeCsvField(methodName),
            sqlVerb: escapeCsvField(sqlVerb),
            objectKey: escapeCsvField(objectKey),
            opDescription: escapeCsvField(opDescription)
          };
          
          // Write row
          writer.write(`${escapedFields.filename},${escapedFields.path},${escapedFields.operationId},${escapedFields.formattedOpId},${escapedFields.verb},${escapedFields.responseRef},${escapedFields.tagsStr},${escapedFields.formattedTags},${escapedFields.resourceName},${escapedFields.methodName},${escapedFields.sqlVerb},${escapedFields.objectKey},${escapedFields.opDescription}\n`);
        }
      }
    }
    
    writer.end();
    
    logger.info(`✅ Analysis complete. Output written to: ${outputPath}`);
    return true;
  } catch (error) {
    logger.error(`Failed to analyze OpenAPI specs: ${error.message}`);
    return false;
  }
}