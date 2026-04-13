# Generate Operation

The `generate` operation creates StackQL provider extensions from OpenAPI specifications and mapping configurations.

## Overview

After splitting an OpenAPI specification into service files and creating a mapping configuration, the `generate` operation transforms these inputs into a complete StackQL provider. The generated provider includes all the necessary components for StackQL to interact with the API, including resource definitions, method mappings, authentication configurations, and endpoint information.

## Function Signature

```javascript
async function generate(options) {
  // Implementation details
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputDir` | string | Yes | Directory containing split service files |
| `outputDir` | string | Yes | Directory for generated provider |
| `configPath` | string | Yes | Path to mapping configuration CSV |
| `providerId` | string | Yes | Provider identifier |
| `servers` | Array\<Object\> | No | Server configuration (URLs, variables) |
| `providerConfig` | Object | No | Provider-specific configuration (auth, etc.) |
| `serviceConfig` | Object | No | Service-level configuration injected as `x-stackQL-config` at the root of each service spec (e.g., pagination settings) |
| `naiveReqBodyTranslate` | boolean | No | When `true`, adds `config.requestBodyTranslate.algorithm: naive` to every method with a request body (POST, PUT, PATCH). Also causes doc generation to omit the `data__` prefix on insert/update/replace fields. (default: false) |
| `updatePathParamNames` | boolean | No | When `true`, converts all path parameter names to snake_case (e.g. `projectId` → `project_id`) as a preprocessing step before `x-stackQL-resources` is generated. See [Path Parameter Name Normalisation](#path-parameter-name-normalisation). (default: false) |
| `skipFiles` | Array\<string\> | No | List of files to skip during generation |
| `overwrite` | boolean | No | Whether to overwrite existing files (default: false) |
| `verbose` | boolean | No | Whether to output detailed logs (default: false) |

### Server Configuration

The `servers` parameter defines the base URL(s) for API requests, including any variable placeholders:

```javascript
servers: [
  {
    "url": "https://{subdomain}.api.example.com/v1",
    "variables": {
      "subdomain": {
        "default": "api",
        "description": "Your API subdomain"
      }
    }
  }
]
```

### Provider Configuration

The `providerConfig` parameter defines authentication and other provider-specific settings:

```javascript
providerConfig: {
  "config": {
    "auth": {
      "type": "api_key",
      "credentialsenvvar": "API_KEY",
      "valuePrefix": "Bearer "
    }
  }
}
```

## Return Value

The function returns a Promise that resolves to an object containing:

```javascript
{
  serviceCount: number,      // Number of services processed
  resourceCount: number,     // Number of resources created
  methodCount: number,       // Number of methods created
  outputDirectory: string    // Path to the output directory
}
```

## Example Usage

```javascript
import { providerdev } from '@stackql/provider-utils';

async function generateExample() {
  try {
    const result = await providerdev.generate({
      inputDir: './output/split/github',
      outputDir: './output/generate/github',
      configPath: './config/mapping/github/all_services.csv',
      providerId: 'github',
      servers: [
        {
          "url": "https://api.github.com",
          "description": "GitHub API endpoint"
        }
      ],
      providerConfig: {
        "config": {
          "auth": {
            "type": "bearer",
            "credentialsenvvar": "GITHUB_TOKEN"
          }
        }
      },
      overwrite: true,
      verbose: true
    });
    
    console.log(`Provider generation completed successfully!`);
    console.log(`Processed ${result.serviceCount} services.`);
    console.log(`Created ${result.resourceCount} resources with ${result.methodCount} methods.`);
    console.log(`Output directory: ${result.outputDirectory}`);
  } catch (error) {
    console.error('Error generating provider extensions:', error);
  }
}

generateExample();
```

## Path Parameter Name Normalisation

When `updatePathParamNames: true` is set, every path parameter name in the spec is converted to snake_case before `x-stackQL-resources` is injected. This is useful because StackQL converts path parameters into query parameters at runtime, and when a response payload contains a field with the same name as a path parameter (e.g. both a path param `projectId` and a response field `projectId`), the analyzer can confuse the two. Converting path param names to snake_case makes them distinct from the camelCase field names typically found in response payloads.

### What gets renamed

The normalisation applies to **path parameters only** (`in: path`). Query and header parameter names are left exactly as they are, because those names are evaluated by the remote server and must match the API's expectations.

| Location | What changes |
|---|---|
| `components/parameters` entries where `in: path` | The `name` field is converted to snake_case |
| Inline parameters at path-item level where `in: path` | The `name` field is converted to snake_case |
| Inline parameters at operation level where `in: path` | The `name` field is converted to snake_case |
| Path URL strings in `paths` keys | `{camelCase}` placeholders become `{snake_case}` |
| `$ref` strings pointing to `components/parameters` | **Unchanged** — component keys are not renamed |
| Query and header parameter names | **Unchanged** |

### Example

Given this input spec fragment:

```yaml
paths:
  /projects/{projectId}/resources/{resourceId}:
    parameters:
      - $ref: '#/components/parameters/pathProjectId'
      - $ref: '#/components/parameters/pathResourceId'

components:
  parameters:
    pathProjectId:
      name: projectId
      in: path
      required: true
      schema:
        type: string
    pathResourceId:
      name: resourceId
      in: path
      required: true
      schema:
        type: string
```

After normalisation the written output contains:

```yaml
paths:
  /projects/{project_id}/resources/{resource_id}:   # path key renamed
    parameters:
      - $ref: '#/components/parameters/pathProjectId'   # $ref unchanged
      - $ref: '#/components/parameters/pathResourceId'

components:
  parameters:
    pathProjectId:        # component key unchanged
      name: project_id   # name renamed
      in: path
      required: true
      schema:
        type: string
    pathResourceId:
      name: resource_id  # name renamed
      in: path
      required: true
      schema:
        type: string
```

The `x-stackQL-resources` `$ref` values in the output also use the renamed path:

```yaml
operation:
  $ref: '#/paths/~1projects~1{project_id}~1resources~1{resource_id}/get'
```

> **Note:** The mapping CSV used as `configPath` is built from the original (pre-normalisation) spec, so it contains the original camelCase path strings. `generate` handles this internally — it uses the original path string for the CSV lookup and the normalised path string for the generated `$ref` values.

## Missing Mappings

Every operation in the input spec must have a corresponding row in the mapping CSV with all three StackQL fields populated:

| CSV field | Description |
|---|---|
| `stackql_resource_name` | The StackQL resource the operation belongs to |
| `stackql_method_name` | The method name within that resource |
| `stackql_verb` | The SQL verb (`select`, `insert`, `update`, `delete`, `replace`, `exec`) |

If any of these fields are empty for an operation, `generate` logs an error message identifying exactly which fields are missing and **immediately exits with a `false` return value** (no output is written for that run):

```
❌ agentpools.yaml/getAgentPoolsUpdateSettings is not mapped to a resource
❌ users.yaml/createUser is not mapped to a resource, method_name
```

Only the missing fields are listed. If all three are missing the message names all three; if only one is missing only that one is named.

To resolve these errors, open the mapping CSV and fill in the missing values for the reported operations, then re-run `generate`.

## Output Structure

The generate operation creates the following directory structure:

```
outputDir/
├── {providerId}/
│   └── v00.00.00000/           # Version directory
│       ├── provider.yaml       # Main provider definition
│       └── services/           # Service definitions
│           ├── service1.yaml
│           ├── service2.yaml
│           └── ...
```

## Authentication Types

StackQL supports various authentication types, which can be configured in the `providerConfig` parameter:

### API Key Authentication

```javascript
providerConfig: {
  "config": {
    "auth": {
      "type": "api_key",
      "credentialsenvvar": "API_KEY",
      "in": "header",         // or "query"
      "name": "Authorization", // Header name or query parameter
      "valuePrefix": "Bearer " // Optional prefix
    }
  }
}
```

### Basic Authentication

```javascript
providerConfig: {
  "config": {
    "auth": {
      "type": "basic",
      "credentialsenvvar": "BASIC_AUTH" // username:password
    }
  }
}
```

### OAuth Authentication

```javascript
providerConfig: {
  "config": {
    "auth": {
      "type": "oauth",
      "tokenenvvar": "OAUTH_TOKEN"
    }
  }
}
```
