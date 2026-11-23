import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { generateDocs, generateDocsv2 } from '../../src/docgen/generator.js';
import { metaDescription, yamlString, META_DESCRIPTION_MAX } from '../../src/docgen/helpers.js';
import { resourceFallbackDescription } from '../../src/docgen/resource/overview.js';

// Per-page front matter descriptions: resource pages take the first
// sentence of the resource description, or a line naming the resource,
// service and provider; service index pages name the service; the provider
// index keeps the one in headerContent1.txt.

const here = path.dirname(fileURLToPath(import.meta.url));
const providerDir = path.join(here, 'src', 'homebrew', 'v00.00.00000');
const providerDataDir = path.join(here, 'provider-data', 'homebrew');
// The provider-wide line resource pages used to share; none may carry it now.
const PROVIDER_WIDE = 'Query, deploy and manage homebrew resources using SQL';
const fallback = (resource) => `Query, deploy and manage the ${resource} resource in the homebrew formula service using SQL`;

// The description of every generated resource page (resource -> description).
function resourceDescriptions(outputDir) {
  const dir = path.join(outputDir, 'docs', 'services', 'formula');
  return Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => [e.name, frontMatter(path.join(dir, e.name, 'index.md')).description]));
}

const tmpDirs = [];
function tmpdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-descriptions-'));
  tmpDirs.push(dir);
  return dir;
}

// The parsed front matter of a generated page. js-yaml throws on anything
// that is not valid YAML, which is part of what these tests check.
function frontMatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/);
  if (!match) throw new Error(`no front matter in ${file}`);
  return yaml.load(match[1]);
}

const resourcePage = (outputDir, resource) => path.join(outputDir, 'docs', 'services', 'formula', resource, 'index.md');

// A copy of the homebrew fixture whose resources carry the descriptions
// given (resource name -> description; null deletes the description).
function fixtureWith(descriptions) {
  const dir = tmpdir();
  fs.cpSync(providerDir, dir, { recursive: true });
  const file = path.join(dir, 'services', 'formula.yaml');
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  const resources = doc.components['x-stackQL-resources'];
  for (const [name, description] of Object.entries(descriptions)) {
    if (description === null) delete resources[name].description;
    else resources[name].description = description;
  }
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: -1 }));
  return dir;
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

describe('metaDescription', () => {
  test('strips HTML tags and Markdown links, keeping the text', () => {
    expect(metaDescription('Lists <code>formula</code> entries from <a href="https://brew.sh">Homebrew</a>.', 'x'))
      .toBe('Lists formula entries from Homebrew.');
    expect(metaDescription('See [the API](https://formulae.brew.sh/docs/api/) for fields.', 'x'))
      .toBe('See the API for fields.');
    expect(metaDescription('Line one<br/>line two.', 'x')).toBe('Line one line two.');
  });

  test('drops inline code backticks and decodes entities', () => {
    expect(metaDescription('The `vw_info` view &amp; friends.', 'x')).toBe('The vw_info view & friends.');
    // numeric entities decode, except surrogate code points, which stay as written
    expect(metaDescription('A &#x2F; B &#65; &#xD800; C.', 'x')).toBe('A / B A &#xD800; C.');
  });

  test('collapses whitespace and takes the first sentence', () => {
    expect(metaDescription('  First   sentence\n here.  Second sentence.  ', 'x')).toBe('First sentence here.');
    expect(metaDescription('Does it work? Yes.', 'x')).toBe('Does it work?');
    expect(metaDescription('No terminal punctuation', 'x')).toBe('No terminal punctuation');
  });

  test('does not end a sentence at an abbreviation or inside a token', () => {
    expect(metaDescription('Tools, e.g. brew, and more. Next.', 'x')).toBe('Tools, e.g. brew, and more.');
    expect(metaDescription('Runs on Node.js and v1.2 builds. Next.', 'x')).toBe('Runs on Node.js and v1.2 builds.');
  });

  test(`caps at ${META_DESCRIPTION_MAX} characters on a word boundary`, () => {
    const long = `${'word '.repeat(60).trim()}.`;
    const out = metaDescription(long, 'x');
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(out).toMatch(/^(word )+word\.\.\.$/);
    const unbroken = 'x'.repeat(300);
    expect(metaDescription(unbroken, 'y')).toBe(`${'x'.repeat(META_DESCRIPTION_MAX - 3)}...`);
    const exact = `${'a'.repeat(META_DESCRIPTION_MAX - 1)}.`;
    expect(metaDescription(exact, 'y')).toBe(exact);
  });

  test('falls back when nothing is left', () => {
    for (const empty of [undefined, null, '', '   \n ', '<br/>', '<!-- note -->']) {
      expect(metaDescription(empty, 'fallback')).toBe('fallback');
    }
  });

  test('yamlString round-trips through js-yaml', () => {
    for (const value of ['plain', 'a: b', 'say "hi"', "it's", 'line\nbreak', '# not a comment', '- not a list', 'tab\there', '{x}']) {
      expect(yaml.load(`description: ${yamlString(value)}`)).toEqual({ description: value });
    }
  });
});

describe.each([
  ['generateDocs', generateDocs],
  ['generateDocsv2', generateDocsv2],
])('%s front matter descriptions', (_, generate) => {
  test('as-is fixture: the described resource gets its first sentence, the rest a per-resource fallback', async () => {
    const out = tmpdir();
    await generate({ providerName: 'homebrew', providerDir, providerDataDir, outputDir: out });

    expect(frontMatter(resourcePage(out, 'vw_info')).description)
      .toBe('The vw_info view provides detailed information about the StackQL formula in the Homebrew package manager.');
    for (const resource of ['formula', 'vw_build_errors', 'vw_versions']) {
      expect(frontMatter(resourcePage(out, resource)).description).toBe(fallback(resource));
    }
    // no resource page carries the provider-wide line, and no two share one
    const all = resourceDescriptions(out);
    expect(Object.keys(all).length).toBeGreaterThan(5);
    expect(Object.values(all)).not.toContain(PROVIDER_WIDE);
    expect(new Set(Object.values(all)).size).toBe(Object.keys(all).length);
    // service index names the service
    expect(frontMatter(path.join(out, 'docs', 'services', 'formula', 'index.md')).description)
      .toBe('Query, deploy and manage homebrew formula resources using SQL');
    // provider index keeps headerContent1.txt's description, whatever it says
    expect(frontMatter(path.join(out, 'docs', 'index.md')).description)
      .toBe(frontMatter(path.join(providerDataDir, 'headerContent1.txt')).description);
  }, 30000);

  test('described resources get distinct descriptions that parse whatever they contain', async () => {
    const descriptions = {
      formula: 'Formula metadata: names, versions and taps.',
      vw_info: 'Shows "info" for \'stackql\' only. Second sentence.',
      vw_build_errors: 'Build errors\nper formula and OS.',
      vw_conflicts: 'Conflicts between <code>formula</code> entries, see <a href="https://brew.sh">brew</a>.',
      vw_dependencies: 'Dependencies of each formula # with a hash.',
      vw_lifecycle: '',
      vw_urls: null,
    };
    const out = tmpdir();
    await generate({ providerName: 'homebrew', providerDir: fixtureWith(descriptions), providerDataDir, outputDir: out });

    const got = Object.fromEntries(Object.keys(descriptions).map((r) => [r, frontMatter(resourcePage(out, r)).description]));
    expect(got).toEqual({
      formula: 'Formula metadata: names, versions and taps.',
      vw_info: 'Shows "info" for \'stackql\' only.',
      vw_build_errors: 'Build errors per formula and OS.',
      vw_conflicts: 'Conflicts between formula entries, see brew.',
      vw_dependencies: 'Dependencies of each formula # with a hash.',
      vw_lifecycle: fallback('vw_lifecycle'),
      vw_urls: fallback('vw_urls'),
    });
    expect(new Set(Object.values(got)).size).toBe(Object.keys(descriptions).length);

    // every generated page's front matter is valid YAML
    const pages = fs.readdirSync(path.join(out, 'docs', 'services', 'formula'), { recursive: true })
      .filter((f) => f.endsWith('index.md'));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(() => frontMatter(path.join(out, 'docs', 'services', 'formula', page))).not.toThrow();
    }
  }, 30000);

  test('resources without descriptions get different fallbacks naming the resource, service and provider', async () => {
    // every resource stripped of its description
    const names = Object.keys(resourceDescriptions(await (async () => {
      const probe = tmpdir();
      await generate({ providerName: 'homebrew', providerDir, providerDataDir, outputDir: probe });
      return probe;
    })()));
    const out = tmpdir();
    await generate({
      providerName: 'homebrew',
      providerDir: fixtureWith(Object.fromEntries(names.map((n) => [n, null]))),
      providerDataDir,
      outputDir: out,
    });
    const got = resourceDescriptions(out);

    expect(got.vw_lifecycle).not.toBe(got.vw_urls);
    for (const [resource, description] of Object.entries(got)) {
      expect(description).toBe(fallback(resource));
      expect(description).toContain(resource);
      expect(description).toContain('formula');
      expect(description).toContain('homebrew');
    }
    expect(new Set(Object.values(got)).size).toBe(names.length);
  }, 30000);
});

test('resourceFallbackDescription names the resource, provider and service', () => {
  expect(resourceFallbackDescription('zones_settings', 'cloudflare', 'zones'))
    .toBe('Query, deploy and manage the zones_settings resource in the cloudflare zones service using SQL');
});
