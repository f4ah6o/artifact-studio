import { describe, expect, test } from 'vite-plus/test';
import { resolveStudioConfig } from '../src/server/studio-config.js';

describe('resolveStudioConfig', () => {
  test('uses configured adapter list and default', () => {
    expect(
      resolveStudioConfig(
        {},
        {
          studio: { defaultAdapter: 'mermaid', enabledAdapters: ['bpmn', 'mermaid', 'opa'] },
        },
      ),
    ).toEqual({ defaultAdapter: 'mermaid', enabledAdapters: ['bpmn', 'mermaid', 'opa'] });
  });

  test('environment overrides studio config', () => {
    expect(
      resolveStudioConfig(
        {
          ARTIFACT_STUDIO_DEFAULT_ADAPTER: 'opa',
          ARTIFACT_STUDIO_ENABLED_ADAPTERS: 'opa,mermaid,bpmn',
        },
        {
          studio: { defaultAdapter: 'bpmn', enabledAdapters: ['bpmn'] },
        },
      ),
    ).toEqual({ defaultAdapter: 'opa', enabledAdapters: ['opa', 'mermaid', 'bpmn'] });
  });

  test('drops unknown adapters and repairs an invalid default', () => {
    expect(
      resolveStudioConfig(
        {},
        {
          studio: { defaultAdapter: 'unknown', enabledAdapters: ['unknown', 'opa'] },
        },
      ),
    ).toEqual({ defaultAdapter: 'opa', enabledAdapters: ['opa'] });
  });
});
