// src/docgen/resource/view.js
import { sanitizeHtml } from '../helpers.js';

export function docView(resourceData) {

    let content = '';

    const fields = resourceData.config?.docs?.fields ?? [];

    if (fields.length === 0) {
        content += `See the SQL Definition (view DDL) for fields returned by this view.\n\n`;
    } else {
        // Add the table
        content += `The following fields are returned by this view:\n\n`;
        content += `<table>
<thead>
    <tr>
    <th>Name</th>
    <th>Datatype</th>
    <th>Description</th>
    </tr>
</thead>
<tbody>`;

        for (const field of fields) {
            content += `
<tr>
    <td><CopyableCode code="${field.name}" /></td>
    <td><CopyableCode code="${field.type}" /></td>
    <td>${sanitizeHtml(field.description)}</td>
</tr>`;
        }

        // Close the table
        content += `
</tbody>
</table>\n\n`;
    }

    // Add required params section if exists
    const requiredParams = resourceData.config?.docs?.requiredParams ?? [];
    if (requiredParams.length > 0) {
        // add the table
        content += `## Required Parameters\n\n`;
        content += `The following parameters are required by this view:\n\n`;
        content += `<table>
<thead>
    <tr>
    <th>Name</th>
    <th>Datatype</th>
    <th>Description</th>
    </tr>
</thead>
<tbody>`;

        for (const param of requiredParams) {
            content += `
<tr>
    <td><CopyableCode code="${param.name}" /></td>
    <td><CopyableCode code="${param.type}" /></td>
    <td>${sanitizeHtml(param.description)}</td>
</tr>`;
        }

        // Close the table
        content += `
</tbody>
</table>\n\n`;
    }

    // SELECT examples section
    content += `## \`SELECT\` Examples\n\n`;

    // Compose example queries based on fields and required params
    const fqViewName = resourceData.id ?? 'view_name';
    const fieldList = fields.length > 0
        ? fields.map(f => f.name).join(',\n  ')
        : '*';

    if (requiredParams.length > 0) {
        const whereClause = requiredParams
            .map(p => `${p.name} = '{{ ${p.name} }}'`)
            .join('\n  AND ');
        content += `\`\`\`sql
SELECT
  ${fieldList}
FROM ${fqViewName}
WHERE ${whereClause};
\`\`\`\n\n`;
    } else {
        content += `\`\`\`sql
SELECT
  ${fieldList}
FROM ${fqViewName};
\`\`\`\n\n`;
    }

    // SQL Definition section
    content += `## SQL Definition\n\n`;
    
    // Build array of dialect objects
    const dialects = [];
    let currentSelect = resourceData.config.views.select;
    
    // Add primary dialect
    dialects.push({
        name: extractDialectName(currentSelect.predicate),
        ddl: currentSelect.ddl
    });
    
    // Add fallback dialects
    while (currentSelect.fallback) {
        currentSelect = currentSelect.fallback;
        dialects.push({
            name: extractDialectName(currentSelect.predicate),
            ddl: currentSelect.ddl
        });
    }
    
    // Create the tabbed interface
    const tabValues = dialects.map(dialect => (
`{ label: '${dialect.name}', value: '${dialect.name}' }`
    )).join(',\n');
    
    content += `<Tabs
defaultValue="${dialects[0].name}"
values={[
${tabValues}
]}
>\n`;
    
    // Create tab content
    for (const dialect of dialects) {
        content += `<TabItem value="${dialect.name}">\n\n`;
        content += `\`\`\`sql
${dialect.ddl}
\`\`\`\n\n`;
        content += `</TabItem>\n`;
    }
    
    content += `</Tabs>\n`;

    return content;

}

// Extract and format dialect name from predicate
function extractDialectName(predicate) {
    if (!predicate) {
        return 'Default';
    }
    const dialectMatch = predicate.match(/sqlDialect\s*==\s*['"](.*?)['"]/);
    if (!dialectMatch || !dialectMatch[1]) {
        throw new Error(`Invalid dialect predicate: ${predicate}`);
    }
    
    // Capitalize first letter of dialect name
    return dialectMatch[1].charAt(0).toUpperCase() + dialectMatch[1].slice(1);
}