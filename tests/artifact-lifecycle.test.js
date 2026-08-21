import { describe, expect, test } from 'vite-plus/test';
import { textContent, workspaceContent } from '../src/core/artifact-content.js';
import {
  artifactDisplayTitle,
  artifactIsShellEmpty,
  nextAvailableArtifactTitle,
} from '../src/client/artifact-lifecycle.js';

describe('artifact lifecycle shell policy', () => {
  test('treats blank BPMN definitions as empty but flow nodes as content', () => {
    expect(
      artifactIsShellEmpty({
        adapterId: 'bpmn',
        content: textContent(
          '<?xml version="1.0"?><bpmn:definitions><bpmn:process id="Process_1" /></bpmn:definitions>',
        ),
      }),
    ).toBe(true);
    expect(
      artifactIsShellEmpty({
        adapterId: 'bpmn',
        content: textContent(
          '<bpmn:definitions><bpmn:process><bpmn:startEvent id="Start" /></bpmn:process></bpmn:definitions>',
        ),
      }),
    ).toBe(false);
  });

  test('uses normal empty semantics for text and workspace adapters', () => {
    expect(artifactIsShellEmpty({ adapterId: 'dagu', content: textContent('') })).toBe(true);
    expect(artifactIsShellEmpty({ adapterId: 'dagu', content: textContent('steps: []\n') })).toBe(
      false,
    );
    expect(
      artifactIsShellEmpty({
        adapterId: 'opa',
        content: workspaceContent({ files: { 'policy.rego': '' } }),
      }),
    ).toBe(true);
  });

  test('renders titles without exposing internal ids and allocates stable ordinals', () => {
    expect(artifactDisplayTitle({ adapterId: 'dagu', title: 'dagu' }, 'Dagu')).toBe('Dagu');
    expect(artifactDisplayTitle({ adapterId: 'dagu', title: 'Daily ETL' }, 'Dagu')).toBe(
      'Daily ETL',
    );
    expect(
      nextAvailableArtifactTitle('dagu', 'Dagu', [
        { adapterId: 'dagu', title: 'Dagu 1' },
        { adapterId: 'dagu', title: 'Dagu 3' },
      ]),
    ).toBe('Dagu 2');
  });
});
