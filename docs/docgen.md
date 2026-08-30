# Documentation Generation

The `docgen` module provides utilities for generating comprehensive documentation for StackQL providers.

## Overview

After creating a StackQL provider, the next step is to generate documentation that helps users understand the available services, resources, and methods. The `docgen` module automates this process, creating well-structured markdown files that can be used with static site generators like Docusaurus.

## Function Signature

```javascript
async function generateDocs(options) {
  // Implementation details
}
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `providerName` | string | Yes | Name of the provider (e.g., 'github', 'aws') |
| `providerDir` | string | Yes | Path to provider specification directory |
| `outputDir` | string | Yes | Directory for generated documentation |
| `providerDataDir` | string | Yes | Directory containing provider header files |
| `verbose` | boolean | No | Whether to output detailed logs (default: false) |
| `snakeCaseAliases` | boolean \| object | No | Render identifiers as the engine's snake_case surface (default: false, see below) |

## Snake Case Aliases

Providers that set `config.snake_case_aliases: true` in `provider.yaml` present a snake_case SQL surface in the engine: `SELECT` / `DESCRIBE` columns are snake aliases of the camelCase or PascalCase wire properties, and for methods that declare `request.nativeCasing`, snake_case `WHERE` keys and `INSERT` / `UPDATE` columns resolve to the wire parameter and body attribute names. By default docgen renders wire names. Pass `snakeCaseAliases: true` (CLI: `--snake-case-aliases`) to render identifiers the way the engine presents them:

- Response fields (fields table, `SELECT` column lists, `RETURNING` lists, view projections) display as `toSnake(name)` for top-level properties only. Nested object and array contents keep wire casing, as the engine does not alias inside JSON blobs.
- For methods with `request.nativeCasing` set, path/query parameters and top-level request-body properties display as `toSnake(name)` in the methods table, the parameters section (including anchor ids) and the `WHERE` / `INSERT` / `UPDATE` / `DELETE` examples. Methods without `request.nativeCasing` keep wire names.
- Server variables and `EXEC` variables always render as authored (wire names). A note to that effect is added to the lifecycle methods section.
- A snake alias never replaces a real name of the same spelling; if a schema or parameter set already contains the snake spelling, the camelCase one keeps its wire name.
- Renamed fields and parameters get a `(wire: <name>)` hint in their description cell so readers can map back to `SHOW METHODS` output and `EXEC` variables.

### Selecting surfaces

The three surfaces are independently switchable, because a provider can be correct on one and not another at a given point in time - the engine translates response columns, parameters and request-body keys through different mechanisms, and they do not necessarily land together. Documenting a surface the engine does not serve produces copy-paste examples that fail, so pass only what is true for the provider:

| value | fields | params | body |
| --- | --- | --- | --- |
| `false` (default) | wire | wire | wire |
| `true` | snake | snake | snake |
| `{ params: true }` | wire | snake | wire |
| `{ fields: true, params: true }` | snake | snake | wire |

Omitted keys default to `false`. The boolean form is retained and equivalent to all three on.

```javascript
// a provider whose engine aliases parameters but not response columns
await docgen.generateDocs({ ...opts, snakeCaseAliases: { params: true } });
```

```bash
docgen-utils generate-docs ... --snake-case-aliases=params
docgen-utils generate-docs ... --snake-case-aliases=fields,params
docgen-utils generate-docs ... --snake-case-aliases          # every surface
```

The transform is a port of any-sdk `casing.ToSnake` (botocore `xform_name`): `totalCHC` -> `total_chc`, `VPCId` -> `vpc_id`, `ipAccessList` -> `ip_access_list`; names that already contain `_` are returned unchanged. The flag is the switch - it is not inferred from `provider.yaml`, although the CLI prints a hint when `provider.yaml` opts in and the flag is absent.

## Return Value

The function returns a Promise that resolves to an object containing:

```javascript
{
  totalServices: number,     // Number of services documented
  totalResources: number,    // Total number of resources documented
  outputPath: string         // Path to the generated documentation
}
```

## Provider Data Files

The documentation generator requires specific header files in the `providerDataDir`:

- **headerContent1.txt**: Provider introduction and overview content
- **headerContent2.txt**: Additional provider information (e.g., authentication details)

These files should contain markdown content that will be included in the provider's main documentation page.

## Example Usage

```javascript
import { docgen } from '@stackql/provider-utils';

async function generateDocsExample() {
  try {
    const result = await docgen.generateDocs({
      providerName: 'github',
      providerDir: './output/generate/github/v00.00.00000',
      outputDir: './docs/github-docs',
      providerDataDir: './config/provider-data/github',
      verbose: true
    });
    
    console.log(`Documentation generation completed successfully!`);
    console.log(`Documented ${result.totalServices} services with ${result.totalResources} resources.`);
    console.log(`Output directory: ${result.outputPath}`);
  } catch (error) {
    console.error('Error generating documentation:', error);
  }
}

generateDocsExample();
```

## Output Structure

The documentation generator creates a structured set of markdown files:

```
outputDir/
├── {providerName}-docs/
│   ├── index.md                      # Main provider documentation
│   ├── {service1}/
│   │   ├── index.md                  # Service documentation
│   │   ├── {resource1}/
│   │   │   └── index.md              # Resource documentation
│   │   ├── {resource2}/
│   │   │   └── index.md
│   │   └── ...
│   ├── {service2}/
│   │   └── ...
│   └── ...
```

## Documentation Content

### Provider Documentation (index.md)

The main provider documentation includes:
- Provider overview (from headerContent1.txt)
- Authentication instructions
- Available services list
- Additional information (from headerContent2.txt)

### Service Documentation

Service documentation includes:
- Service description
- Available resources list
- Service-specific configuration (if any)

### Resource Documentation

Resource documentation includes:
- Resource description
- Available methods with parameters
- SQL verb mappings
- Example queries
- Request and response details

## Example Header Content Files

### headerContent1.txt

```markdown
---
title: GitHub
hide_title: false
hide_table_of_contents: false
keywords:
  - github
  - stackql
  - infrastructure-as-code
  - configuration-as-data
description: Query and manage GitHub resources using SQL
---

# GitHub Provider

The GitHub provider for StackQL allows you to query and manage GitHub resources using SQL. This provider supports repositories, issues, pull requests, users, and more.
```

### headerContent2.txt

```markdown
## Authentication

GitHub requires a Personal Access Token (PAT) for authentication. You can create one in your GitHub account settings under Developer Settings > Personal Access Tokens.

Set your token as an environment variable:

```bash
export GITHUB_TOKEN="your_token_here"
```

For more information, see the [GitHub API documentation](https://docs.github.com/en/rest).
```

## Integrating with Docusaurus

The generated documentation is designed to work with [Docusaurus](https://docusaurus.io/), a popular static site generator.

1. Create a Docusaurus site:
```bash
npx create-docusaurus@latest website classic
```

2. Copy the generated documentation to the docs folder:
```bash
cp -r ./docs/{providerName}-docs/* ./website/docs/
```

3. Update the Docusaurus configuration to include the provider documentation:
```javascript
// docusaurus.config.js
module.exports = {
  // ...other config
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          path: 'docs',
          routeBasePath: 'docs',
        },
        // ...
      },
    ],
  ],
};
```

4. Build and serve the documentation site:
```bash
cd website
yarn start # or npm start
```
