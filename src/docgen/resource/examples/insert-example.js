// src/docgen/resource/examples/insert-example.js
import { 
    getSqlMethodsWithOrderedFields, 
    sanitizeHtml
} from '../../helpers.js';

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
        
        // Add requestBody fields prefixed with data__ (excluding read-only props)
        const reqBodyProps = methodDetails.requestBody?.properties 
            ? Object.entries(methodDetails.requestBody.properties)
                .filter(([_, propDetails]) => propDetails.readOnly !== true)
                .map(([propName]) => propName)
            : [];

        const requiredBodyProps = methodDetails.requestBody?.required ? methodDetails.requestBody.required : [];
            
        const dataProps = reqBodyProps.map(prop => 'data__' + prop);
        
        // Combine data props with params
        const requiredParams = Object.keys(methodDetails.requiredParams || {});
        const optionalParams = Object.keys(methodDetails.optionalParams || {});
        const allFields = [...dataProps, ...requiredParams, ...optionalParams];
        
        // Add fields to INSERT
        content += allFields.join(',\n');
        
        // Start SELECT statement
        content += '\n)\nSELECT \n';
        
        // Add values placeholders
        const valueLines = allFields.map(field => {
            const isDataField = field.startsWith('data__');
            const paramName = isDataField ? field.substring(6) : field;
            
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
    content += '<TabItem value="manifest">\n\n';
    content += '```yaml\n# Description fields are for documentation purposes\n- name: ' + resourceName + '\n  props:\n';
    
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
            content += '    - name: ' + name + '\n';
            content += '      value: ' + type + '\n';
            content += '      description: Required parameter for the ' + resourceName + ' resource.\n';
        });
    
    // Add request body props
    Object.entries(allRequestBodyProps).forEach(([name, details]) => {
        const type = details.type || 'string';
        const description = details.description || '';
        content += '    - name: ' + name + '\n';
        content += '      value: ' + type + '\n';
        
        if (description) {
            content += '      description: |\n';
            
            // Split by lines and remove empty lines
            const lines = description
                .split(/\n/)
                .filter(line => line.trim() !== ''); // Remove completely empty lines
            
            // Process each line with proper indentation
            lines.forEach(line => {
                content += '        ' + line.trim() + '\n'; // trim each line to remove extra spaces
            });
        }
        
        // Add enum values if available
        if (details.enum) {
            content += '      valid_values: [\'' + details.enum.join('\', \'') + '\']\n';
        }
        
        // Add default value if available
        if (details.default !== undefined) {
            content += '      default: ' + details.default + '\n';
        }
    });
    
    // Add optional params last
    Object.entries(allParams)
        .filter(([_, details]) => !details.required)
        .forEach(([name, details]) => {
            const type = details.type || 'string';
            const description = details.description || '';
            content += '    - name: ' + name + '\n';
            content += '      value: ' + type + '\n';
            
            if (description) {
                content += '      description: ' + description + '\n';
            }
        });
    
    content += '```\n</TabItem>\n';
    
    // Close tabs
    content += '</Tabs>\n';
    
    return content;
}