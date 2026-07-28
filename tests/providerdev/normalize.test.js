import {
  renameVariants,
  stripMisplacedSchemaKeywords,
  convertOpaqueObjectsToStrings,
  liftPathItemParameters,
  stripNonRootServers,
  wrapBareArrayResponses,
  walkAllOf,
  normalizeDocument,
} from '../../src/providerdev/normalize.js';

function makeStripStats() {
  return { stripped: [] };
}

function makeOpaqueStats() {
  return { opaqueConverted: [] };
}

function makeRenameStats() {
  return { oneOfRenamed: 0, anyOfRenamed: 0 };
}

describe('stripMisplacedSchemaKeywords', () => {
  test('1. strips scalar type:object that landed inside properties map', () => {
    const doc = {
      components: {
        schemas: {
          Foo: {
            type: 'object',
            properties: {
              type: 'object',
              name: { type: 'string' },
            },
          },
        },
      },
    };
    const stats = makeStripStats();
    stripMisplacedSchemaKeywords(doc, stats);
    expect(doc.components.schemas.Foo.properties).not.toHaveProperty('type');
    expect(doc.components.schemas.Foo.properties.name).toEqual({ type: 'string' });
    expect(stats.stripped.length).toBe(1);
  });

  test('2. preserves property literally named "type" whose value is a schema object', () => {
    const doc = {
      components: {
        schemas: {
          Foo: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'a real property' },
            },
          },
        },
      },
    };
    const stats = makeStripStats();
    stripMisplacedSchemaKeywords(doc, stats);
    expect(doc.components.schemas.Foo.properties.type).toEqual({
      type: 'string',
      description: 'a real property',
    });
    expect(stats.stripped.length).toBe(0);
  });

  test('3. preserves "properties" property with value type:array (recursion does not mis-target)', () => {
    const doc = {
      components: {
        schemas: {
          Foo: {
            type: 'object',
            properties: {
              properties: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    };
    const stats = makeStripStats();
    stripMisplacedSchemaKeywords(doc, stats);
    expect(doc.components.schemas.Foo.properties.properties).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
    expect(stats.stripped.length).toBe(0);
  });
});

describe('convertOpaqueObjectsToStrings', () => {
  test('4. rewrites type:object with only description to type:string and appends note', () => {
    const doc = { type: 'object', description: 'foo' };
    const stats = makeOpaqueStats();
    convertOpaqueObjectsToStrings(doc, stats);
    expect(doc.type).toBe('string');
    expect(doc.description).toBe('foo (opaque JSON object)');
    expect(stats.opaqueConverted.length).toBe(1);
  });

  test('5. leaves type:object with additionalProperties untouched', () => {
    const doc = { type: 'object', additionalProperties: true };
    const stats = makeOpaqueStats();
    convertOpaqueObjectsToStrings(doc, stats);
    expect(doc).toEqual({ type: 'object', additionalProperties: true });
    expect(stats.opaqueConverted.length).toBe(0);
  });

  test('6. rewrites array items:{type:object} (opaque) to items:{type:string}', () => {
    const doc = { type: 'array', items: { type: 'object' } };
    const stats = makeOpaqueStats();
    convertOpaqueObjectsToStrings(doc, stats);
    expect(doc.items.type).toBe('string');
    expect(doc.items.description).toBe('(opaque JSON object)');
    expect(stats.opaqueConverted.length).toBe(1);
  });
});

describe('renameVariants (pass 1 scope)', () => {
  test('7. renames oneOf -> allOf on a top-level response schema', () => {
    const doc = {
      paths: {
        '/thing': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: {
                      oneOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const stats = makeRenameStats();
    renameVariants(doc, stats);
    const sch = doc.paths['/thing'].get.responses[200].content['application/json'].schema;
    expect(sch).not.toHaveProperty('oneOf');
    expect(Array.isArray(sch.allOf)).toBe(true);
    expect(sch.allOf.length).toBe(2);
    expect(stats.oneOfRenamed).toBe(1);
  });

  test('8. leaves deeply nested oneOf (items.properties.foo.oneOf) alone', () => {
    const nested = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          foo: {
            oneOf: [{ type: 'string' }, { type: 'number' }],
          },
        },
      },
    };
    const doc = {
      paths: {
        '/thing': {
          get: {
            responses: {
              200: { content: { 'application/json': { schema: nested } } },
            },
          },
        },
      },
    };
    const stats = makeRenameStats();
    renameVariants(doc, stats);
    // The nested oneOf sits below items.properties.foo, outside pass 1 scope.
    expect(nested.items.properties.foo).toHaveProperty('oneOf');
    expect(nested.items.properties.foo).not.toHaveProperty('allOf');
    expect(stats.oneOfRenamed).toBe(0);
  });
});

describe('walkAllOf / flattenAllOf (pass 2)', () => {
  test('9. terminates when allOf members form a $ref cycle via seenRefs', () => {
    const doc = {
      components: {
        schemas: {
          A: { allOf: [{ $ref: '#/components/schemas/B' }, { type: 'object', properties: { a: { type: 'string' } } }] },
          B: { allOf: [{ $ref: '#/components/schemas/A' }, { type: 'object', properties: { b: { type: 'string' } } }] },
        },
      },
    };
    // No infinite loop = success.
    walkAllOf(doc, doc, new Set(), { allOfFlattened: 0 });
    expect(doc.components.schemas.A).not.toHaveProperty('allOf');
    expect(doc.components.schemas.B).not.toHaveProperty('allOf');
    expect(doc.components.schemas.A.properties).toHaveProperty('a');
    expect(doc.components.schemas.B.properties).toHaveProperty('b');
  });

  test('10. merging allOf with overlapping required yields unique union', () => {
    const doc = {
      type: 'object',
      allOf: [
        { required: ['a', 'b'], properties: { a: { type: 'string' } } },
        { required: ['b', 'c'], properties: { c: { type: 'string' } } },
      ],
    };
    walkAllOf(doc, doc, new Set(), { allOfFlattened: 0 });
    expect(doc).not.toHaveProperty('allOf');
    expect(doc.required.sort()).toEqual(['a', 'b', 'c']);
    expect(Object.keys(doc.properties).sort()).toEqual(['a', 'c']);
  });
});

describe('liftPathItemParameters', () => {
  function makeLiftStats() {
    return { pathParamsLifted: 0 };
  }

  test('11. lifts path-item params onto an operation with empty parameters (Confluent Connect repro)', () => {
    const doc = {
      paths: {
        '/connect/v1/environments/{environment_id}/clusters/{kafka_cluster_id}/connectors': {
          parameters: [
            { name: 'environment_id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'kafka_cluster_id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            operationId: 'listConnectv1Connectors',
            parameters: [],
          },
        },
      },
    };
    const stats = makeLiftStats();
    liftPathItemParameters(doc, stats);
    const path = doc.paths['/connect/v1/environments/{environment_id}/clusters/{kafka_cluster_id}/connectors'];
    expect(path).not.toHaveProperty('parameters');
    expect(path.get.parameters.map(p => p.name)).toEqual(['environment_id', 'kafka_cluster_id']);
    expect(stats.pathParamsLifted).toBe(2);
  });

  test('12. operation-level parameter overrides path-item parameter on (name, in)', () => {
    const doc = {
      paths: {
        '/things/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'from path-item' },
          ],
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'from operation' },
            ],
          },
        },
      },
    };
    const stats = makeLiftStats();
    liftPathItemParameters(doc, stats);
    const params = doc.paths['/things/{id}'].get.parameters;
    expect(params.length).toBe(1);
    expect(params[0].description).toBe('from operation');
    expect(params[0].schema.type).toBe('integer');
    expect(stats.pathParamsLifted).toBe(0);
  });

  test('13. same name in different `in` locations are not deduped', () => {
    const doc = {
      paths: {
        '/items/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            parameters: [
              { name: 'id', in: 'query', schema: { type: 'string' } },
            ],
          },
        },
      },
    };
    const stats = makeLiftStats();
    liftPathItemParameters(doc, stats);
    const params = doc.paths['/items/{id}'].get.parameters;
    expect(params.length).toBe(2);
    expect(params.map(p => p.in).sort()).toEqual(['path', 'query']);
    expect(stats.pathParamsLifted).toBe(1);
  });

  test('14. lifts onto every operation under the same path', () => {
    const doc = {
      paths: {
        '/things/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: { parameters: [] },
          delete: { parameters: [] },
          patch: {},
        },
      },
    };
    const stats = makeLiftStats();
    liftPathItemParameters(doc, stats);
    const path = doc.paths['/things/{id}'];
    expect(path.get.parameters[0].name).toBe('id');
    expect(path.delete.parameters[0].name).toBe('id');
    expect(path.patch.parameters[0].name).toBe('id');
    expect(stats.pathParamsLifted).toBe(3);
  });

  test('15. resolves $ref params for dedup against op-level inline param', () => {
    const doc = {
      components: {
        parameters: {
          IdParam: { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        },
      },
      paths: {
        '/things/{id}': {
          parameters: [
            { $ref: '#/components/parameters/IdParam' },
          ],
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            ],
          },
        },
      },
    };
    const stats = makeLiftStats();
    liftPathItemParameters(doc, stats);
    const params = doc.paths['/things/{id}'].get.parameters;
    expect(params.length).toBe(1);
    expect(params[0].schema.type).toBe('integer');
    expect(stats.pathParamsLifted).toBe(0);
  });

  test('16. leaves paths without path-item parameters untouched', () => {
    const doc = {
      paths: {
        '/foo': {
          get: { parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }] },
        },
      },
    };
    const stats = makeLiftStats();
    liftPathItemParameters(doc, stats);
    expect(doc.paths['/foo'].get.parameters).toEqual([
      { name: 'q', in: 'query', schema: { type: 'string' } },
    ]);
    expect(stats.pathParamsLifted).toBe(0);
  });

  test('17. lifted parameter is a deep clone (mutating op param does not affect siblings)', () => {
    const doc = {
      paths: {
        '/things/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: { parameters: [] },
          delete: { parameters: [] },
        },
      },
    };
    liftPathItemParameters(doc, { pathParamsLifted: 0 });
    const path = doc.paths['/things/{id}'];
    path.get.parameters[0].schema.type = 'integer';
    expect(path.delete.parameters[0].schema.type).toBe('string');
  });
});

describe('stripNonRootServers', () => {
  function makeServersStats() {
    return { serversStripped: 0 };
  }

  test('18. removes path-item-level servers (Confluent Kafka REST repro)', () => {
    const doc = {
      servers: [{ url: 'https://api.confluent.cloud' }],
      paths: {
        '/kafka/v3/clusters/{cluster_id}/topics': {
          servers: [{ url: 'https://pkc-00000.region.provider.confluent.cloud' }],
          get: { operationId: 'listKafkaTopics' },
        },
      },
    };
    const stats = makeServersStats();
    stripNonRootServers(doc, stats);
    expect(doc.paths['/kafka/v3/clusters/{cluster_id}/topics']).not.toHaveProperty('servers');
    expect(doc.servers).toEqual([{ url: 'https://api.confluent.cloud' }]);
    expect(stats.serversStripped).toBe(1);
  });

  test('19. removes operation-level servers across all HTTP verbs', () => {
    const doc = {
      paths: {
        '/x': {
          get: { servers: [{ url: 'https://a' }] },
          post: { servers: [{ url: 'https://b' }] },
          delete: { servers: [{ url: 'https://c' }] },
          patch: {},
        },
      },
    };
    const stats = makeServersStats();
    stripNonRootServers(doc, stats);
    expect(doc.paths['/x'].get).not.toHaveProperty('servers');
    expect(doc.paths['/x'].post).not.toHaveProperty('servers');
    expect(doc.paths['/x'].delete).not.toHaveProperty('servers');
    expect(stats.serversStripped).toBe(3);
  });

  test('20. strips both path-item and per-op servers in the same path', () => {
    const doc = {
      paths: {
        '/y': {
          servers: [{ url: 'https://path-level' }],
          get: { servers: [{ url: 'https://op-level' }] },
        },
      },
    };
    const stats = makeServersStats();
    stripNonRootServers(doc, stats);
    expect(doc.paths['/y']).not.toHaveProperty('servers');
    expect(doc.paths['/y'].get).not.toHaveProperty('servers');
    expect(stats.serversStripped).toBe(2);
  });

  test('21. leaves the document-level servers array untouched', () => {
    const rootServers = [{ url: 'https://api.example.com', description: 'prod' }];
    const doc = {
      servers: rootServers,
      paths: {
        '/foo': {
          servers: [{ url: 'https://nope' }],
          get: {},
        },
      },
    };
    stripNonRootServers(doc, makeServersStats());
    expect(doc.servers).toBe(rootServers);
    expect(doc.servers).toEqual([{ url: 'https://api.example.com', description: 'prod' }]);
  });

  test('22. is a no-op on a doc with no path-item or operation servers', () => {
    const doc = {
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/foo': { get: { operationId: 'getFoo' } },
      },
    };
    const stats = makeServersStats();
    stripNonRootServers(doc, stats);
    expect(stats.serversStripped).toBe(0);
    expect(doc.paths['/foo'].get).toEqual({ operationId: 'getFoo' });
  });

  test('23. ignores non-operation keys at the path-item level (parameters, summary, x-*)', () => {
    const doc = {
      paths: {
        '/z': {
          summary: 'a path',
          parameters: [{ name: 'q', in: 'query' }],
          'x-extension': { servers: [{ url: 'https://nested-extension' }] },
          get: { servers: [{ url: 'https://op' }] },
        },
      },
    };
    const stats = makeServersStats();
    stripNonRootServers(doc, stats);
    expect(doc.paths['/z'].summary).toBe('a path');
    expect(doc.paths['/z'].parameters).toEqual([{ name: 'q', in: 'query' }]);
    expect(doc.paths['/z']['x-extension']).toEqual({ servers: [{ url: 'https://nested-extension' }] });
    expect(doc.paths['/z'].get).not.toHaveProperty('servers');
    expect(stats.serversStripped).toBe(1);
  });

  test('24. is idempotent on re-run', () => {
    const doc = {
      paths: {
        '/x': {
          servers: [{ url: 'https://a' }],
          get: { servers: [{ url: 'https://b' }] },
        },
      },
    };
    const first = makeServersStats();
    stripNonRootServers(doc, first);
    expect(first.serversStripped).toBe(2);
    const second = makeServersStats();
    stripNonRootServers(doc, second);
    expect(second.serversStripped).toBe(0);
  });
});

describe('wrapBareArrayResponses', () => {
  function makeWrapStats() {
    return { bareArrayWrapped: 0 };
  }
  function captureWarnings() {
    const warnings = [];
    return { log: { warn: (m) => warnings.push(m) }, warnings };
  }

  test('25. scalar items: synthesises wrapper schema, rewrites response, marks op (Confluent listContexts repro)', () => {
    const doc = {
      paths: {
        '/contexts': {
          get: {
            operationId: 'listContexts',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const stats = makeWrapStats();
    wrapBareArrayResponses(doc, {}, stats);

    const op = doc.paths['/contexts'].get;
    expect(op.responses['200'].content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/ListContextsResponse' });
    expect(op['x-stackql-bare-array-wrap']).toEqual({
      wrapperKey: 'contexts',
      wrapperName: 'ListContextsResponse',
      mediaType: 'application/json',
      scalar: true,
      columnName: 'context',
    });

    const wrapper = doc.components.schemas.ListContextsResponse;
    expect(wrapper.type).toBe('object');
    expect(wrapper.properties.contexts.type).toBe('array');
    expect(wrapper.properties.contexts.items.type).toBe('object');
    expect(wrapper.properties.contexts.items.properties.context.type).toBe('string');
    expect(stats.bareArrayWrapped).toBe(1);
  });

  test('26. object items: wrapper key with original items schema preserved', () => {
    const itemsSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        kind: { type: 'string' },
      },
    };
    const doc = {
      paths: {
        '/connectors/{name}/tasks': {
          get: {
            operationId: 'listConnectorTasks',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: itemsSchema },
                  },
                },
              },
            },
          },
        },
      },
    };
    const stats = makeWrapStats();
    wrapBareArrayResponses(doc, {}, stats);

    const wrap = doc.paths['/connectors/{name}/tasks'].get['x-stackql-bare-array-wrap'];
    expect(wrap).toEqual({
      wrapperKey: 'connector_tasks',
      wrapperName: 'ListConnectorTasksResponse',
      mediaType: 'application/json',
      scalar: false,
    });
    const wrapper = doc.components.schemas.ListConnectorTasksResponse;
    expect(wrapper.properties.connector_tasks.items).toEqual(itemsSchema);
    expect(stats.bareArrayWrapped).toBe(1);
  });

  test('27. integer scalar items: column type matches the underlying scalar type', () => {
    const doc = {
      paths: {
        '/ids': {
          get: {
            operationId: 'listIds',
            responses: {
              '200': { content: { 'application/json': { schema: { type: 'array', items: { type: 'integer' } } } } },
            },
          },
        },
      },
    };
    wrapBareArrayResponses(doc, {}, makeWrapStats());
    const wrapper = doc.components.schemas.ListIdsResponse;
    expect(wrapper.properties.ids.items.properties.id.type).toBe('integer');
  });

  test('28. response schema is itself a $ref to a top-level array component: still wraps', () => {
    const doc = {
      components: {
        schemas: {
          StringList: { type: 'array', items: { type: 'string' } },
        },
      },
      paths: {
        '/things': {
          get: {
            operationId: 'listThings',
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/StringList' } } } },
            },
          },
        },
      },
    };
    wrapBareArrayResponses(doc, {}, makeWrapStats());
    const op = doc.paths['/things'].get;
    expect(op.responses['200'].content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/ListThingsResponse' });
    // Original component schema is left in place — other ops may reference it.
    expect(doc.components.schemas.StringList).toEqual({ type: 'array', items: { type: 'string' } });
  });

  test('29. operationId-only verb falls back to wrapperKey "items" and column "item"', () => {
    const doc = {
      paths: {
        '/x': {
          get: {
            operationId: 'list',
            responses: {
              '200': { content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } },
            },
          },
        },
      },
    };
    wrapBareArrayResponses(doc, {}, makeWrapStats());
    const wrap = doc.paths['/x'].get['x-stackql-bare-array-wrap'];
    expect(wrap.wrapperKey).toBe('items');
    expect(wrap.columnName).toBe('item');
  });

  test('30. override file wins for both wrapperKey and columnName', () => {
    const doc = {
      paths: {
        '/contexts': {
          get: {
            operationId: 'listContexts',
            responses: {
              '200': { content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } },
            },
          },
        },
      },
    };
    const overrides = { listContexts: { wrapperKey: 'rows', columnName: 'name' } };
    wrapBareArrayResponses(doc, { bareArrayOverrides: overrides }, makeWrapStats());
    const wrap = doc.paths['/contexts'].get['x-stackql-bare-array-wrap'];
    expect(wrap.wrapperKey).toBe('rows');
    expect(wrap.columnName).toBe('name');
    const wrapper = doc.components.schemas.ListContextsResponse;
    expect(wrapper.properties.rows.items.properties.name.type).toBe('string');
  });

  test('31. is idempotent on re-run (existing marker short-circuits)', () => {
    const doc = {
      paths: {
        '/contexts': {
          get: {
            operationId: 'listContexts',
            responses: {
              '200': { content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } },
            },
          },
        },
      },
    };
    const first = makeWrapStats();
    wrapBareArrayResponses(doc, {}, first);
    expect(first.bareArrayWrapped).toBe(1);
    const second = makeWrapStats();
    wrapBareArrayResponses(doc, {}, second);
    expect(second.bareArrayWrapped).toBe(0);
  });

  test('32. wrapper schema name collision with different body is reported and skipped', () => {
    const doc = {
      components: {
        schemas: {
          ListContextsResponse: { type: 'object', description: 'pre-existing, not the same' },
        },
      },
      paths: {
        '/contexts': {
          get: {
            operationId: 'listContexts',
            responses: {
              '200': { content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } },
            },
          },
        },
      },
    };
    const { log, warnings } = captureWarnings();
    wrapBareArrayResponses(doc, { log }, makeWrapStats());
    const op = doc.paths['/contexts'].get;
    expect(op).not.toHaveProperty('x-stackql-bare-array-wrap');
    expect(op.responses['200'].content['application/json'].schema).toEqual({ type: 'array', items: { type: 'string' } });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/already in use/);
  });

  test('33. operations whose response is an object (not array) are untouched', () => {
    const doc = {
      paths: {
        '/foo': {
          get: {
            operationId: 'getFoo',
            responses: {
              '200': { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } },
            },
          },
        },
      },
    };
    const stats = makeWrapStats();
    wrapBareArrayResponses(doc, {}, stats);
    expect(stats.bareArrayWrapped).toBe(0);
    expect(doc.paths['/foo'].get).not.toHaveProperty('x-stackql-bare-array-wrap');
  });

  test('34. bare-array response with no operationId is skipped with a warning', () => {
    const doc = {
      paths: {
        '/x': {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } },
            },
          },
        },
      },
    };
    const { log, warnings } = captureWarnings();
    const stats = makeWrapStats();
    wrapBareArrayResponses(doc, { log }, stats);
    expect(stats.bareArrayWrapped).toBe(0);
    expect(warnings[0]).toMatch(/no operationId/);
  });
});

describe('normalizeDocument (end-to-end)', () => {
  test('runs all four passes and returns aggregate stats', () => {
    const doc = {
      paths: {
        '/thing': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: {
                      oneOf: [{ type: 'object', properties: { a: { type: 'string' } } }],
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Opaque: { type: 'object', description: 'blob' },
          Buggy: {
            type: 'object',
            properties: {
              type: 'object',
              real: { type: 'string' },
            },
          },
        },
      },
    };
    const stats = normalizeDocument(doc);
    expect(stats.oneOfRenamed).toBe(1);
    expect(stats.opaqueConverted.length).toBe(1);
    expect(stats.stripped.length).toBe(1);
    expect(stats.allOfFlattened).toBeGreaterThanOrEqual(1);
    expect(doc.components.schemas.Opaque.type).toBe('string');
    expect(doc.components.schemas.Buggy.properties).not.toHaveProperty('type');
    expect(doc.components.schemas.Buggy.properties.real).toEqual({ type: 'string' });
  });
});
