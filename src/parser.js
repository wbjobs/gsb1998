(function (root) {
  'use strict';
  const JSE = (root.JSE = root.JSE || {});
  const JSEError = JSE.JSEError;

  const BINARY_PREC = {
    '||': 1, '&&': 2,
    '==': 3, '!=': 3, '===': 3, '!==': 3,
    '<': 4, '<=': 4, '>': 4, '>=': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '%': 6
  };
  const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=']);

  function parse(src) {
    const tokens = JSE.tokenize(src);
    let pos = 0;
    const peek = () => tokens[pos];

    function describe(t) {
      if (t.type === 'eof') return '文件结束（EOF）';
      if (t.type === 'kw') return '关键字 "' + t.value + '"';
      return JSON.stringify(t.value);
    }
    function err(msg, t) {
      t = t || peek();
      throw new JSEError(msg + '，实际遇到 ' + describe(t), t.line, t.col);
    }
    function next() { return tokens[pos++]; }
    function atPunc(p) { const t = peek(); return t.type === 'punc' && t.value === p; }
    function eatPunc(p) { if (atPunc(p)) { next(); return true; } return false; }
    function expectPunc(p) {
      if (!atPunc(p)) err('期望标点 "' + p + '"');
      next();
    }
    function atKw(k) { const t = peek(); return t.type === 'kw' && t.value === k; }
    function expectKw(k) {
      if (!atKw(k)) err('期望关键字 "' + k + '"');
      next();
    }
    function expectId() {
      const t = peek();
      if (t.type !== 'id') err('此处期望标识符（变量名）');
      next();
      return { type: 'Identifier', name: t.value };
    }
    function semi() { eatPunc(';'); }

    // ---------- 语句 ----------
    function parseProgram() {
      const body = [];
      while (peek().type !== 'eof') {
        const s = parseStatement();
        if (s) body.push(s);
      }
      return { type: 'Program', body };
    }

    function parseStatement() {
      const t = peek();
      if (t.type === 'kw') {
        switch (t.value) {
          case 'var': case 'let': case 'const': return parseVarDecl();
          case 'function': return parseFunctionDecl();
          case 'return': {
            next();
            let argument = null;
            if (!atPunc(';') && !atPunc('}') && peek().type !== 'eof') {
              argument = parseExpression();
            }
            semi();
            return { type: 'ReturnStatement', argument };
          }
          case 'if': return parseIf();
          case 'while': return parseWhile();
          case 'for': return parseFor();
          case 'break': next(); semi(); return { type: 'BreakStatement' };
          case 'continue': next(); semi(); return { type: 'ContinueStatement' };
          default: err('关键字 "' + t.value + '" 不能作为语句开头');
        }
      }
      if (atPunc('{')) return parseBlock();
      if (eatPunc(';')) return null;
      const expression = parseExpression();
      semi();
      return { type: 'ExpressionStatement', expression };
    }

    function parseVarDecl() {
      const kind = next().value;
      const declarations = [];
      do {
        const id = expectId();
        let init = null;
        if (eatPunc('=')) init = parseExpression();
        declarations.push({ type: 'VariableDeclarator', id, init });
      } while (eatPunc(','));
      semi();
      return { type: 'VariableDeclaration', kind, declarations };
    }

    function parseParams() {
      expectPunc('(');
      const params = [];
      if (!atPunc(')')) {
        do { params.push(expectId()); } while (eatPunc(','));
      }
      expectPunc(')');
      return params;
    }

    function parseFunctionDecl() {
      expectKw('function');
      const id = expectId();
      const params = parseParams();
      const body = parseBlock();
      return { type: 'FunctionDeclaration', id, params, body };
    }

    function parseBlock() {
      expectPunc('{');
      const body = [];
      while (!atPunc('}')) {
        if (peek().type === 'eof') err('代码块缺少结束的 "}"');
        const s = parseStatement();
        if (s) body.push(s);
      }
      expectPunc('}');
      return { type: 'BlockStatement', body };
    }

    function parseIf() {
      expectKw('if');
      expectPunc('(');
      const test = parseExpression();
      expectPunc(')');
      const consequent = parseStatement() || { type: 'EmptyStatement' };
      let alternate = null;
      if (atKw('else')) {
        next();
        alternate = parseStatement() || { type: 'EmptyStatement' };
      }
      return { type: 'IfStatement', test, consequent, alternate };
    }

    function parseWhile() {
      expectKw('while');
      expectPunc('(');
      const test = parseExpression();
      expectPunc(')');
      const body = parseStatement() || { type: 'EmptyStatement' };
      return { type: 'WhileStatement', test, body };
    }

    function parseFor() {
      expectKw('for');
      expectPunc('(');
      let init = null;
      if (!atPunc(';')) {
        if (atKw('var') || atKw('let') || atKw('const')) {
          const kind = next().value;
          const declarations = [];
          do {
            const id = expectId();
            let initExpr = null;
            if (eatPunc('=')) initExpr = parseExpression();
            declarations.push({ type: 'VariableDeclarator', id, init: initExpr });
          } while (eatPunc(','));
          init = { type: 'VariableDeclaration', kind, declarations };
        } else {
          init = parseExpression();
        }
      }
      expectPunc(';');
      const test = atPunc(';') ? null : parseExpression();
      expectPunc(';');
      const update = atPunc(')') ? null : parseExpression();
      expectPunc(')');
      const body = parseStatement() || { type: 'EmptyStatement' };
      return { type: 'ForStatement', init, test, update, body };
    }

    // ---------- 表达式（优先级爬升） ----------
    function parseExpression() { return parseAssignment(); }

    function parseAssignment() {
      const left = parseBinary(1);
      const t = peek();
      if (t.type === 'punc' && ASSIGN_OPS.has(t.value)) {
        if (left.type !== 'Identifier' && left.type !== 'MemberExpression') {
          err('赋值号左边必须是变量或属性，不能是表达式');
        }
        next();
        const right = parseAssignment();
        return { type: 'AssignmentExpression', operator: t.value, left, right };
      }
      return left;
    }

    function parseBinary(minPrec) {
      let left = parseUnary();
      while (true) {
        const t = peek();
        if (t.type !== 'punc' || !(t.value in BINARY_PREC)) break;
        const prec = BINARY_PREC[t.value];
        if (prec < minPrec) break;
        next();
        const right = parseBinary(prec + 1);
        const type = (t.value === '&&' || t.value === '||')
          ? 'LogicalExpression' : 'BinaryExpression';
        left = { type, operator: t.value, left, right };
      }
      return left;
    }

    function checkUpdateTarget(arg) {
      if (arg.type !== 'Identifier' && arg.type !== 'MemberExpression') {
        err('自增/自减（++、--）的操作数必须是变量或属性');
      }
    }

    function parseUnary() {
      const t = peek();
      if (t.type === 'punc' && (t.value === '!' || t.value === '-' || t.value === '+')) {
        next();
        const argument = parseUnary();
        return { type: 'UnaryExpression', operator: t.value, argument };
      }
      if (t.type === 'kw' && t.value === 'typeof') {
        next();
        const argument = parseUnary();
        return { type: 'UnaryExpression', operator: 'typeof', argument };
      }
      if (t.type === 'punc' && (t.value === '++' || t.value === '--')) {
        next();
        const argument = parseUnary();
        checkUpdateTarget(argument);
        return { type: 'UpdateExpression', operator: t.value, argument, prefix: true };
      }
      return parsePostfix();
    }

    function parsePostfix() {
      const expr = parseCallMember();
      const t = peek();
      if (t.type === 'punc' && (t.value === '++' || t.value === '--')) {
        next();
        checkUpdateTarget(expr);
        return { type: 'UpdateExpression', operator: t.value, argument: expr, prefix: false };
      }
      return expr;
    }

    function parseCallMember() {
      let expr = parsePrimary();
      while (true) {
        if (eatPunc('(')) {
          const args = [];
          if (!atPunc(')')) {
            do { args.push(parseAssignment()); } while (eatPunc(','));
          }
          expectPunc(')');
          expr = { type: 'CallExpression', callee: expr, arguments: args };
        } else if (eatPunc('.')) {
          const property = expectId();
          expr = { type: 'MemberExpression', object: expr, property, computed: false };
        } else if (eatPunc('[')) {
          const property = parseExpression();
          expectPunc(']');
          expr = { type: 'MemberExpression', object: expr, property, computed: true };
        } else {
          break;
        }
      }
      return expr;
    }

    function parsePrimary() {
      const t = peek();

      if (t.type === 'num') {
        next();
        return { type: 'Literal', value: t.value, raw: t.raw };
      }
      if (t.type === 'str') {
        next();
        return { type: 'Literal', value: t.value };
      }
      if (t.type === 'kw') {
        if (t.value === 'true' || t.value === 'false') {
          next();
          return { type: 'Literal', value: t.value === 'true' };
        }
        if (t.value === 'null') {
          next();
          return { type: 'Literal', value: null };
        }
        if (t.value === 'function') {
          next();
          const id = peek().type === 'id' ? expectId() : null;
          const params = parseParams();
          const body = parseBlock();
          return { type: 'FunctionExpression', id, params, body };
        }
        err('此处不允许使用关键字 "' + t.value + '"');
      }
      if (t.type === 'id') return expectId();

      if (eatPunc('(')) {
        const e = parseExpression();
        expectPunc(')');
        return e;
      }
      if (eatPunc('[')) {
        const elements = [];
        if (!atPunc(']')) {
          do { elements.push(parseAssignment()); } while (eatPunc(','));
        }
        expectPunc(']');
        return { type: 'ArrayExpression', elements };
      }
      if (eatPunc('{')) {
        const properties = [];
        if (!atPunc('}')) {
          do {
            const kt = peek();
            let key;
            if (kt.type === 'id' || kt.type === 'kw') {
              next();
              key = { type: 'Identifier', name: kt.value };
            } else if (kt.type === 'str' || kt.type === 'num') {
              next();
              key = { type: 'Literal', value: kt.value };
            } else {
              err('对象属性名必须是标识符、字符串或数字');
            }
            let value;
            if (eatPunc(':')) {
              value = parseAssignment();
            } else {
              if (key.type !== 'Identifier') err('对象简写属性必须是标识符');
              value = { type: 'Identifier', name: key.name };
            }
            properties.push({ type: 'Property', key, value });
          } while (eatPunc(','));
        }
        expectPunc('}');
        return { type: 'ObjectExpression', properties };
      }

      err('无法解析的表达式起点');
    }

    return parseProgram();
  }

  JSE.parse = parse;
})(typeof self !== 'undefined' ? self : globalThis);
