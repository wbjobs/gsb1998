(function (root) {
  'use strict';
  const JSE = (root.JSE = root.JSE || {});
  const { traverse, replaceNode, childEntries } = JSE;

  function literal(value) {
    return { type: 'Literal', value };
  }
  const isLiteral = n => n && n.type === 'Literal';

  const FOLDABLE = new Set([
    '+', '-', '*', '/', '%',
    '<', '<=', '>', '>=', '==', '!=', '===', '!=='
  ]);

  // 变换 1：常量折叠（字面量运算在编译期求值）
  function constantFold(ast) {
    traverse(ast, {
      exit(node, parent, key, index) {
        if (node.type === 'BinaryExpression'
          && FOLDABLE.has(node.operator)
          && isLiteral(node.left) && isLiteral(node.right)) {

          if ((node.operator === '/' || node.operator === '%')
            && node.right.value === 0) return;

          let result;
          switch (node.operator) {
            case '+': result = node.left.value + node.right.value; break;
            case '-': result = node.left.value - node.right.value; break;
            case '*': result = node.left.value * node.right.value; break;
            case '/': result = node.left.value / node.right.value; break;
            case '%': result = node.left.value % node.right.value; break;
            case '<': result = node.left.value < node.right.value; break;
            case '<=': result = node.left.value <= node.right.value; break;
            case '>': result = node.left.value > node.right.value; break;
            case '>=': result = node.left.value >= node.right.value; break;
            case '==': result = node.left.value == node.right.value; break;
            case '!=': result = node.left.value != node.right.value; break;
            case '===': result = node.left.value === node.right.value; break;
            case '!==': result = node.left.value !== node.right.value; break;
          }
          // 只保留可安全字面量化的结果
          const t = typeof result;
          if (t === 'number' && !isFinite(result)) return;
          if (t !== 'number' && t !== 'string' && t !== 'boolean') return;
          replaceNode(parent, key, index, literal(result));
          return;
        }

        if (node.type === 'UnaryExpression' && isLiteral(node.argument)) {
          const v = node.argument.value;
          let result;
          switch (node.operator) {
            case '!': result = !v; break;
            case '-': result = -v; break;
            case '+': result = +v; break;
            case 'typeof': result = typeof v; break;
            default: return;
          }
          replaceNode(parent, key, index, literal(result));
          return;
        }

        if (node.type === 'LogicalExpression' && isLiteral(node.left)) {
          const v = node.left.value;
          if (node.operator === '&&') {
            replaceNode(parent, key, index, v ? node.right : node.left);
          } else {
            replaceNode(parent, key, index, v ? node.left : node.right);
          }
        }
      }
    });
    return ast;
  }

  // 变换 2：死代码消除（常量条件分支 / 常量假 while）
  function deadBranch(ast) {
    traverse(ast, {
      exit(node, parent, key, index) {
        if (node.type === 'IfStatement' && isLiteral(node.test)) {
          const keep = node.test.value ? node.consequent : node.alternate;
          replaceNode(parent, key, index, keep || { type: 'EmptyStatement' });
        } else if (node.type === 'WhileStatement'
          && isLiteral(node.test) && !node.test.value) {
          replaceNode(parent, key, index, { type: 'EmptyStatement' });
        }
      }
    });
    return ast;
  }

  // 变换 3：作用域感知的变量重命名（a, b, ..., z, aa, ab, ...）
  function rename(ast) {
    const CHARS = 'abcdefghijklmnopqrstuvwxyz';
    // 生成的短名不能落在保留字上（如 for、do、in）
    const RESERVED = new Set([
      'var', 'let', 'const', 'function', 'return', 'if', 'else', 'while',
      'for', 'break', 'continue', 'true', 'false', 'null', 'typeof', 'do',
      'new', 'delete', 'in', 'of', 'switch', 'case', 'default', 'try',
      'catch', 'finally', 'throw', 'class', 'extends', 'this', 'super',
      'void', 'instanceof', 'yield', 'async', 'await', 'static'
    ]);
    let counter = 0;
    function nextName() {
      while (true) {
        let n = counter++;
        let s = '';
        do {
          s = CHARS[n % 26] + s;
          n = Math.floor(n / 26) - 1;
        } while (n >= 0);
        if (!RESERVED.has(s)) return s;
      }
    }

    function Scope(parent) { this.parent = parent; this.map = new Map(); }
    Scope.prototype.declare = function (name) {
      if (!this.map.has(name)) this.map.set(name, nextName());
    };
    Scope.prototype.lookup = function (name) {
      for (let s = this; s; s = s.parent) {
        if (s.map.has(name)) return s.map.get(name);
      }
      return null;
    };

    // var/let/const 与函数声明在进入该作用域前预先登记（提升 + 块级统一处理）
    function declareBlock(body, scope) {
      for (const st of body) {
        if (st.type === 'VariableDeclaration') {
          for (const d of st.declarations) scope.declare(d.id.name);
        } else if (st.type === 'FunctionDeclaration') {
          scope.declare(st.id.name);
        }
      }
    }

    function renameId(id, scope) {
      const nn = scope.lookup(id.name);
      if (nn !== null) id.name = nn;
    }

    function visit(node, scope) {
      switch (node.type) {
        case 'Program':
        case 'BlockStatement': {
          const s = new Scope(scope);
          declareBlock(node.body, s);
          node.body.forEach(c => visit(c, s));
          break;
        }
        case 'FunctionDeclaration': {
          renameId(node.id, scope);
          const s = new Scope(scope);
          node.params.forEach(p => s.declare(p.name));
          declareBlock(node.body.body, s);
          node.params.forEach(p => renameId(p, s));
          node.body.body.forEach(c => visit(c, s));
          break;
        }
        case 'FunctionExpression': {
          const s = new Scope(scope);
          if (node.id) s.declare(node.id.name);
          node.params.forEach(p => s.declare(p.name));
          declareBlock(node.body.body, s);
          if (node.id) renameId(node.id, s);
          node.params.forEach(p => renameId(p, s));
          node.body.body.forEach(c => visit(c, s));
          break;
        }
        case 'VariableDeclarator':
          if (node.init) visit(node.init, scope);
          renameId(node.id, scope);
          break;
        case 'Identifier':
          renameId(node, scope);
          break;
        case 'Literal':
          break;
        case 'MemberExpression':
          visit(node.object, scope);
          if (node.computed) visit(node.property, scope);
          break;
        case 'Property':
          // 对象字面量的键（标识符）不重命名，值正常遍历
          if (node.key.type !== 'Identifier') visit(node.key, scope);
          visit(node.value, scope);
          break;
        default:
          for (const entry of childEntries(node)) visit(entry[3], scope);
      }
    }

    visit(ast, new Scope(null));
    return ast;
  }

  JSE.constantFold = constantFold;
  JSE.deadBranch = deadBranch;
  JSE.rename = rename;
})(typeof self !== 'undefined' ? self : globalThis);
