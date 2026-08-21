import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vite-plus/test';

const mainSource = readFileSync(new URL('../src/client/main.js', import.meta.url), 'utf8');
const adapterSource = readFileSync(
  new URL('../src/client/artifact-adapters.js', import.meta.url),
  'utf8',
);
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('client adapter lazy loading', () => {
  test('BPMN modeler is dynamically imported outside the shell entry', () => {
    expect(mainSource).not.toContain("from 'bpmn-js");
    expect(mainSource).toContain("import('./bpmn-runtime.js')");
  });

  test('Mermaid runtime remains dynamically imported', () => {
    expect(adapterSource).toContain("import('mermaid')");
    expect(adapterSource).not.toContain("from 'mermaid'");
    expect(adapterSource).not.toContain('from "mermaid"');
  });

  test('OPA and Dagu browser extensions are not eager index entries', () => {
    expect(indexSource).not.toContain('/src/client/opa-extension.js');
    expect(indexSource).not.toContain('/src/client/dagu-extension.js');
    expect(mainSource).toContain("opa: () => import('./opa-extension.js')");
    expect(mainSource).toContain("dagu: () => import('./dagu-extension.js')");
  });
});
