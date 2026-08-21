import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { normalizeGraphProjection } from '../core/graph-projection.js';
import { normalizeSemanticEntities } from '../core/semantic-entity.js';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const ARRAY_TAGS = new Set([
  'businessObject',
  'field',
  'relationField',
  'uniqueConstraint',
  'index',
  'query',
  'queryParameter',
  'fieldName',
]);

export class BonitaBdmSourceError extends Error {
  constructor(message, code = 'BONITA_BDM_SOURCE_INVALID', details = {}) {
    super(message);
    this.name = 'BonitaBdmSourceError';
    this.code = code;
    Object.assign(this, details);
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

function sourceText(source) {
  const text = String(source ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES) {
    throw new BonitaBdmSourceError(
      `Bonita BDM source exceeds ${MAX_SOURCE_BYTES} bytes`,
      'BONITA_BDM_SOURCE_TOO_LARGE',
    );
  }
  return text;
}

function scalar(value, fallback = '') {
  return value == null ? fallback : String(value);
}

function booleanValue(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function arrayAt(value, key) {
  if (!value || typeof value !== 'object') return [];
  const item = value[key];
  if (Array.isArray(item)) return item;
  if (item == null || item === '') return [];
  return [item];
}

function fieldNames(container) {
  return arrayAt(container?.fieldNames, 'fieldName')
    .map((name) => scalar(name))
    .filter(Boolean);
}

function simpleName(qualifiedName) {
  return qualifiedName.split('.').at(-1) || qualifiedName;
}

function businessObjectEntityId(qualifiedName) {
  return `bonita-bdm:${encodeURIComponent(qualifiedName)}`;
}

function fieldEntityId(qualifiedName, fieldName) {
  return `${businessObjectEntityId(qualifiedName)}#field:${encodeURIComponent(fieldName)}`;
}

function normalizeSimpleField(field) {
  return {
    kind: 'simple',
    name: scalar(field?.name || field?.id),
    type: scalar(field?.type, 'STRING'),
    length: field?.length == null || field.length === '' ? null : Number(field.length),
    nullable: booleanValue(field?.nullable, true),
    collection: booleanValue(field?.collection, false),
    description: scalar(field?.description) || null,
  };
}

function normalizeRelationField(field) {
  return {
    kind: 'relation',
    name: scalar(field?.name || field?.id),
    reference: scalar(field?.reference),
    relationType: scalar(field?.type, 'AGGREGATION').toUpperCase(),
    fetchType: scalar(field?.fetchType, 'LAZY').toUpperCase(),
    nullable: booleanValue(field?.nullable, true),
    collection: booleanValue(field?.collection, false),
    description: scalar(field?.description) || null,
  };
}

function normalizeConstraints(container) {
  return arrayAt(container, 'uniqueConstraint').map((constraint) => ({
    name: scalar(constraint?.name || constraint?.id),
    description: scalar(constraint?.description) || null,
    fieldNames: fieldNames(constraint),
  }));
}

function normalizeIndexes(container) {
  return arrayAt(container, 'index').map((index) => ({
    name: scalar(index?.name || index?.id),
    description: scalar(index?.description) || null,
    fieldNames: fieldNames(index),
  }));
}

function normalizeQueries(container) {
  return arrayAt(container, 'query').map((query) => ({
    name: scalar(query?.name || query?.id),
    description: scalar(query?.description) || null,
    content: scalar(query?.content),
    returnType: scalar(query?.returnType),
    parameters: arrayAt(query?.queryParameters, 'queryParameter').map((parameter) => ({
      name: scalar(parameter?.name),
      className: scalar(parameter?.className),
      description: scalar(parameter?.description) || null,
    })),
  }));
}

function finding(code, message, path = '') {
  return { code, message, path };
}

function parsedRoot(source) {
  const text = sourceText(source);
  if (!text.trim()) {
    throw new BonitaBdmSourceError('Bonita BDM source is empty', 'BONITA_BDM_SOURCE_EMPTY');
  }
  const valid = XMLValidator.validate(text, { allowBooleanAttributes: false });
  if (valid !== true) {
    const detail = valid?.err?.msg || 'Malformed XML';
    throw new BonitaBdmSourceError(`Invalid Bonita BDM XML: ${detail}`, 'BONITA_BDM_XML_INVALID', {
      line: valid?.err?.line,
      col: valid?.err?.col,
    });
  }
  let document;
  try {
    document = parser.parse(text);
  } catch (error) {
    throw new BonitaBdmSourceError(
      `Invalid Bonita BDM XML: ${error.message}`,
      'BONITA_BDM_XML_INVALID',
    );
  }
  if (!document?.businessObjectModel || typeof document.businessObjectModel !== 'object') {
    throw new BonitaBdmSourceError(
      'Bonita BDM root element must be businessObjectModel',
      'BONITA_BDM_ROOT_INVALID',
    );
  }
  return document.businessObjectModel;
}

export function inspectBonitaBdm(source) {
  const root = parsedRoot(source);
  const errors = [];
  const warnings = [];
  const objects = arrayAt(root.businessObjects, 'businessObject').map(
    (businessObject, objectIndex) => {
      const qualifiedName = scalar(businessObject?.qualifiedName);
      if (!qualifiedName) {
        errors.push(
          finding(
            'BONITA_BDM_OBJECT_NAME_REQUIRED',
            'Business Object qualifiedName is required',
            `businessObjects[${objectIndex}]`,
          ),
        );
      }
      const fields = [
        ...arrayAt(businessObject?.fields, 'field').map(normalizeSimpleField),
        ...arrayAt(businessObject?.fields, 'relationField').map(normalizeRelationField),
      ];
      const fieldNamesSeen = new Set();
      fields.forEach((field, fieldIndex) => {
        if (!field.name) {
          errors.push(
            finding(
              'BONITA_BDM_FIELD_NAME_REQUIRED',
              `Field name is required in ${qualifiedName || `Business Object ${objectIndex + 1}`}`,
              `businessObjects[${objectIndex}].fields[${fieldIndex}]`,
            ),
          );
          return;
        }
        if (fieldNamesSeen.has(field.name)) {
          errors.push(
            finding(
              'BONITA_BDM_FIELD_DUPLICATE',
              `Duplicate field ${field.name} in ${qualifiedName}`,
              `businessObjects[${objectIndex}].fields[${fieldIndex}]`,
            ),
          );
        }
        fieldNamesSeen.add(field.name);
      });
      return {
        qualifiedName,
        simpleName: simpleName(qualifiedName),
        description: scalar(businessObject?.description) || null,
        fields,
        uniqueConstraints: normalizeConstraints(businessObject?.uniqueConstraints),
        indexes: normalizeIndexes(businessObject?.indexes),
        queries: normalizeQueries(businessObject?.queries),
      };
    },
  );

  const byName = new Map();
  objects.forEach((businessObject, index) => {
    if (!businessObject.qualifiedName) return;
    if (byName.has(businessObject.qualifiedName)) {
      errors.push(
        finding(
          'BONITA_BDM_OBJECT_DUPLICATE',
          `Duplicate Business Object ${businessObject.qualifiedName}`,
          `businessObjects[${index}]`,
        ),
      );
    } else {
      byName.set(businessObject.qualifiedName, businessObject);
    }
  });

  for (const [objectIndex, businessObject] of objects.entries()) {
    for (const [fieldIndex, field] of businessObject.fields.entries()) {
      if (field.kind !== 'relation') continue;
      if (!field.reference || !byName.has(field.reference)) {
        errors.push(
          finding(
            'BONITA_BDM_RELATION_TARGET_UNKNOWN',
            `Relation ${businessObject.qualifiedName}.${field.name} references unknown Business Object ${field.reference || '(empty)'}`,
            `businessObjects[${objectIndex}].fields[${fieldIndex}]`,
          ),
        );
      }
      if (!['AGGREGATION', 'COMPOSITION'].includes(field.relationType)) {
        warnings.push(
          finding(
            'BONITA_BDM_RELATION_TYPE_UNKNOWN',
            `Unknown relation type ${field.relationType} on ${businessObject.qualifiedName}.${field.name}`,
            `businessObjects[${objectIndex}].fields[${fieldIndex}]`,
          ),
        );
      }
    }
  }

  return {
    modelVersion: scalar(root.modelVersion) || null,
    productVersion: scalar(root.productVersion) || null,
    namespace: scalar(root.xmlns) || null,
    businessObjects: objects,
    errors,
    warnings,
  };
}

export function validateBonitaBdmSource(source) {
  try {
    const model = inspectBonitaBdm(source);
    return { errors: model.errors, warnings: model.warnings };
  } catch (error) {
    if (!(error instanceof BonitaBdmSourceError)) throw error;
    return {
      errors: [finding(error.code, error.message)],
      warnings: [],
    };
  }
}

export function bonitaBdmSemanticEntities(source, artifactId) {
  const normalizedArtifactId = String(artifactId || '').trim();
  if (!normalizedArtifactId) {
    throw new BonitaBdmSourceError(
      'Bonita BDM semantic entity exposure requires artifactId',
      'BONITA_BDM_ARTIFACT_ID_REQUIRED',
    );
  }
  const model = inspectBonitaBdm(source);
  if (model.errors.length) {
    throw new BonitaBdmSourceError(
      `Bonita BDM contains ${model.errors.length} structural error(s)`,
      'BONITA_BDM_STRUCTURE_INVALID',
      { findings: model.errors },
    );
  }

  const entities = [];
  for (const businessObject of model.businessObjects) {
    entities.push({
      id: businessObjectEntityId(businessObject.qualifiedName),
      artifactId: normalizedArtifactId,
      kind: 'business-object',
      label: businessObject.simpleName || businessObject.qualifiedName,
      address: businessObject.qualifiedName,
      metadata: {
        qualifiedName: businessObject.qualifiedName,
        description: businessObject.description,
        uniqueConstraints: businessObject.uniqueConstraints,
        indexes: businessObject.indexes,
        queries: businessObject.queries,
      },
    });
    for (const field of businessObject.fields) {
      const metadata =
        field.kind === 'relation'
          ? {
              fieldKind: 'relation',
              reference: field.reference,
              relationType: field.relationType,
              fetchType: field.fetchType,
              nullable: field.nullable,
              collection: field.collection,
              description: field.description,
            }
          : {
              fieldKind: 'simple',
              type: field.type,
              length: field.length,
              nullable: field.nullable,
              collection: field.collection,
              description: field.description,
            };
      entities.push({
        id: fieldEntityId(businessObject.qualifiedName, field.name),
        artifactId: normalizedArtifactId,
        kind: 'field',
        label: field.name,
        address: `${businessObject.qualifiedName}#${field.name}`,
        metadata,
      });
    }
  }
  return normalizeSemanticEntities(entities, { artifactId: normalizedArtifactId });
}

export function bonitaBdmGraphProjection(source) {
  const model = inspectBonitaBdm(source);
  if (model.errors.length) {
    throw new BonitaBdmSourceError(
      `Bonita BDM contains ${model.errors.length} structural error(s)`,
      'BONITA_BDM_STRUCTURE_INVALID',
      { findings: model.errors },
    );
  }
  const nodes = model.businessObjects.map((businessObject) => ({
    id: businessObjectEntityId(businessObject.qualifiedName),
    label: businessObject.simpleName || businessObject.qualifiedName,
    kind: 'business-object',
    metadata: {
      qualifiedName: businessObject.qualifiedName,
      fields: businessObject.fields
        .filter((field) => field.kind === 'simple')
        .map((field) => ({
          name: field.name,
          type: field.type,
          nullable: field.nullable,
          collection: field.collection,
        })),
    },
  }));
  const idByQualifiedName = new Map(
    model.businessObjects.map((businessObject) => [
      businessObject.qualifiedName,
      businessObjectEntityId(businessObject.qualifiedName),
    ]),
  );
  const edges = [];
  for (const businessObject of model.businessObjects) {
    for (const field of businessObject.fields) {
      if (field.kind !== 'relation') continue;
      edges.push({
        from: idByQualifiedName.get(businessObject.qualifiedName),
        to: idByQualifiedName.get(field.reference),
        kind: field.relationType.toLowerCase(),
        metadata: {
          fieldName: field.name,
          collection: field.collection,
          nullable: field.nullable,
          fetchType: field.fetchType,
        },
      });
    }
  }
  return normalizeGraphProjection({ nodes, edges });
}
