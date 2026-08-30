// src/docgen/resource/parameters.js
import { 
    getSqlMethodsWithOrderedFields,
    sanitizeHtml 
} from '../helpers.js';
import { wireHint } from '../casing.js';

const mdCodeAnchor = "`";

export function createParamsSection(resourceData, dereferencedAPI, casing = null) {
    let content = '\n\n## Parameters\n\n';

    content += 'Parameters can be passed in the `WHERE` clause of a query. ' +
               'Check the [Methods](#methods) section to see which parameters are required or optional for each operation.\n\n';
 
    // Get all methods at once
    const allMethodTypes = ['select', 'insert', 'update', 'replace', 'delete', 'exec'];
    const allMethods = allMethodTypes.flatMap(type => 
        Object.values(getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, type, casing))
    );
    
    // Collect all unique parameters in one pass
    const requiredParams = {};
    const optionalParams = {};
    
    allMethods.forEach(method => {
        // Add required params
        Object.entries(method.requiredParams || {}).forEach(([name, details]) => {
            requiredParams[name] = details;
        });
        
        // Add optional params
        Object.entries(method.optionalParams || {}).forEach(([name, details]) => {
            optionalParams[name] = details;
        });
    });

    // Add the table header
    content += `<table>
<thead>
    <tr>
    <th>Name</th>
    <th>Datatype</th>
    <th>Description</th>
    </tr>
</thead>
<tbody>`;            

    // Helper function to add parameter rows
    const addParamRows = (params) => {
        // Sort parameters alphabetically for better readability
        const sortedParamNames = Object.keys(params).sort();
        
        for (const paramName of sortedParamNames) {
            const paramDetails = params[paramName];
            content += `
<tr id="parameter-${paramName}">
    <td><CopyableCode code="${paramName}" /></td>
    <td><code>${paramDetails.type || ''}</code></td>
    <td>${sanitizeHtml(paramDetails.description) || ''}${wireHint(paramDetails)}</td>
</tr>`;
        }
    };

    // Add required parameter rows
    addParamRows(requiredParams);
    
    // Add optional parameter rows
    addParamRows(optionalParams);
    
    // Close the table
    content += `
</tbody>
</table>`;

    return content;
}