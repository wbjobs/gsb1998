// 语法分析器：递归下降解析 JS 子集，产出 ESTree 风格 AST。
// 支持：变量声明、函数声明/箭头函数、if/while/for、return/break/continue、
// 二元/一元/赋值/三元/调用/成员/数组/对象表达式与字面量。

import { tokenize, TokenType, ParseError } from './lexer.js';

const BINARY_PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3, '===': 3, '!==': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '<<': 5, '>>': 5,
  '+': 6, '-': 6,
  '*': 7, '/': 7, '%': 7,
};

const ASSIGNMENT_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

export function parse(source) {
  const tokens = tokenize(source);
  let index = 0;

  const peek = () => tokens[index];
  const next = () => tokens[index++];
  const is = (value) => peek().value === value;
  const isKeyword = (value) => peek().type === TokenType.Keyword && peek().value === value;
  const isPunct = (value) => peek().type === TokenType.Punctuator && peek().value === value;

  const error = (msg, token = peek()) => { throw new ParseError(msg, token.line, token.column); };

  const expectPunct = (value) => {
    if (!isPunct(value)) error(`期望 "${value}"，实际是 "${peek().value}"`);
    return next();
  };

  const expectIdentifier = () => {
    const token = peek();
    if (token.type !== TokenType.Identifier) error(`期望标识符，实际是 "${token.value}"`);
    return next();
  };

  const loc = (token) => ({ line: token.line, column: token.column });

  // ---------- 语句 ----------

  function parseProgram() {
    const body = [];
    while (peek().type !== TokenType.EOF) body.push(parseStatement());
    return { type: 'Program', body };
  }

  function parseStatement() {
    const token = peek();
    if (token.type === TokenType.Keyword) {
      switch (token.value) {
        case 'var': case 'let': case 'const': return parseVariableDeclaration();
        case 'function': return parseFunctionDeclaration();
        case 'return': return parseReturnStatement();
        case 'if': return parseIfStatement();
        case 'while': return parseWhileStatement();
        case 'for': return parseForStatement();
        case 'break': case 'continue': {
          next();
          consumeSemicolon();
          return { type: token.value === 'break' ? 'BreakStatement' : 'ContinueStatement', loc: loc(token) };
        }
        default:
          error(`不支持的关键字 "${token.value}"`, token);
      }
    }
    if (isPunct('{')) return parseBlock();
    return parseExpressionStatement();
  }

  function consumeSemicolon() {
    if (isPunct(';')) next(); // 分号可选，模拟 ASI
  }

  function parseBlock() {
    const start = expectPunct('{');
    const body = [];
    while (!isPunct('}')) {
      if (peek().type === TokenType.EOF) error('代码块缺少 "}"');
      body.push(parseStatement());
    }
    next();
    return { type: 'BlockStatement', body, loc: loc(start) };
  }

  function parseVariableDeclaration() {
    const start = next(); // var / let / const
    const declarations = [];
    do {
      const idToken = expectIdentifier();
      const id = { type: 'Identifier', name: idToken.value, loc: loc(idToken) };
      let init = null;
      if (isPunct('=')) {
        next();
        init = parseExpression();
      } else if (start.value === 'const') {
        error('const 声明必须初始化');
      }
      declarations.push({ type: 'VariableDeclarator', id, init });
    } while (isPunct(',') && (next(), true));
    consumeSemicolon();
    return { type: 'VariableDeclaration', kind: start.value, declarations, loc: loc(start) };
  }

  function parseFunctionDeclaration() {
    const start = next(); // function
    const idToken = expectIdentifier();
    const { params, body } = parseFunctionRest();
    return {
      type: 'FunctionDeclaration',
      id: { type: 'Identifier', name: idToken.value, loc: loc(idToken) },
      params, body, loc: loc(start),
    };
  }

  function parseFunctionRest() {
    expectPunct('(');
    const params = [];
    if (!isPunct(')')) {
      do {
        const token = expectIdentifier();
        params.push({ type: 'Identifier', name: token.value, loc: loc(token) });
      } while (isPunct(',') && (next(), true));
    }
    expectPunct(')');
    const body = parseBlock();
    return { params, body };
  }

  function parseReturnStatement() {
    const start = next(); // return
    let argument = null;
    if (!isPunct(';') && !isPunct('}') && peek().type !== TokenType.EOF) {
      argument = parseExpression();
    }
    consumeSemicolon();
    return { type: 'ReturnStatement', argument, loc: loc(start) };
  }

  function parseIfStatement() {
    const start = next(); // if
    expectPunct('(');
    const test = parseExpression();
    expectPunct(')');
    const consequent = parseStatement();
    let alternate = null;
    if (isKeyword('else')) {
      next();
      alternate = parseStatement();
    }
    return { type: 'IfStatement', test, consequent, alternate, loc: loc(start) };
  }

  function parseWhileStatement() {
    const start = next(); // while
    expectPunct('(');
    const test = parseExpression();
    expectPunct(')');
    const body = parseStatement();
    return { type: 'WhileStatement', test, body, loc: loc(start) };
  }

  function parseForStatement() {
    const start = next(); // for
    expectPunct('(');
    let init = null;
    if (!isPunct(';')) {
      if (isKeyword('var') || isKeyword('let') || isKeyword('const')) {
        const kind = next().value;
        const idToken = expectIdentifier();
        const id = { type: 'Identifier', name: idToken.value, loc: loc(idToken) };
        let initExpr = null;
        if (isPunct('=')) { next(); initExpr = parseExpression(); }
        init = {
          type: 'VariableDeclaration', kind,
          declarations: [{ type: 'VariableDeclarator', id, init: initExpr }],
        };
      } else {
        init = parseExpression();
      }
    }
    expectPunct(';');
    const test = isPunct(';') ? null : parseExpression();
    expectPunct(';');
    const update = isPunct(')') ? null : parseExpression();
    expectPunct(')');
    const body = parseStatement();
    return { type: 'ForStatement', init, test, update, body, loc: loc(start) };
  }

  function parseExpressionStatement() {
    const token = peek();
    const expression = parseExpression();
    consumeSemicolon();
    return { type: 'ExpressionStatement', expression, loc: loc(token) };
  }

  // ---------- 表达式 ----------

  function parseExpression() {
    return parseAssignment();
  }

  function parseAssignment() {
    const left = parseConditional();
    const token = peek();
    if (token.type === TokenType.Punctuator && ASSIGNMENT_OPS.has(token.value)) {
      next();
      if (!['Identifier', 'MemberExpression'].includes(left.type)) {
        error('赋值目标必须是变量或成员表达式', token);
      }
      const right = parseAssignment();
      return { type: 'AssignmentExpression', operator: token.value, left, right, loc: loc(token) };
    }
    return left;
  }

  function parseConditional() {
    const test = parseBinary(0);
    if (isPunct('?')) {
      const token = next();
      const consequent = parseAssignment();
      expectPunct(':');
      const alternate = parseAssignment();
      return { type: 'ConditionalExpression', test, consequent, alternate, loc: loc(token) };
    }
    return test;
  }

  function parseBinary(minPrecedence) {
    let left = parseUnary();
    while (true) {
      const token = peek();
      if (token.type !== TokenType.Punctuator) break;
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      next();
      const right = parseBinary(precedence + 1);
      left = { type: 'BinaryExpression', operator: token.value, left, right, loc: loc(token) };
    }
    return left;
  }

  function parseUnary() {
    const token = peek();
    if (token.type === TokenType.Punctuator && (token.value === '!' || token.value === '-' || token.value === '+')) {
      next();
      const argument = parseUnary();
      return { type: 'UnaryExpression', operator: token.value, argument, loc: loc(token) };
    }
    if (token.type === TokenType.Keyword && token.value === 'typeof') {
      next();
      const argument = parseUnary();
      return { type: 'UnaryExpression', operator: 'typeof', argument, loc: loc(token) };
    }
    if (token.type === TokenType.Punctuator && (token.value === '++' || token.value === '--')) {
      next();
      const argument = parseUnary();
      return { type: 'UpdateExpression', operator: token.value, argument, prefix: true, loc: loc(token) };
    }
    return parsePostfix();
  }

  function parsePostfix() {
    const expr = parseCallMember(parsePrimary());
    const token = peek();
    if (token.type === TokenType.Punctuator && (token.value === '++' || token.value === '--')) {
      next();
      return { type: 'UpdateExpression', operator: token.value, argument: expr, prefix: false, loc: loc(token) };
    }
    return expr;
  }

  function parseCallMember(expr) {
    while (true) {
      const token = peek();
      if (isPunct('.')) {
        next();
        const prop = expectIdentifier();
        expr = {
          type: 'MemberExpression', object: expr, computed: false,
          property: { type: 'Identifier', name: prop.value, loc: loc(prop) },
          loc: loc(token),
        };
      } else if (isPunct('[')) {
        next();
        const property = parseExpression();
        expectPunct(']');
        expr = { type: 'MemberExpression', object: expr, computed: true, property, loc: loc(token) };
      } else if (isPunct('(')) {
        next();
        const args = [];
        if (!isPunct(')')) {
          do { args.push(parseAssignment()); } while (isPunct(',') && (next(), true));
        }
        expectPunct(')');
        expr = { type: 'CallExpression', callee: expr, arguments: args, loc: loc(token) };
      } else {
        break;
      }
    }
    return expr;
  }

  function parsePrimary() {
    const token = peek();

    if (token.type === TokenType.Number) {
      next();
      return { type: 'Literal', value: Number(token.value), raw: token.value, loc: loc(token) };
    }
    if (token.type === TokenType.String) {
      next();
      return { type: 'Literal', value: token.value, raw: JSON.stringify(token.value), loc: loc(token) };
    }
    if (token.type === TokenType.Keyword) {
      if (token.value === 'true' || token.value === 'false') {
        next();
        return { type: 'Literal', value: token.value === 'true', raw: token.value, loc: loc(token) };
      }
      if (token.value === 'null') {
        next();
        return { type: 'Literal', value: null, raw: 'null', loc: loc(token) };
      }
      if (token.value === 'function') {
        next();
        const { params, body } = parseFunctionRest();
        return { type: 'FunctionExpression', id: null, params, body, loc: loc(token) };
      }
      error(`此处不允许关键字 "${token.value}"`, token);
    }
    if (token.type === TokenType.Identifier) {
      next();
      const id = { type: 'Identifier', name: token.value, loc: loc(token) };
      if (isPunct('=>')) {
        next();
        const body = isPunct('{') ? parseBlock() : parseAssignment();
        return { type: 'ArrowFunctionExpression', params: [id], body, loc: loc(token) };
      }
      return id;
    }
    if (isPunct('(')) {
      next();
      // 尝试箭头函数：(a, b) => ...
      const checkpoint = index;
      const params = [];
      let isArrowParams = true;
      if (!isPunct(')')) {
        while (true) {
          if (peek().type !== TokenType.Identifier) { isArrowParams = false; break; }
          const param = next();
          params.push({ type: 'Identifier', name: param.value, loc: loc(param) });
          if (isPunct(',')) { next(); continue; }
          break;
        }
      }
      if (isArrowParams && isPunct(')')) {
        next();
        if (isPunct('=>')) {
          next();
          const body = isPunct('{') ? parseBlock() : parseAssignment();
          return { type: 'ArrowFunctionExpression', params, body, loc: loc(token) };
        }
      }
      // 不是箭头函数，回退按括号表达式解析
      index = checkpoint;
      const expr = parseExpression();
      expectPunct(')');
      return expr;
    }
    if (isPunct('[')) {
      next();
      const elements = [];
      if (!isPunct(']')) {
        do { elements.push(parseAssignment()); } while (isPunct(',') && (next(), true));
      }
      expectPunct(']');
      return { type: 'ArrayExpression', elements, loc: loc(token) };
    }
    if (isPunct('{')) {
      next();
      const properties = [];
      if (!isPunct('}')) {
        do {
          const keyToken = peek();
          let key;
          if (keyToken.type === TokenType.Identifier || keyToken.type === TokenType.Keyword) {
            next();
            key = { type: 'Identifier', name: keyToken.value, loc: loc(keyToken) };
          } else if (keyToken.type === TokenType.String || keyToken.type === TokenType.Number) {
            next();
            key = { type: 'Literal', value: keyToken.value, raw: String(keyToken.value), loc: loc(keyToken) };
          } else {
            error('对象属性名必须是标识符或字面量');
          }
          expectPunct(':');
          const value = parseAssignment();
          properties.push({ type: 'Property', key, value });
        } while (isPunct(',') && (next(), true));
      }
      expectPunct('}');
      return { type: 'ObjectExpression', properties, loc: loc(token) };
    }

    error(`意外的记号 "${token.value}"`, token);
  }

  return parseProgram();
}
