// 测试与基准：解析准确性、变换正确性、生成正确性、性能、异常提示。
// 运行：node test/run.mjs

import { parse } from '../src/parser.js';
import { generate } from '../src/generator.js';
import { applyTransforms, foldConstants, varToLet, eliminateDeadCode, renameIdentifiers } from '../src/transform.js';
import { ParseError } from '../src/lexer.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

function assertEqual(actual, expected, what = '') {
  if (actual !== expected) {
    throw new Error(`${what} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

// 生成代码的语义应与源码语义一致：用 Function 构造器对比执行结果
function assertSemantics(source, transformed, what) {
  const run = (code) => {
    const fn = new Function(`${code}; return typeof main === 'function' ? main() : undefined;`);
    return fn();
  };
  assertEqual(JSON.stringify(run(transformed)), JSON.stringify(run(source)), what);
}

console.log('\n[1] 解析准确性');

test('变量声明与运算符优先级', () => {
  const ast = parse('let x = 1 + 2 * 3;');
  assertEqual(ast.body[0].type, 'VariableDeclaration');
  const init = ast.body[0].declarations[0].init;
  assertEqual(init.type, 'BinaryExpression');
  assertEqual(init.operator, '+');
  assertEqual(init.right.operator, '*', '乘法应优先于加法');
});

test('函数声明、控制流、成员与调用', () => {
  const ast = parse(`
    function fib(n) {
      if (n <= 1) { return n; }
      return fib(n - 1) + fib(n - 2);
    }
    let arr = [1, 2, 3];
    let obj = { name: "a", value: arr[0] };
    for (let i = 0; i < 3; i++) { obj.value += arr[i]; }
    while (obj.value > 0) { obj.value -= 1; }
  `);
  assertEqual(ast.body.length, 5);
  assertEqual(ast.body[0].type, 'FunctionDeclaration');
  assertEqual(ast.body[3].type, 'ForStatement');
  assertEqual(ast.body[4].type, 'WhileStatement');
});

test('箭头函数与三元表达式', () => {
  const ast = parse('const f = (a, b) => a > b ? a : b;');
  const init = ast.body[0].declarations[0].init;
  assertEqual(init.type, 'ArrowFunctionExpression');
  assertEqual(init.body.type, 'ConditionalExpression');
});

console.log('\n[2] 变换正确性');

test('常量折叠', () => {
  const code = generate(foldConstants(parse('let x = 1 + 2 * 3; let y = !false;')));
  assertEqual(code, 'let x = 7;\nlet y = true;');
});

test('var → let', () => {
  const code = generate(varToLet(parse('var a = 1; var b;')));
  assertEqual(code, 'let a = 1;\nlet b;');
});

test('死代码消除', () => {
  const code = generate(eliminateDeadCode(parse(`
    function f() { return 1; let x = 2; }
    if (false) { let y = 3; } else { let z = 4; }
  `)));
  assertEqual(code, 'function f() {\n  return 1;\n}\nlet z = 4;');
});

test('标识符重命名', () => {
  const code = generate(renameIdentifiers(parse('let total = a + a;'), { a: 'b' }));
  assertEqual(code, 'let total = b + b;');
});

test('变换管线保持语义', () => {
  const source = `
    function main() {
      var sum = 0;
      for (var i = 1; i <= 10; i++) { sum += i * 1; }
      if (true) { sum += 0; } else { sum = -1; }
      return sum;
    }
  `;
  const transformed = generate(applyTransforms(parse(source), ['varToLet', 'foldConstants', 'eliminateDeadCode']));
  assertSemantics(source, transformed, '管线变换后语义');
});

console.log('\n[3] 生成正确性');

test('解析→生成→再解析 往返一致', () => {
  const source = `
    function main() {
      let x = 1 + 2 * 3;
      let s = "hi";
      if (x > 5) { x = x - 1; } else { x = 0; }
      for (let i = 0; i < x; i++) { s += "!"; }
      return x;
    }
  `;
  const once = generate(parse(source));
  const twice = generate(parse(once));
  assertEqual(twice, once, '二次生成应稳定');
});

test('括号保持结合性', () => {
  assertEqual(generate(parse('let x = a - (b - c);')), 'let x = a - (b - c);');
  assertEqual(generate(parse('let x = (a + b) * c;')), 'let x = (a + b) * c;');
  assertEqual(generate(parse('let x = a / (b * c);')), 'let x = a / (b * c);');
});

test('生成代码可执行且结果正确', () => {
  const source = `
    function main() {
      let total = 0;
      for (let i = 1; i <= 100; i++) { total += i; }
      return total;
    }
  `;
  const code = generate(parse(source));
  const result = new Function(`${code}; return main();`)();
  assertEqual(result, 5050, '生成代码执行结果');
});

console.log('\n[4] 异常提示');

test('语法错误带行列信息', () => {
  let caught = null;
  try { parse('let x = ;'); } catch (err) { caught = err; }
  if (!(caught instanceof ParseError)) throw new Error('应抛出 ParseError');
  if (typeof caught.line !== 'number' || typeof caught.column !== 'number') {
    throw new Error('错误应携带行列号');
  }
  if (!/第 1 行/.test(caught.message)) throw new Error(`错误消息缺少位置: ${caught.message}`);
});

test('未闭合字符串/括号/块注释', () => {
  for (const bad of ['let s = "abc', 'let x = (1 + 2;', '/* 未闭合']) {
    let caught = null;
    try { parse(bad); } catch (err) { caught = err; }
    if (!(caught instanceof ParseError)) throw new Error(`应抛出 ParseError: ${bad}`);
  }
});

test('const 未初始化报错', () => {
  let caught = null;
  try { parse('const x;'); } catch (err) { caught = err; }
  if (!caught || !/const/.test(caught.message)) throw new Error('应提示 const 必须初始化');
});

console.log('\n[5] 性能基准');

test('大文件解析+变换+生成耗时', () => {
  // 生成约 2000 条语句的源码
  const parts = [];
  for (let i = 0; i < 1000; i++) {
    parts.push(`function fn${i}(a, b) { let t = a * ${i} + b; if (t > 10) { t = t - 1; } return t; }`);
    parts.push(`let v${i} = fn${i}(${i}, ${i + 1}) + [1, 2, 3][0] + ({ k: ${i} }).k;`);
  }
  const source = parts.join('\n');

  const t0 = performance.now();
  const ast = parse(source);
  const t1 = performance.now();
  const transformed = applyTransforms(ast, ['foldConstants', 'varToLet']);
  const t2 = performance.now();
  const output = generate(transformed);
  const t3 = performance.now();

  const parseMs = t1 - t0, transformMs = t2 - t1, genMs = t3 - t2;
  console.log(`    源码 ${source.length} 字符 / ${ast.body.length} 条语句`);
  console.log(`    解析 ${parseMs.toFixed(1)}ms，变换 ${transformMs.toFixed(1)}ms，生成 ${genMs.toFixed(1)}ms`);
  if (parseMs > 1000 || transformMs > 1000 || genMs > 1000) {
    throw new Error('性能不达标：单阶段超过 1000ms');
  }
  if (output.length === 0) throw new Error('生成结果为空');
});

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
