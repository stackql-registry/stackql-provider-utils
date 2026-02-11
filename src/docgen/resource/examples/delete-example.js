// src/docgen/resource/examples/delete-example.js
import { 
    getSqlMethodsWithOrderedFields, 
    sanitizeHtml,
} from '../../helpers.js';

export function createDeleteExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, succinct = false) {
    const deleteMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'delete');

    // if there are no delete methods, return empty content
    if (Object.keys(deleteMethods).length === 0) {
        return '';
    }

    let content = '\n\n## `DELETE` examples\n\n';

    // Create tab structure with values array
    content += '<Tabs\n    defaultValue="' + Object.keys(deleteMethods)[0] + '"\n    values={[\n';
    
    // Add each method as a tab option
    Object.keys(deleteMethods).forEach((methodName, index, arr) => {
        content += '        { label: \'' + methodName + '\', value: \'' + methodName + '\' }';
        content += index < arr.length - 1 ? ',\n' : '\n';
    });
    
    content += '    ]}\n>\n';
    
    // Create each method tab content
    Object.entries(deleteMethods).forEach(([methodName, methodDetails]) => {
        content += '<TabItem value="' + methodName + '">\n\n';
        
        // Add method description
        const opDescription = (succinct && methodDetails.opSummary) ? methodDetails.opSummary : (methodDetails.opDescription || 'No description available.');
        content += sanitizeHtml(opDescription);

        // Create SQL example
        content += '\n\n```sql\nDELETE FROM ' + providerName + '.' + serviceName + '.' + resourceName;
        
        // Add WHERE clause with parameters
        const requiredParams = Object.keys(methodDetails.requiredParams || {});
        const optionalParams = Object.keys(methodDetails.optionalParams || {});
        
        if (requiredParams.length > 0 || optionalParams.length > 0) {
            content += '\nWHERE ';
            
            // Add required parameters
            requiredParams.forEach((param, index) => {
                content += param + ' = \'{{ ' + param + ' }}\' --required';
                content += index < requiredParams.length - 1 || optionalParams.length > 0 ? '\nAND ' : '';
            });
            
            // Add optional parameters
            optionalParams.forEach((param, index) => {
                // For boolean parameters, we can add a comment about their default value
                const paramDetails = methodDetails.optionalParams[param];
                const isBoolean = paramDetails.type === 'boolean';
                const defaultValue = paramDetails.default;
                
                content += param + ' = \'{{ ' + param + ' }}\'';
                
                if (isBoolean && defaultValue !== undefined) {
                    content += ' -- default: ' + defaultValue;
                }
                
                content += index < optionalParams.length - 1 ? '\nAND ' : '';
            });
        }
        
        content += '\n;\n```\n</TabItem>\n';
    });
    
    // Close tabs
    content += '</Tabs>\n';
    
    return content;
}