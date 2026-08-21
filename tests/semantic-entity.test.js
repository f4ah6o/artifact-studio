import { describe, expect, test } from 'vite-plus/test';
import {
  SemanticEntityError,
  SemanticEntityResolutionError,
  normalizeSemanticEntities,
  resolveSemanticEntity,
  semanticEntity,
} from '../src/core/semantic-entity.js';

const CUSTOMER = {
  id: 'bonita-bdm:com.example.Customer',
  artifactId: 'artifact-bdm-1',
  kind: 'business-object',
  label: 'Customer',
  address: 'com.example.Customer',
  metadata: { qualifiedName: 'com.example.Customer' },
};

const NAME = {
  id: 'bonita-bdm:com.example.Customer#field:name',
  artifactId: 'artifact-bdm-1',
  kind: 'field',
  label: 'name',
  address: 'com.example.Customer#name',
  metadata: { fieldKind: 'simple', type: 'STRING', nullable: false },
};

describe('SemanticEntity core contract', () => {
  test('normalizes generic entity data without adapter-specific schema knowledge', () => {
    expect(semanticEntity(CUSTOMER)).toEqual(CUSTOMER);
    expect(
      semanticEntity({
        id: 'x',
        artifactId: 'a',
        kind: 'custom',
        metadata: { nested: [{ ok: true }, null, 1] },
      }),
    ).toEqual({
      id: 'x',
      artifactId: 'a',
      kind: 'custom',
      metadata: { nested: [{ ok: true }, null, 1] },
    });
  });

  test('rejects non-JSON metadata, duplicate identities, and provider artifact mismatches', () => {
    expect(() => semanticEntity({ ...CUSTOMER, metadata: { bad: undefined } })).toThrow(
      SemanticEntityError,
    );
    expect(() => normalizeSemanticEntities([CUSTOMER, { ...NAME, id: CUSTOMER.id }])).toThrow(
      /duplicate SemanticEntity id/,
    );
    expect(() =>
      normalizeSemanticEntities([CUSTOMER, { ...NAME, address: CUSTOMER.address }]),
    ).toThrow(/duplicate SemanticEntity address/);
    expect(() => normalizeSemanticEntities([CUSTOMER], { artifactId: 'other' })).toThrow(
      /unexpected artifact/,
    );
  });

  test('scopes duplicate ids and addresses by artifact', () => {
    const other = { ...CUSTOMER, artifactId: 'artifact-bdm-2' };
    expect(normalizeSemanticEntities([CUSTOMER, other])).toHaveLength(2);
  });
});

describe('SemanticEntity resolver', () => {
  const entities = [CUSTOMER, NAME];

  test('resolves by id, address, or consistent id and address within an artifact', () => {
    expect(
      resolveSemanticEntity(entities, {
        artifactId: 'artifact-bdm-1',
        entityId: CUSTOMER.id,
      }),
    ).toEqual(CUSTOMER);
    expect(
      resolveSemanticEntity(entities, {
        artifactId: 'artifact-bdm-1',
        address: NAME.address,
      }),
    ).toEqual(NAME);
    expect(
      resolveSemanticEntity(entities, {
        artifactId: 'artifact-bdm-1',
        entityId: NAME.id,
        address: NAME.address,
      }),
    ).toEqual(NAME);
  });

  test('returns null for ordinary misses and rejects contradictory id/address refs', () => {
    expect(
      resolveSemanticEntity(entities, {
        artifactId: 'artifact-bdm-2',
        entityId: CUSTOMER.id,
      }),
    ).toBeNull();
    expect(
      resolveSemanticEntity(entities, {
        artifactId: 'artifact-bdm-1',
        entityId: 'missing',
        address: NAME.address,
      }),
    ).toBeNull();
    expect(() =>
      resolveSemanticEntity(entities, {
        artifactId: 'artifact-bdm-1',
        entityId: CUSTOMER.id,
        address: NAME.address,
      }),
    ).toThrow(SemanticEntityResolutionError);
  });
});
