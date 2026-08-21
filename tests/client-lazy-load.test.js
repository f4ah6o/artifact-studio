import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vite-plus/test';

const mainSource = readFileSync(new URL('../src/client/main.js', import.meta.url), 'utf8');
const adapterSource = readFileSync(
  new URL('../src/client/artifact-adapters.js', import.meta.url),
  'utf8',
);
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const kumoBootstrapSource = readFileSync(
  new URL('../src/client/kumo-bootstrap.jsx', import.meta.url),
  'utf8',
);
const themeSource = readFileSync(
  new URL('../src/client/as-code-studio-theme.css', import.meta.url),
  'utf8',
);
const bonitaBdmExtensionSource = readFileSync(
  new URL('../src/client/bonita-bdm-extension.js', import.meta.url),
  'utf8',
);

describe('client adapter lazy loading', () => {
  test('BPMN modeler is dynamically imported outside the shell entry', () => {
    expect(mainSource).not.toContain("from 'bpmn-js");
    expect(mainSource).toContain("import('./bpmn-runtime.js')");
  });

  test('BPMN semantic entity provider delegates parsing through HostRuntime', () => {
    expect(mainSource).toContain("hostRuntime().artifactAction('bpmn', 'entities'");
    expect(mainSource).toContain('semanticEntities(artifact)');
  });

  test('Mermaid runtime remains dynamically imported', () => {
    expect(adapterSource).toContain("import('mermaid')");
    expect(adapterSource).not.toContain("from 'mermaid'");
    expect(adapterSource).not.toContain('from "mermaid"');
  });

  test('Mermaid rendering does not require crypto.randomUUID', () => {
    expect(adapterSource).not.toContain('crypto.randomUUID');
    expect(adapterSource).toContain('mermaidRenderSequence += 1');
  });

  test('OPA, Dagu, and Bonita BDM browser extensions are not eager index entries', () => {
    expect(indexSource).not.toContain('/src/client/opa-extension.js');
    expect(indexSource).not.toContain('/src/client/dagu-extension.js');
    expect(indexSource).not.toContain('/src/client/bonita-bdm-extension.js');
    expect(mainSource).toContain("opa: () => import('./opa-extension.js')");
    expect(mainSource).toContain("dagu: () => import('./dagu-extension.js')");
    expect(mainSource).toContain("'bonita-bdm': () => import('./bonita-bdm-extension.js')");
    const bonitaExtensionSource = readFileSync(
      new URL('../src/client/bonita-bdm-extension.js', import.meta.url),
      'utf8',
    );
    expect(indexSource).toContain('id="bonita-bdm-load-sample"');
    expect(bonitaExtensionSource).toContain('../../examples/bonita-bdm/bom.xml?raw');
  });

  test('Bonita BDM semantic entities are an explicit HostRuntime-backed capability', () => {
    expect(adapterSource).toContain('semanticEntities: true');
    expect(bonitaBdmExtensionSource).toContain("hostRuntime().artifactAction('bonita-bdm'");
    expect(bonitaBdmExtensionSource).toContain("artifactAction('bonita-bdm', 'entities'");
    expect(bonitaBdmExtensionSource).toContain('artifactId: artifact.id');
    expect(bonitaBdmExtensionSource).not.toContain('fetch(');
  });

  test('Kumo shell uses granular components and preserves adapter runtime boundaries', () => {
    expect(indexSource).toContain('/src/client/kumo-bootstrap.jsx');
    expect(kumoBootstrapSource).toContain('@cloudflare/kumo/components/button');
    expect(kumoBootstrapSource).not.toContain("from '@cloudflare/kumo';");
    expect(kumoBootstrapSource).toContain('@cloudflare/kumo/styles/standalone');
    expect(kumoBootstrapSource).toContain("await import('./main.js')");
    expect(themeSource).toContain("data-theme='as-code-studio'");
    expect(themeSource).toContain('--color-kumo-brand: #1d4ed8;');
  });
});
