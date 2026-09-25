// Canvas AST 树形可视化：自动布局 + 拖拽平移 + 滚轮缩放
(function (root) {
  'use strict';
  const JSE = (root.JSE = root.JSE || {});

  const LEVEL_H = 64;
  const GAP = 10;
  const NODE_H = 30;
  const PAD_X = 8;

  function nodeLabel(node) {
    let extra = '';
    if (node.type === 'Identifier') extra = node.name;
    else if (node.type === 'Literal') extra = JSON.stringify(node.value);
    else if (node.operator) extra = node.operator;
    else if (node.type === 'VariableDeclaration') extra = node.kind;
    else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
      extra = node.id ? node.id.name : '(匿名)';
    }
    return extra ? node.type + ' ' + extra : node.type;
  }

  function colorOf(type) {
    if (/Statement|Declaration/.test(type)) return '#2b3a55';
    if (/Expression/.test(type)) return '#1f4d3a';
    if (/Function/.test(type)) return '#4d2f5e';
    if (type === 'Literal') return '#5e4322';
    if (type === 'Identifier') return '#274b63';
    return '#333c4a';
  }

  function createAstView(canvas) {
    const ctx = canvas.getContext('2d');
    const view = { scale: 1, ox: 20, oy: 20, root: null };

    function measure(node) {
      const label = nodeLabel(node);
      node._w = Math.max(ctx.measureText(label).width + PAD_X * 2, 56);
      const kids = JSE.childEntries(node).map(e => e[3]);
      node._kids = kids;
      kids.forEach(measure);
      node._kw = kids.reduce((s, k) => s + k._sw, 0) + GAP * Math.max(kids.length - 1, 0);
      node._sw = Math.max(node._w, node._kw);
    }

    function place(node, x, depth) {
      node._x = x + node._sw / 2;
      node._y = depth * LEVEL_H + NODE_H / 2;
      let cx = x + (node._sw - node._kw) / 2;
      for (const k of node._kids) {
        place(k, cx, depth + 1);
        cx += k._sw + GAP;
      }
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!view.root) return;

      ctx.save();
      ctx.translate(view.ox, view.oy);
      ctx.scale(view.scale, view.scale);
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';

      (function walk(n) {
        for (const k of n._kids) {
          ctx.strokeStyle = '#5b6472';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(n._x, n._y + NODE_H / 2);
          ctx.lineTo(k._x, k._y - NODE_H / 2);
          ctx.stroke();
          walk(k);
        }
        const x = n._x - n._w / 2;
        const y = n._y - NODE_H / 2;
        ctx.fillStyle = colorOf(n.type);
        ctx.fillRect(x, y, n._w, NODE_H);
        ctx.strokeStyle = '#8a94a6';
        ctx.strokeRect(x, y, n._w, NODE_H);
        ctx.fillStyle = '#e6ebf2';
        ctx.fillText(nodeLabel(n), n._x, n._y + 4);
      })(view.root);

      ctx.restore();
    }

    function render(ast) {
      ctx.font = '11px ui-monospace, monospace';
      measure(ast);
      place(ast, 0, 0);
      view.root = ast;
      const W = canvas.clientWidth || 600;
      view.scale = Math.min(1, (W - 40) / ast._sw) || 1;
      view.ox = 20;
      view.oy = 20;
      draw();
    }

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('mousedown', e => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      view.ox += e.clientX - lastX;
      view.oy += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      draw();
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      view.ox = mx - (mx - view.ox) * factor;
      view.oy = my - (my - view.oy) * factor;
      view.scale *= factor;
      draw();
    }, { passive: false });

    return { render, draw };
  }

  JSE.createAstView = createAstView;
})(typeof self !== 'undefined' ? self : globalThis);
