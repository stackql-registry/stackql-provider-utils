#!/usr/bin/env node
// CLI entry for @stackql/provider-utils docgen commands.
// Subcommands: generate-docs, generate-docs-v2

import { generateDocs, generateDocsv2 } from '../src/docgen/index.js';

function getArg(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function collectOptions(args) {
  const providerName = getArg(args, '--provider-name');
  const providerDir = getArg(args, '--provider-dir');
  const outputDir = getArg(args, '--output-dir');
  const providerDataDir = getArg(args, '--provider-data-dir');
  const verbose = hasFlag(args, '--verbose');

  const missing = [];
  if (!providerName) missing.push('--provider-name');
  if (!providerDir) missing.push('--provider-dir');
  if (!outputDir) missing.push('--output-dir');
  if (!providerDataDir) missing.push('--provider-data-dir');
  return { providerName, providerDir, outputDir, providerDataDir, verbose, missing };
}

function usageFor(subcmd) {
  return `Usage: docgen-utils ${subcmd} --provider-name NAME --provider-dir DIR --output-dir DIR --provider-data-dir DIR [--verbose]`;
}

async function runGenerateDocs(args) {
  const opts = collectOptions(args);
  if (opts.missing.length) {
    console.error(`Error: missing required arg(s): ${opts.missing.join(', ')}`);
    console.error(usageFor('generate-docs'));
    process.exit(1);
  }
  const { missing, ...rest } = opts;
  const result = await generateDocs(rest);
  console.log(JSON.stringify(result, null, 2));
}

async function runGenerateDocsV2(args) {
  const opts = collectOptions(args);
  if (opts.missing.length) {
    console.error(`Error: missing required arg(s): ${opts.missing.join(', ')}`);
    console.error(usageFor('generate-docs-v2'));
    process.exit(1);
  }
  const { missing, ...rest } = opts;
  const result = await generateDocsv2(rest);
  console.log(JSON.stringify(result, null, 2));
}

function printUsage() {
  console.error('Usage: docgen-utils <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  generate-docs     --provider-name NAME --provider-dir DIR --output-dir DIR --provider-data-dir DIR [--verbose]');
  console.error('  generate-docs-v2  --provider-name NAME --provider-dir DIR --output-dir DIR --provider-data-dir DIR [--verbose]');
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
