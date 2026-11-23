# Changelog

## 0.8.0

Regenerated output changes for every provider: the front matter `description:` of every resource and service page.

- docgen: per-page descriptions. Resource pages take the first sentence of the resource description (HTML tags and Markdown links stripped, inline code backticks dropped, entities decoded, whitespace collapsed, capped at 160 characters on a word boundary), falling back to `Query, deploy and manage the <resource> resource in the <provider> <service> service using SQL` when the resource has none, so no resource page carries the former provider-wide line and no two share a description. Service index pages read `Query, deploy and manage <provider> <service> resources using SQL`. The provider index page keeps the description from `headerContent1.txt`. Applies to `generateDocs` and `generateDocsv2`
- docgen: front matter descriptions are written as YAML double-quoted scalars (`JSON.stringify`), so a description containing a colon, quotes, `#` or a newline still parses
- new helpers: `metaDescription(text, fallback)`, `yamlString(value)` and `META_DESCRIPTION_MAX` in `src/docgen/helpers.js`; `resourceFallbackDescription(resourceName, providerName, serviceName)` in `src/docgen/resource/overview.js`. Covered by tests/docgen/descriptions.test.js

## 0.7.12

- docgen: `generateDocsv2` (CLI: `generate-docs-v2`) ends each Provider Summary row with the two-space Markdown hard break the v1 template already uses, so `total services`, `total resources` and `source project` render on separate lines instead of one paragraph. v1 output is unchanged. Covered by tests/docgen/summary.test.js

## 0.7.11

- docgen: optional `sourceProject` (CLI: `--source-project URL`) adds a `source project` row to the Provider Summary admonition on the provider index page, rendered as a bold link whose label is the repository name (last URL path segment, `.git` stripped) and whose target is the URL as supplied. Applies to `generateDocs` and `generateDocsv2`. Omitted: the admonition is unchanged

## 0.7.10

- deps: `@stackql/deno-openapi-dereferencer` ^0.3.2, which moves jsonpath-plus from a 7.0.0 pin to ^10.3.0 (CVE-2024-21534, CVE-2025-1302). docgen output is unchanged - it only calls `flattenAllOf`, which does not use JSONPath

## 0.7.9

- docgen: `snakeCaseAliases` accepts a per-surface object - `{ fields, params, body }` - as well as the existing boolean. The three surfaces are translated by different engine mechanisms and do not necessarily land together, so a provider can be correct on one and not another; documenting a surface the engine does not serve yields copy-paste examples that fail
  - `true` remains equivalent to every surface on; `false` / omitted remains all wire names
  - CLI: `--snake-case-aliases=fields,params,body` selects surfaces, the bare `--snake-case-aliases` still enables all; an unknown surface name is rejected
  - `resolveSnakeCaseAliases` in `src/docgen/casing.js` normalises the option

## 0.7.8

- docgen: `--snake-case-aliases` renders fields and parameters as the engine's snake_case surface (top-level, per-method `request.nativeCasing`), default unchanged
  - new `src/docgen/casing.js` with `toSnake` (port of any-sdk `casing.ToSnake` / botocore `xform_name`) and the alias collision rule
  - response fields (fields table, `SELECT` columns, `RETURNING`, view projections) are aliased at the top level only; nested schema contents keep wire casing
  - parameters and top-level request-body properties are aliased only for methods that declare `request.nativeCasing`; server variables and `EXEC` variables always render as wire names
  - renamed fields and parameters carry a `(wire: <name>)` hint in their description cell
  - `docgen-utils` prints a hint when `provider.yaml` sets `config.snake_case_aliases: true` and the flag is absent
