import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vite-plus/test';
import {
  BonitaBdmSourceError,
  bonitaBdmGraphProjection,
  inspectBonitaBdm,
  validateBonitaBdmSource,
} from '../../src/adapters/bonita-bdm.js';

const SAMPLE_BOM = readFileSync(
  new URL('../../examples/bonita-bdm/bom.xml', import.meta.url),
  'utf8',
);

const OFFICIAL_STYLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<businessObjectModel xmlns="http://documentation.bonitasoft.com/bdm-xml-schema/1.0" modelVersion="1.0" productVersion="7.10.0">
  <businessObjects>
    <businessObject qualifiedName="com.company.model.Claim">
      <fields>
        <field type="STRING" length="255" name="description" nullable="false" collection="false"/>
        <field type="INTEGER" length="255" name="satisfactionLevel" nullable="true" collection="false"/>
      </fields>
      <uniqueConstraints>
        <uniqueConstraint name="uniqueDescription"><fieldNames><fieldName>description</fieldName></fieldNames></uniqueConstraint>
      </uniqueConstraints>
      <queries>
        <query name="findByDescription" content="SELECT c FROM Claim c" returnType="java.util.List">
          <queryParameters><queryParameter name="description" className="java.lang.String"/></queryParameters>
        </query>
      </queries>
      <indexes><index name="IDX_DESCRIPTION"><fieldNames><fieldName>description</fieldName></fieldNames></index></indexes>
    </businessObject>
  </businessObjects>
</businessObjectModel>`;

const RELATIONS = `<?xml version="1.0" encoding="UTF-8"?>
<businessObjectModel modelVersion="1.0" productVersion="2026.1">
  <businessObjects>
    <businessObject qualifiedName="com.company.model.PurchaseOrder">
      <fields>
        <field type="STRING" length="255" name="number" nullable="false" collection="false"/>
        <relationField type="COMPOSITION" reference="com.company.model.OrderItem" fetchType="EAGER" name="items" nullable="false" collection="true"/>
      </fields>
      <uniqueConstraints/><queries/><indexes/>
    </businessObject>
    <businessObject qualifiedName="com.company.model.OrderItem">
      <fields>
        <field type="INTEGER" length="255" name="quantity" nullable="false" collection="false"/>
        <relationField type="AGGREGATION" reference="com.company.model.Product" fetchType="LAZY" name="product" nullable="false" collection="false"/>
      </fields>
      <uniqueConstraints/><queries/><indexes/>
    </businessObject>
    <businessObject qualifiedName="com.company.model.Product">
      <fields><field type="STRING" length="255" name="name" nullable="false" collection="false"/></fields>
      <uniqueConstraints/><queries/><indexes/>
    </businessObject>
  </businessObjects>
</businessObjectModel>`;

describe('Bonita BDM adapter', () => {
  test('ships a parseable onboarding sample with aggregation and composition', () => {
    const model = inspectBonitaBdm(SAMPLE_BOM);
    expect(model.errors).toEqual([]);
    expect(model.businessObjects.map((item) => item.simpleName)).toEqual([
      'Customer',
      'Order',
      'OrderLine',
    ]);
    expect(
      bonitaBdmGraphProjection(SAMPLE_BOM)
        .edges.map((edge) => edge.kind)
        .sort(),
    ).toEqual(['aggregation', 'composition']);
  });

  test('parses official-style bom.xml without changing canonical source semantics', () => {
    const model = inspectBonitaBdm(OFFICIAL_STYLE);
    expect(model).toMatchObject({
      modelVersion: '1.0',
      productVersion: '7.10.0',
      namespace: 'http://documentation.bonitasoft.com/bdm-xml-schema/1.0',
      errors: [],
      warnings: [],
    });
    expect(model.businessObjects).toHaveLength(1);
    expect(model.businessObjects[0]).toMatchObject({
      qualifiedName: 'com.company.model.Claim',
      simpleName: 'Claim',
      fields: [
        { kind: 'simple', name: 'description', type: 'STRING', nullable: false, collection: false },
        { kind: 'simple', name: 'satisfactionLevel', type: 'INTEGER', nullable: true },
      ],
      uniqueConstraints: [{ name: 'uniqueDescription', fieldNames: ['description'] }],
      indexes: [{ name: 'IDX_DESCRIPTION', fieldNames: ['description'] }],
    });
    expect(model.businessObjects[0].queries[0]).toMatchObject({
      name: 'findByDescription',
      returnType: 'java.util.List',
      parameters: [{ name: 'description', className: 'java.lang.String' }],
    });
  });

  test('distinguishes composition and aggregation relation fields and projects them', () => {
    const model = inspectBonitaBdm(RELATIONS);
    const order = model.businessObjects[0];
    expect(order.fields[1]).toMatchObject({
      kind: 'relation',
      name: 'items',
      reference: 'com.company.model.OrderItem',
      relationType: 'COMPOSITION',
      fetchType: 'EAGER',
      collection: true,
    });

    const graph = bonitaBdmGraphProjection(RELATIONS);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'composition',
          metadata: expect.objectContaining({ fieldName: 'items' }),
        }),
        expect.objectContaining({
          kind: 'aggregation',
          metadata: expect.objectContaining({ fieldName: 'product' }),
        }),
      ]),
    );
  });

  test('reports malformed XML, duplicate fields, and unknown relation targets explicitly', () => {
    expect(validateBonitaBdmSource('<not-bdm/>').errors[0].code).toBe('BONITA_BDM_ROOT_INVALID');
    expect(validateBonitaBdmSource('<businessObjectModel>').errors[0].code).toBe(
      'BONITA_BDM_XML_INVALID',
    );

    const invalid = `<businessObjectModel><businessObjects>
      <businessObject qualifiedName="a.A"><fields>
        <field type="STRING" name="same"/><field type="STRING" name="same"/>
        <relationField name="missing" reference="a.Missing" type="AGGREGATION"/>
      </fields><uniqueConstraints/><queries/><indexes/></businessObject>
    </businessObjects></businessObjectModel>`;
    const result = inspectBonitaBdm(invalid);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['BONITA_BDM_FIELD_DUPLICATE', 'BONITA_BDM_RELATION_TARGET_UNKNOWN']),
    );
    expect(() => bonitaBdmGraphProjection(invalid)).toThrow(BonitaBdmSourceError);
  });
});
