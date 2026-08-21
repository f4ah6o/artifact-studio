# Bonita BDM Adapter

Status: closed
Date: 2026-08-21
Target: As-Code Studio

## Goal

Add Bonita Business Data Model (BDM) as a generic As-Code Studio adapter while keeping Bonita's `bdm/bom.xml` as the canonical source of truth.

As-Code Studio must not invent a second proprietary Business Data Model format.

## Background

Bonita defines the Business Data Model shared by processes and process-based applications. The Studio repository stores the model as `bdm/bom.xml`, marshalled/unmarshalled through Bonita's `BusinessObjectModelConverter`.

Current Bonita sources define at least:

- BusinessObject
- SimpleField
- RelationField
- UniqueConstraint
- Index
- Query / QueryParameter
- RelationType: `AGGREGATION`, `COMPOSITION`
- FetchType: `EAGER`, `LAZY`

An official Bonita getting-started project contains a canonical example such as:

```xml
<businessObjectModel xmlns="http://documentation.bonitasoft.com/bdm-xml-schema/1.0"
                     modelVersion="1.0"
                     productVersion="7.10.0">
  <businessObjects>
    <businessObject qualifiedName="com.company.model.Claim">
      <fields>
        <field type="STRING" length="255" name="description"
               nullable="false" collection="false"/>
      </fields>
      <uniqueConstraints/>
      <queries/>
      <indexes/>
    </businessObject>
  </businessObjects>
</businessObjectModel>
```

## Product boundary

Bonita BDM is an external canonical artifact, analogous to BPMN XML or Rego source.

```text
As-Code Studio
  ├─ BPMN adapter
  ├─ Mermaid adapter
  ├─ OPA adapter
  ├─ Dagu adapter
  └─ Bonita BDM adapter
          canonical = bdm/bom.xml
```

Do not create an As-Code Studio-specific canonical BDM schema.

## MVP

### Adapter identity

- adapter id: `bonita-bdm`
- label: `Bonita BDM`
- canonical content: text XML
- expected filename: `bom.xml`
- input inference must prefer `bom.xml`; arbitrary `.xml` must not steal BPMN files

### Parse / inspect

Parse the canonical XML without mutating it and expose a normalized read model containing:

- modelVersion / productVersion
- Business Objects by qualified name
- fields
  - name
  - primitive type / length
  - nullable
  - collection
  - relation target
  - aggregation/composition
  - eager/lazy when present
- unique constraints
- indexes
- queries at least as metadata

Unknown XML must remain in canonical source and must not be rewritten or dropped.

### Validation

MVP validation is structural/read-only and must fail closed for malformed input.

Minimum checks:

- XML is well formed
- root is `businessObjectModel`
- Business Object has `qualifiedName`
- duplicate qualified names rejected
- field has name
- relation target resolves to an existing Business Object
- duplicate field names inside a Business Object rejected

Do not claim full Bonita Runtime validation equivalence. As-Code Studio does not reimplement Bonita's complete validator set in this issue.

### GraphProjection

Project Business Objects and relations into the existing generic `GraphProjection` contract.

- node = Business Object
- node label = simple class name, with qualified name in metadata
- relation edge = relation field
- edge kind distinguishes `aggregation` / `composition`
- edge metadata may include field name, collection, nullable, fetch type
- primitive fields remain node metadata/view data rather than separate graph nodes in MVP

This projection is derived/read-only; `bom.xml` remains authoritative.

### UI

Provide an adapter-owned view with:

- raw XML source editor/view
- Business Object list/tree
- selected Business Object details and attributes
- graph preview using generic GraphProjection rendering
- validate action
- export preserving the canonical XML source

MVP may keep visual model editing read-only. Editing the raw XML is allowed if generic text editing remains safe.

### Runtime boundary

Use `HostRuntime` for adapter HTTP calls. Do not add direct client `fetch()` calls.

## Non-goals

- inventing a generic AS Business Data Model standard
- generating Java entity / DAO classes
- deploying BDM to Bonita Runtime
- editing Bonita Runtime database contents
- reproducing Bonita Studio's full validation rules
- replacing Bonita's BusinessObjectModelConverter
- rewriting `bom.xml` from a lossy normalized model
- treating BDM as the DDT/Transformation domain model

## Acceptance criteria

- [x] `bonita-bdm` appears as an As-Code Studio adapter.
- [x] `bom.xml` is inferred as Bonita BDM without affecting BPMN XML inference.
- [x] Official-style Bonita BDM XML parses into Business Objects and fields.
- [x] Primitive and relation fields are distinguished.
- [x] aggregation/composition relationships project to GraphProjection.
- [x] malformed XML and unresolved relation references produce explicit findings/errors.
- [x] source XML remains the canonical persisted artifact.
- [x] UI shows source, object details, and relationship graph.
- [x] adapter client uses HostRuntime rather than direct fetch.
- [x] tests cover parsing, validation, projection, adapter inference, HTTP route, and lazy client activation.
- [x] `vp check`, `vp test --run`, and `vp build` pass.

## Evidence / references

- Bonita Studio source: `BusinessDataModel.ecore` describes BusinessObject, Field, RelationField, constraints, indexes and queries.
- Bonita Studio source: `BusinessObjectModelFileStore.BOM_FILENAME = "bom.xml"` and uses `BusinessObjectModelConverter` to unmarshall/marshall it.
- Bonitasoft Community getting-started project: `bdm/bom.xml` provides a real canonical example.

## Completion evidence

Implemented in As-Code Studio as a canonical-source Bonita BDM adapter.

- `bdm/bom.xml` remains authoritative; no As-Code Studio-specific BDM schema was introduced.
- Added structural XML parsing/validation, Business Object inspection, relation `GraphProjection`, lazy UI integration, and lossless source export.
- Exact `bom.xml` filename inference does not claim arbitrary XML files.
- Client adapter actions use the generic `HostRuntime` boundary.
- `vp check`: pass (0 errors; pre-existing repository warnings remain).
- `vp test --run`: 445 passed, 1 skipped.
- `vp build`: pass.
- `git diff --check`: pass.
