import {
  renameVariants,
  stripMisplacedSchemaKeywords,
  convertOpaqueObjectsToStrings,
  liftPathItemParameters,
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
