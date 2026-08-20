let mermaidPromise = null;

async function mermaidRuntime() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(module => {
      const mermaid = module.default || module;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

async function loadMermaidAdapter() {
  const mermaid = await mermaidRuntime();
  return {
    ...artifactAdapters.mermaid,
    async validate(source) {
      try {
        await mermaid.parse(String(source || ''));
        return { errors: [], warnings: [] };
      } catch (error) {
        return { errors: [error?.str || error?.message || String(error)], warnings: [] };
      }
    },
    format(source) {
      const text = String(source || '').replace(/\r\n?/g, '\n').trimEnd();
      return text ? `${text}\n` : '';
    },
    async render(source, target) {
      const id = `artifact-studio-mermaid-${crypto.randomUUID().replaceAll('-', '')}`;
      const { svg, bindFunctions } = await mermaid.render(id, String(source || ''));
      target.innerHTML = svg;
      bindFunctions?.(target);
    },
  };
}

export const artifactAdapters = Object.freeze({
  bpmn: Object.freeze({
    id: 'bpmn',
    label: 'BPMN',
    accept: '.bpmn,.xml,application/xml,text/xml',
    exportFileName: 'process.bpmn',
    promptPlaceholder: '業務プロセスを自然言語で記述してください。',
    contentKind: 'text',
    capabilities: { validate: true, format: true, actions: [], views: ['model'] },
  }),
  mermaid: Object.freeze({
    id: 'mermaid',
    label: 'Mermaid',
    accept: '.mmd,.mermaid,text/plain',
    exportFileName: 'diagram.mmd',
    promptPlaceholder: '作りたい図を自然言語で記述してください。',
    contentKind: 'text',
    capabilities: { validate: true, format: true, actions: [], views: ['source', 'preview'] },
  }),
  opa: Object.freeze({
    id: 'opa',
    label: 'OPA / Rego',
    accept: '.rego,.json,.yaml,.yml,.opa-workspace.json,text/plain,application/json',
    exportFileName: 'policy.opa-workspace.json',
    promptPlaceholder: 'OPA workspace はソースエディタから編集してください。',
    contentKind: 'workspace',
    capabilities: {
      validate: true,
      format: true,
      actions: ['evaluate', 'test', 'coverage', 'dependencies'],
      views: ['source', 'dependencies', 'decision', 'tests'],
    },
  }),
});

export function getArtifactAdapter(id) {
  return artifactAdapters[id] || null;
}

export function inferAdapterFromFileName(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.bpmn') || name.endsWith('.bpmn.xml')) return 'bpmn';
  if (name.endsWith('.mmd') || name.endsWith('.mermaid')) return 'mermaid';
  if (name.endsWith('.rego') || name.endsWith('.opa-workspace.json')) return 'opa';
  return null;
}

export async function loadArtifactAdapter(id) {
  const adapter = getArtifactAdapter(id);
  if (!adapter) throw new Error(`Unknown artifact adapter: ${id}`);
  if (id === 'mermaid') return loadMermaidAdapter();
  return adapter;
}
