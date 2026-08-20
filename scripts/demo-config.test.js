import { describe, expect, test } from '@jest/globals';
import { resolveDemoConfig } from './demo-config.js';

describe('resolveDemoConfig', () => {
  test('uses configured adapter list and default', () => {
    expect(resolveDemoConfig({}, {
      demo: { defaultAdapter: 'mermaid', enabledAdapters: ['bpmn', 'mermaid'] },
    })).toEqual({ defaultAdapter: 'mermaid', enabledAdapters: ['bpmn', 'mermaid'] });
  });

  test('environment overrides demo config', () => {
    expect(resolveDemoConfig({
      ARTIFACT_STUDIO_DEFAULT_ADAPTER: 'mermaid',
      ARTIFACT_STUDIO_ENABLED_ADAPTERS: 'mermaid,bpmn',
    }, {
      demo: { defaultAdapter: 'bpmn', enabledAdapters: ['bpmn'] },
    })).toEqual({ defaultAdapter: 'mermaid', enabledAdapters: ['mermaid', 'bpmn'] });
  });

  test('drops unknown adapters and repairs an invalid default', () => {
    expect(resolveDemoConfig({}, {
      demo: { defaultAdapter: 'unknown', enabledAdapters: ['unknown', 'mermaid'] },
    })).toEqual({ defaultAdapter: 'mermaid', enabledAdapters: ['mermaid'] });
  });
});
