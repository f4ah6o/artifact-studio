import ELK from 'elkjs/lib/elk.bundled.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_WIDTH = 168;
const NODE_HEIGHT = 58;
const elk = new ELK();

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function edgePath(section) {
  const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
  if (points.length < 2) return '';
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

function fallbackEdgePath(edge, nodes) {
  const from = nodes.get(edge.sources?.[0]);
  const to = nodes.get(edge.targets?.[0]);
  if (!from || !to) return '';
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  return `M ${startX} ${startY} L ${endX} ${endY}`;
}

function shortLabel(value) {
  const text = String(value || 'Step');
  return text.length > 22 ? `${text.slice(0, 21)}…` : text;
}

export async function renderDaguVisualGraph(
  projection,
  target,
  {
    nodeIndexById = new Map(),
    selectedStepIndex = null,
    connectFromStepIndex = null,
    editable = false,
    onSelect = () => {},
  } = {},
) {
  const graph = {
    id: 'dagu-visual-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '34',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.padding': '[top=28,left=28,bottom=28,right=28]',
    },
    children: projection.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      labels: [{ text: node.label }],
    })),
    edges: projection.edges.map((edge, index) => ({
      id: `edge-${index}`,
      sources: [edge.from],
      targets: [edge.to],
    })),
  };

  const layout = await elk.layout(graph);
  const width = Math.max(320, Math.ceil(layout.width || 0));
  const height = Math.max(220, Math.ceil(layout.height || 0));
  const svg = svgElement('svg', {
    class: 'dagu-visual-svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Dagu dependency graph editor',
  });

  const defs = svgElement('defs');
  const marker = svgElement('marker', {
    id: 'dagu-arrowhead',
    viewBox: '0 0 10 10',
    refX: '9',
    refY: '5',
    markerWidth: '6',
    markerHeight: '6',
    orient: 'auto-start-reverse',
  });
  marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'dagu-arrowhead' }));
  defs.append(marker);
  svg.append(defs);

  const layoutNodes = new Map((layout.children || []).map((node) => [node.id, node]));
  const edgeLayer = svgElement('g', { class: 'dagu-edge-layer' });
  for (const edge of layout.edges || []) {
    const sections = edge.sections || [];
    const paths = sections.length
      ? sections.map(edgePath)
      : [fallbackEdgePath(edge, layoutNodes)].filter(Boolean);
    for (const pathData of paths) {
      edgeLayer.append(
        svgElement('path', {
          d: pathData,
          class: 'dagu-visual-edge',
          'marker-end': 'url(#dagu-arrowhead)',
        }),
      );
    }
  }
  svg.append(edgeLayer);

  const nodeLayer = svgElement('g', { class: 'dagu-node-layer' });
  for (const node of layout.children || []) {
    const stepIndex = nodeIndexById.get(node.id);
    const group = svgElement('g', {
      class: 'dagu-visual-node',
      transform: `translate(${node.x || 0} ${node.y || 0})`,
      tabindex: stepIndex == null ? '-1' : '0',
      role: stepIndex == null ? 'img' : 'button',
    });
    if (stepIndex === selectedStepIndex) group.classList.add('selected');
    if (stepIndex === connectFromStepIndex) group.classList.add('connecting');
    if (!editable || stepIndex == null) group.classList.add('read-only');

    const rect = svgElement('rect', {
      width: node.width || NODE_WIDTH,
      height: node.height || NODE_HEIGHT,
      rx: '8',
      ry: '8',
    });
    const label = svgElement('text', {
      x: '14',
      y: '29',
      class: 'dagu-visual-node-label',
    });
    const projectionNode = projection.nodes.find((candidate) => candidate.id === node.id);
    label.textContent = shortLabel(projectionNode?.label || node.id);
    group.append(rect, label);

    if (stepIndex != null) {
      const select = () => onSelect(stepIndex);
      group.addEventListener('click', select);
      group.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        select();
      });
    }
    nodeLayer.append(group);
  }
  svg.append(nodeLayer);

  target.replaceChildren(svg);
  return svg;
}
