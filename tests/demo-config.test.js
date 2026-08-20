import { describe, expect, test } from 'vite-plus/test';
import { resolveDemoConfig } from '../src/server/demo-config.js';

describe('resolveDemoConfig', () => {
  test('uses configured adapter list and default', () => {
    expect(
      resolveDemoConfig(
        {},
        {
          demo: { defaultAdapter: 'mermaid', enabledAdapters: ['bpmn', 'mermaid', 'opa'] },
        },
      ),
    ).toEqual({ defaultAdapter: 'mermaid', enabledAdapters: ['bpmn', 'mermaid', 'opa'] });
  });

  test('environment overrides demo config', () => {
    expect(
      resolveDemoConfig(
        {
          ARTIFACT_STUDIO_DEFAULT_ADAPTER: 'opa',
          ARTIFACT_STUDIO_ENABLED_ADAPTERS: 'opa,mermaid,bpmn',
        },
        {
          demo: { defaultAdapter: 'bpmn', enabledAdapters: ['bpmn'] },
        },
      ),
    ).toEqual({ defaultAdapter: 'opa', enabledAdapters: ['opa', 'mermaid', 'bpmn'] });
  });

  test('drops unknown adapters and repairs an invalid default', () => {
    expect(
      resolveDemoConfig(
        {},
        {
          demo: { defaultAdapter: 'unknown', enabledAdapters: ['unknown', 'opa'] },
        },
      ),
    ).toEqual({ defaultAdapter: 'opa', enabledAdapters: ['opa'] });
  });
});
