// src/docgen/resource/fields.js
import {
    getSqlMethodsWithOrderedFields,
    sanitizeHtml,
    generateSchemaJsonFromProps,
    sortSchemaFields,
} from '../helpers.js';
import { docView } from './view.js';

const mdCodeAnchor = "`";

// List of meaningless descriptions to filter out (all lowercase)
const meaninglessDescriptions = [
    'ok',
    'successful response',
    'success'
];

export function createFieldsSection(resourceType, resourceData, dereferencedAPI) {
    let content = '## Fields\n\n';

    if(resourceType === 'Resource'){
    
        content += 'The following fields are returned by `SELECT` queries:\n\n';

        // Use the reusable function to get methods with ordered fields
        const methods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'select');
        
        if (Object.keys(methods).length > 0) {
            // Create the tabs and markdown content
            const methodNames = Object.keys(methods);
            
            // Create the tab values array for the Tabs component
            const tabValues = methodNames.map(methodName => {
                return `{ label: '${methodName}', value: '${methodName}' }`;
            }).join(',\n        ');
            
            // Start building the Tabs component
            content += `<Tabs
    defaultValue="${methodNames[0]}"
    values={[
        ${tabValues}
    ]}
>\n`;
        
            // Create the TabItems with table content
            for (const methodName of methodNames) {
                const methodData = methods[methodName];
                
                // Start the TabItem
                content += `<TabItem value="${methodName}">\n\n`;
                
                // Add the method description if available and not in the meaningless list
                if (methodData.respDescription && 
                    !meaninglessDescriptions.includes(methodData.respDescription.trim().toLowerCase()) &&
                    methodData.respDescription.trim().length > 0) {
                    content += `${sanitizeHtml(methodData.respDescription)}\n\n`;
                }
                

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

                // Add each property as a row in the table
                for (const [propName, propData] of Object.entries(methodData.properties)) {
                    content += `\n<tr>
    <td><CopyableCode code="${propName}" /></td>
    <td><code>${propData.type}</code></td>
    <td>${sanitizeHtml(propData.description)}</td>
</tr>`;
                }
            
                content += `\n</tbody>
</table>
`;

                // Close the TabItem
                content += `</TabItem>\n`;
            }
            
            // Close the Tabs component
            content += `</Tabs>\n`;
        } else {
            // no fields
            content += `${mdCodeAnchor}SELECT${mdCodeAnchor} not supported for this resource, use ${mdCodeAnchor}SHOW METHODS${mdCodeAnchor} to view available operations for the resource.\n\n`;
        }

    } else {
        // its a view
        console.log(`processing view : ${resourceData.name}...`)
        content += docView(resourceData);
    }

    return content;
}

export function createFieldsSectionv2(resourceType, resourceData, dereferencedAPI) {
    let content = '## Fields\n\n';

    if (resourceType === 'Resource') {

        content += 'The following fields are returned by `SELECT` queries:\n\n';

        // Use the reusable function to get methods with ordered fields
        const methods = getSqlMethodsWithOrderedFields(resourceData, dereferencedAPI, 'select');

        if (Object.keys(methods).length > 0) {
            const methodNames = Object.keys(methods);

            const tabValues = methodNames.map(methodName => {
                return `{ label: '${methodName}', value: '${methodName}' }`;
            }).join(',\n        ');

            content += `<Tabs
    defaultValue="${methodNames[0]}"
    values={[
        ${tabValues}
    ]}
>\n`;

            for (const methodName of methodNames) {
                const methodData = methods[methodName];

                content += `<TabItem value="${methodName}">\n\n`;

                // Add the method description if available and not in the meaningless list
                if (methodData.respDescription &&
                    !meaninglessDescriptions.includes(methodData.respDescription.trim().toLowerCase()) &&
                    methodData.respDescription.trim().length > 0) {
                    content += `${sanitizeHtml(methodData.respDescription)}\n\n`;
                }

                // Build nested schema JSON from raw response props and sort fields
                const schemaFields = generateSchemaJsonFromProps(methodData.rawRespProps);
                const sortedFields = sortSchemaFields(schemaFields);

                content += `<SchemaTable fields={${JSON.stringify(sortedFields, null, 2)}} />\n`;

                content += `</TabItem>\n`;
            }

            content += `</Tabs>\n`;
        } else {
            content += `${mdCodeAnchor}SELECT${mdCodeAnchor} not supported for this resource, use ${mdCodeAnchor}SHOW METHODS${mdCodeAnchor} to view available operations for the resource.\n\n`;
        }

    } else {
        // its a view
        console.log(`processing view : ${resourceData.name}...`)
        content += docView(resourceData);
    }

    return content;
}

