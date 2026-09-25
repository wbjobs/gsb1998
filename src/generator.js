(function (root) {
  'use strict';
  const JSE = (root.JSE = root.JSE || {});

  const BIN_PREC = {
    '||': 4, '&&': 5,
    '==': 8, '!=': 8, '===': 8, '!==': 8,
    '<': 9, '<=': 9, '>': 9, '>=': 9,
    '+': 11, '-': 11,
    '*': 12, '/': 12, '%': 12
  };

  function precOf(node) {
    switch (node.type) {
      case 'Literal':
      case 'Identifier':
      case 'ArrayExpression':
      case 'ObjectExpression':
        return 20;
      case 'MemberExpression':
      case 'CallExpression':
        return 18;
      case 'UpdateExpression':
        return node.prefix ? 15 : 16;
      case 'UnaryExpression':
        return 15;
      case 'BinaryExpression':
      case 'LogicalExpression':
        return BIN_PREC[node.operator];
      case 'AssignmentExpression':
        return 2;
      case 'FunctionExpression':
        return 2;
      default:
        return 20;
    }
  }

  function literalText(value) {
    if (typeof value === 'string') return JSON.stringify(value);
    if (value === null) return 'null';
    return String(value);
  }

  function expr(node, ctxPrec) {
    let s;
    switch (node.type) {
      case 'Identifier':
        s = node.name;
        break;
      case 'Literal':
        s = literalText(node.value);
        break;
      case 'ArrayExpression':
        s = '[' + node.elements.map(e => expr(e, 0)).join(', ') + ']';
        break;
      case 'ObjectExpression':
        s = '{' + node.properties.map(p => {
          const k = p.key.type === 'Identifier' ? p.key.name : literalText(p.key.value);
          return k + ': ' + expr(p.value, 0);
        }).join(', ') + '}';
        break;
      case 'MemberExpression':
        s = expr(node.object, 18) + (node.computed
          ? '[' + expr(node.property, 0) + ']'
          : '.' + node.property.name);
        break;
      case 'CallExpression':
        s = expr(node.callee, 18) + '('
          + node.arguments.map(a => expr(a, 0)).join(', ') + ')';
        break;
      case 'UnaryExpression': {
        const a = node.argument;
        const inner = (a.type === 'UnaryExpression' || a.type === 'UpdateExpression')
          ? '(' + expr(a, 0) + ')'
          : expr(a, 15);
        s = node.operator === 'typeof' ? 'typeof ' + inner : node.operator + inner;
        break;
      }
      case 'UpdateExpression': {
        const a = expr(node.argument, 16);
        s = node.prefix ? node.operator + a : a + node.operator;
        break;
      }
      case 'BinaryExpression':
      case 'LogicalExpression': {
        const p = BIN_PREC[node.operator];
        s = expr(node.left, p) + ' ' + node.operator + ' ' + expr(node.right, p + 1);
        break;
      }
      case 'AssignmentExpression':
        s = expr(node.left, 2) + ' ' + node.operator + ' ' + expr(node.right, 1);
        break;
      case 'FunctionExpression':
        s = 'function' + (node.id ? ' ' + node.id.name : '')
          + '(' + node.params.map(p => p.name).join(', ') + ') '
          + block(node.body, 0);
        break;
      default:
        throw new Error('代码生成：不支持的表达式节点 ' + node.type);
    }
    if (precOf(node) < ctxPrec) s = '(' + s + ')';
    return s;
  }

  function pad(indent) { return '  '.repeat(indent); }

  function block(b, indent) {
    const inner = b.body
      .map(s => stmt(s, indent + 1))
      .filter(x => x !== '')
      .join('\n');
    if (inner === '') return '{}';
    return '{\n' + inner + '\n' + pad(indent) + '}';
  }

  function varDecl(node) {
    return node.kind + ' ' + node.declarations.map(d =>
      d.id.name + (d.init ? ' = ' + expr(d.init, 2) : '')
    ).join(', ');
  }

  // 作为 if/while/for 语句体：块直接拼接，单语句换行缩进
  function bodyOf(node, indent) {
    if (node.type === 'BlockStatement') return block(node, indent);
    const s = stmt(node, indent + 1);
    if (s === '') return '\n' + pad(indent + 1) + ';';
    return '\n' + s;
  }

  function stmt(node, indent) {
    const p = pad(indent);
    switch (node.type) {
      case 'Program':
        return node.body.map(s => stmt(s, 0)).filter(x => x !== '').join('\n');
      case 'EmptyStatement':
        return '';
      case 'BlockStatement':
        return p + block(node, indent);
      case 'VariableDeclaration':
        return p + varDecl(node) + ';';
      case 'ExpressionStatement': {
        let s = expr(node.expression, 0);
        // 以 { 或 function 开头的表达式语句需要括号，避免被当作块/函数声明
        if (node.expression.type === 'ObjectExpression'
          || node.expression.type === 'FunctionExpression') {
          s = '(' + s + ')';
        }
        return p + s + ';';
      }
      case 'ReturnStatement':
        return p + 'return' + (node.argument ? ' ' + expr(node.argument, 0) : '') + ';';
      case 'IfStatement': {
        let s = p + 'if (' + expr(node.test, 0) + ') ' + bodyOf(node.consequent, indent);
        if (node.alternate) {
          if (node.alternate.type === 'IfStatement') {
            s += ' else ' + stmt(node.alternate, indent).replace(/^ +/, '');
          } else {
            s += ' else ' + bodyOf(node.alternate, indent);
          }
        }
        return s;
      }
      case 'WhileStatement':
        return p + 'while (' + expr(node.test, 0) + ') ' + bodyOf(node.body, indent);
      case 'ForStatement': {
        const init = node.init
          ? (node.init.type === 'VariableDeclaration' ? varDecl(node.init) : expr(node.init, 0))
          : '';
        const test = node.test ? expr(node.test, 0) : '';
        const update = node.update ? expr(node.update, 0) : '';
        return p + 'for (' + init + '; ' + test + '; ' + update + ') '
          + bodyOf(node.body, indent);
      }
      case 'FunctionDeclaration':
        return p + 'function ' + node.id.name
          + '(' + node.params.map(x => x.name).join(', ') + ') '
          + block(node.body, indent);
      case 'BreakStatement':
        return p + 'break;';
      case 'ContinueStatement':
        return p + 'continue;';
      default:
        throw new Error('代码生成：不支持的语句节点 ' + node.type);
    }
  }

  function generate(ast) {
    return stmt(ast, 0) + '\n';
  }

  JSE.generate = generate;
})(typeof self !== 'undefined' ? self : globalThis);
