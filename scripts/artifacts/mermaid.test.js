import { describe, expect, test, vi } from 'vite-plus/test';
import { extractMermaidSource, generateMermaidArtifact } from './mermaid.js';

describe('Mermaid artifact generation', () => {
  test('extracts a fenced Mermaid response', () => {
    expect(extractMermaidSource('```mermaid\nflowchart TD\n  A --> B\n```')).toBe(
      'flowchart TD\n  A --> B',
    );
  });

  test('keeps plain Mermaid source', () => {
    expect(extractMermaidSource('sequenceDiagram\n  A->>B: Hello')).toBe(
      'sequenceDiagram\n  A->>B: Hello',
    );
  });

  test('normalizes escaped newlines from model output', () => {
    expect(extractMermaidSource('flowchart TD\\n  A --> B')).toBe('flowchart TD\n  A --> B');
  });

  test('normalizes multiply escaped newlines from model output', () => {
    expect(extractMermaidSource('flowchart TD\\\\n  A --> B')).toBe('flowchart TD\n  A --> B');
  });

  test('asks the provider for source-only Mermaid in the user language', async () => {
    const llmProvider = vi.fn(async () => 'flowchart TD\n  A[申請] --> B[承認]');
    const result = await generateMermaidArtifact({
      userText: '申請から承認までの図',
      llmProvider,
    });

    expect(result.source).toContain('A[申請] --> B[承認]');
    expect(llmProvider).toHaveBeenCalledTimes(1);
    const [system, user] = llmProvider.mock.calls[0];
    expect(system).toContain('Return ONLY Mermaid source text');
    expect(system).toContain("same human language as the user's request");
    expect(user).toBe('申請から承認までの図');
  });
});
