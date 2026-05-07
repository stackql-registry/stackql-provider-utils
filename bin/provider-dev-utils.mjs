#!/usr/bin/env node
// CLI entry for @stackql/provider-utils provider-dev commands.
// Subcommands: split, normalize, analyze, generate

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { split, normalize, analyze, generate } from '../src/providerdev/index.js';

// Accepts both `--flag value` (two argv entries) and `--flag=value`
// (one argv entry). npm run passes arguments through after `--` with
// whichever form the caller used; we support both.
function getArg(args, flag) {
  const eqPrefix = `${flag}=`;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) return args[i + 1] ?? null;
    if (args[i].startsWith(eqPrefix)) return args[i].slice(eqPrefix.length);
  }
  return null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

// Resolve a JSON argument to a JSON string suitable for handing to
// library code that internally calls `JSON.parse` (`generate()` does
// this for servers / providerConfig / serviceConfig). Accepts either an
// inline JSON string or a path to a file containing JSON. Validates by
// parsing, then returns the raw text so the library parses exactly what
// the caller provided.
function loadJsonString(value) {
  const trimmed = value.trim();
  const inline = trimmed.startsWith('{') || trimmed.startsWith('[');
  const raw = inline ? trimmed : readFileSync(resolve(value), 'utf8');
  try {
    JSON.parse(raw);
  } catch (err) {
    const src = inline ? 'inline JSON' : resolve(value);
    throw new Error(`invalid JSON in ${src}: ${err.message}`);
  }
  return raw;
}

// Resolve a JSON argument to a parsed value (for library options that
// expect an object/array, e.g. skipFiles, svcNameOverrides).
function loadJsonValue(value) {
  return JSON.parse(loadJsonString(value));
}

async function loadDiscriminatorFn(filePath) {
  const abs = resolve(filePath);
  const mod = await import(pathToFileURL(abs).href);
  const fn = (mod && typeof mod.default === 'function') ? mod.default
    : (typeof mod === 'function' ? mod : null);
  if (typeof fn !== 'function') {
    throw new Error(`svc-discriminator-fn module at ${abs} must export a default function (path, operationId, tags) => serviceName`);
  }
  return fn;
}

async function runSplit(args) {
  const apiDoc = getArg(args, '--api-doc');
  const providerName = getArg(args, '--provider-name');
  const outputDir = getArg(args, '--output-dir');
  const svcDiscriminator = getArg(args, '--svc-discriminator');
  const svcDiscriminatorFnPath = getArg(args, '--svc-discriminator-fn');
  const overwrite = hasFlag(args, '--overwrite');
  const verbose = hasFlag(args, '--verbose');
  const svcNameOverridesPath = getArg(args, '--svc-name-overrides');

  const missing = [];
  if (!apiDoc) missing.push('--api-doc');
  if (!providerName) missing.push('--provider-name');
  if (!outputDir) missing.push('--output-dir');
  if (!svcDiscriminator) missing.push('--svc-discriminator');
  if (svcDiscriminator === 'function' && !svcDiscriminatorFnPath) {
    missing.push('--svc-discriminator-fn (required when --svc-discriminator=function)');
  }
  if (missing.length) {
    console.error(`Error: missing required arg(s): ${missing.join(', ')}`);
    console.error('Usage: provider-dev-utils split --api-doc FILE --provider-name NAME --output-dir DIR --svc-discriminator {tag|path|function} [--svc-discriminator-fn FILE.{js,mjs}] [--overwrite] [--verbose] [--svc-name-overrides JSON|FILE.json]');
    process.exit(1);
  }

  const svcNameOverrides = svcNameOverridesPath ? loadJsonValue(svcNameOverridesPath) : {};
  const opts = {
    apiDoc, providerName, outputDir, svcDiscriminator, overwrite, verbose, svcNameOverrides,
  };
  if (svcDiscriminatorFnPath) {
    opts.svcDiscriminatorFn = await loadDiscriminatorFn(svcDiscriminatorFnPath);
  }
  const result = await split(opts);
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
  // `--provider-name` is accepted as an alias for `--provider-id` to match
  // the naming used by split / docgen commands.
  const providerId = getArg(args, '--provider-id') || getArg(args, '--provider-name');
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
  if (!providerId) missing.push('--provider-id (or --provider-name)');
  if (missing.length) {
    console.error(`Error: missing required arg(s): ${missing.join(', ')}`);
    console.error('Usage: provider-dev-utils generate --input-dir DIR --output-dir DIR --config-path FILE --provider-id ID [--servers JSON|FILE.json] [--provider-config JSON|FILE.json] [--service-config JSON|FILE.json] [--skip-files JSON|FILE.json] [--naive-req-body-translate] [--update-path-param-names] [--overwrite] [--verbose]');
    process.exit(1);
  }

  const opts = {
    inputDir, outputDir, configPath, providerId,
    naiveReqBodyTranslate, updatePathParamNames, overwrite, verbose,
  };
  // generate() internally calls JSON.parse on servers / providerConfig /
  // serviceConfig, so pass raw (validated) JSON strings through. skipFiles
  // is consumed as an array, so pass the parsed value.
  if (serversPath) opts.servers = loadJsonString(serversPath);
  if (providerConfigPath) opts.providerConfig = loadJsonString(providerConfigPath);
  if (serviceConfigPath) opts.serviceConfig = loadJsonString(serviceConfigPath);
  if (skipFilesPath) opts.skipFiles = loadJsonValue(skipFilesPath);

  const result = await generate(opts);
  console.log(JSON.stringify(result, null, 2));
}

function printUsage() {
  console.error('Usage: provider-dev-utils <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  split     --api-doc FILE --provider-name NAME --output-dir DIR --svc-discriminator {tag|path|function}');
  console.error('            [--svc-discriminator-fn FILE.{js,mjs}]   (required when --svc-discriminator=function)');
  console.error('            [--overwrite] [--verbose] [--svc-name-overrides JSON|FILE.json]');
  console.error('  normalize --api-dir DIR [--verbose]');
  console.error('  analyze   --input-dir DIR --output-dir DIR [--verbose]');
  console.error('  generate  --input-dir DIR --output-dir DIR --config-path FILE');
  console.error('            (--provider-id ID | --provider-name NAME)');
  console.error('            [--servers JSON|FILE.json] [--provider-config JSON|FILE.json]');
  console.error('            [--service-config JSON|FILE.json] [--skip-files JSON|FILE.json]');
  console.error('            [--naive-req-body-translate] [--update-path-param-names]');
  console.error('            [--overwrite] [--verbose]');
  console.error('');
  console.error('JSON flags accept either an inline JSON string (e.g. \'[{"url":"..."}]\') or a path to a JSON file.');
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
