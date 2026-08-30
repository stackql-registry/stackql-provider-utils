# Changelog

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
