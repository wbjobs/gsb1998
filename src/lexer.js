(function (root) {
  'use strict';
  const JSE = (root.JSE = root.JSE || {});

  class JSEError extends Error {
    constructor(message, line, col) {
      super(message + '（行 ' + line + '，列 ' + col + '）');
      this.name = 'JSEError';
      this.line = line;
      this.col = col;
    }
  }

  const KEYWORDS = new Set([
    'var', 'let', 'const', 'function', 'return', 'if', 'else',
    'while', 'for', 'break', 'continue', 'true', 'false', 'null', 'typeof'
  ]);

  // 多字符运算符必须排在单字符前面，按最长匹配
  const PUNCTUATORS = [
    '===', '!==', '++', '--', '+=', '-=', '*=', '/=', '&&', '||',
    '<=', '>=', '==', '!=',
    '+', '-', '*', '/', '%', '(', ')', '{', '}', '[', ']',
    ',', ';', '.', '<', '>', '=', '!', ':'
  ];

  function isIdStart(c) { return /[A-Za-z_$]/.test(c); }
  function isIdChar(c) { return /[A-Za-z0-9_$]/.test(c); }
  function isDigit(c) { return c >= '0' && c <= '9'; }

  function tokenize(src) {
    const tokens = [];
    let i = 0, line = 1, col = 1;
    const n = src.length;

    function err(msg) { throw new JSEError(msg, line, col); }

    while (i < n) {
      const c = src[i];

      if (c === '\n') { line++; col = 1; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; col++; continue; }

      // 行注释
      if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') { i++; col++; }
        continue;
      }
      // 块注释
      if (c === '/' && src[i + 1] === '*') {
        const sl = line, sc = col;
        i += 2; col += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
          if (src[i] === '\n') { line++; col = 1; i++; } else { i++; col++; }
        }
        if (i >= n) throw new JSEError('未闭合的块注释，缺少 "*/"', sl, sc);
        i += 2; col += 2;
        continue;
      }

      // 数字（含小数、科学计数法）
      if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
        const sl = line, sc = col;
        let j = i;
        while (j < n && isDigit(src[j])) j++;
        if (src[j] === '.') {
          j++;
          while (j < n && isDigit(src[j])) j++;
        }
        if (src[j] === 'e' || src[j] === 'E') {
          let k = j + 1;
          if (src[k] === '+' || src[k] === '-') k++;
          if (isDigit(src[k] || '')) {
            j = k;
            while (j < n && isDigit(src[j])) j++;
          }
        }
        const text = src.slice(i, j);
        col += j - i; i = j;
        tokens.push({ type: 'num', value: parseFloat(text), raw: text, line: sl, col: sc });
        continue;
      }

      // 字符串
      if (c === '"' || c === "'") {
        const quote = c, sl = line, sc = col;
        i++; col++;
        let out = '';
        while (i < n && src[i] !== quote) {
          if (src[i] === '\n') throw new JSEError('字符串中不允许直接换行，请使用 "\\n"', line, col);
          if (src[i] === '\\') {
            i++; col++;
            const esc = src[i];
            const map = {
              n: '\n', t: '\t', r: '\r', '0': '\0',
              '\\': '\\', "'": "'", '"': '"'
            };
            if (esc === undefined) throw new JSEError('字符串在转义符后意外结束', line, col);
            if (!(esc in map)) throw new JSEError('不支持的转义字符 "\\' + esc + '"', line, col);
            out += map[esc];
            i++; col++;
          } else {
            out += src[i];
            i++; col++;
          }
        }
        if (i >= n) throw new JSEError('未闭合的字符串，缺少结束引号 ' + quote, sl, sc);
        i++; col++;
        tokens.push({ type: 'str', value: out, line: sl, col: sc });
        continue;
      }

      // 标识符 / 关键字
      if (isIdStart(c)) {
        const sl = line, sc = col;
        let j = i;
        while (j < n && isIdChar(src[j])) j++;
        const word = src.slice(i, j);
        col += j - i; i = j;
        tokens.push({
          type: KEYWORDS.has(word) ? 'kw' : 'id',
          value: word, line: sl, col: sc
        });
        continue;
      }

      // 运算符 / 标点
      let matched = null;
      for (const p of PUNCTUATORS) {
        if (src.startsWith(p, i)) { matched = p; break; }
      }
      if (matched) {
        tokens.push({ type: 'punc', value: matched, line, col });
        i += matched.length;
        col += matched.length;
        continue;
      }

      err('无法识别的字符 ' + JSON.stringify(c));
    }

    tokens.push({ type: 'eof', value: '<eof>', line, col });
    return tokens;
  }

  JSE.JSEError = JSEError;
  JSE.tokenize = tokenize;
})(typeof self !== 'undefined' ? self : globalThis);
