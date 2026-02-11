// src/docgen/resource/examples/select-example.js
import { 
    getSqlMethodsWithOrderedFields, 
    sanitizeHtml
} from '../../helpers.js';

export function createSelectExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, succinct = false) {
    const selectMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'select');
    
    // if there are no select methods, return empty content
    if (Object.keys(selectMethods).length === 0) {
        return '';
    }
    
    let content = '\n\n## `SELECT` examples\n\n';
    
    // Create tab structure with values array
    content += '<Tabs\n    defaultValue="' + Object.keys(selectMethods)[0] + '"\n    values={[\n';
    
    // Add each method as a tab option
    Object.keys(selectMethods).forEach((methodName, index, arr) => {
        content += '        { label: \'' + methodName + '\', value: \'' + methodName + '\' }';
        content += index < arr.length - 1 ? ',\n' : '\n';
    });
    
    content += '    ]}\n>\n';
    
    // Create each tab content
    Object.entries(selectMethods).forEach(([methodName, methodDetails]) => {
        content += '<TabItem value="' + methodName + '">\n\n';
        // content += methodDetails.opDescription || 'No description available.';
        // Add method description
        const opDescription = (succinct && methodDetails.opSummary) ? methodDetails.opSummary : (methodDetails.opDescription || methodDetails.respDescription || 'No description available.');
        content += sanitizeHtml(opDescription);

        // Create SQL example
        content += '\n\n```sql\nSELECT\n';
        
        // Add fields
        const fieldNames = Object.keys(methodDetails.properties || {});
        if (fieldNames.length > 0) {
            content += fieldNames.join(',\n');
        } else {
            content += '*';
        }
        
        // Add FROM clause
        content += '\nFROM ' + providerName + '.' + serviceName + '.' + resourceName;
        
        // Add WHERE clause with parameters
        const requiredParams = Object.keys(methodDetails.requiredParams || {});
        const optionalParams = Object.keys(methodDetails.optionalParams || {});
        
        if (requiredParams.length > 0 || optionalParams.length > 0) {
            content += '\nWHERE ';
            
            // Add required parameters
            requiredParams.forEach((param, index) => {
                content += param + ' = \'{{ ' + param + ' }}\' -- required';
                content += index < requiredParams.length - 1 || optionalParams.length > 0 ? '\nAND ' : '';
            });
            
            // Add optional parameters
            optionalParams.forEach((param, index) => {
                content += param + ' = \'{{ ' + param + ' }}\'';
                content += index < optionalParams.length - 1 ? '\nAND ' : '';
            });
        }
        
        content += '\n;\n```\n</TabItem>\n';
    });
    
    // Close tabs
    content += '</Tabs>\n';
    
    return content;
}