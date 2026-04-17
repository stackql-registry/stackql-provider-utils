# Normalize Operation

The `normalize` operation reshapes OpenAPI spec files in place so they can be consumed by stackql's relational analyzer. It is a pure client-side lowering step - upstream server behaviour is not changed, only the local spec representation.

## Overview

stackql is a relational backend, so polymorphism (`oneOf` / `anyOf`) cannot be represented as distinct SQL columns, and opaque `type: object` schemas with no defined fields have nothing for `DESCRIBE` to project. The `normalize` operation applies four passes that collapse these shapes into something the analyzer can handle:

1. **`renameVariants`** (top-level scope only) - rewrites `oneOf` / `anyOf` to `allOf` at top-level component schemas, their direct properties, and request / response body schemas and their direct properties. Deeper polymorphism is left alone because the analyzer does not descend into it.
2. **`stripMisplacedSchemaKeywords`** (whole-doc walk) - in any `properties:` map, deletes children whose name is a schema keyword (`type`, `required`, `description`, `title`, `format`, `minItems`, `maxItems`, `minimum`, `maximum`, `default`, `nullable`, `readOnly`, `writeOnly`, `deprecated`, `additionalProperties`, `patternProperties`) AND whose value is a scalar. These are upstream indentation bugs where e.g. the outer schema's `type: object` was indented one level too deep and landed inside `properties` as if it were a property named "type". Properties whose value is a proper schema object are preserved.
3. **`convertOpaqueObjectsToStrings`** (whole-doc walk) - any schema with `type: object` and none of `{properties, additionalProperties, patternProperties, allOf, oneOf, anyOf, $ref}` is rewritten to `type: string` with ` (opaque JSON object)` appended to the description. stackql then exposes it as a queryable JSON-blob column instead of failing `DESCRIBE` with "No columns found".
4. **`walkAllOf`** / **`flattenAllOf`** (whole-doc walk) - flattens every `allOf` array by merging members (resolving `$ref`s, deep-cloning) into a single schema. `required` arrays are unioned; `properties` merge without overwriting. `$ref` cycles are handled via a `seenRefs` set.

The operation rewrites every `.yaml` / `.yml` file in the target directory in place.

## Function Signature

```javascript
async function normalize(options) {
  // Implementation details
}
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiDir` | string | Yes | Directory containing `.yaml` / `.yml` OpenAPI service files |
| `verbose` | boolean | No | Whether to log per-pass detail for every file (default: `false`) |

## Return Value

The function returns a Promise that resolves to an aggregate stats object across every processed file:

```javascript
{
  allOfFlattened: number,       // count of allOf arrays merged
  oneOfRenamed: number,         // count of oneOf -> allOf rewrites
  anyOfRenamed: number,         // count of anyOf -> allOf rewrites
  stripped: Array<string>,      // JSON-pointer-ish paths of stripped keywords
  opaqueConverted: Array<string>, // paths of object->string rewrites
  filesProcessed: number        // how many files were rewritten
}
```

## Example Usage

```javascript
import { providerdev } from '@stackql/provider-utils';

async function normalizeExample() {
  try {
    const stats = await providerdev.normalize({
      apiDir: './provider-dev/source',
      verbose: true,
    });

    console.log(`Processed ${stats.filesProcessed} file(s).`);
    console.log(`Flattened ${stats.allOfFlattened} allOf array(s).`);
    console.log(`Renamed ${stats.oneOfRenamed} oneOf / ${stats.anyOfRenamed} anyOf to allOf.`);
    console.log(`Stripped ${stats.stripped.length} misplaced schema keyword(s).`);
    console.log(`Converted ${stats.opaqueConverted.length} opaque object schema(s) to string.`);
  } catch (error) {
    console.error('Error normalizing specs:', error);
  }
}

normalizeExample();
```

## CLI Usage

The operation is also exposed as a CLI via the `provider-dev-utils` bin entry:

```bash
npx provider-dev-utils normalize --api-dir ./provider-dev/source [--verbose]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--api-dir DIR` | Yes | Directory containing `.yaml` / `.yml` files to rewrite in place |
| `--verbose` | No | Log per-pass detail for every file |

## When To Run It

Run `normalize` on the output of `providerdev.split` (or on any hand-authored service spec directory) before `providerdev.generate`. Typical pipeline:

1. `providerdev.split` -> per-service YAML files in `provider-dev/source/`
2. `providerdev.normalize` -> rewrite those files in place for relational consumption
3. `providerdev.analyze` -> produce mapping recommendations
4. `providerdev.generate` -> build the stackql provider

## Caveats

- **In-place rewrite**: the original files are overwritten. Keep the raw spec under `provider-dev/downloaded/` (or equivalent) so you can re-split if needed.
- **Lossy for opaque objects**: pass 3 trades structural detail for a queryable column. The original shape is not recoverable from the normalized file.
- **Shallow variant rename**: pass 1 only rewrites `oneOf` / `anyOf` at the sites the analyzer reads. Variants buried inside array items or nested properties are preserved on purpose - collapsing them would risk lossy merges for no analyzer benefit.
- **YAML output formatting**: files are written with `js-yaml` using `{ lineWidth: -1, noRefs: true }`, which matches the existing provider-dev `flatten.mjs` output but may reorder keys relative to the input.
