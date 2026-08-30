#!/usr/bin/env node
// CLI entry for @stackql/provider-utils docgen commands.
// Subcommands: generate-docs, generate-docs-v2

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { generateDocs, generateDocsv2 } from '../src/docgen/index.js';

function getArg(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

// value of a `--flag=value` style argument (getArg only handles `--flag value`)
function getInlineArg(args, flag) {
  const hit = args.find(a => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

function collectOptions(args) {
  const providerName = getArg(args, '--provider-name');
  const providerDir = getArg(args, '--provider-dir');
  const outputDir = getArg(args, '--output-dir');
  const providerDataDir = getArg(args, '--provider-data-dir');
  const verbose = hasFlag(args, '--verbose');
  const snakeCaseAliases = hasFlag(args, '--snake-case-aliases');
  // per-surface form: --snake-case-aliases=params,fields (see docgen/casing.js)
  const snakeCaseSurfaces = getInlineArg(args, '--snake-case-aliases');

  const missing = [];
  if (!providerName) missing.push('--provider-name');
  if (!providerDir) missing.push('--provider-dir');
  if (!outputDir) missing.push('--output-dir');
  if (!providerDataDir) missing.push('--provider-data-dir');
  const invalid = [];
  const opts = { providerName, providerDir, outputDir, providerDataDir, verbose, missing, invalid };
  if (snakeCaseSurfaces) {
    const wanted = new Set(snakeCaseSurfaces.split(',').map(v => v.trim()).filter(Boolean));
    const known = ['fields', 'params', 'body'];
    const unknown = [...wanted].filter(v => !known.includes(v));
    if (unknown.length > 0) {
      invalid.push(`--snake-case-aliases: unknown surface(s) ${unknown.join(', ')} (expected ${known.join(', ')})`);
    }
    opts.snakeCaseAliases = Object.fromEntries(known.map(k => [k, wanted.has(k)]));
  } else if (snakeCaseAliases) {
    opts.snakeCaseAliases = true;
  }
  return opts;
}

// If provider.yaml opts in to the engine's snake_case surface but the flag is
// absent, print a one-line hint. Never changes behaviour - the flag is the switch.
function maybeHintSnakeCaseAliases(opts) {
  if (opts.snakeCaseAliases || !opts.providerDir) return;
  try {
    const providerYamlPath = path.join(opts.providerDir, 'provider.yaml');
    if (!fs.existsSync(providerYamlPath)) return;
    const providerDoc = yaml.load(fs.readFileSync(providerYamlPath, 'utf8'));
    if (providerDoc && providerDoc.config && providerDoc.config.snake_case_aliases === true) {
      console.error('hint: provider.yaml sets config.snake_case_aliases: true - pass --snake-case-aliases to render fields and parameters as the engine presents them');
    }
  } catch (err) {
    // hint only - ignore unreadable provider.yaml
  }
}

function usageFor(subcmd) {
  return `Usage: docgen-utils ${subcmd} --provider-name NAME --provider-dir DIR --output-dir DIR --provider-data-dir DIR [--verbose] [--snake-case-aliases[=fields,params,body]]`;
}

async function runGenerateDocs(args) {
  const opts = collectOptions(args);
  if (opts.invalid.length) {
    console.error(`Error: ${opts.invalid.join('; ')}`);
    console.error(usageFor('generate-docs'));
    process.exit(1);
  }
  if (opts.missing.length) {
    console.error(`Error: missing required arg(s): ${opts.missing.join(', ')}`);
    console.error(usageFor('generate-docs'));
    process.exit(1);
  }
  const { missing, invalid, ...rest } = opts;
  maybeHintSnakeCaseAliases(rest);
  const result = await generateDocs(rest);
  console.log(JSON.stringify(result, null, 2));
}

async function runGenerateDocsV2(args) {
  const opts = collectOptions(args);
  if (opts.invalid.length) {
    console.error(`Error: ${opts.invalid.join('; ')}`);
    console.error(usageFor('generate-docs-v2'));
    process.exit(1);
  }
  if (opts.missing.length) {
    console.error(`Error: missing required arg(s): ${opts.missing.join(', ')}`);
    console.error(usageFor('generate-docs-v2'));
    process.exit(1);
  }
  const { missing, invalid, ...rest } = opts;
  maybeHintSnakeCaseAliases(rest);
  const result = await generateDocsv2(rest);
  console.log(JSON.stringify(result, null, 2));
}

function printUsage() {
  console.error('Usage: docgen-utils <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  generate-docs     --provider-name NAME --provider-dir DIR --output-dir DIR --provider-data-dir DIR [--verbose] [--snake-case-aliases[=fields,params,body]]');
  console.error('  generate-docs-v2  --provider-name NAME --provider-dir DIR --output-dir DIR --provider-data-dir DIR [--verbose] [--snake-case-aliases[=fields,params,body]]');
  console.error('');
  console.error('Options:');
  console.error('  --snake-case-aliases[=fields,params,body]');
  console.error('                        render identifiers as the engine snake_case surface. The bare');
  console.error('                        flag enables every surface; the list form enables only those');
  console.error('                        named, for providers where the engine serves some surfaces');
  console.error('                        but not others. Surfaces: fields (top-level response columns),');
  console.error('                        params and body (for methods declaring request.nativeCasing).');
  console.error('                        Default: wire names.');
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);
  try {
    switch (cmd) {
      case 'generate-docs':     await runGenerateDocs(rest); break;
      case 'generate-docs-v2':  await runGenerateDocsV2(rest); break;
      case undefined:
      case '-h':
      case '--help':
        printUsage();
        process.exit(cmd === undefined ? 1 : 0);
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
