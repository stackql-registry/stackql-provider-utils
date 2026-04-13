# Analyze Operation

The `analyze` operation examines split OpenAPI specifications and generates mapping recommendations for StackQL resources and methods.

## Overview

After splitting a large OpenAPI specification into service-specific files, the next step is to analyze these files to identify operations, parameters, and response schemas. The `analyze` operation processes each service file and generates CSV mapping recommendations that can be used as a starting point for configuring StackQL provider resources and methods.

## Function Signature

```javascript
async function analyze(options) {
  // Implementation details
}
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputDir` | string | Yes | Directory containing split service files |
| `outputDir` | string | Yes | Directory for analysis output |
| `verbose` | boolean | No | Whether to output detailed logs (default: false) |

## Return Value

The function returns a Promise that resolves to an object containing:

```javascript
{
  serviceCount: number,      // Number of services analyzed
  operationCount: number,    // Total number of operations found
  outputDirectory: string,   // Path to the output directory
  mappingFile: string        // Path to the generated mapping file
}
```

## Example Usage

```javascript
import { providerdev } from '@stackql/provider-utils';

async function analyzeExample() {
  try {
    const result = await providerdev.analyze({
      inputDir: './output/split/okta',
      outputDir: './output/analysis/okta',
      verbose: true
    });
    
    console.log(`Analysis completed successfully!`);
    console.log(`Analyzed ${result.serviceCount} services with a total of ${result.operationCount} operations.`);
    console.log(`Output directory: ${result.outputDirectory}`);
    console.log(`Mapping file: ${result.mappingFile}`);
  } catch (error) {
    console.error('Error analyzing OpenAPI specs:', error);
  }
}

analyzeExample();
```

## Output Structure

The analyze operation creates the following outputs:

```
outputDir/
├── {providerName}/
│   ├── all_services.csv        # Main mapping file with all operations
│   ├── service1_analysis.json  # Detailed analysis of service1
│   ├── service2_analysis.json  # Detailed analysis of service2
│   └── ...
```

## CSV Mapping Format

The generated `all_services.csv` file includes the following columns:

| Column | Description |
|--------|-------------|
| `filename` | Name of the service file |
| `path` | API endpoint path |
| `operationId` | Original operation ID from the spec |
| `formatted_op_id` | Operation ID formatted as snake_case |
| `verb` | HTTP method (GET, POST, PUT, DELETE, etc.) |
| `response_object` | Main response object schema reference |
| `tags` | Original tags from the operation |
| `formatted_tags` | Tags formatted as snake_case |
| `stackql_resource_name` | Suggested StackQL resource name (to be filled in) |
| `stackql_method_name` | Suggested StackQL method name (to be filled in) |
| `stackql_verb` | Suggested SQL verb (SELECT, INSERT, UPDATE, DELETE) (to be filled in) |
| `op_description` | Operation summary or description from the spec |

The last three columns (`stackql_resource_name`, `stackql_method_name`, `stackql_verb`) are initially empty or populated with existing mappings if found in the spec. They can be updated manually based on your desired StackQL provider structure.

## Missing Mappings

After applying all automatic defaults, `analyze` checks each operation for unmapped fields and logs a `WARN` message for any that are still empty:

```
agentpools.yaml/getAgentPoolsUpdateSettings is not mapped to a resource
users.yaml/createUser is not mapped to a resource, method_name
```

Only the fields that are actually empty are included in the message. The three fields checked are:

| Field | When it appears in the warning |
|---|---|
| `resource` | `stackql_resource_name` is empty — no existing mapping was found in the spec and no `x-stackql-resource` annotation is present. This is the most common case and always requires manual intervention. |
| `method_name` | `stackql_method_name` is empty — only occurs when the operation has no `operationId`. |
| `stackql_verb` | `stackql_verb` is empty — effectively never occurs because a default is derived from the HTTP verb (`get` → `select`, `post` → `insert`, etc.). |

These warnings indicate rows in `all_services.csv` that need to be filled in before running `generate`. `analyze` still writes the row to the CSV (with the empty fields) so you have a complete record of every operation to work from.

> **Tip:** After filling in the CSV, re-run `analyze` — it skips rows that are already fully mapped, so only genuinely new or incomplete operations are reported.

## Working with the Mapping File

1. **Review the generated mapping file**: Open the CSV file and review all operations
2. **Complete the mapping**:
   - Assign appropriate resource names (e.g., `users`, `groups`, `applications`)
   - Assign method names (e.g., `list`, `get`, `create`, `update`, `delete`)
   - Map HTTP methods to SQL verbs (e.g., GET → SELECT, POST → INSERT, PUT/PATCH → UPDATE, DELETE → DELETE)
   - Use the `op_description` column to understand what each operation does
3. **Naming conventions**:
   - Resources are typically plural nouns (e.g., `users` not `user`)
   - Methods are typically verbs (e.g., `list`, `get`, `create`)
   - Follow consistent naming patterns across related operations

## Resource and Method Naming Recommendations

### Resource Naming

Resources should represent logical entities in the API. For example:
- `users`
- `groups`
- `applications`
- `zones`

Group related operations under the same resource when they operate on the same entity.

### Method Naming

Methods should describe the action performed on the resource:

| HTTP Method | Common Method Names |
|-------------|---------------------|
| GET (collection) | `list`, `search`, `find` |
| GET (individual) | `get`, `describe`, `fetch` |
| POST (create) | `create`, `add`, `register` |
| PUT/PATCH | `update`, `modify`, `patch` |
| DELETE | `delete`, `remove`, `deregister` |

### SQL Verb Mapping

The standard mapping from HTTP methods to SQL verbs:

| HTTP Method | SQL Verb |
|-------------|----------|
| GET | SELECT |
| POST | INSERT |
| PUT/PATCH | UPDATE |
| DELETE | DELETE |