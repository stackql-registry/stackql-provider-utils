// src/docgen/resource/examples/insert-example.js
import { 
    getSqlMethodsWithOrderedFields, 
    sanitizeHtml
} from '../../helpers.js';

/**
 * Formats a value using template syntax based on the field type.
 * - Strings: "{{ name }}"
 * - Booleans/numbers/integers: {{ name }}
 */
function formatTemplateValue(name, type) {
    if (type === 'boolean' || type === 'number' || type === 'integer') {
        return '{{ ' + name + ' }}';
    }
    return '"{{ ' + name + ' }}"';
}

/**
 * Generates inline YAML value structure for nested object properties.
 * Produces key: value pairs instead of - name: / props: structure.
 * Example output:
 *   sts_role:
 *     role_arn: "{{ role_arn }}"
 * @param {Object} properties - Schema properties object
 * @param {string} indent - Current indentation string
 * @param {number} depth - Current recursion depth
 * @param {number} maxDepth - Maximum recursion depth
 * @returns {string} YAML string for the inline value
 */
function generateInlineYamlValue(properties, indent, depth = 0, maxDepth = 4) {
    let content = '';
    Object.entries(properties).forEach(([name, details]) => {
        if (!details) return;
        const type = details.type || 'string';

        if (depth < maxDepth && type === 'object' && details.properties && Object.keys(details.properties).length > 0) {
            content += indent + name + ':\n';
            content += generateInlineYamlValue(details.properties, indent + '  ', depth + 1, maxDepth);
        } else if (depth < maxDepth && type === 'array' && details.items) {
            if (details.items.properties && Object.keys(details.items.properties).length > 0) {
                content += indent + name + ':\n';
                const entries = Object.entries(details.items.properties);
                entries.forEach(([itemName, itemDetails], index) => {
                    const itemType = itemDetails?.type || 'string';
                    const lineIndent = index === 0 ? indent + '  - ' : indent + '    ';
                    if (itemType === 'object' && itemDetails.properties && Object.keys(itemDetails.properties).length > 0) {
                        content += lineIndent + itemName + ':\n';
                        content += generateInlineYamlValue(itemDetails.properties, indent + '      ', depth + 2, maxDepth);
                    } else {
                        content += lineIndent + itemName + ': ' + formatTemplateValue(itemName, itemType) + '\n';
                    }
                });
            } else if (details.items.type && details.items.type !== 'object') {
                content += indent + name + ':\n';
                content += indent + '  - ' + formatTemplateValue(name, details.items.type) + '\n';
            } else {
                content += indent + name + ': ' + formatTemplateValue(name, type) + '\n';
            }
        } else {
            content += indent + name + ': ' + formatTemplateValue(name, type) + '\n';
        }
    });
    return content;
}

/**
 * Recursively generates manifest YAML props for a set of schema properties.
 * - For scalars, uses template syntax: value: "{{ name }}" or value: {{ name }}
 * - For objects, uses inline YAML value structure instead of nested props blocks.
 * - For arrays, shows inline YAML prototype of the first element.
 * @param {Object} properties - Schema properties object (name -> details)
 * @param {string} indent - Current indentation string
 * @param {number} depth - Current recursion depth
 * @param {number} maxDepth - Maximum recursion depth (default 4)
 * @returns {string} YAML string for the props
 */
function generateManifestPropsYaml(properties, indent, depth = 0, maxDepth = 4) {
    let content = '';
    Object.entries(properties).forEach(([name, details]) => {
        if (!details) return;
        const type = details.type || 'string';
        const description = details.description || '';
        const isObject = depth < maxDepth && type === 'object' && details.properties && Object.keys(details.properties).length > 0;
        const isArrayOfObjects = depth < maxDepth && type === 'array' && details.items && details.items.properties && Object.keys(details.items.properties).length > 0;
        const isArrayOfPrimitives = depth < maxDepth && type === 'array' && details.items && details.items.type && details.items.type !== 'object' && !(details.items.properties && Object.keys(details.items.properties).length > 0);

        content += indent + '- name: ' + name + '\n';

        if (isObject || isArrayOfObjects) {
            // For objects/arrays-of-objects: description before value
            if (description) {
                content += indent + '  description: |\n';
                const lines = description.split(/\n/).filter(line => line.trim() !== '');
                lines.forEach(line => {
                    content += indent + '    ' + line.trim() + '\n';
                });
            }
            content += indent + '  value:\n';
            if (isObject) {
                content += generateInlineYamlValue(details.properties, indent + '    ', 0, maxDepth - depth);
            } else {
                const entries = Object.entries(details.items.properties);
                entries.forEach(([itemName, itemDetails], index) => {
                    const itemType = itemDetails?.type || 'string';
                    const lineIndent = index === 0 ? indent + '    - ' : indent + '      ';
                    if (itemType === 'object' && itemDetails.properties && Object.keys(itemDetails.properties).length > 0) {
                        content += lineIndent + itemName + ':\n';
                        content += generateInlineYamlValue(itemDetails.properties, indent + '        ', 0, maxDepth - depth - 1);
                    } else {
                        content += lineIndent + itemName + ': ' + formatTemplateValue(itemName, itemType) + '\n';
                    }
                });
            }
        } else {
            // For scalars and simple arrays: value before description
            if (isArrayOfPrimitives) {
                content += indent + '  value:\n';
                content += indent + '    - ' + formatTemplateValue(name, details.items.type) + '\n';
            } else {
                content += indent + '  value: ' + formatTemplateValue(name, type) + '\n';
            }
            if (description) {
                content += indent + '  description: |\n';
                const lines = description.split(/\n/).filter(line => line.trim() !== '');
                lines.forEach(line => {
                    content += indent + '    ' + line.trim() + '\n';
                });
            }
        }

        // Add enum values if available
        if (details.enum) {
            content += indent + '  valid_values: [\'' + details.enum.join('\', \'') + '\']\n';
        }

        // Add default value if available
        if (details.default !== undefined) {
            content += indent + '  default: ' + details.default + '\n';
        }
    });
    return content;
}

export function createInsertExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, succinct = false) {
    const insertMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'insert');

    // if there are no insert methods, return empty content
    if (Object.keys(insertMethods).length === 0) {
        return '';
    }

    let content = '\n\n## `INSERT` examples\n\n';

    // Create tab structure with values array
    content += '<Tabs\n    defaultValue="' + Object.keys(insertMethods)[0] + '"\n    values={[\n';
    
    // Add each method as a tab option
    Object.keys(insertMethods).forEach((methodName, index) => {
        content += '        { label: \'' + methodName + '\', value: \'' + methodName + '\' }';
        if (index < Object.keys(insertMethods).length - 1 || true) { // Always add comma for manifest tab
            content += ',\n';
        }
    });
    
    // Add manifest tab
    content += '        { label: \'Manifest\', value: \'manifest\' }\n';
    content += '    ]}\n>\n';
    
    // Create each method tab content
    Object.entries(insertMethods).forEach(([methodName, methodDetails]) => {
        content += '<TabItem value="' + methodName + '">\n\n';

        // Add method description
        const opDescription = (succinct && methodDetails.opSummary) ? methodDetails.opSummary : (methodDetails.opDescription || 'No description available.');
        content += sanitizeHtml(opDescription);
        
        // Create SQL example
        content += '\n\n```sql\nINSERT INTO ' + providerName + '.' + serviceName + '.' + resourceName + ' (\n';
        
        // Add requestBody fields (excluding read-only props)
        // If requestBodyTranslate.algorithm is 'naive', do not prefix with data__
        const hasNaiveTranslate = methodDetails.methodConfig?.requestBodyTranslate?.algorithm === 'naive';

        const reqBodyProps = methodDetails.requestBody?.properties
            ? Object.entries(methodDetails.requestBody.properties)
                .filter(([_, propDetails]) => propDetails.readOnly !== true)
                .map(([propName]) => propName)
            : [];

        const requiredBodyProps = methodDetails.requestBody?.required ? methodDetails.requestBody.required : [];

        const dataProps = hasNaiveTranslate
            ? reqBodyProps
            : reqBodyProps.map(prop => 'data__' + prop);
        
        // Combine data props with params
        const requiredParams = Object.keys(methodDetails.requiredParams || {});
        const optionalParams = Object.keys(methodDetails.optionalParams || {});
        const allFields = [...dataProps, ...requiredParams, ...optionalParams];
        
        // Add fields to INSERT
        content += allFields.join(',\n');
        
        // Start SELECT statement
        content += '\n)\nSELECT \n';
        
        // Build a set of body prop names for quick lookup
        const bodyPropSet = new Set(reqBodyProps);

        // Add values placeholders
        const valueLines = allFields.map(field => {
            const isDataField = hasNaiveTranslate
                ? bodyPropSet.has(field)
                : field.startsWith('data__');
            const paramName = isDataField
                ? (hasNaiveTranslate ? field : field.substring(6))
                : field;

            // Check for required body props
            let isRequiredBodyParam = false;
            if(isDataField){
                if (requiredBodyProps.includes(paramName)) {
                    isRequiredBodyParam = true;
                }
            }

            // Check if it's a number or boolean type
            let isNumber = false;
            let isBoolean = false;

            if (isDataField && methodDetails.requestBody?.properties?.[paramName]) {
                const propType = methodDetails.requestBody.properties[paramName].type;
                isNumber = propType === 'number' || propType === 'integer';
                isBoolean = propType === 'boolean';
            }

            if (isNumber || isBoolean) {
                return '{{ ' + paramName + ' }}' + (isRequiredBodyParam ? ' /* required */' : '');
            } else {
                return '\'{{ ' + paramName + ' }}\'' + (isRequiredBodyParam ? ' /* required */' : '');
            }
        });
        
        content += valueLines.join(',\n');

        // returning clause if properties exist
        if (methodDetails.properties && Object.keys(methodDetails.properties).length > 0) {
            content += '\nRETURNING\n';
            const keys = Object.keys(methodDetails.properties);
            keys.forEach((key, index) => {
                if (index === keys.length - 1) {
                    // For the last item, don't add a newline after it
                    content += `${key}`;
                } else {
                    content += `${key},\n`;
                }
            });
        }

        content += '\n;\n```\n</TabItem>\n';
    });

    // Create manifest tab
    // Build manifest YAML as a separate string first, then wrap in <CodeBlock>
    // to preserve whitespace through MDX compilation (fenced code blocks inside
    // JSX containers like <TabItem> can lose leading whitespace).
    let manifestYaml = '# Description fields are for documentation purposes\n- name: ' + resourceName + '\n  props:\n';
    
    // Collect all unique params and request body props across all methods
    const allParams = {};
    const allRequestBodyProps = {};

    Object.values(insertMethods).forEach(method => {
        // Add required params
        Object.entries(method.requiredParams || {}).forEach(([name, details]) => {
            allParams[name] = { ...details, required: true };
        });

        // Add optional params
        Object.entries(method.optionalParams || {}).forEach(([name, details]) => {
            if (!allParams[name]) {
                allParams[name] = { ...details, required: false };
            }
        });

        // Add request body props (excluding read-only props)
        if (method.requestBody && method.requestBody.properties) {
            Object.entries(method.requestBody.properties)
                .filter(([_, propDetails]) => propDetails.readOnly !== true)
                .forEach(([name, details]) => {
                    allRequestBodyProps[name] = details;
                });
        }
    });

    // Add required params first
    Object.entries(allParams)
        .filter(([_, details]) => details.required)
        .forEach(([name, details]) => {
            const type = details.type || 'string';
            manifestYaml += '    - name: ' + name + '\n';
            manifestYaml += '      value: ' + formatTemplateValue(name, type) + '\n';
            manifestYaml += '      description: Required parameter for the ' + resourceName + ' resource.\n';
        });

    // Add request body props (with recursive expansion of objects and arrays)
    manifestYaml += generateManifestPropsYaml(allRequestBodyProps, '    ');

    // Add optional params last
    Object.entries(allParams)
        .filter(([_, details]) => !details.required)
        .forEach(([name, details]) => {
            const type = details.type || 'string';
            const description = details.description || '';
            manifestYaml += '    - name: ' + name + '\n';
            manifestYaml += '      value: ' + formatTemplateValue(name, type) + '\n';

            if (description) {
                manifestYaml += '      description: ' + description + '\n';
                manifestYaml += '      description: ' + description + '\n';
            }
        });

    // Escape backticks and ${} in the YAML to prevent template literal issues
    const escapedYaml = manifestYaml.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

    content += '<TabItem value="manifest">\n\n';
    content += '<CodeBlock language="yaml">{`' + escapedYaml + '`}</CodeBlock>\n\n';
    content += '</TabItem>\n';
    
    // Close tabs
    content += '</Tabs>\n';
    
    return content;
}
