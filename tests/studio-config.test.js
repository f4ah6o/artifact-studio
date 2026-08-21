import { describe, expect, test } from 'vite-plus/test';
import { resolveStudioConfig } from '../src/server/studio-config.js';

describe('resolveStudioConfig', () => {
  test('uses configured adapter list and default', () => {
    expect(
      resolveStudioConfig(
        {},
        {
          studio: {
            defaultAdapter: 'mermaid',
            enabledAdapters: ['bpmn', 'mermaid', 'opa', 'dagu'],
          },
        },
      ),
    ).toEqual({
      defaultAdapter: 'mermaid',
      enabledAdapters: ['bpmn', 'mermaid', 'opa', 'dagu'],
    });
  });

  test('environment overrides studio config', () => {
    expect(
      resolveStudioConfig(
        {
          AS_CODE_STUDIO_DEFAULT_ADAPTER: 'dagu',
          AS_CODE_STUDIO_ENABLED_ADAPTERS: 'dagu,opa,mermaid,bpmn',
        },
        {
          studio: { defaultAdapter: 'bpmn', enabledAdapters: ['bpmn'] },
        },
      ),
    ).toEqual({
      defaultAdapter: 'dagu',
      enabledAdapters: ['dagu', 'opa', 'mermaid', 'bpmn'],
    });
  });

  test('accepts legacy Artifact Studio environment variables as compatibility aliases', () => {
    expect(
      resolveStudioConfig({
        ARTIFACT_STUDIO_DEFAULT_ADAPTER: 'opa',
        ARTIFACT_STUDIO_ENABLED_ADAPTERS: 'opa,bpmn',
      }),
    ).toEqual({ defaultAdapter: 'opa', enabledAdapters: ['opa', 'bpmn'] });
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

  test('enables all built-in adapters by default when no adapter list is configured', () => {
    expect(resolveStudioConfig()).toEqual({
      defaultAdapter: 'bpmn',
      enabledAdapters: ['bpmn', 'mermaid', 'opa', 'dagu', 'bonita-bdm'],
    });
  });
});
