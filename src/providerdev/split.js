// @stackql/provider-utils/src/providerdev/split.js

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import logger from '../logger.js';
import {
  camelToSnake,
  createDestDir
} from '../utils.js';

// Constants
const OPERATIONS = ["get", "post", "put", "delete", "patch", "options", "head", "trace"];
const COMPONENTS_CHILDREN = ["schemas", "responses", "parameters", "examples", "requestBodies", "headers", "securitySchemes", "links", "callbacks"];

/**
 * Check if operation should be excluded
 * @param {string[]} exclude - List of exclusion criteria
 * @param {Object} opItem - Operation item from OpenAPI doc
 * @param {string} svcDiscriminator - Service discriminator 
 * @returns {boolean} - Whether operation should be excluded
 */
function isOperationExcluded(exclude, opItem) {
  if (!exclude || exclude.length === 0) {
    return false;
  }
  
  // Example: exclude based on tags or other criteria
  if (opItem.tags && opItem.tags.some(tag => exclude.includes(tag))) {
    return true;
  }
  
  return false;
}

/**
 * Normalize a raw service name returned by a discriminator into the
 * filesystem-safe identifier used as the service key (lowercase, with
 * hyphens / spaces / dots collapsed to underscores).
 * @param {string} raw
 * @returns {string}
 */
function normalizeServiceName(raw) {
  return String(raw).toLowerCase().replace(/-/g, '_').replace(/ /g, '_').replace(/\./g, '_');
}

/**
 * Determine service name and description using discriminator
 * @param {string} providerName - Provider name
 * @param {Object} opItem - Operation item
 * @param {string} pathKey - Path key
 * @param {string} svcDiscriminator - Service discriminator ("tag", "path", or "function")
 * @param {Object[]} allTags - All tags from API doc
 * @param {boolean} debug - Debug flag
 * @param {Object} svcNameOverrides - Service name overrides
 * @param {Function} [svcDiscriminatorFn] - User-supplied function used when svcDiscriminator === "function".
 *   Called as fn(pathKey, operationId, tags, { providerName, pathItem, operation }).
 *   Should return a service name string, or "skip"/null/undefined to skip the operation.
 * @param {Object} [pathItem] - The full path item (for context when invoking svcDiscriminatorFn)
 * @returns {[string, string]} - [service name, service description]
 */
function retServiceNameAndDesc(providerName, opItem, pathKey, svcDiscriminator, allTags, debug, svcNameOverrides, svcDiscriminatorFn, pathItem) {
  let service = "default";
  let serviceDesc = `${providerName} API`;

  // Use tags if discriminator is "tag"
  if (svcDiscriminator === "tag" && opItem.tags && opItem.tags.length > 0) {
    service = normalizeServiceName(opItem.tags[0]);

    // Find description in all_tags
    for (const tag of allTags) {
      if (tag.name === service) {
        serviceDesc = tag.description || serviceDesc;
        break;
      }
    }
  }

  // Use first significant path segment if discriminator is "path"
  else if (svcDiscriminator === "path") {
    const pathParts = pathKey.replace(/^\//, '').split('/');
    if (pathParts.length > 0) {
      // Find the first path segment that is not 'api', 'v{number}', or '{apiVersion}'
      for (const part of pathParts) {
        const lowerPart = part.toLowerCase();
        // Skip if it's 'api', matches version pattern 'v1', 'v2', etc., or is '{apiVersion}'
        if (lowerPart === 'api' || /^v\d+$/.test(lowerPart) || /^\{.*version\}$/i.test(part)) {
          continue;
        }
        service = normalizeServiceName(lowerPart);
        break;
      }
      serviceDesc = `${providerName} ${service} API`;
    }
  }

  // Use a user-supplied function if discriminator is "function"
  else if (svcDiscriminator === "function") {
    if (typeof svcDiscriminatorFn !== 'function') {
      throw new Error('svcDiscriminator is "function" but no svcDiscriminatorFn was provided');
    }
    const tags = Array.isArray(opItem.tags) ? opItem.tags : [];
    const operationId = opItem.operationId || null;
    const raw = svcDiscriminatorFn(pathKey, operationId, tags, { providerName, pathItem, operation: opItem });
    if (raw === null || raw === undefined || raw === '') {
      return ["skip", ""];
    }
    service = normalizeServiceName(raw);
    // Prefer a tag description matching the returned service name; otherwise
    // fall back to a generic "<provider> <service> API".
    let matched = null;
    for (const tag of allTags) {
      if (tag.name && normalizeServiceName(tag.name) === service) {
        matched = tag.description || null;
        break;
      }
    }
    serviceDesc = matched || `${providerName} ${service} API`;
  }

  // Check if service should be skipped
  if (service === "skip") {
    return ["skip", ""];
  }
  
  // Apply service name overrides if present
  if (svcNameOverrides && svcNameOverrides[service]) {
    const newName = svcNameOverrides[service];
    if (debug) {
      logger.debug(`Overriding service name: ${service} -> ${newName}`);
    }
    
    // Update service description for discriminators that synthesize the desc
    // from the service name (path / function). For tag mode the description
    // came from the original tag and is left intact.
    if (svcDiscriminator === "path" || svcDiscriminator === "function") {
      serviceDesc = `${providerName} ${newName} API`;
    }
    
    service = newName;
  }
  
  return [service, serviceDesc];
}


/**
 * Initialize service map
 * @param {Object} services - Services map
 * @param {string[]} componentsChildren - Components children
 * @param {string} service - Service name
 * @param {string} serviceDesc - Service description
 * @param {Object} apiDoc - API doc
 * @returns {Object} - Updated services map
 */
function initService(services, componentsChildren, service, serviceDesc, apiDoc) {
  services[service] = {
    openapi: apiDoc.openapi || "3.0.0",
    info: {
      title: `${service} API`,
      description: serviceDesc,
      version: apiDoc.info?.version || "1.0.0"
    },
    paths: {},
    components: {}
  };
  
  // Initialize components sections
  services[service].components = {};
  for (const child of componentsChildren) {
    services[service].components[child] = {};
  }
  
  // Copy servers if present
  if (apiDoc.servers) {
    services[service].servers = apiDoc.servers;
  }
  
  return services;
}

/**
 * Extract all $ref values from an object recursively
 * @param {any} obj - Object to extract refs from
 * @returns {Set<string>} - Set of refs
 */
function getAllRefs(obj) {
  const refs = new Set();
  
  if (typeof obj === 'object' && obj !== null) {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        for (const ref of getAllRefs(item)) {
          refs.add(ref);
        }
      }
    } else {
      for (const [key, value] of Object.entries(obj)) {
        if (key === "$ref" && typeof value === 'string') {
          refs.add(value);
        } else if (typeof value === 'object' && value !== null) {
          for (const ref of getAllRefs(value)) {
            refs.add(ref);
          }
        }
      }
    }
  }
  
  return refs;
}

/**
 * Extract all $ref values from path-level parameters and non-operation elements
 * @param {Object} pathItem - Path item from OpenAPI doc
 * @returns {Set<string>} - Set of refs
 */
function getPathLevelRefs(pathItem) {
  const refs = new Set();
  
  // Check for path-level parameters
  if (pathItem.parameters) {
    for (const param of pathItem.parameters) {
      if (param.$ref) {
        refs.add(param.$ref);
      } else if (typeof param === 'object') {
        // Extract refs from schema if present
        if (param.schema && param.schema.$ref) {
          refs.add(param.schema.$ref);
        }
        
        // Also get all nested refs in the parameter object
        for (const ref of getAllRefs(param)) {
          refs.add(ref);
        }
      }
    }
  }
  
  // Also check other non-operation properties for refs
  for (const key in pathItem) {
    if (!OPERATIONS.includes(key)) {
      for (const ref of getAllRefs(pathItem[key])) {
        refs.add(ref);
      }
    }
  }
  
  return refs;
}

/**
 * Add missing type: object to schema objects
 * @param {any} obj - Object to process
 * @returns {any} - Processed object
 */
function addMissingObjectTypes(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => addMissingObjectTypes(item));
  }
  
  // If it has properties but no type, add type: object
  if (obj.properties && !obj.type) {
    obj.type = "object";
  }
  
  // Process nested objects
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      obj[key] = addMissingObjectTypes(value);
    }
  }
  
  return obj;
}

/**
 * Recursively resolve and add all references to service components
 * @param {Set<string>} refs - Set of references to resolve
 * @param {Object} service - Service object to add components to
 * @param {Object} components - Source components from API doc
 * @param {boolean} debug - Debug flag
 * @param {Set<string>} processed - Set of already processed refs (to prevent infinite recursion)
 */
function resolveReferences(refs, service, components, debug, processed = new Set()) {
  let newRefs = new Set();
  
  for (const ref of refs) {
    // Skip if already processed
    if (processed.has(ref)) {
      continue;
    }
    
    processed.add(ref);
    
    const parts = ref.split('/');
    
    // Only process refs that point to components
    if (parts.length >= 4 && parts[1] === "components") {
      const componentType = parts[2];
      const componentName = parts[3];
      
      // Check if component type exists in service
      if (!service.components[componentType]) {
        service.components[componentType] = {};
      }
      
      // Skip if component already added
      if (service.components[componentType][componentName]) {
        continue;
      }
      
      // Add component if it exists in source document
      if (components[componentType] && components[componentType][componentName]) {
        service.components[componentType][componentName] = 
          JSON.parse(JSON.stringify(components[componentType][componentName]));
        
        if (debug) {
          logger.debug(`Added component ${componentType}/${componentName}`);
        }
        
        // Find all refs in the newly added component
        const componentRefs = getAllRefs(service.components[componentType][componentName]);
        for (const cRef of componentRefs) {
          if (!processed.has(cRef)) {
            newRefs.add(cRef);
          }
        }
      } else if (debug) {
        logger.debug(`WARNING: Could not find component ${componentType}/${componentName}`);
      }
    }
  }
  
  // If we found new refs, resolve them too (recursively)
  if (newRefs.size > 0) {
    if (debug) {
      logger.debug(`Found ${newRefs.size} additional refs to resolve`);
    }
    resolveReferences(newRefs, service, components, debug, processed);
  }
}

/**
 * Split OpenAPI document into service-specific files
 * @param {Object} options - Options for splitting
 * @returns {Promise<boolean>} - Success status
 */
export async function split(options) {
  const {
    apiDoc,
    providerName,
    outputDir,
    svcDiscriminator = "tag",
    svcDiscriminatorFn = null,
    exclude = null,
    overwrite = true,
    verbose = false,
    svcNameOverrides = {}  // Add this new parameter with default empty object
  } = options;

  // Setup logging based on verbosity
  if (verbose) {
    logger.level = 'debug';
  }

  logger.info(`🔄 Splitting OpenAPI doc for ${providerName}`);
  logger.info(`API Doc: ${apiDoc}`);
  logger.info(`Output: ${outputDir}`);
  logger.info(`Service Discriminator: ${svcDiscriminator}`);

  if (svcDiscriminator === "function" && typeof svcDiscriminatorFn !== 'function') {
    logger.error('❌ svcDiscriminator is "function" but svcDiscriminatorFn was not supplied or is not callable');
    return false;
  }

  if (Object.keys(svcNameOverrides).length > 0) {
    logger.info(`Using ${Object.keys(svcNameOverrides).length} service name overrides`);
    if (verbose) {
      logger.debug(`Service name overrides: ${JSON.stringify(svcNameOverrides, null, 2)}`);
    }
  }
  
  // Process exclude list
  const excludeList = exclude ? exclude.split(",") : [];
  
  // Read the OpenAPI document
  let apiDocObj;
  try {
    const apiDocContent = fs.readFileSync(apiDoc, 'utf8');
    apiDocObj = yaml.load(apiDocContent);
  } catch (e) {
    logger.error(`❌ Failed to parse ${apiDoc}: ${e.message}`);
    return false;
  }
  
  // Create destination directory
  if (!createDestDir(outputDir, overwrite)) {
    return false;
  }
  
  // Get API paths
  const apiPaths = apiDocObj.paths || {};
  logger.info(`🔑 Iterating over ${Object.keys(apiPaths).length} paths`);
  
  const services = {};
  let opCounter = 0;
  
  // First pass: identify all services and collect operations
  for (const [pathKey, pathItem] of Object.entries(apiPaths)) {
    if (verbose) {
      logger.debug(`Processing path ${pathKey}`);
    }
    
    if (!pathItem) {
      continue;
    }
    
    // Collect all services that use this path
    const pathServices = new Set();
    
    // Process each operation (HTTP verb)
    for (const [verbKey, opItem] of Object.entries(pathItem)) {
      if (!OPERATIONS.includes(verbKey) || !opItem) {
        continue;
      }
      
      opCounter += 1;
      if (opCounter % 100 === 0) {
        logger.info(`⚙️ Operations processed: ${opCounter}`);
      }
      
      if (verbose) {
        logger.debug(`Processing operation ${pathKey}:${verbKey}`);
      }
      
      // Skip excluded operations
      if (isOperationExcluded(excludeList, opItem)) {
        continue;
      }
      
      const [service, serviceDesc] = retServiceNameAndDesc(
        providerName, opItem, pathKey, svcDiscriminator,
        apiDocObj.tags || [], verbose, svcNameOverrides,
        svcDiscriminatorFn, pathItem
      );

      // Skip if service is marked to skip
      if (service === 'skip') {
        logger.warn(`⭐️ Skipping service: ${service}`);
        continue;
      }
      
      pathServices.add(service);
      
      if (verbose) {
        logger.debug(`Service name: ${service}`);
        logger.debug(`Service desc: ${serviceDesc}`);
      }
      
      // Initialize service if first occurrence
      if (!services[service]) {
        if (verbose) {
          logger.debug(`First occurrence of ${service}`);
        }
        initService(services, COMPONENTS_CHILDREN, service, serviceDesc, apiDocObj);
      }
      
      // Add operation to service
      if (!services[service].paths[pathKey]) {
        if (verbose) {
          logger.debug(`First occurrence of ${pathKey}`);
        }
        services[service].paths[pathKey] = {};
      }
      
      services[service].paths[pathKey][verbKey] = opItem;
      
      // Special case for GitHub
      if (providerName === 'github' && 
          opItem['x-github'] && 
          opItem['x-github'].subcategory) {
        services[service].paths[pathKey][verbKey]['x-stackQL-resource'] = camelToSnake(
          opItem['x-github'].subcategory
        );
      }
    }
    
    // For each service that uses this path, add path-level parameters
    for (const service of pathServices) {
      // Copy non-operation elements (like parameters) to service paths
      for (const key in pathItem) {
        if (!OPERATIONS.includes(key)) {
          if (!services[service].paths[pathKey]) {
            services[service].paths[pathKey] = {};
          }
          services[service].paths[pathKey][key] = pathItem[key];
        }
      }
    }
  }
  
  // Second pass: collect all references for each service
  for (const service in services) {
    if (verbose) {
      logger.debug(`Collecting references for service ${service}`);
    }
    
    // Get all refs from all operations in this service
    const allRefs = new Set();
    
    // Collect refs from paths
    for (const pathKey in services[service].paths) {
      const pathItem = services[service].paths[pathKey];
      
      // Get refs from path-level parameters
      const pathRefs = getPathLevelRefs(pathItem);
      for (const ref of pathRefs) {
        allRefs.add(ref);
      }
      
      // Get refs from operations
      for (const verbKey in pathItem) {
        if (OPERATIONS.includes(verbKey)) {
          const opRefs = getAllRefs(pathItem[verbKey]);
          for (const ref of opRefs) {
            allRefs.add(ref);
          }
        }
      }
    }
    
    if (verbose) {
      logger.debug(`Found ${allRefs.size} total refs for service ${service}`);
    }
    
    // Resolve all references recursively
    resolveReferences(allRefs, services[service], apiDocObj.components || {}, verbose);
  }
  
  // Update path param names (replace hyphens with underscores)
  for (const service in services) {
    if (services[service].paths) {
      const pathKeys = Object.keys(services[service].paths);
      for (const pathKey of pathKeys) {
        if (verbose) {
          logger.debug(`Renaming path params in ${service} for path ${pathKey}`);
        }
        
        // Replace hyphens with underscores in path parameters
        const updatedPathKey = pathKey.replace(/(?<=\{)([^}]+?)-([^}]+?)(?=\})/g, '$1_$2');
        
        if (updatedPathKey !== pathKey) {
          if (verbose) {
            logger.debug(`Updated path key from ${pathKey} to ${updatedPathKey}`);
          }
          
          services[service].paths[updatedPathKey] = services[service].paths[pathKey];
          delete services[service].paths[pathKey];
          
          // Also update parameter names in operations
          for (const verbKey in services[service].paths[updatedPathKey]) {
            const operation = services[service].paths[updatedPathKey][verbKey];
            if (operation.parameters) {
              for (const param of operation.parameters) {
                if (param.in === 'path' && param.name.includes('-')) {
                  const originalName = param.name;
                  param.name = param.name.replace(/-/g, '_');
                  if (verbose) {
                    logger.debug(`Updated parameter name from ${originalName} to ${param.name} in path ${updatedPathKey}`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  
  // Fix missing type: object
  for (const service in services) {
    if (verbose) {
      logger.debug(`Updating paths for ${service}`);
    }
    services[service].paths = addMissingObjectTypes(services[service].paths);
    services[service].components = addMissingObjectTypes(services[service].components);
  }
  
  // Cleanup empty components
  for (const service in services) {
    for (const componentType in services[service].components) {
      if (Object.keys(services[service].components[componentType]).length === 0) {
        delete services[service].components[componentType];
      }
    }
  }
  
  // Write out service docs
  for (const service in services) {
    logger.info(`✅ Writing out OpenAPI doc for [${service}]`);

    const outputFile = path.join(outputDir, `${service}.yaml`);    
    
    fs.writeFileSync(outputFile, yaml.dump(services[service], { 
      noRefs: true,
      sortKeys: false
    }));
  }
  
  logger.info(`🎉 Successfully split OpenAPI doc into ${Object.keys(services).length} services`);
  return true;
}