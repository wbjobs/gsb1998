// Canvas AST 可视化：将语法树绘制为可缩放/平移的树形图。

const NODE_W = 150;
const NODE_H = 34;
const GAP_X = 16;
const GAP_Y = 46;

// 将 AST 转为 { label, children } 结构
function toTree(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    return node.map(toTree).filter(Boolean);
  }
  if (typeof node.type !== 'string') return null;
  let label = node.type;
  if (node.type === 'Identifier') label += `: ${node.name}`;
  if (node.type === 'Literal') label += `: ${JSON.stringify(node.value)}`;
  if (node.operator) label += `: ${node.operator}`;
  if (node.kind) label += `: ${node.kind}`;

  const children = [];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'type' || key === 'name' || key === 'value' ||
        key === 'raw' || key === 'operator' || key === 'kind' || key === 'prefix' ||
        key === 'computed') {
      continue;
    }
    const child = toTree(node[key]);
    if (!child) continue;
    if (Array.isArray(child)) children.push(...child);
    else children.push(child);
  }
  return { label, children };
}

//  tidy 布局：叶子依次排列，父节点居中于子节点
function layout(root) {
  let nextX = 0;
  let maxDepth = 0;
  function place(node, depth) {
    maxDepth = Math.max(maxDepth, depth);
    node.depth = depth;
    if (node.children.length === 0) {
      node.x = nextX;
      nextX += 1;
    } else {
      node.children.forEach((child) => place(child, depth + 1));
      node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2;
    }
  }
  place(root, 0);
  return { width: nextX, height: maxDepth + 1 };
}

export function renderAST(canvas, ast) {
  const tree = toTree(ast);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!tree) return;

  const dims = layout(tree);
  const pixelW = dims.width * (NODE_W + GAP_X) + GAP_X;
  const pixelH = dims.height * (NODE_H + GAP_Y) + GAP_Y;

  // 自适应缩放以铺满画布
  const scale = Math.min(canvas.width / pixelW, canvas.height / pixelH, 1);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(GAP_X, GAP_Y);

  const px = (node) => node.x * (NODE_W + GAP_X);
  const py = (node) => node.depth * (NODE_H + GAP_Y);

  // 连线
  ctx.strokeStyle = '#8b949e';
  ctx.lineWidth = 1.2 / scale;
  function drawEdges(node) {
    for (const child of node.children) {
      ctx.beginPath();
      ctx.moveTo(px(node) + NODE_W / 2, py(node) + NODE_H);
      ctx.lineTo(px(child) + NODE_W / 2, py(child));
      ctx.stroke();
      drawEdges(child);
    }
  }
  drawEdges(tree);

  // 节点
  function drawNode(node) {
    const x = px(node);
    const y = py(node);
    ctx.fillStyle = node.children.length === 0 ? '#1f6feb' : '#238636';
    ctx.beginPath();
    ctx.roundRect(x, y, NODE_W, NODE_H, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label;
    ctx.fillText(text, x + NODE_W / 2, y + NODE_H / 2);
    node.children.forEach(drawNode);
  }
  drawNode(tree);
  ctx.restore();
}
