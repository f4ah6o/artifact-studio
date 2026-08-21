# Bonita BDM SemanticEntity Provider

Status: open
Date: 2026-08-21
Target: As-Code Studio Architecture Graph semantic infrastructure
Parent: `issues/open/20260820-architecture-graph-semantic-model.md`

## Goal

Implement the first generic `SemanticEntity` exposure slice for Architecture Graph by using Bonita BDM (`bdm/bom.xml`) as the first real provider.

This issue proves the boundary:

```text
Bonita bom.xml
    ↓
Bonita BDM adapter
    ↓
SemanticEntity[]
    ↓
generic resolver
```

The canonical Bonita `bom.xml` remains authoritative. Semantic entities are derived on demand and are not persisted as copied model data in the workspace.

## Scope

Implement:

1. a minimal generic `SemanticEntity` contract in core;
2. a formal adapter capability for semantic entities;
3. Bonita BDM Business Object and field entity exposure;
4. browser/host/server routing for the Bonita provider;
5. a generic `SemanticRef -> SemanticEntity` resolver;
6. deterministic identity, duplicate detection, fail-closed validation, and tests.

Do not implement Architecture Graph UI or semantic relationship projection in this issue.

## Generic contract

Create a generic core contract equivalent to:

```ts
interface SemanticEntity {
  id: string;
  artifactId: string;
  kind: string;
  label?: string;
  address?: string;
  metadata?: Record<string, unknown>;
}
```

Rules:

- `id`, `artifactId`, and `kind` are required non-empty strings.
- `label` and `address` are optional.
- `metadata` is adapter-owned but must be JSON-safe plain data.
- Core does not define Bonita-specific metadata fields.
- Entity list ordering has no semantic meaning; providers should nevertheless return deterministic output.

## Identity

Semantic entity identity is scoped to an Artifact.

```text
(artifactId, entityId)
```

`entityId` is not required to be globally unique across a workspace or repository.

`address` is a logical, human-readable address when the source format can provide one. It is optional in the generic contract but Bonita entities must provide it.

Within one Artifact:

- duplicate `entityId` is invalid;
- duplicate `address` is invalid;
- provider output referring to another `artifactId` is a contract violation.

All such violations fail closed.

## Adapter capability

Make semantic entity exposure an explicit generic adapter capability.

Conceptually:

```text
capabilities.semanticEntities = true
runtime.semanticEntities(artifact)
```

Do not implement it as a Bonita-only runtime convention.

## Bonita provider

Expose exactly these entity kinds in the first slice:

```text
business-object
field
```

Do not expose queries, indexes, or unique constraints as entities yet.

### Business Object identity

Use adapter-owned deterministic identity and keep it aligned with the existing Bonita Business Object GraphProjection identity where practical.

Example:

```text
id:      bonita-bdm:com.example.Customer
address: com.example.Customer
kind:    business-object
label:   Customer
```

The canonical qualified name is the logical address.

Business Object metadata may include:

- `qualifiedName`
- `description`
- `uniqueConstraints`
- `indexes`
- `queries`

These remain Bonita-owned metadata rather than new generic semantic entity types.

### Field identity

Expose both simple and relation fields as generic `field` entities.

Example:

```text
id:      bonita-bdm:com.example.Customer#field:name
address: com.example.Customer#name
kind:    field
label:   name
```

Use `#` as the Business Object / field address boundary so a Java qualified class name remains unambiguous.

Simple field metadata:

```text
fieldKind
 type
 length
 nullable
 collection
 description
```

Relation field metadata:

```text
fieldKind
 reference
 relationType
 fetchType
 nullable
 collection
 description
```

Relation `reference` remains the Bonita qualified name in this issue. Do not create a generic `SemanticRef` or `contains` relationship from it yet.

## Source validation

Semantic entity exposure is fail-closed for structurally invalid BDM.

Examples that prevent entity exposure:

- duplicate Business Object qualified name;
- duplicate field name;
- missing required names;
- unknown relation target;
- malformed XML.

Warnings alone do not prevent entity exposure.

## Generic resolver

Provide a generic resolver equivalent to:

```ts
resolveSemanticEntity(entities, ref)
  => SemanticEntity | null
```

Resolution rules:

- `artifactId` is always part of matching;
- `entityId` only: resolve by id;
- `address` only: resolve by logical address;
- both supplied: both must identify the same entity;
- not found: return `null`;
- `entityId` and `address` resolving to different entities: throw `SemanticEntityResolutionError`.

The provider exposes an entity list only. Do not require each adapter to implement its own semantic-reference resolver.

## Host/runtime boundary

The browser must not acquire a second Bonita XML parser.

Use the existing HostRuntime artifact action boundary:

```text
runtime.semanticEntities(artifact)
  ↓
HostRuntime.artifactAction('bonita-bdm', 'entities')
  ↓
POST /api/v1/artifacts/bonita-bdm/entities
  ↓
Bonita adapter
```

Request:

```json
{
  "source": "<businessObjectModel ...>"
}
```

Response:

```json
{
  "status": "success",
  "entities": []
}
```

Keep `/inspect` as a Bonita-specific normalized-model API. Generic runtime code must not interpret the Bonita inspect structure.

## Persistence

Do not persist copied `SemanticEntity` bodies into Artifact Workspace.

Persisted semantic relationships continue to refer through existing `SemanticRef` values. Consumers may derive entities from the canonical artifact when resolving those refs.

## Explicit non-goals

This issue does not implement:

- `contains` relationships between Business Object and field;
- conversion of Bonita relation fields into generic relationships;
- integration with `validateArtifactRelationshipReferences()`;
- relationship-to-GraphProjection projection;
- generic graph traversal;
- Architecture Graph UI;
- SemanticEntity list/inspector UI;
- query/index/constraint entity types;
- a generic As-Code Studio BDM canonical schema;
- workspace-global semantic entity UUIDs;
- reverse synchronization into `bom.xml`.

## Acceptance criteria

- [ ] generic `SemanticEntity` normalize/validation contract exists in core;
- [ ] semantic entity exposure is an explicit adapter capability;
- [ ] Bonita BDM provides deterministic Business Object entities;
- [ ] Bonita BDM provides deterministic simple/relation field entities;
- [ ] Business Object IDs remain aligned with the existing Bonita graph node identity;
- [ ] entity identity is scoped by `artifactId`;
- [ ] duplicate id/address and wrong-artifact provider output fail closed;
- [ ] generic resolver supports id, address, and consistent id+address resolution;
- [ ] resolver returns null for ordinary not-found refs and errors on contradictory refs;
- [ ] structurally invalid Bonita BDM does not expose partial entity output;
- [ ] browser runtime uses HostRuntime rather than a browser-side Bonita parser;
- [ ] `/api/v1/artifacts/bonita-bdm/entities` returns generic entities;
- [ ] existing ArtifactRelationship/SemanticRef behavior remains unchanged;
- [ ] no Architecture Graph UI or generic BDM schema is introduced;
- [ ] existing adapters/tests/build remain green.

## Follow-up

After this proof is complete, the next Architecture Graph slice may consume the provider/resolver to:

1. resolve persisted `ArtifactRelationship` / `SemanticRef` endpoints;
2. project relationships into generic `GraphProjection`;
3. add generic traversal;
4. add read-only Architecture Graph UI.
