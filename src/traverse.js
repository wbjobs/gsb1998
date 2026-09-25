(function (root) {
  'use strict';
  const JSE = (root.JSE = root.JSE || {});

  function isNode(v) { return v && typeof v === 'object' && typeof v.type === 'string'; }

  // 返回 [parent, key, index(数组时), child]
  function childEntries(node) {
    const out = [];
    for (const key of Object.keys(node)) {
      if (key === 'type' || key.charAt(0) === '_') continue;
      const v = node[key];
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v)) {
        v.forEach((c, i) => { if (isNode(c)) out.push([node, key, i, c]); });
      } else if (isNode(v)) {
        out.push([node, key, null, v]);
      }
    }
    return out;
  }

  function visit(node, parent, key, index, visitor) {
    if (visitor.enter) visitor.enter(node, parent, key, index);
    for (const [p, k, i, child] of childEntries(node)) {
      visit(child, p, k, i, visitor);
    }
    if (visitor.exit) visitor.exit(node, parent, key, index);
  }

  function traverse(node, visitor) {
    visit(node, null, null, null, visitor);
  }

  function replaceNode(parent, key, index, newNode) {
    if (index === null || index === undefined) {
      parent[key] = newNode;
    } else {
      parent[key][index] = newNode;
    }
  }

  JSE.isNode = isNode;
  JSE.childEntries = childEntries;
  JSE.traverse = traverse;
  JSE.replaceNode = replaceNode;
})(typeof self !== 'undefined' ? self : globalThis);
