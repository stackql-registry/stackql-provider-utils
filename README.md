# StackQL Provider Utils

![NPM Version](https://img.shields.io/npm/v/%40stackql%2Fprovider-utils)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/stackql/stackql/total?style=plastic&label=stackql%20downloads)

A comprehensive toolkit for transforming OpenAPI specifications into StackQL providers. This library streamlines the process of parsing, mapping, validating, testing, and generating documentation for StackQL providers.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Directory Structure](#directory-structure)
- [Provider Development Workflow](#provider-development-workflow)
  - [`providerdev.split`](docs/split.md) - Divide a large OpenAPI specification into smaller, service-specific files
  - [`providerdev.normalize`](docs/normalize.md) - Reshape split specs for relational consumption (flatten allOf, rename oneOf/anyOf, strip misplaced keywords, lower opaque objects)
  - [`providerdev.analyze`](docs/analyze.md) - Examine split API specifications to generate mapping recommendations
  - [`providerdev.generate`](docs/generate.md) - Create StackQL provider extensions from specifications and mappings
  - [`docgen.generateDocs`](docs/docgen.md) - Generate comprehensive documentation for StackQL providers
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

## Prerequisites

- Node.js >= 20
- `npm` or `yarn`
- [`stackql`](https://stackql.io/docs/installing-stackql) for testing 

## Installation

Add `@stackql/provider-utils` to your `package.json`:

```bash
npm install @stackql/provider-utils
# or
yarn add @stackql/provider-utils
```

## Consumer Setup: npm scripts

The package ships two CLI entry points: `provider-dev-utils` (for `split` / `normalize` / `analyze` / `generate`) and `docgen-utils` (for `generate-docs` / `generate-docs-v2`). Wrap them as npm scripts in your provider repo's `package.json` so every step of the workflow is a single `npm run <step>` invocation:

```json
{
  "scripts": {
    "split":             "node node_modules/@stackql/provider-utils/bin/provider-dev-utils.mjs split",
    "normalize":         "node node_modules/@stackql/provider-utils/bin/provider-dev-utils.mjs normalize",
    "generate-mappings": "node node_modules/@stackql/provider-utils/bin/provider-dev-utils.mjs analyze",
    "generate-provider": "node node_modules/@stackql/provider-utils/bin/provider-dev-utils.mjs generate",
    "generate-docs":     "node node_modules/@stackql/provider-utils/bin/docgen-utils.mjs generate-docs"
  }
}
```

Call the bins through `node` (rather than relying on `node_modules/.bin/` shims) because npm does not always link `.bin` shims for `.mjs` files on Windows. Pass flags through with npm's `--` separator, e.g.:

```bash
npm run normalize -- --api-dir provider-dev/source --verbose
```

JSON-valued flags (`--servers`, `--provider-config`, `--service-config`, `--skip-files`, `--svc-name-overrides`) accept either an inline JSON string or a path to a JSON file.

### Full workflow example

```bash
npm run split -- \
  --provider-name github \
  --api-doc provider-dev/downloaded/api.github.com.json \
  --svc-discriminator tag \
  --output-dir provider-dev/source \
  --overwrite

npm run normalize -- \
  --api-dir provider-dev/source \
  --verbose

npm run generate-mappings -- \
  --input-dir provider-dev/source \
  --output-dir provider-dev/config

npm run generate-provider -- \
  --provider-name github \
  --input-dir provider-dev/source \
  --output-dir provider-dev/openapi/src/github \
  --config-path provider-dev/config/all_services.csv \
  --servers '[{"url": "https://api.github.com"}]' \
  --provider-config '{"auth": {"type": "basic", "username_var": "STACKQL_GITHUB_USERNAME", "password_var": "STACKQL_GITHUB_PASSWORD"}}' \
  --overwrite

npm run generate-docs -- \
  --provider-name github \
  --provider-dir ./provider-dev/openapi/src/github/v00.00.00000 \
  --output-dir ./website \
  --provider-data-dir ./provider-dev/docgen/provider-data
```

On `generate-provider`, `--provider-name` is accepted as an alias for `--provider-id` so the flag name is consistent with the other commands.

On `generate-docs` / `generate-docs-v2`, pass `--snake-case-aliases` for providers that set `config.snake_case_aliases: true` in `provider.yaml`, so fields and parameters are rendered as the engine's snake_case surface (see [docs/docgen.md](docs/docgen.md)). Without the flag, output is unchanged (wire names).

## Directory Structure

A typical project structure for the development of a `stackql` provider would be...

```bash
.
├── bin # convinience scripts
│   ├── ... 
├── provider-dev                            
│   ├── config
│   │   └── all_services.csv  # mappings generated or updated by the `providerdev.analyze` function, used by `providerdev.generate`
│   ├── docgen
│   │   └── provider-data  # provider metadata used by `docgen.generateDocs`
│   │       ├── headerContent1.txt
│   │       └── headerContent2.txt
│   ├── downloaded # used to store the original spec for the provider
│   │   └── management-minimal.yaml
│   ├── openapi # output from `providerdev.generate`, this is the stackql provider
│   │   └── src
│   │       └── okta
│   │           └── v00.00.00000
│   │               ├── provider.yaml
│   │               └── services
│   │                   ├── agentpools.yaml
│   │                   ├── ...
│   ├── scripts # optional scripts for pre or post processing if required
│   │   └── post_processing.sh
│   └── source  # output from `providerdev.split` if used, this is the source used with the mappings to generate the provider
│       ├── agentpools.yaml
│       ├── ...
└── website # docusaurus site
    ├── docs # output from `docgen.generateDocs`
    │   ├── ...
```

> see [__stackql-provider-okta__](https://github.com/stackql/stackql-provider-okta) for a working example.

## Provider Development Workflow

The library provides a streamlined workflow for creating StackQL providers from OpenAPI specifications:

1. [`providerdev.split`](docs/split.md) - Divide a large OpenAPI specification into smaller, service-specific files
2. [`providerdev.normalize`](docs/normalize.md) - Reshape split specs for relational consumption (flatten allOf, rename oneOf/anyOf, strip misplaced keywords, lower opaque objects)
3. [`providerdev.analyze`](docs/analyze.md) - Examine split API specifications to generate mapping recommendations
4. [`providerdev.generate`](docs/generate.md) - Create StackQL provider extensions from specifications and mappings
5. [`docgen.generateDocs`](docs/docgen.md) - Generate comprehensive documentation for StackQL providers

## Contributing

Contributions are welcome!

### Running Tests

Unit tests are written with [Jest](https://jestjs.io/) and live in the `tests/` directory. This package uses native ES modules, so the `test` script runs Jest under `node --experimental-vm-modules`.

```bash
npm ci
npm test
```

To run a single test suite:

```bash
npm test -- tests/providerdev/normalize.test.js
```

Tests run automatically in CI via GitHub Actions (`.github/workflows/test.yml`) on pushes and pull requests to `main`. Publishing to npm is deliberately not automated - it is a manual step performed by a maintainer as it requires 2FA.

## License

MIT

## Support

- [StackQL Documentation](https://stackql.io/docs)
- [GitHub Issues](https://github.com/stackql/stackql-provider-utils/issues)
- [StackQL Community Slack](https://stackqlcommunity.slack.com/join/shared_invite/zt-1cbdq9s5v-CkY65IMAesCgFqjN6FU6hg)
- [StackQL Discord](https://discord.com/invite/xVXZ9d5NxN)