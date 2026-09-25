// 词法分析器：将 JS 子集源码切分为 Token 流。
// 每个 Token 携带类型、值与行列位置，供解析器与错误提示使用。

export const TokenType = {
  Keyword: 'Keyword',
  Identifier: 'Identifier',
  Number: 'Number',
  String: 'String',
  Punctuator: 'Punctuator',
  EOF: 'EOF',
};

export class ParseError extends Error {
  constructor(message, line, column) {
    super(`${message}（第 ${line} 行，第 ${column} 列）`);
    this.name = 'ParseError';
    this.line = line;
    this.column = column;
  }
}

const KEYWORDS = new Set([
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'while',
  'for', 'break', 'continue', 'true', 'false', 'null', 'typeof', 'new',
]);

const PUNCTUATORS = [
  '===', '!==', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '++', '--', '=>',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '?', ':', ';', ',',
  '(', ')', '{', '}', '[', ']', '.',
];

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function isIdentPart(ch) {
  return isIdentStart(ch) || isDigit(ch);
}

export function tokenize(source) {
  const tokens = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  const error = (msg) => { throw new ParseError(msg, line, column); };

  while (pos < source.length) {
    const ch = source[pos];

    // 空白与换行
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pos += 1; column += 1; continue;
    }
    if (ch === '\n') {
      pos += 1; line += 1; column = 1; continue;
    }

    // 注释
    if (ch === '/' && source[pos + 1] === '/') {
      while (pos < source.length && source[pos] !== '\n') pos += 1;
      continue;
    }
    if (ch === '/' && source[pos + 1] === '*') {
      const startLine = line, startCol = column;
      pos += 2; column += 2;
      while (pos < source.length && !(source[pos] === '*' && source[pos + 1] === '/')) {
        if (source[pos] === '\n') { line += 1; column = 1; pos += 1; }
        else { pos += 1; column += 1; }
      }
      if (pos >= source.length) throw new ParseError('块注释未闭合', startLine, startCol);
      pos += 2; column += 2;
      continue;
    }

    // 数字（含小数与科学计数法）
    if (isDigit(ch) || (ch === '.' && isDigit(source[pos + 1]))) {
      const start = pos, startCol = column;
      while (pos < source.length && isDigit(source[pos])) { pos += 1; column += 1; }
      if (source[pos] === '.') {
        pos += 1; column += 1;
        while (pos < source.length && isDigit(source[pos])) { pos += 1; column += 1; }
      }
      if (source[pos] === 'e' || source[pos] === 'E') {
        pos += 1; column += 1;
        if (source[pos] === '+' || source[pos] === '-') { pos += 1; column += 1; }
        if (!isDigit(source[pos])) error('科学计数法缺少指数');
        while (pos < source.length && isDigit(source[pos])) { pos += 1; column += 1; }
      }
      tokens.push({ type: TokenType.Number, value: source.slice(start, pos), line, column: startCol });
      continue;
    }

    // 字符串（单/双引号，支持常见转义）
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const startCol = column;
      pos += 1; column += 1;
      let value = '';
      while (pos < source.length && source[pos] !== quote) {
        if (source[pos] === '\n') error('字符串未闭合');
        if (source[pos] === '\\') {
          const esc = source[pos + 1];
          const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' };
          if (!(esc in map)) error(`不支持的转义字符 \\${esc}`);
          value += map[esc];
          pos += 2; column += 2;
        } else {
          value += source[pos];
          pos += 1; column += 1;
        }
      }
      if (pos >= source.length) error('字符串未闭合');
      pos += 1; column += 1;
      tokens.push({ type: TokenType.String, value, line, column: startCol });
      continue;
    }

    // 标识符 / 关键字
    if (isIdentStart(ch)) {
      const start = pos, startCol = column;
      while (pos < source.length && isIdentPart(source[pos])) { pos += 1; column += 1; }
      const word = source.slice(start, pos);
      tokens.push({
        type: KEYWORDS.has(word) ? TokenType.Keyword : TokenType.Identifier,
        value: word, line, column: startCol,
      });
      continue;
    }

    // 标点（最长匹配优先）
    const matched = PUNCTUATORS.find((p) => source.startsWith(p, pos));
    if (matched) {
      tokens.push({ type: TokenType.Punctuator, value: matched, line, column });
      pos += matched.length; column += matched.length;
      continue;
    }

    error(`无法识别的字符 "${ch}"`);
  }

  tokens.push({ type: TokenType.EOF, value: '<eof>', line, column });
  return tokens;
}
