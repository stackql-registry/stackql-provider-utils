// src/docgen/helpers.js

// exported functions for use in other modules

export function getIndefiniteArticle(resourceName) {
  // Determine whether to use "a" or "an" based on the first letter's pronunciation
  const firstLetter = resourceName.charAt(0).toLowerCase();
  const vowelSounds = ['a', 'e', 'i', 'o', 'u'];
  // Special case for 'h' when it's silent (like in "hour")
  const specialCaseH = resourceName.toLowerCase().startsWith('hour');
  // Special case for words starting with 'u' but pronounced with 'y' sound (like "user")
  const specialCaseU = firstLetter === 'u' && !resourceName.toLowerCase().startsWith('un');

  let article = 'a';
  if (vowelSounds.includes(firstLetter) && !specialCaseU) {
    article = 'an';
  }
  // Handle special case for words starting with 'h' where 'h' is silent
  if (firstLetter === 'h' && specialCaseH) {
    article = 'an';
  }

  return article;
}

/**
 * Sanitizes HTML with special handling for allowed tags and backticked content
 * @param {string} text - The text to sanitize
 * @return {string} - The sanitized text
 */
export function sanitizeHtml(text) {
  if (!text) return '';
  
  // Special handling for code tags - temporarily replace them with placeholders
  let result = text
    // Replace <code> tags with a safe placeholder
    .replace(/<code>/g, '___CODE_OPEN___')
    .replace(/<\/code>/g, '___CODE_CLOSE___');
    
  // Remove <nobr> tags completely
  result = result
    .replace(/<nobr>/g, '')
    .replace(/<\/nobr>/g, '');
  
  // Then apply the general sanitization
  result = result
    .replace(/{/g, '&#123;')
    .replace(/}/g, '&#125;')
    .replace(/>/g, '&gt;')
    .replace(/</g, '&lt;')
    // edge case
    .replace(/&#125;_&#123;/g, '&#125;&#95;&#123;')
    // Handle all types of line breaks - very important!
    .replace(/\r\n/g, '<br />')
    .replace(/\r/g, '<br />')
    .replace(/\n/g, '<br />');
  
  // Fix 1: Replace &lt;br&gt;, &lt;br/&gt;, &lt;p&gt;, &lt;/p&gt; back to their literal HTML tags
  result = result
    .replace(/&lt;br\s*\/?&gt;/gi, '<br />')
    .replace(/&lt;p&gt;/gi, '<p>')
    .replace(/&lt;\/p&gt;/gi, '</p>');
  
  // Fix 2: Handle backticked content more carefully
  result = result.replace(/`([^`]*)`/g, (match, content) => {
    // Convert &lt; and &gt; back to < and > only within backticked content
    const fixedContent = content
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    return '`' + fixedContent + '`';
  });
  
  // IMPORTANT: Explicitly sanitize any <location> tags that might be in the text
  // This ensures they get properly escaped even if added later
  result = result.replace(/<location>/g, '&lt;location&gt;')
                .replace(/<\/location>/g, '&lt;/location&gt;');
  
  // Finally, restore the code tags
  result = result
    .replace(/___CODE_OPEN___/g, '<code>')
    .replace(/___CODE_CLOSE___/g, '</code>');
  
  return result;
}

export function getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, sqlVerb) {
    const methods = {};

    if (sqlVerb === 'exec') {
        // Get all SQL verb methods
        const allSqlMethodNames = new Set();
        const sqlVerbTypes = ['select', 'insert', 'update', 'delete', 'replace'];

        for (const verb of sqlVerbTypes) {
            if (resourceData.sqlVerbs[verb] && resourceData.sqlVerbs[verb].length > 0) {
                for (const method of resourceData.sqlVerbs[verb]) {
                    const { methodName } = getHttpOperationForSqlVerb(method.$ref, resourceData);
                    allSqlMethodNames.add(methodName);
                }
            }
        }

        // Process each method that's not in any SQL verb
        for (const [methodName, methodData] of Object.entries(resourceData.methods)) {
            if (!allSqlMethodNames.has(methodName)) {
                const { path, httpVerb, mediaType, openAPIDocKey } = methodData.operation;
                let resolvedPath = path;
                let resolvedVerb = httpVerb;

                // If operation uses $ref, resolve it
                if (methodData.operation.$ref) {
                    const refPath = methodData.operation.$ref;

                    // Extract the path and verb from the $ref
                    // The path format is typically '#/paths/~1api~1v2~1accounts~1{name}:undrop/post'
                    const pathMatch = refPath.match(/#\/paths\/(.+)\/([^/]+)$/);

                    if (pathMatch && pathMatch.length === 3) {
                        // Replace the escaped characters in the path
                        let path = pathMatch[1]
                            .replace(/~1/g, '/') // Replace ~1 with /
                            .replace(/~0/g, '~') // Replace ~0 with ~ if needed

                        // Don't modify path parts with special characters like ':undrop'
                        resolvedPath = path;
                        resolvedVerb = pathMatch[2];

                        console.log(`Resolved path: ${resolvedPath}, verb: ${resolvedVerb}`);
                    } else {
                        console.warn(`Could not parse $ref path: ${refPath}`);
                        // Skip this method if we can't parse the path
                        continue;
                    }
                }

                // Get response and params using the same function as for SQL verbs
                const { respProps, respDescription, opDescription, opSummary, requestBody } = getHttpOperationInfo(
                    dereferencedAPI,
                    resolvedPath,
                    resolvedVerb,
                    methodData.response.mediaType || '',
                    methodData.response.openAPIDocKey || '200',
                    ''
                );

                const { requiredParams, optionalParams } = getHttpOperationParams(
                    dereferencedAPI,
                    resolvedPath,
                    resolvedVerb
                );

                // Initialize the method with the same structure as SQL methods
                methods[methodName] = {
                    opDescription,
                    opSummary,
                    respDescription,
                    properties: {},
                    requiredParams: requiredParams || {},
                    optionalParams: optionalParams || {},
                    requestBody: requestBody || {},
                    rawRespProps: respProps,
                };

                // Format and sort the properties using our helper functions
                const allProperties = formatProperties(respProps);
                sortAndAddProperties(methods[methodName], allProperties);

                console.info(`Processed exec method: ${methodName}`);
            }
        }

        return methods;
    }

    if (!resourceData.sqlVerbs[sqlVerb] || resourceData.sqlVerbs[sqlVerb].length === 0) {
        return methods;
    }

    for (const thisMethod of resourceData.sqlVerbs[sqlVerb]) {
        const {path, httpVerb, mediaType, openAPIDocKey, objectKey, methodName} = getHttpOperationForSqlVerb(thisMethod.$ref, resourceData);
        const {respProps, respDescription, opDescription, opSummary, requestBody} = getHttpOperationInfo(dereferencedAPI, path, httpVerb, mediaType, openAPIDocKey, objectKey);
        const {requiredParams, optionalParams} = getHttpOperationParams(dereferencedAPI, path, httpVerb);

        // Initialize the method object with description and params
        methods[methodName] = {
            opDescription,
            opSummary,
            respDescription,
            properties: {},
            requiredParams: requiredParams || {},
            optionalParams: optionalParams || {},
            requestBody: requestBody || {},
            rawRespProps: respProps,
        };

        // Format and sort the properties using our helper functions
        const allProperties = formatProperties(respProps);
        sortAndAddProperties(methods[methodName], allProperties);

        console.info(`Processed method: ${methodName}`);
    }

    return methods;
}

// internal helper functions for use in this module only

// Extract the property sorting logic into a separate function
function sortAndAddProperties(methodObj, allProperties) {
    // First group: "id" and "name" fields exactly
    const exactIdNameFields = Object.keys(allProperties).filter(
        propName => propName === 'id' || propName === 'name'
    );
    
    // Second group: fields ending with "_id"
    const idSuffixFields = Object.keys(allProperties).filter(
        propName => propName !== 'id' && propName.endsWith('_id')
    );
    
    // Third group: fields ending with "_name"
    const nameSuffixFields = Object.keys(allProperties).filter(
        propName => propName !== 'name' && propName.endsWith('_name')
    );
    
    // Fourth group: all other fields
    const otherFields = Object.keys(allProperties).filter(
        propName => !exactIdNameFields.includes(propName) && 
                   !idSuffixFields.includes(propName) && 
                   !nameSuffixFields.includes(propName)
    );
    
    // Create a sorted array of all field names according to priority
    const sortedFieldNames = [
        ...exactIdNameFields.sort(),   // Sort alphabetically within group
        ...idSuffixFields.sort(),      // Sort alphabetically within group
        ...nameSuffixFields.sort(),    // Sort alphabetically within group
        ...otherFields.sort()          // Sort alphabetically within group
    ];
    
    // Add properties to the method in the sorted order
    for (const propName of sortedFieldNames) {
        methodObj.properties[propName] = allProperties[propName];
    }
}

// And also extract the property formatting logic
function formatProperties(respProps) {
    const allProperties = {};
    for (const [propName, propDetails] of Object.entries(respProps)) {
        let typeString = propDetails.type || '';
        if (propDetails.format) {
            typeString += ` (${propDetails.format})`;
        }
        
        // Get the base description
        let fullDescription = propDetails.description || '';
        fullDescription = fullDescription.replace(/\n/g, ' ');
        let additionalDescriptionPaths = [];

        // Add all other fields to description parts
        for (const [fieldName, fieldValue] of Object.entries(propDetails)) {
            // Skip the fields we're handling separately
            if (fieldName === 'type' || fieldName === 'format' || fieldName === 'description') {
                continue;
            }

            if (typeof fieldValue != 'string') {
                continue;
            } else {
                // Specifically wrap pattern fields in code tags
                if (fieldName === 'pattern') {
                    additionalDescriptionPaths.push(`${fieldName}: <code>${String(fieldValue)}</code>`);
                } else {
                    additionalDescriptionPaths.push(`${fieldName}: ${String(fieldValue)}`);
                }
            }
        }
        
        fullDescription += additionalDescriptionPaths.length > 0 ? ` (${additionalDescriptionPaths.join(', ')})` : '';

        // Store formatted property details
        allProperties[propName] = {
            type: typeString,
            description: fullDescription
        };
    }
    return allProperties;
}

function getRequiredServerVars(dereferencedAPI) {
    const serverVars = {};
    
    // Check if servers and variables exist in the API spec
    if (!dereferencedAPI.servers || 
        !dereferencedAPI.servers[0] || 
        !dereferencedAPI.servers[0].variables) {
        return serverVars;
    }
    
    // Process each server variable
    for (const [varName, varDetails] of Object.entries(dereferencedAPI.servers[0].variables)) {
        // Start with base type and description
        let typeString = 'string'; // Base type for server variables
        let description = varDetails.description || '';
        
        // Replace newlines with spaces
        description = description.replace(/\n/g, ' ');
        
        // If format exists, add it to type
        if (varDetails.format) {
            typeString += ` (${varDetails.format})`;
        }
        
        // Collect additional fields for description
        let additionalFields = [];
        
        for (const [fieldName, fieldValue] of Object.entries(varDetails)) {
            // Skip description and format which are already handled
            if (fieldName === 'description' || fieldName === 'format') {
                continue;
            }
            
            // Format the field value appropriately
            let formattedValue;
            if (Array.isArray(fieldValue)) {
                formattedValue = `[${fieldValue.join(', ')}]`;
            } else if (typeof fieldValue === 'object' && fieldValue !== null) {
                formattedValue = JSON.stringify(fieldValue);
            } else {
                formattedValue = String(fieldValue);
            }
            
            additionalFields.push(`${fieldName}: ${formattedValue}`);
        }
        
        // Add the additional fields to description if any exist
        if (additionalFields.length > 0) {
            if (description) {
                description += ' ';
            }
            description += `(${additionalFields.join(', ')})`;
        }
        
        // Create the server variable entry
        serverVars[varName] = {
            type: typeString,
            description: description
        };
    }
    
    return serverVars;
}

function getHttpOperationForSqlVerb(sqlVerbRef, resourceData){

    console.log(`Getting http operation for sql verb...`);

    // get path and verb
    const methodName = sqlVerbRef.split('/').pop();
    const methodObj = resourceData.methods[methodName]
    const operationRef = methodObj.operation.$ref.split('#/paths/').pop();
    const httpVerb = operationRef.split('/').pop()
    const path = operationRef.split('/')[0].replaceAll('~1','/');

    return { 
        path, 
        httpVerb, 
        mediaType: methodObj.response.mediaType,  
        openAPIDocKey: methodObj.response.openAPIDocKey,
        objectKey: methodObj.response.objectKey || false,
        methodName 
    }
}

function getHttpOperationInfo(dereferencedAPI, path, httpVerb, mediaType, openAPIDocKey, objectKey) {
    console.log(`Getting response for ${path}/${httpVerb}...`);
    
    // Check if the path exists in the dereferencedAPI
    if (!dereferencedAPI.paths[path]) {
        throw new Error(`Path '${path}' not found in dereferencedAPI.paths`);
    }
    
    // Check if the HTTP verb exists for this path
    if (!dereferencedAPI.paths[path][httpVerb]) {
        throw new Error(`HTTP verb '${httpVerb}' not found for path '${path}'`);
    }
    
    // Get operation description and summary
    const opDescription = (dereferencedAPI.paths[path][httpVerb].description || '');
    const opSummary = (dereferencedAPI.paths[path][httpVerb].summary || '');

    // Extract request body if it exists
    let requestBody = {};
    if (dereferencedAPI.paths[path][httpVerb].requestBody && 
        dereferencedAPI.paths[path][httpVerb].requestBody.content) {
        
        // Get first content type available in requestBody
        const contentTypes = Object.keys(dereferencedAPI.paths[path][httpVerb].requestBody.content);
        if (contentTypes.length > 0) {
            const firstContentType = contentTypes[0];
            const reqBodySchema = dereferencedAPI.paths[path][httpVerb].requestBody.content[firstContentType].schema;
            
            if (reqBodySchema) {
                // Handle polymorphic schemas (anyOf/oneOf) - pick the first one but preserve original structure
                if ((reqBodySchema.anyOf && reqBodySchema.anyOf.length > 0) || 
                    (reqBodySchema.oneOf && reqBodySchema.oneOf.length > 0)) {
                    
                    // Start with the original schema to preserve its structure
                    requestBody = { ...reqBodySchema };
                    
                    // Select the first schema
                    const schemas = reqBodySchema.anyOf || reqBodySchema.oneOf;
                    const firstSchema = schemas[0];
                    
                    // Extract properties from first schema
                    if (firstSchema.$ref) {
                        // If it's a reference, we need to add it as a property
                        requestBody.$firstSchema = firstSchema;
                    } else if (firstSchema.properties) {
                        // If it has properties, use them as our main properties
                        requestBody.properties = firstSchema.properties;
                        requestBody.required = firstSchema.required || [];
                    } else {
                        // Otherwise, merge all properties from first schema
                        Object.assign(requestBody, firstSchema);
                    }
                    
                    // Additional check: if there's an example, use it to extract properties
                    // that might be expected by other parts of the code
                    const example = dereferencedAPI.paths[path][httpVerb].requestBody.content[firstContentType].example;
                    if (example) {
                        // Ensure properties object exists
                        if (!requestBody.properties) {
                            requestBody.properties = {};
                        }
                        
                        // Add properties from example that aren't already defined
                        Object.keys(example).forEach(key => {
                            if (!requestBody.properties[key]) {
                                // Create a simple property definition based on the example value
                                const value = example[key];
                                const type = typeof value === 'number' ? 'number' : 
                                            typeof value === 'boolean' ? 'boolean' : 'string';
                                
                                requestBody.properties[key] = {
                                    type: type,
                                    example: value
                                };
                            }
                        });
                    }
                }
                // If schema is a reference, use it directly (unchanged)
                else if (reqBodySchema.$ref) {
                    requestBody = reqBodySchema;
                } 
                // If schema is an object with properties, get them (unchanged)
                else if (reqBodySchema.properties) {
                    requestBody = {
                        properties: reqBodySchema.properties,
                        required: reqBodySchema.required || []
                    };
                }
                // If schema is something else, use it as is (unchanged)
                else {
                    requestBody = reqBodySchema;
                }
            }
        }
    }

    // Rest of the function remains unchanged
    if (!dereferencedAPI.paths[path][httpVerb].responses || 
        !dereferencedAPI.paths[path][httpVerb].responses[openAPIDocKey]) {
        console.warn(`Response '${openAPIDocKey}' not found for ${path}/${httpVerb}`);
        return {
            respProps: {},
            respDescription: '',
            opDescription,
            opSummary,
            requestBody
        };
    }

    // Check if there's a content section with the mediaType
    const responseObj = dereferencedAPI.paths[path][httpVerb].responses[openAPIDocKey];

    // If no content or no mediaType in the response, return empty properties
    if (!responseObj.content || !mediaType || !responseObj.content[mediaType] || !responseObj.content[mediaType].schema) {
        return {
            respProps: {},
            respDescription: responseObj.description || '',
            opDescription,
            opSummary,
            requestBody
        };
    }

    const schema = responseObj.content[mediaType].schema;

    const { respProps, respDescription } = getHttpRespBody(schema, objectKey);

    return {
        respProps,
        respDescription: responseObj.description ? responseObj.description : respDescription,
        opDescription,
        opSummary,
        requestBody
    };
}

function getHttpRespBody(schema, objectKey) {

    if (schema.type === 'array') {
        return {
         respProps: schema.items.properties || {},
         respDescription: schema.items.description || '',
        }
    } else if (schema.type === 'object') {
        if(objectKey){
            // if objectKey contains [*] print something
            if (objectKey.includes('[*]')) {
                // complex object key
                console.log(`Complex Object Key : ${objectKey}`);
                const parts = objectKey.split('[*]');
                const complexObjectKey = parts[1].replace('.', '');
                console.log(`Item of Interest : ${complexObjectKey}`);

                // Safe access to respProps
                const respProps = schema?.properties?.items?.additionalProperties?.properties?.[complexObjectKey]?.items?.properties ?? {};

                // Safe access to respDescription with fallbacks
                const respDescription = 
                    schema?.properties?.items?.additionalProperties?.properties?.[complexObjectKey]?.items?.description ?? 
                    schema?.properties?.items?.description ?? 
                    '';

                // console.info(respProps);
                // console.log(respDescription);
                return {
                    respProps: respProps,
                    respDescription: respDescription,
                };

            } else {
                // simple object key
                console.log(`Simple Object Key : ${objectKey}`);
                const simpleObjectKey = objectKey.replace('$.', '');


                const respProps = (schema?.properties?.[simpleObjectKey]?.items?.properties) ?? 
                                (schema?.properties?.[simpleObjectKey]?.properties) ?? 
                                {};

                const respDescription = (schema?.properties?.[simpleObjectKey]?.items?.description) ?? 
                                        (schema?.description) ?? 
                                        '';

                // console.info(respProps);
                // console.log(respDescription);
                return {
                    respProps: respProps,
                    respDescription: respDescription,
                };
            }
        } else {
                return {
                    respProps: schema.properties || {},
                    respDescription: schema.description || '',
                };
        }
    } else {
        return {
            respProps: {},
            respDescription: '',
        };
    }
}

/**
 * Recursively generates a nested JSON schema tree from response properties,
 * suitable for use with the SchemaTable React component.
 * Each node has: { name, type, description, children? }
 * @param {Object} respProps - The raw response properties from the dereferenced API
 * @param {number} depth - Current recursion depth
 * @param {number} maxDepth - Maximum recursion depth to prevent infinite loops
 * @returns {Array} Array of schema field objects
 */
export function generateSchemaJsonFromProps(respProps, depth = 0, maxDepth = 4) {
    if (depth >= maxDepth || !respProps || typeof respProps !== 'object') return [];

    return Object.entries(respProps).map(([propName, prop]) => {
        if (!prop) return null;

        let propType = prop.type || 'object';
        let propDesc = sanitizeHtml(prop.description || '');

        // Add format info to type string if available
        if (prop.format) {
            propType += ` (${prop.format})`;
        }

        let children = [];

        // Handle arrays - get children from items
        if (prop.type === 'array' && prop.items) {
            if (prop.items.properties) {
                children = generateSchemaJsonFromProps(prop.items.properties, depth + 1, maxDepth);
            }
        }

        // Handle objects - get children from properties
        if (prop.type === 'object' && prop.properties) {
            children = generateSchemaJsonFromProps(prop.properties, depth + 1, maxDepth);
        }

        return {
            name: propName,
            type: propType,
            description: propDesc,
            ...(children.length > 0 && { children })
        };
    }).filter(Boolean);
}

/**
 * Sorts an array of schema field objects using the standard field priority:
 * 1. Exact 'id' and 'name' fields
 * 2. Fields ending with '_id'
 * 3. Fields ending with '_name'
 * 4. All other fields (alphabetical)
 * @param {Array} fields - Array of schema field objects with 'name' property
 * @returns {Array} Sorted array of schema field objects
 */
export function sortSchemaFields(fields) {
    if (!fields || fields.length === 0) return [];

    const exactIdName = fields.filter(f => f.name === 'id' || f.name === 'name');
    const idSuffix = fields.filter(f => f.name !== 'id' && f.name.endsWith('_id'));
    const nameSuffix = fields.filter(f => f.name !== 'name' && f.name.endsWith('_name'));
    const others = fields.filter(f =>
        !exactIdName.includes(f) &&
        !idSuffix.includes(f) &&
        !nameSuffix.includes(f)
    );

    return [
        ...exactIdName.sort((a, b) => a.name.localeCompare(b.name)),
        ...idSuffix.sort((a, b) => a.name.localeCompare(b.name)),
        ...nameSuffix.sort((a, b) => a.name.localeCompare(b.name)),
        ...others.sort((a, b) => a.name.localeCompare(b.name)),
    ];
}

function getHttpOperationParams(dereferencedAPI, path, httpVerb) {
    const requiredParams = {};
    const optionalParams = {};
    
    // Get the parameters array from the operation
    const params = dereferencedAPI.paths[path][httpVerb].parameters || [];
    
    // Process each parameter
    for (const param of params) {
        // Skip parameters without a name or schema
        if (!param.name || !param.schema) continue;
        
        // Format the type string
        let typeString = param.schema.type || '';
        if (param.schema.format) {
            typeString += ` (${param.schema.format})`;
        }
        
        // Get the base description and clean it up
        let description = param.description || '';
        // Replace newlines with spaces to avoid string concatenation in output
        description = description.replace(/\n/g, ' ');
        
        let additionalDescriptionParts = [];
        
        // for (const [fieldName, fieldValue] of Object.entries(param.schema)) {
        //     if (fieldName === 'type' || fieldName === 'format' || fieldName === 'description' || fieldName === 'pattern') {
        //         continue;
        //     }

        //     let formattedValue;
        //     if (Array.isArray(fieldValue)) {
        //         formattedValue = `[${fieldValue.join(', ')}]`;
        //     } else if (typeof fieldValue === 'object' && fieldValue !== null) {
        //         formattedValue = JSON.stringify(fieldValue);
        //     } else {
        //         formattedValue = String(fieldValue);
        //     }

        //     if (fieldName === 'pattern') {
        //         additionalDescriptionParts.push(`pattern: <code>${formattedValue}</code>`);
        //     } else {
        //         additionalDescriptionParts.push(`${fieldName}: ${formattedValue}`);
        //     }
        // }

        // Add any fields from the parameter itself that might contain metadata
        for (const [fieldName, fieldValue] of Object.entries(param)) {
            // Skip fields we've already processed or don't need
            if (fieldName === 'name' || fieldName === 'schema' || 
                fieldName === 'required' || fieldName === 'in' || 
                fieldName === 'description') {
                continue;
            }
            
            // Handle example field specifically (it might exist at param level not schema level)
            if (fieldName === 'example' && !param.schema.example) {
                let formattedValue;
                if (Array.isArray(fieldValue)) {
                    formattedValue = `[${fieldValue.join(', ')}]`;
                } else if (typeof fieldValue === 'object' && fieldValue !== null) {
                    formattedValue = JSON.stringify(fieldValue);
                } else {
                    formattedValue = String(fieldValue);
                }
                
                additionalDescriptionParts.push(`example: ${formattedValue}`);
            }
        }
        
        // Add additional description parts in parentheses if there are any
        if (additionalDescriptionParts.length > 0) {
            description += ` (${additionalDescriptionParts.join(', ')})`;
        }
        
        // Create the parameter details object
        const paramDetails = {
            type: typeString,
            description: description
        };
        
        // Add to the appropriate category based on required flag
        if (param.required === true) {
            requiredParams[param.name] = paramDetails;
        } else {
            optionalParams[param.name] = paramDetails;
        }
    }
    
    // Get server variables and merge them into requiredParams
    const serverVars = getRequiredServerVars(dereferencedAPI);
    
    // Merge server variables into requiredParams
    Object.assign(requiredParams, serverVars);

    return { requiredParams, optionalParams };
}
