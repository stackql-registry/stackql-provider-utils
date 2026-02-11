// src/docgen/resource/examples/exec-example.js
import { 
    getSqlMethodsWithOrderedFields, 
    sanitizeHtml
} from '../../helpers.js';

export function createExecExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, succinct = false) {
    const execMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'exec');
    
    // if there are no exec methods, return empty content
    if (Object.keys(execMethods).length === 0) {
        return '';
    }
    
    let content = '\n\n## Lifecycle Methods\n\n';
    
    // Create tab structure with values array
    content += '<Tabs\n    defaultValue="' + Object.keys(execMethods)[0] + '"\n    values={[\n';
    
    // Add each method as a tab option
    Object.keys(execMethods).forEach((methodName, index, arr) => {
        content += '        { label: \'' + methodName + '\', value: \'' + methodName + '\' }';
        content += index < arr.length - 1 ? ',\n' : '\n';
    });
    
    content += '    ]}\n>\n';
    
    // Create each method tab content
    Object.entries(execMethods).forEach(([methodName, methodDetails]) => {
        content += '<TabItem value="' + methodName + '">\n\n';
        
        // Add method description
        const opDescription = (succinct && methodDetails.opSummary) ? methodDetails.opSummary : (methodDetails.opDescription || methodDetails.respDescription || 'No description available.');
        content += sanitizeHtml(opDescription);
        
        // Create SQL example
        content += '\n\n```sql\nEXEC ' + providerName + '.' + serviceName + '.' + resourceName + '.' + methodName + ' \n';
        
        // Add required and optional parameters with @ prefix
        const requiredParams = Object.keys(methodDetails.requiredParams || {});
        const optionalParams = Object.keys(methodDetails.optionalParams || {});
        
        // Add parameters
        let hasParams = false;
        
        // Add required parameters
        requiredParams.forEach((param, index) => {
            content += '@' + param + '=\'{{ ' + param + ' }}\' --required';
            hasParams = true;
            
            if (index < requiredParams.length - 1 || optionalParams.length > 0) {
                content += ', \n';
            }
        });
        
        // Add optional parameters
        optionalParams.forEach((param, index) => {
            const paramDetails = methodDetails.optionalParams[param];
            const isBoolean = paramDetails.type === 'boolean';
            
            content += '@' + param + '=';
            
            if (isBoolean) {
                content += '{{ ' + param + ' }}';
            } else {
                content += '\'{{ ' + param + ' }}\'';
            }
            
            hasParams = true;
            
            if (index < optionalParams.length - 1) {
                content += ', \n';
            }
        });
        
        // Add request body if present
        if (methodDetails.requestBody && methodDetails.requestBody.properties && 
            Object.keys(methodDetails.requestBody.properties).length > 0) {
            
            if (hasParams) {
                content += ' \n';
            }
            
            content += '@@json=\n\'{\n';
            
            // Format request body properties as JSON
            // Filter out read-only properties based on OpenAPI readOnly flag
            const bodyProps = Object.entries(methodDetails.requestBody.properties)
                .filter(([_, propDetails]) => propDetails.readOnly !== true)
                .map(([propName]) => propName);
            
            bodyProps.forEach((prop, index) => {
                const propDetails = methodDetails.requestBody.properties[prop];
                const isString = propDetails.type !== 'number' && 
                                propDetails.type !== 'integer' && 
                                propDetails.type !== 'boolean';
                
                content += '"' + prop + '": ';
                
                if (isString) {
                    content += '"{{ ' + prop + ' }}"';
                } else {
                    content += '{{ ' + prop + ' }}';
                }
                
                if (index < bodyProps.length - 1) {
                    content += ', \n';
                } else {
                    content += '\n';
                }
            });
            
            content += '}\'';
        }
        
        content += '\n;\n```\n</TabItem>\n';
    });
    
    // Close tabs
    content += '</Tabs>\n';
    
    return content;
}