import { toSnake, buildAliasMap, aliasTopLevelKeys, WIRE_NAME, wireHint, resolveSnakeCaseAliases } from '../../src/docgen/casing.js';

describe('toSnake (port of any-sdk casing.ToSnake / botocore xform_name)', () => {
  // Values pinned against botocore xform_name and any-sdk casing_test.go.
  const cases = [
    ['totalCHC', 'total_chc'],
    ['VPCId', 'vpc_id'],
    ['VpcId', 'vpc_id'],
    ['VPCEndpoint', 'vpc_endpoint'],
    ['ipAccessList', 'ip_access_list'],
    ['minReplicaMemoryGb', 'min_replica_memory_gb'],
    ['EnableDnsHostnames', 'enable_dns_hostnames'],
    ['DryRun', 'dry_run'],
    ['S3Bucket', 's3_bucket'],
    ['already_snake', 'already_snake'],
    ['id', 'id'],
    ['Name', 'name'],
    ['serviceId', 'service_id'],
    ['backupName', 'backup_name'],
    ['sizeInBytes', 'size_in_bytes'],
    // awkward cases - fidelity to any-sdk beats prettiness
    ['ARNs', '_arns'],
    ['DBInstanceARNs', 'db_instance_arns'],
    ['IPv6Address', 'i_pv_6_address'],
    ['HTTPSPort', 'https_port'],
    ['SSEKMSKeyId', 'ssekms_key_id'],
    ['ipv4', 'ipv_4'],
    ['v2Api', 'v_2_api'],
    ['ARN', 'arn'],
    ['a', 'a'],
    ['', ''],
  ];

  test.each(cases)('%s -> %s', (input, expected) => {
    expect(toSnake(input)).toBe(expected);
  });

  test('is memoised and stable across calls', () => {
    expect(toSnake('serviceId')).toBe('service_id');
    expect(toSnake('serviceId')).toBe('service_id');
  });

  test('passes non-strings through', () => {
    expect(toSnake(undefined)).toBeUndefined();
    expect(toSnake(null)).toBeNull();
  });
});

describe('buildAliasMap collision rule', () => {
  test('aliases camelCase names', () => {
    const m = buildAliasMap(['serviceId', 'name']);
    expect(m.get('serviceId')).toBe('service_id');
    expect(m.get('name')).toBe('name');
  });

  test('a snake alias never clobbers a real name of the same spelling', () => {
    const m = buildAliasMap(['serviceId', 'service_id']);
    expect(m.get('serviceId')).toBe('serviceId');
    expect(m.get('service_id')).toBe('service_id');
  });

  test('reserved names are also protected', () => {
    const m = buildAliasMap(['organizationId'], ['organization_id']);
    expect(m.get('organizationId')).toBe('organizationId');
  });
});

describe('aliasTopLevelKeys', () => {
  test('renames only top-level keys and marks wire names', () => {
    const nested = { type: 'object', properties: { innerKey: { type: 'string' } } };
    const src = { serviceId: { type: 'string', description: 'd' }, blob: nested };
    const out = aliasTopLevelKeys(src);
    expect(Object.keys(out)).toEqual(['service_id', 'blob']);
    expect(out.service_id[WIRE_NAME]).toBe('serviceId');
    expect(out.service_id.description).toBe('d');
    expect(wireHint(out.service_id)).toBe(' (wire: serviceId)');
    // nested contents untouched, and the same object (not copied)
    expect(out.blob).toBe(nested);
    expect(Object.keys(out.blob.properties)).toEqual(['innerKey']);
    // source object not mutated
    expect(Object.keys(src)).toEqual(['serviceId', 'blob']);
    expect(src.serviceId[WIRE_NAME]).toBeUndefined();
    expect(wireHint(out.blob)).toBe('');
  });

  test('skip predicate keeps entries as authored and protects their spelling', () => {
    const SV = Symbol('sv');
    const src = { organizationId: { type: 'string' }, organization_id: { type: 'string', [SV]: true } };
    const out = aliasTopLevelKeys(src, { skip: d => d[SV] === true });
    expect(Object.keys(out)).toEqual(['organizationId', 'organization_id']);
  });

  test('WIRE_NAME is invisible to Object.entries and JSON.stringify', () => {
    const out = aliasTopLevelKeys({ fooBar: { type: 'string' } });
    expect(Object.keys(out.foo_bar)).toEqual(['type']);
    expect(JSON.stringify(out.foo_bar)).toBe('{"type":"string"}');
  });
});

describe('resolveSnakeCaseAliases', () => {
  test('off by default', () => {
    for (const input of [undefined, false, null, 0, '']) {
      expect(resolveSnakeCaseAliases(input)).toEqual({ fields: false, params: false, body: false });
    }
  });

  test('boolean true turns every surface on (back-compatible)', () => {
    expect(resolveSnakeCaseAliases(true)).toEqual({ fields: true, params: true, body: true });
  });

  test('object form gates each surface independently', () => {
    expect(resolveSnakeCaseAliases({ params: true })).toEqual({ fields: false, params: true, body: false });
    expect(resolveSnakeCaseAliases({ fields: true })).toEqual({ fields: true, params: false, body: false });
    expect(resolveSnakeCaseAliases({ body: true })).toEqual({ fields: false, params: false, body: true });
  });

  test('omitted keys default to false, unknown keys are ignored', () => {
    expect(resolveSnakeCaseAliases({ params: true, nonsense: true }))
      .toEqual({ fields: false, params: true, body: false });
  });

  test('values are coerced to booleans', () => {
    expect(resolveSnakeCaseAliases({ fields: 1, params: 0, body: 'yes' }))
      .toEqual({ fields: true, params: false, body: true });
  });
});
