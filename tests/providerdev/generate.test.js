import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadServiceViews,
  mergeViewsIntoSpec,
  applyBareArrayWrap,
} from '../../src/providerdev/generate.js';

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeLogger() {
  const calls = { info: [], warn: [], error: [] };
  return {
    info: (...a) => calls.info.push(a.join(' ')),
    warn: (...a) => calls.warn.push(a.join(' ')),
    error: (...a) => calls.error.push(a.join(' ')),
    _calls: calls,
  };
}

describe('loadServiceViews', () => {
  let root;
  beforeEach(() => { root = tmpdir('gen-views-'); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('returns null when viewsDir is not supplied', () => {
    expect(loadServiceViews(null, 'foo')).toBeNull();
    expect(loadServiceViews('', 'foo')).toBeNull();
  });

  test('returns null when no views.yaml exists for the service', () => {
    fs.mkdirSync(path.join(root, 'other'), { recursive: true });
    expect(loadServiceViews(root, 'foo')).toBeNull();
  });

  test('parses a 4-space-indented fragment as a top-level mapping', () => {
    const svcDir = path.join(root, 'managed_kafka_clusters');
    fs.mkdirSync(svcDir, { recursive: true });
    const fragment = [
      '    vw_clusters:',
      '      name: vw_clusters',
      '      id: confluent.managed_kafka_clusters.vw_clusters',
      '      config:',
      '        views:',
      '          select:',
      '            predicate: sqlDialect == "sqlite3"',
      '            ddl: SELECT id FROM x',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(svcDir, 'views.yaml'), fragment, 'utf8');

    const views = loadServiceViews(root, 'managed_kafka_clusters');
    expect(Object.keys(views)).toEqual(['vw_clusters']);
    expect(views.vw_clusters.name).toBe('vw_clusters');
    expect(views.vw_clusters.config.views.select.predicate).toBe('sqlDialect == "sqlite3"');
  });

  test('also accepts a flush-left fragment', () => {
    const svcDir = path.join(root, 'iam');
    fs.mkdirSync(svcDir, { recursive: true });
    fs.writeFileSync(path.join(svcDir, 'views.yaml'),
      'vw_users:\n  name: vw_users\n  id: p.iam.vw_users\n', 'utf8');
    const views = loadServiceViews(root, 'iam');
    expect(views.vw_users.name).toBe('vw_users');
  });

  test('throws when the fragment is not a top-level mapping', () => {
    const svcDir = path.join(root, 'bad');
    fs.mkdirSync(svcDir, { recursive: true });
    fs.writeFileSync(path.join(svcDir, 'views.yaml'),
      '- just\n- a\n- list\n', 'utf8');
    expect(() => loadServiceViews(root, 'bad')).toThrow(/must parse to a YAML mapping/);
  });
});

describe('mergeViewsIntoSpec', () => {
  test('splices view entries into components.x-stackQL-resources', () => {
    const spec = {
      components: {
        'x-stackQL-resources': {
          clusters: { id: 'p.s.clusters', name: 'clusters' },
        },
      },
    };
    const views = {
      vw_clusters: { id: 'p.s.vw_clusters', name: 'vw_clusters' },
    };
    const log = makeLogger();
    const result = mergeViewsIntoSpec(spec, views, log, 'svc');

    expect(result.merged).toBe(1);
    expect(result.collisions).toEqual([]);
    expect(spec.components['x-stackQL-resources'].vw_clusters).toEqual(views.vw_clusters);
    expect(spec.components['x-stackQL-resources'].clusters).toBeDefined();
  });

  test('existing API-derived entry wins on collision; collision is logged', () => {
    const spec = {
      components: {
        'x-stackQL-resources': {
          clusters: { id: 'api-derived', name: 'clusters' },
        },
      },
    };
    const views = {
      clusters: { id: 'view-version', name: 'clusters' },
    };
    const log = makeLogger();
    const result = mergeViewsIntoSpec(spec, views, log, 'svc');

    expect(result.merged).toBe(0);
    expect(result.collisions).toEqual(['clusters']);
    expect(spec.components['x-stackQL-resources'].clusters.id).toBe('api-derived');
    expect(log._calls.warn.length).toBe(1);
    expect(log._calls.warn[0]).toMatch(/collides/);
  });

  test('idempotent re-run: deep-equal existing entry is silently skipped', () => {
    const body = {
      id: 'p.s.vw_clusters',
      name: 'vw_clusters',
      config: { views: { select: { ddl: 'SELECT 1' } } },
    };
    const spec = {
      components: {
        'x-stackQL-resources': {
          vw_clusters: JSON.parse(JSON.stringify(body)),
        },
      },
    };
    const log = makeLogger();
    const result = mergeViewsIntoSpec(spec, { vw_clusters: body }, log, 'svc');

    expect(result.merged).toBe(0);
    expect(result.skippedIdempotent).toBe(1);
    expect(result.collisions).toEqual([]);
    expect(log._calls.warn).toEqual([]);
  });

  test('initialises components.x-stackQL-resources when missing', () => {
    const spec = {};
    const views = { vw_x: { name: 'vw_x' } };
    const log = makeLogger();
    mergeViewsIntoSpec(spec, views, log, 'svc');
    expect(spec.components['x-stackQL-resources'].vw_x).toEqual({ name: 'vw_x' });
  });

  test('null/empty views is a no-op', () => {
    const spec = { components: { 'x-stackQL-resources': { a: { name: 'a' } } } };
    const log = makeLogger();
    expect(mergeViewsIntoSpec(spec, null, log, 'svc').merged).toBe(0);
    expect(mergeViewsIntoSpec(spec, {}, log, 'svc').merged).toBe(0);
    expect(spec.components['x-stackQL-resources'].a).toBeDefined();
  });
});

describe('applyBareArrayWrap', () => {
  test('scalar: emits per-item Go template inside response, sets objectKey, strips marker', () => {
    const methodEntry = { response: { mediaType: 'application/json', openAPIDocKey: '200' } };
    const operation = {
      operationId: 'listContexts',
      'x-stackql-bare-array-wrap': {
        wrapperKey: 'contexts',
        wrapperName: 'ListContextsResponse',
        mediaType: 'application/json',
        scalar: true,
        columnName: 'context',
      },
    };
    applyBareArrayWrap(methodEntry, operation);

    expect(methodEntry.response.objectKey).toBe('$.contexts');
    expect(methodEntry.response.transform.type).toBe('golang_template_text_v0.3.0');
    expect(methodEntry.response.transform.body).toMatch(/jsonMapFromString/);
    expect(methodEntry.response.transform.body).toMatch(/"contexts":/);
    expect(methodEntry.response.transform.body).toMatch(/"context":/);
    // transform must live inside response, not as a sibling on the method entry
    expect(methodEntry).not.toHaveProperty('transform');
    expect(operation).not.toHaveProperty('x-stackql-bare-array-wrap');
  });

  test('emits overrideMediaType and schema_override so stackql fires the transform at runtime', () => {
    const methodEntry = { response: { mediaType: 'application/json', openAPIDocKey: '200' } };
    const operation = {
      'x-stackql-bare-array-wrap': {
        wrapperKey: 'connectv1_connectors',
        wrapperName: 'ListConnectv1ConnectorsResponse',
        mediaType: 'application/json',
        scalar: true,
        columnName: 'connectv1_connector',
      },
    };
    applyBareArrayWrap(methodEntry, operation);

    expect(methodEntry.response.overrideMediaType).toBe('application/json');
    expect(methodEntry.response.schema_override).toEqual({
      $ref: '#/components/schemas/ListConnectv1ConnectorsResponse',
    });
  });

  test('overrideMediaType falls back to response.mediaType when not on marker, then to application/json', () => {
    const a = { response: { mediaType: 'application/vnd.api+json' } };
    applyBareArrayWrap(a, {
      'x-stackql-bare-array-wrap': {
        wrapperKey: 'rows', wrapperName: 'R', scalar: false,
      },
    });
    expect(a.response.overrideMediaType).toBe('application/vnd.api+json');

    const b = { response: {} };
    applyBareArrayWrap(b, {
      'x-stackql-bare-array-wrap': {
        wrapperKey: 'rows', wrapperName: 'R', scalar: false,
      },
    });
    expect(b.response.overrideMediaType).toBe('application/json');
  });

  test('marker mediaType wins over methodEntry.response.mediaType', () => {
    const methodEntry = { response: { mediaType: 'application/json' } };
    applyBareArrayWrap(methodEntry, {
      'x-stackql-bare-array-wrap': {
        wrapperKey: 'rows', wrapperName: 'R',
        mediaType: 'application/vnd.confluent.v3+json',
        scalar: false,
      },
    });
    expect(methodEntry.response.overrideMediaType).toBe('application/vnd.confluent.v3+json');
  });

  test('object items: simpler wrap template, no inner column, lives inside response', () => {
    const methodEntry = { response: {} };
    const operation = {
      'x-stackql-bare-array-wrap': {
        wrapperKey: 'connector_tasks',
        wrapperName: 'ListConnectorTasksResponse',
        scalar: false,
      },
    };
    applyBareArrayWrap(methodEntry, operation);

    expect(methodEntry.response.objectKey).toBe('$.connector_tasks');
    expect(methodEntry.response.transform.type).toBe('golang_template_text_v0.3.0');
    expect(methodEntry.response.transform.body).toMatch(/"connector_tasks\\":/);
    expect(methodEntry.response.transform.body).not.toMatch(/jsonMapFromString/);
    expect(methodEntry).not.toHaveProperty('transform');
  });

  test('overrides any CSV-supplied objectKey because the wrap is authoritative', () => {
    const methodEntry = { response: { objectKey: '$.fromCsv' } };
    const operation = {
      'x-stackql-bare-array-wrap': {
        wrapperKey: 'rows', wrapperName: 'R', scalar: true, columnName: 'name',
      },
    };
    applyBareArrayWrap(methodEntry, operation);
    expect(methodEntry.response.objectKey).toBe('$.rows');
  });

  test('no marker: methodEntry untouched', () => {
    const methodEntry = { response: { objectKey: '$.data' } };
    const operation = { operationId: 'getFoo' };
    applyBareArrayWrap(methodEntry, operation);
    expect(methodEntry).toEqual({ response: { objectKey: '$.data' } });
  });
});
