# Split Operation

The `split` operation divides a large OpenAPI specification into smaller, service-specific files that are easier to manage and process.

## Overview

Processing large monolithic OpenAPI specifications can be challenging. The `split` operation breaks down these large files into smaller, more manageable pieces based on logical service boundaries. This makes subsequent analysis and generation steps more efficient and helps organize the provider structure.

## Function Signature

```javascript
async function split(options) {
  // Implementation details
}
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiDoc` | string | Yes | Path to the OpenAPI specification file |
| `providerName` | string | Yes | Name of the provider (e.g., 'github', 'aws') |
| `outputDir` | string | Yes | Directory for output files |
| `svcDiscriminator` | string | Yes | Method for determining services ('tag', 'path', or 'function') |
| `svcDiscriminatorFn` | function | Conditional | User-supplied service-mapping function. Required when `svcDiscriminator` is `'function'`. |
| `overwrite` | boolean | No | Whether to overwrite existing files (default: false) |
| `verbose` | boolean | No | Whether to output detailed logs (default: false) |
| `svcNameOverrides` | object | No | Map of service names to override (default: {}) |

## Service Discriminators

The `svcDiscriminator` parameter determines how services are identified:

- **tag**: Uses OpenAPI tags to group operations into services. This is ideal for well-organized APIs where operations are properly tagged by service or resource type.

- **path**: Uses URL path patterns to determine service boundaries. This is useful for APIs that follow a consistent URL structure but may not have proper tagging.

- **function**: Delegates the service-name decision to a user-supplied function. This is useful for providers whose tags or paths do not cleanly map to services - for example Confluent, where tags include both `API Keys (iam/v2)` (which should map to `iam`) and `Schemas (v1)` (which should map to `schemas`). The function is called once per operation as the splitter walks the spec, and its return value is used as the service name.

### Function discriminator

When `svcDiscriminator` is `'function'`, supply `svcDiscriminatorFn` either as a JavaScript function (programmatic API) or as a path to a `.js` / `.mjs` module that exports the function as the default export (CLI - via `--svc-discriminator-fn FILE`).

The function is invoked as:

```javascript
svcDiscriminatorFn(path, operationId, tags, context)
```

| Argument | Type | Description |
|----------|------|-------------|
| `path` | string | The OpenAPI path key, e.g. `/iam/v2/api-keys` |
| `operationId` | string \| null | The operation's `operationId`, or `null` if absent |
| `tags` | string[] | The operation's `tags` array (empty if none) |
| `context` | object | `{ providerName, pathItem, operation }` for advanced cases |

The function should return:

- A non-empty string - used as the service name (lowercased; hyphens, spaces and dots are converted to underscores).
- `null`, `undefined`, `''`, or the literal string `'skip'` - the operation is skipped.

`svcNameOverrides` is applied after the function returns, so it can still be used to remap the function's output.

#### Example: Confluent canonical-ref pattern

Tags like `API Keys (iam/v2)` should map to `iam`; tags like `Schemas (v1)` should map to `schemas`. Save the following as e.g. `provider-dev/scripts/confluent-svc.mjs`:

```javascript
// confluent-svc.mjs
export default function confluentSvc(path, operationId, tags) {
  const tag = tags && tags[0];
  if (!tag) return null;

  // "API Keys (iam/v2)"  -> "iam"
  // "Schemas (v1)"       -> "schemas"
  const m = tag.match(/\(([^)]+)\)\s*$/);
  if (m) {
    const inside = m[1];
    const slash = inside.indexOf('/');
    return slash >= 0 ? inside.slice(0, slash) : tag.replace(/\s*\([^)]*\)\s*$/, '');
  }
  return tag;
}
```

Run via the CLI:

```bash
npm run split -- \
  --provider-name confluent \
  --api-doc provider-dev/downloaded/confluent.yaml \
  --svc-discriminator function \
  --svc-discriminator-fn provider-dev/scripts/confluent-svc.mjs \
  --output-dir provider-dev/source \
  --overwrite
```

Or programmatically:

```javascript
import { providerdev } from '@stackql/provider-utils';
import confluentSvc from './provider-dev/scripts/confluent-svc.mjs';

await providerdev.split({
  apiDoc: './provider-dev/downloaded/confluent.yaml',
  providerName: 'confluent',
  outputDir: './provider-dev/source',
  svcDiscriminator: 'function',
  svcDiscriminatorFn: confluentSvc,
  overwrite: true,
});
```

## Service Name Overrides

The `svcNameOverrides` parameter allows you to rename services during the split process. This is useful when:

- The automatically generated service names are not descriptive enough
- You want to standardize service naming across different providers
- You need to merge similar services under a common name

The parameter takes an object where:
- Keys are the original service names (as determined by the service discriminator)
- Values are the new service names to use

For example:
```javascript
{
  "user_management": "users",
  "user_authentication": "auth",
  "compute_instances": "compute"
}
```

## Return Value

The function returns a Promise that resolves to an object containing:

```javascript
{
  serviceCount: number,      // Number of services created
  operationCount: number,    // Total number of operations processed
  outputDirectory: string,   // Path to the output directory
  services: Array<string>    // List of service names created
}
```

## Example Usage

```javascript
import { providerdev } from '@stackql/provider-utils';

async function splitExample() {
  try {
    const result = await providerdev.split({
      apiDoc: './specs/okta/management-minimal.yaml',
      providerName: 'okta',
      outputDir: './output/split/okta',
      svcDiscriminator: 'path',
      overwrite: true,
      verbose: true,
      svcNameOverrides: {
        'users': 'identity',
        'apps': 'applications'
      }
    });
    
    console.log(`Split operation completed successfully!`);
    console.log(`Created ${result.serviceCount} services with a total of ${result.operationCount} operations.`);
    console.log(`Output directory: ${result.outputDirectory}`);
    console.log(`Services created: ${result.services.join(', ')}`);
  } catch (error) {
    console.error('Error splitting OpenAPI doc:', error);
  }
}

splitExample();
```

## Output Structure

The split operation creates the following directory structure:

```
outputDir/
├── {providerName}/
│   ├── service1.yaml
│   ├── service2.yaml
│   └── ...
```

Each service file contains only the paths, schemas, and operations relevant to that service.