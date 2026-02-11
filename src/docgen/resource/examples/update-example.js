// src/docgen/resource/examples/update-example.js
import { 
    getSqlMethodsWithOrderedFields, 
    sanitizeHtml
} from '../../helpers.js';

export function createUpdateExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, isReplace = false, succinct = false) {
    const updateMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, isReplace ? 'replace' : 'update');
    
    // if there are no update methods, return empty content
    if (Object.keys(updateMethods).length === 0) {
        return '';
    }
    
    let content = '';
    if (isReplace) {
        content += '\n\n## `REPLACE` examples\n\n';
    } else {
        content += '\n\n## `UPDATE` examples\n\n';
    }
    
    // Create tab structure with values array
    content += '<Tabs\n    defaultValue="' + Object.keys(updateMethods)[0] + '"\n    values={[\n';
    
    // Add each method as a tab option
    Object.keys(updateMethods).forEach((methodName, index, arr) => {
        content += '        { label: \'' + methodName + '\', value: \'' + methodName + '\' }';
        content += index < arr.length - 1 ? ',\n' : '\n';
    });
    
    content += '    ]}\n>\n';
    
    // Create each method tab content
    Object.entries(updateMethods).forEach(([methodName, methodDetails]) => {
        content += '<TabItem value="' + methodName + '">\n\n';
        
        // Add method description
        const opDescription = (succinct && methodDetails.opSummary) ? methodDetails.opSummary : (methodDetails.opDescription || 'No description available.');
        content += sanitizeHtml(opDescription);
        
        // Create SQL example
        content += '\n\n```sql\n';
        content += (isReplace ? 'REPLACE ' : 'UPDATE ') + providerName + '.' + serviceName + '.' + resourceName;
        
        // Add SET clause with requestBody fields (excluding read-only props)
        content += '\nSET \n';
        
        // Get request body fields (excluding read-only props)
        const reqBodyProps = methodDetails.requestBody?.properties 
            ? Object.entries(methodDetails.requestBody.properties)
                .filter(([_, propDetails]) => propDetails.readOnly !== true)
                .map(([propName]) => propName)
            : [];
        
        // Add data__ prefixed fields to SET clause
        if (reqBodyProps.length > 0) {
            const setLines = reqBodyProps.map(prop => {
                const propDetails = methodDetails.requestBody.properties[prop];
                const isNumber = propDetails.type === 'number' || propDetails.type === 'integer';
                const isBoolean = propDetails.type === 'boolean';
                
                if (isNumber || isBoolean) {
                    return 'data__' + prop + ' = {{ ' + prop + ' }}';
                } else {
                    return 'data__' + prop + ' = \'{{ ' + prop + ' }}\'';
                }
            });
            
            content += setLines.join(',\n');
        } else {
            content += '-- No updatable properties';
        }
        
        // Add WHERE clause with parameters
        const requiredParams = Object.keys(methodDetails.requiredParams || {});
        const optionalParams = Object.keys(methodDetails.optionalParams || {});
        
        // Get required body props (excluding read-only props)
        const requiredBodyProps = methodDetails.requestBody?.required 
            ? methodDetails.requestBody.required.filter(prop => 
                methodDetails.requestBody.properties[prop] && 
                methodDetails.requestBody.properties[prop].readOnly !== true)
            : [];
        
        if (requiredParams.length > 0 || requiredBodyProps.length > 0 || optionalParams.length > 0) {

            content += '\nWHERE \n';
            
            // Add required parameters
            let clauseCount = 0;
            
            // Add required query/path/header params
            requiredParams.forEach(param => {
                if (clauseCount > 0) content += '\nAND ';
                content += param + ' = \'{{ ' + param + ' }}\' --required';
                clauseCount++;
            });
            
            // Add required body params (only non-readonly ones)
            requiredBodyProps.forEach(prop => {
                if (clauseCount > 0) content += '\nAND ';
                
                const propDetails = methodDetails.requestBody.properties[prop];
                const isBoolean = propDetails.type === 'boolean';
                
                if (isBoolean) {
                    content += 'data__' + prop + ' = {{ ' + prop + ' }} --required';
                } else {
                    content += 'data__' + prop + ' = \'{{ ' + prop + ' }}\' --required';
                }
                
                clauseCount++;
            });
            
            // Add optional parameters
            optionalParams.forEach(param => {
                if (clauseCount > 0) content += '\nAND ';
                
                // For boolean parameters, we can add a comment about their default value
                const paramDetails = methodDetails.optionalParams[param];
                const isBoolean = paramDetails.type === 'boolean';
                const defaultValue = paramDetails.default;
                
                if (isBoolean) {
                    content += param + ' = {{ ' + param + '}}';
                } else {
                    content += param + ' = \'{{ ' + param + '}}\'';
                }
                
                if (isBoolean && defaultValue !== undefined) {
                    content += ' -- default: ' + defaultValue;
                }
                
                clauseCount++;
            });
        }

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

        content += ';\n```\n</TabItem>\n';
    });
    
    // Close tabs
    content += '</Tabs>\n';
    
    return content;
}