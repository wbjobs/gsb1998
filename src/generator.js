// 代码生成器：将 AST 还原为格式化的 JS 源码。
// 依据运算符优先级插入括号，保证生成代码语义与 AST 一致。

const BINARY_PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3, '===': 3, '!==': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '<<': 5, '>>': 5,
  '+': 6, '-': 6,
  '*': 7, '/': 7, '%': 7,
};
const PREC_ASSIGNMENT = 0.5;
const PREC_CONDITIONAL = 0.8;
const PREC_UNARY = 8;
const PREC_POSTFIX = 9;
const PREC_CALL_MEMBER = 10;
const PREC_PRIMARY = 11;

export function generate(ast) {
  if (!ast || ast.type !== 'Program') throw new Error('代码生成入口必须是 Program 节点');
  const lines = [];
  let indent = 0;

  const push = (text) => lines.push('  '.repeat(indent) + text);

  function genBlockStatements(block) {
    indent += 1;
    block.body.forEach(genStatement);
    indent -= 1;
  }

  // 生成 "{ ... }" 形式的语句体；非块语句自动包裹缩进
  function genBody(node) {
    if (node.type === 'BlockStatement') {
      if (node.body.length === 0) {
        const last = lines.length - 1;
        lines[last] += ' {}';
        return;
      }
      const last = lines.length - 1;
      lines[last] += ' {';
      genBlockStatements(node);
      push('}');
    } else {
      indent += 1;
      genStatement(node);
      indent -= 1;
    }
  }

  function genStatement(node) {
    switch (node.type) {
      case 'VariableDeclaration': {
        const decls = node.declarations.map((d) =>
          d.init ? `${genExpression(d.id)} = ${genExpression(d.init)}` : genExpression(d.id));
        push(`${node.kind} ${decls.join(', ')};`);
        break;
      }
      case 'FunctionDeclaration': {
        push(`function ${node.id.name}(${node.params.map(genExpression).join(', ')}) {`);
        genBlockStatements(node.body);
        push('}');
        break;
      }
      case 'ReturnStatement':
        push(node.argument ? `return ${genExpression(node.argument)};` : 'return;');
        break;
      case 'ExpressionStatement':
        push(`${genExpression(node.expression)};`);
        break;
      case 'IfStatement': {
        push(`if (${genExpression(node.test)})`);
        genBody(node.consequent);
        if (node.alternate) {
          // 与上一个 '}' 合并为 '} else ...'
          const last = lines.length - 1;
          if (node.alternate.type === 'IfStatement') {
            lines[last] += ' else';
            // 将 else-if 的 if 头拼到同一行
            const before = lines.length;
            genStatement(node.alternate);
            const first = lines.splice(before, 1)[0];
            lines[last] += ` ${first.trimStart()}`;
          } else {
            lines[last] += ' else';
            genBody(node.alternate);
          }
        }
        break;
      }
      case 'WhileStatement':
        push(`while (${genExpression(node.test)})`);
        genBody(node.body);
        break;
      case 'ForStatement': {
        const init = node.init
          ? (node.init.type === 'VariableDeclaration'
            ? `${node.init.kind} ${node.init.declarations.map((d) =>
                d.init ? `${genExpression(d.id)} = ${genExpression(d.init)}` : genExpression(d.id)).join(', ')}`
            : genExpression(node.init))
          : '';
        const test = node.test ? genExpression(node.test) : '';
        const update = node.update ? genExpression(node.update) : '';
        push(`for (${init}; ${test}; ${update})`);
        genBody(node.body);
        break;
      }
      case 'BlockStatement':
        push('{');
        genBlockStatements(node);
        push('}');
        break;
      case 'BreakStatement': push('break;'); break;
      case 'ContinueStatement': push('continue;'); break;
      default:
        throw new Error(`代码生成不支持节点类型: ${node.type}`);
    }
  }

  function genExpression(node, parentPrec = -1) {
    let text;
    let prec;
    switch (node.type) {
      case 'Identifier':
        return node.name;
      case 'Literal':
        return typeof node.value === 'string' ? JSON.stringify(node.value) : String(node.value);
      case 'BinaryExpression': {
        prec = BINARY_PRECEDENCE[node.operator];
        // 右侧同级需加括号，保持结合性（如 a - (b - c)）
        const left = genExpression(node.left, prec);
        const right = genExpression(node.right, prec + 0.1);
        text = `${left} ${node.operator} ${right}`;
        break;
      }
      case 'UnaryExpression':
        prec = PREC_UNARY;
        text = node.operator === 'typeof'
          ? `typeof ${genExpression(node.argument, prec)}`
          : `${node.operator}${genExpression(node.argument, prec)}`;
        break;
      case 'UpdateExpression':
        prec = PREC_POSTFIX;
        text = node.prefix
          ? `${node.operator}${genExpression(node.argument, prec)}`
          : `${genExpression(node.argument, prec)}${node.operator}`;
        break;
      case 'AssignmentExpression':
        prec = PREC_ASSIGNMENT;
        text = `${genExpression(node.left, prec)} ${node.operator} ${genExpression(node.right, prec - 0.1)}`;
        break;
      case 'ConditionalExpression':
        prec = PREC_CONDITIONAL;
        text = `${genExpression(node.test, prec)} ? ${genExpression(node.consequent, PREC_ASSIGNMENT)} : ${genExpression(node.alternate, PREC_ASSIGNMENT)}`;
        break;
      case 'CallExpression':
        prec = PREC_CALL_MEMBER;
        text = `${genExpression(node.callee, prec)}(${node.arguments.map((a) => genExpression(a)).join(', ')})`;
        break;
      case 'MemberExpression':
        prec = PREC_CALL_MEMBER;
        text = node.computed
          ? `${genExpression(node.object, prec)}[${genExpression(node.property)}]`
          : `${genExpression(node.object, prec)}.${genExpression(node.property)}`;
        break;
      case 'ArrayExpression':
        return `[${node.elements.map((e) => genExpression(e)).join(', ')}]`;
      case 'ObjectExpression':
        return `{ ${node.properties.map((p) =>
          `${p.key.type === 'Identifier' ? p.key.name : JSON.stringify(p.key.value)}: ${genExpression(p.value)}`).join(', ')} }`;
      case 'FunctionExpression':
        prec = PREC_PRIMARY;
        text = `function (${node.params.map(genExpression).join(', ')}) ${genInlineBlock(node.body)}`;
        break;
      case 'ArrowFunctionExpression': {
        prec = PREC_ASSIGNMENT;
        const params = node.params.length === 1
          ? node.params[0].name
          : `(${node.params.map(genExpression).join(', ')})`;
        const body = node.body.type === 'BlockStatement'
          ? genInlineBlock(node.body)
          : genExpression(node.body, PREC_ASSIGNMENT);
        text = `${params} => ${body}`;
        break;
      }
      default:
        throw new Error(`代码生成不支持表达式类型: ${node.type}`);
    }
    return prec < parentPrec ? `(${text})` : text;
  }

  // 函数体以紧凑多行形式内联到表达式中
  function genInlineBlock(block) {
    if (block.body.length === 0) return '{}';
    const saved = lines.length;
    push('{');
    genBlockStatements(block);
    push('}');
    return lines.splice(saved).map((l) => l.trimStart()).join('\n');
  }

  ast.body.forEach(genStatement);
  return lines.join('\n');
}
