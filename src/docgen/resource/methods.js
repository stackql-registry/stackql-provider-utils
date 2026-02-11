// src/docgen/resource/methods.js
import { 
    getSqlMethodsWithOrderedFields,
    sanitizeHtml
} from '../helpers.js';

const getRequiredBodyParams = (methodDetails, accessType) => {
    // Only process request body for insert, update, replace, and exec
    if (!['insert', 'update', 'replace', 'exec'].includes(accessType)) {
        return [];
    }
    
    // Get required body params if they exist
    const requiredBodyProps = methodDetails.requestBody?.required ? methodDetails.requestBody.required : [];
    
    // For insert, update, and replace, prefix with data__
    if (['insert', 'update', 'replace'].includes(accessType)) {
        return requiredBodyProps.map(prop => `data__${prop}`);
    } else {
        // For exec, don't prefix
        return requiredBodyProps;
    }
};

export function createMethodsSection(resourceData, dereferencedAPI, succinct = false) {
    
    let content = `\n## Methods\n\n`;

    content += 'The following methods are available for this resource:\n\n';

    // Add the table header
    content += `<table>
<thead>
    <tr>
    <th>Name</th>
    <th>Accessible by</th>
    <th>Required Params</th>
    <th>Optional Params</th>
    <th>Description</th>
    </tr>
</thead>
<tbody>`;

    const selectMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'select');
    const insertMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'insert');
    const updateMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'update');
    const replaceMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'replace');
    const deleteMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'delete');
    const execMethods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'exec');

    // console.dir(selectMethods, { depth: null, colors: true });

    // Helper function to add methods to the table
    const addMethodsToTable = (methods, accessType) => {
        for (const [methodName, methodDetails] of Object.entries(methods)) {
            console.info(`Adding ${accessType} method to table: ${methodName}`);
            
            // Get required params from both the standard params and the request body
            const reqParamsArr = Object.keys(methodDetails.requiredParams || {});
            const reqBodyParamsArr = getRequiredBodyParams(methodDetails, accessType);
            
            // Combine both types of required parameters
            const allReqParamsArr = [...reqParamsArr, ...reqBodyParamsArr];
            
            // Format required params as comma-delimited list with hyperlinks
            const requiredParamsStr = allReqParamsArr.length > 0 
                ? allReqParamsArr.map(param => `<a href="#parameter-${param}"><code>${param}</code></a>`).join(', ') 
                : '';
            
            // Format optional params as comma-delimited list with hyperlinks
            const optionalParamsArr = Object.keys(methodDetails.optionalParams || {});
            const optionalParamsStr = optionalParamsArr.length > 0 
                ? optionalParamsArr.map(param => `<a href="#parameter-${param}"><code>${param}</code></a>`).join(', ') 
                : '';

            // Add the method row to the table
            content += `
<tr>
    <td><a href="#${methodName}"><CopyableCode code="${methodName}" /></a></td>
    <td><CopyableCode code="${accessType}" /></td>
    <td>${requiredParamsStr}</td>
    <td>${optionalParamsStr}</td>
    <td>${sanitizeHtml(succinct && methodDetails.opSummary ? methodDetails.opSummary : methodDetails.opDescription)}</td>
</tr>`;
        }
    };

    // Add all methods to the table by type
    console.info(`Processing select methods...`);
    addMethodsToTable(selectMethods, 'select');
    
    console.info(`Processing insert methods...`);
    addMethodsToTable(insertMethods, 'insert');
    
    console.info(`Processing update methods...`);
    addMethodsToTable(updateMethods, 'update');
    
    console.info(`Processing replace methods...`);
    addMethodsToTable(replaceMethods, 'replace');
    
    console.info(`Processing delete methods...`);
    addMethodsToTable(deleteMethods, 'delete');
    
    console.info(`Processing exec methods...`);
    addMethodsToTable(execMethods, 'exec');

    // Close the table
    content += `
</tbody>
</table>`;

    return content;
}
