import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateDocs, generateDocsv2 } from '../../src/docgen/generator.js';

// Both index-page templates end each Provider Summary row with a two-space
// markdown hard break. Without it Docusaurus folds the rows into one paragraph.

const here = path.dirname(fileURLToPath(import.meta.url));
const providerDir = path.join(here, 'src', 'homebrew', 'v00.00.00000');
const providerDataDir = path.join(here, 'provider-data', 'homebrew');
const sourceProject = 'https://github.com/stackql-registry/stackql-provider-homebrew';

const tmpDirs = [];
function tmpdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-summary-'));
  tmpDirs.push(dir);
  return dir;
}

// The lines between ':::info[Provider Summary]' and the closing ':::' of the
// generated docs/index.md. The header fixtures are CRLF and the template is
// LF, so split on either.
function summaryLines(outputDir) {
  const index = fs.readFileSync(path.join(outputDir, 'docs', 'index.md'), 'utf8');
  const lines = index.split(/\r?\n/);
  const start = lines.findIndex(l => /^:::info\[Provider Summary\]\s*$/.test(l));
  if (start < 0) throw new Error('Provider Summary admonition not found in docs/index.md');
  const end = lines.findIndex((l, i) => i > start && l === ':::');
  if (end < 0) throw new Error('Provider Summary admonition is not closed in docs/index.md');
  return lines.slice(start + 1, end);
}

const silenced = {};
beforeAll(() => {
  // the generators log every service, resource and method they document
  for (const level of ['log', 'info', 'warn', 'error']) {
    silenced[level] = console[level];
    console[level] = () => {};
  }
});

afterAll(() => {
  for (const level of Object.keys(silenced)) console[level] = silenced[level];
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe.each([
  ['generateDocs', generateDocs],
  ['generateDocsv2', generateDocsv2],
])('%s Provider Summary', (_, generate) => {
  let withSource;
  let withoutSource;

  beforeAll(async () => {
    const base = { providerName: 'homebrew', providerDir, providerDataDir };
    const a = tmpdir();
    const b = tmpdir();
    await generate({ ...base, outputDir: a, sourceProject });
    await generate({ ...base, outputDir: b });
    withSource = summaryLines(a);
    withoutSource = summaryLines(b);
  }, 30000);

  test('count rows end with exactly two spaces', () => {
    for (const lines of [withSource, withoutSource]) {
      const services = lines.find(l => l.startsWith('total services:'));
      const resources = lines.find(l => l.startsWith('total resources:'));
      expect(services).toMatch(/^total services: __\d+__  $/);
      expect(resources).toMatch(/^total resources: __\d+__  $/);
      expect(services).not.toMatch(/   $/);
      expect(resources).not.toMatch(/   $/);
    }
  });

  test('source project row is present with sourceProject and ends with two spaces', () => {
    const row = withSource.find(l => l.startsWith('source project:'));
    expect(row).toBe(`source project: __[stackql-provider-homebrew](${sourceProject})__  `);
    expect(row).toMatch(/  $/);
    expect(row).not.toMatch(/   $/);
  });

  test('no source project row without sourceProject', () => {
    expect(withoutSource.filter(l => l.startsWith('source project:'))).toEqual([]);
  });
});
