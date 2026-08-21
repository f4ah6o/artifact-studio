const MERMAID_SYSTEM_PROMPT = `You generate Mermaid diagram source for As-Code Studio.
Return ONLY Mermaid source text. Do not use Markdown fences and do not add explanation.
Use the same human language as the user's request for visible labels.
Choose the Mermaid diagram type that best fits the request. Prefer flowchart TD for ordinary process flows unless the user requests another diagram type.
Keep node IDs concise ASCII identifiers and keep visible labels human-readable.
Do not emit HTML, JavaScript, CSS, or external links unless the user explicitly requests them.`;

export function extractMermaidSource(raw) {
  const text = String(raw || '').trim();
  const fenced = text.match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n```$/i);
  let source = (fenced ? fenced[1] : text).trim();

  // Codex occasionally emits source-like text with escaped newlines rather
  // than literal line breaks. Normalize that transport artifact without
  // touching ordinary Mermaid backslashes in multi-line source.
  if (!source.includes('\n') && source.includes('\\n')) {
    source = source.replace(/\\+n/g, '\n').replace(/\\+t/g, '\t');
  }

  return source;
}

export async function generateMermaidArtifact({ userText, llmProvider }) {
  if (typeof userText !== 'string' || !userText.trim()) {
    throw new Error('Mermaid generation requires userText');
  }
  if (!llmProvider) {
    throw new Error('Mermaid generation requires an llmProvider');
  }

  const raw = await llmProvider(MERMAID_SYSTEM_PROMPT, userText.trim());
  const source = extractMermaidSource(raw);
  if (!source) throw new Error('Mermaid generator returned an empty artifact');

  return { source };
}
