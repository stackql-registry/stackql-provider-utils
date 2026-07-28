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
| `viewsDir` | string | No | Root directory for convenience-view fragments. Each `<viewsDir>/<service>/views.yaml` is spliced into the matching service's `components.x-stackQL-resources`. See [Convenience Views](#convenience-views). The CLI defaults to `./views` if it exists. |
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

## Convenience Views

Provider authors often want to ship "convenience views" alongside the API-derived resources - flattened, parameterised SELECT shapes that hide `JSON_EXTRACT` / `->>` plumbing from end users. `generate` picks these up from a `views/` tree on disk and splices them into each service spec's `components.x-stackQL-resources` map.

### Directory layout

```
views/
  managed_kafka_clusters/
    views.yaml
  iam/
    views.yaml
```

Each subdirectory is named to match the generated `services/<service>.yaml` (the snake_cased base of the source filename). `views.yaml` is a YAML fragment whose top-level keys are view names. The fragment is conventionally indented at 4 spaces, since it is intended to be spliced as the body of `components.x-stackQL-resources`:

```yaml
    vw_clusters:
      name: vw_clusters
      id: confluent.managed_kafka_clusters.vw_clusters
      config:
        views:
          select:
            predicate: sqlDialect == "sqlite3"
            ddl: |-
              SELECT id, JSON_EXTRACT(spec, '$.display_name') AS display_name
              FROM confluent.managed_kafka_clusters.clusters
              WHERE environment = '{{ environment }}'
```

`generate` dedents the fragment automatically (using the smallest non-blank leading-space count), so a flush-left fragment also parses.

### Discovery

- `--views-dir <path>` CLI flag (or `viewsDir` option), if supplied, takes precedence and must point to an existing directory.
- Otherwise the CLI falls back to `./views` if it exists.
- If neither resolves, no views are merged.

### Merge rules

- Existing API-derived entries always win on key collision; collisions are reported via the logger and the view for that key is skipped, so a view can never silently overwrite a real resource.
- If an existing entry is deep-equal to the incoming view body, it's treated as an idempotent re-run and skipped silently.
- Otherwise the view body is added as a sibling under `components.x-stackQL-resources` and persisted to the written service spec.

## Bare-array Response Wrap (pairs with `normalize` pass 6)

When `normalize` rewrites an operation with a bare-array 2xx response, it leaves an `x-stackql-bare-array-wrap` extension on the operation. `generate` consumes this marker and, on the matching resource method's `response` block:

- sets `objectKey` to `$.<wrapperKey>` (overrides any manifest-supplied `objectKey` for this method since the wrapper schema dictates the shape),
- sets `overrideMediaType` to the operation's response media type (defaults to `application/json`),
- sets `schema_override` to `{ $ref: '#/components/schemas/<WrapperName>' }` pointing at the synthesised wrapper schema,
- attaches `transform.body` (a Go template) and `transform.type: golang_template_text_v0.3.0` as siblings of `objectKey` inside `response`,
- removes the marker from the operation so it does not persist in the written spec.

All four keys (`objectKey`, `overrideMediaType`, `schema_override`, `transform`) live inside `response` as siblings. The `overrideMediaType` + `schema_override` pair is what tells stackql's response pipeline to fire the transform at runtime; without them stackql resolves the spec-side wrapper schema correctly but never re-types the runtime payload, the JSONPath evaluator hits the bare-array, and the query fails with `expected number but got <wrapperKey> (string)`.

Two transform-body flavours are produced:

| Items shape | Transform body |
|---|---|
| Scalar (`string` / `integer` / `number` / `boolean`) | Per-item wrap into a single-column row using `jsonMapFromString`, e.g. `{"contexts":[{"context":"default"},...]}`. |
| Object | Outer rename only: `{"connector_tasks": [...]}`. |

The naming heuristics (wrapper key / column name) are decided in `normalize`. If you need to override them, pass `--bare-array-overrides` to `normalize` rather than editing the generated spec.

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

## Skipping Operations via the Manifest

To leave an operation in the source OpenAPI spec but exclude it from the generated `components.x-stackQL-resources` block, set its `stackql_resource_name` column to the literal string `skip_this_resource` in the manifest CSV. The operation is bypassed before the 2xx response check, so this also lets you process specs that contain operations with no 2xx response (e.g. 302-only download endpoints). The operation remains untouched in `spec.paths`; no method entry is created and no `sqlVerbs[...]` reference is added. Rows with any other value (including empty string) are unaffected.

Example row:

```csv
filename,path,verb,stackql_resource_name,stackql_method_name,stackql_verb,stackql_object_key
downloads.yaml,/files/{id}/download,get,skip_this_resource,,,
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
