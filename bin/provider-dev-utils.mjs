#!/usr/bin/env node
// CLI entry for @stackql/provider-utils provider-dev commands.
// Subcommands: split, normalize, analyze, generate

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { split, normalize, analyze, generate } from '../src/providerdev/index.js';

function getArg(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

// Load a JSON file for options that can't be expressed as simple scalar flags
// (servers, providerConfig, serviceConfig, svcNameOverrides, skipFiles).
function loadJson(path) {
  const full = resolve(path);
  const raw = readFileSync(full, 'utf8');
  return JSON.parse(raw);
}

async function runSplit(args) {
  const apiDoc = getArg(args, '--api-doc');
  const providerName = getArg(args, '--provider-name');
  const outputDir = getArg(args, '--output-dir');
  const svcDiscriminator = getArg(args, '--svc-discriminator');
  const overwrite = hasFlag(args, '--overwrite');
  const verbose = hasFlag(args, '--verbose');
  const svcNameOverridesPath = getArg(args, '--svc-name-overrides');

  const missing = [];
  if (!apiDoc) missing.push('--api-doc');
  if (!providerName) missing.push('--provider-name');
  if (!outputDir) missing.push('--output-dir');
  if (!svcDiscriminator) missing.push('--svc-discriminator');
  if (missing.length) {
    console.error(`Error: missing required arg(s): ${missing.join(', ')}`);
    console.error('Usage: provider-dev-utils split --api-doc FILE --provider-name NAME --output-dir DIR --svc-discriminator {tag|path} [--overwrite] [--verbose] [--svc-name-overrides FILE.json]');
    process.exit(1);
  }

  const svcNameOverrides = svcNameOverridesPath ? loadJson(svcNameOverridesPath) : {};
  const result = await split({
    apiDoc, providerName, outputDir, svcDiscriminator, overwrite, verbose, svcNameOverrides,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runNormalize(args) {
  const apiDir = getArg(args, '--api-dir');
  const verbose = hasFlag(args, '--verbose');
  if (!apiDir) {
    console.error('Error: --api-dir is required');
    console.error('Usage: provider-dev-utils normalize --api-dir DIR [--verbose]');
    process.exit(1);
  }
  const stats = await normalize({ apiDir, verbose });
  console.log(JSON.stringify(stats, null, 2));
}

async function runAnalyze(args) {
  const inputDir = getArg(args, '--input-dir');
  const outputDir = getArg(args, '--output-dir');
  const verbose = hasFlag(args, '--verbose');

  const missing = [];
  if (!inputDir) missing.push('--input-dir');
  if (!outputDir) missing.push('--output-dir');
  if (missing.length) {
    console.error(`Error: missing required arg(s): ${missing.join(', ')}`);
    console.error('Usage: provider-dev-utils analyze --input-dir DIR --output-dir DIR [--verbose]');
    process.exit(1);
  }

  const result = await analyze({ inputDir, outputDir, verbose });
  console.log(JSON.stringify(result, null, 2));
}

async function runGenerate(args) {
  const inputDir = getArg(args, '--input-dir');
  const outputDir = getArg(args, '--output-dir');
  const configPath = getArg(args, '--config-path');
  const providerId = getArg(args, '--provider-id');
  const serversPath = getArg(args, '--servers');
  const providerConfigPath = getArg(args, '--provider-config');
  const serviceConfigPath = getArg(args, '--service-config');
  const skipFilesPath = getArg(args, '--skip-files');
  const naiveReqBodyTranslate = hasFlag(args, '--naive-req-body-translate');
  const updatePathParamNames = hasFlag(args, '--update-path-param-names');
  const overwrite = hasFlag(args, '--overwrite');
  const verbose = hasFlag(args, '--verbose');

  const missing = [];
  if (!inputDir) missing.push('--input-dir');
  if (!outputDir) missing.push('--output-dir');
  if (!configPath) missing.push('--config-path');
  if (!providerId) missing.push('--provider-id');
  if (missing.length) {
    console.error(`Error: missing required arg(s): ${missing.join(', ')}`);
    console.error('Usage: provider-dev-utils generate --input-dir DIR --output-dir DIR --config-path FILE --provider-id ID [--servers FILE.json] [--provider-config FILE.json] [--service-config FILE.json] [--skip-files FILE.json] [--naive-req-body-translate] [--update-path-param-names] [--overwrite] [--verbose]');
    process.exit(1);
  }

  const opts = {
    inputDir, outputDir, configPath, providerId,
    naiveReqBodyTranslate, updatePathParamNames, overwrite, verbose,
  };
  if (serversPath) opts.servers = loadJson(serversPath);
  if (providerConfigPath) opts.providerConfig = loadJson(providerConfigPath);
  if (serviceConfigPath) opts.serviceConfig = loadJson(serviceConfigPath);
  if (skipFilesPath) opts.skipFiles = loadJson(skipFilesPath);

  const result = await generate(opts);
  console.log(JSON.stringify(result, null, 2));
}

function printUsage() {
  console.error('Usage: provider-dev-utils <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  split     --api-doc FILE --provider-name NAME --output-dir DIR --svc-discriminator {tag|path}');
  console.error('            [--overwrite] [--verbose] [--svc-name-overrides FILE.json]');
  console.error('  normalize --api-dir DIR [--verbose]');
  console.error('  analyze   --input-dir DIR --output-dir DIR [--verbose]');
  console.error('  generate  --input-dir DIR --output-dir DIR --config-path FILE --provider-id ID');
  console.error('            [--servers FILE.json] [--provider-config FILE.json]');
  console.error('            [--service-config FILE.json] [--skip-files FILE.json]');
  console.error('            [--naive-req-body-translate] [--update-path-param-names]');
  console.error('            [--overwrite] [--verbose]');
  console.error('');
  console.error('JSON-file flags load the file and pass the parsed contents to the corresponding library option.');
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);
  try {
    switch (cmd) {
      case 'split':     await runSplit(rest); break;
      case 'normalize': await runNormalize(rest); break;
      case 'analyze':   await runAnalyze(rest); break;
      case 'generate':  await runGenerate(rest); break;
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
