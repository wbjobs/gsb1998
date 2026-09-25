// AST 遍历与变换：常量折叠、var→let、死代码消除、标识符重命名。
// 所有变换均为纯函数，返回新 AST，不修改输入。

// 通用深度优先遍历（先序），visitor 可返回替换节点。
export function traverse(node, visitor, parent = null) {
  if (!node || typeof node.type !== 'string') return node;
  const replacement = visitor(node, parent);
  if (replacement && replacement !== node) return replacement;
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      node[key] = child.map((item) =>
        item && typeof item.type === 'string' ? traverse(item, visitor, node) : item);
    } else if (child && typeof child.type === 'string') {
      node[key] = traverse(child, visitor, node);
    }
  }
  return node;
}

export function cloneAST(node) {
  return JSON.parse(JSON.stringify(node));
}

function literalOf(value) {
  return { type: 'Literal', value, raw: typeof value === 'string' ? JSON.stringify(value) : String(value) };
}

// 常量折叠：1 + 2 * 3 → 7；!"a" → false 等。
export function foldConstants(ast) {
  const result = cloneAST(ast);
  // 反复折叠直到不动点，保证嵌套表达式完全化简。
  let changed = true;
  while (changed) {
    changed = false;
    traverse(result, (node) => {
      if (node.type === 'BinaryExpression' &&
          node.left.type === 'Literal' && node.right.type === 'Literal') {
        const { left, right, operator } = node;
        const lv = left.value, rv = right.value;
        let value;
        switch (operator) {
          case '+': value = lv + rv; break;
          case '-': value = lv - rv; break;
          case '*': value = lv * rv; break;
          case '/': value = rv === 0 ? undefined : lv / rv; break;
          case '%': value = rv === 0 ? undefined : lv % rv; break;
          case '==': value = lv == rv; break;    // eslint-disable-line eqeqeq
          case '!=': value = lv != rv; break;    // eslint-disable-line eqeqeq
          case '===': value = lv === rv; break;
          case '!==': value = lv !== rv; break;
          case '<': value = lv < rv; break;
          case '<=': value = lv <= rv; break;
          case '>': value = lv > rv; break;
          case '>=': value = lv >= rv; break;
          case '<<': value = lv << rv; break;
          case '>>': value = lv >> rv; break;
          default: return undefined;
        }
        if (value !== undefined && (typeof value !== 'number' || Number.isFinite(value))) {
          changed = true;
          return literalOf(value);
        }
      }
      if (node.type === 'UnaryExpression' && node.argument.type === 'Literal') {
        const v = node.argument.value;
        let value;
        switch (node.operator) {
          case '!': value = !v; break;
          case '-': value = -v; break;
          case '+': value = +v; break;
          case 'typeof': value = typeof v; break;
          default: return undefined;
        }
        changed = true;
        return literalOf(value);
      }
      if (node.type === 'ConditionalExpression' && node.test.type === 'Literal') {
        changed = true;
        return node.test.value ? node.consequent : node.alternate;
      }
      return undefined;
    });
  }
  return result;
}

// var → let 规范化。
export function varToLet(ast) {
  const result = cloneAST(ast);
  traverse(result, (node) => {
    if (node.type === 'VariableDeclaration' && node.kind === 'var') node.kind = 'let';
    return undefined;
  });
  return result;
}

// 死代码消除：return 之后的语句、恒假 if 分支、空块。
export function eliminateDeadCode(ast) {
  const result = cloneAST(ast);
  traverse(result, (node) => {
    if (node.type === 'BlockStatement' || node.type === 'Program') {
      const cleaned = [];
      for (const stmt of node.body) {
        // 条件为字面量的 if：直接内联保留分支的语句
        if (stmt.type === 'IfStatement' && stmt.test.type === 'Literal') {
          const branch = stmt.test.value ? stmt.consequent : stmt.alternate;
          if (branch) {
            const stmts = branch.type === 'BlockStatement' ? branch.body : [branch];
            cleaned.push(...stmts);
          }
          continue;
        }
        cleaned.push(stmt);
        if (stmt.type === 'ReturnStatement' || stmt.type === 'BreakStatement' ||
            stmt.type === 'ContinueStatement') {
          break; // 之后的语句不可达
        }
      }
      node.body = cleaned;
    }
    return undefined;
  });
  return result;
}

// 标识符重命名：renameMap = { 旧名: 新名 }，仅处理简单标识符。
export function renameIdentifiers(ast, renameMap) {
  const result = cloneAST(ast);
  traverse(result, (node) => {
    if (node.type === 'Identifier' && Object.prototype.hasOwnProperty.call(renameMap, node.name)) {
      node.name = renameMap[node.name];
    }
    return undefined;
  });
  return result;
}

export const TRANSFORMS = {
  foldConstants: { label: '常量折叠', apply: (ast) => foldConstants(ast) },
  varToLet: { label: 'var → let', apply: (ast) => varToLet(ast) },
  eliminateDeadCode: { label: '死代码消除', apply: (ast) => eliminateDeadCode(ast) },
};

// 按名称依次应用变换管线。
export function applyTransforms(ast, names) {
  return names.reduce((current, name) => {
    const transform = TRANSFORMS[name];
    if (!transform) throw new Error(`未知变换: ${name}`);
    return transform.apply(current);
  }, ast);
}
