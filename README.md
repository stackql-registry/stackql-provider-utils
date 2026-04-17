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

## License

MIT

## Support

- [StackQL Documentation](https://stackql.io/docs)
- [GitHub Issues](https://github.com/stackql/stackql-provider-utils/issues)
- [StackQL Community Slack](https://stackqlcommunity.slack.com/join/shared_invite/zt-1cbdq9s5v-CkY65IMAesCgFqjN6FU6hg)
- [StackQL Discord](https://discord.com/invite/xVXZ9d5NxN)