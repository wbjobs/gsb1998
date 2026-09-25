'use strict';
// 用法：node test/run-tests.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ---------- 加载引擎（与浏览器/Worker 同一套源码） ----------
const ctx = { console };
ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['lexer.js', 'parser.js', 'traverse.js', 'transform.js', 'generator.js']) {
  const file = path.join(__dirname, '..', 'src', f);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: f });
}
const JSE = ctx.JSE;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
    process.exitCode = 1;
  }
}

function stripRaw(node) {
  JSE.traverse(node, {
    enter(n) { delete n.raw; }
  });
  return node;
}

function pipeline(code, options) {
  const ast = JSE.parse(code);
  if (options.fold) JSE.constantFold(ast);
  if (options.dead) JSE.deadBranch(ast);
  if (options.rename) JSE.rename(ast);
  return JSE.generate(ast);
}

function evalCode(code) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.__result;
}

// ---------- 1. 解析准确性 ----------
console.log('\n[1] 解析准确性');
test('变量声明与运算符优先级', () => {
  const ast = JSE.parse('var x = 1 + 2 * 3;');
  assert.strictEqual(ast.body[0].type, 'VariableDeclaration');
  const init = ast.body[0].declarations[0].init;
  assert.strictEqual(init.type, 'BinaryExpression');
  assert.strictEqual(init.operator, '+');
  assert.strictEqual(init.right.operator, '*'); // * 优先级高于 +
});

test('函数 / 控制流 / 数组对象字面量', () => {
  const code = 'function f(a, b) { if (a > b) { return [a, b]; } return { v: a }; }';
  const ast = JSE.parse(code);
  const fn = ast.body[0];
  assert.strictEqual(fn.type, 'FunctionDeclaration');
  assert.strictEqual(fn.params.length, 2);
  assert.strictEqual(fn.body.body[0].type, 'IfStatement');
  assert.strictEqual(fn.body.body[0].consequent.body[0].argument.type, 'ArrayExpression');
  assert.strictEqual(fn.body.body[1].argument.type, 'ObjectExpression');
});

test('注释、字符串转义、科学计数法', () => {
  const ast = JSE.parse('/* c */ var s = "a\\nb"; // x\nvar n = 1.5e3;');
  assert.strictEqual(ast.body[0].declarations[0].init.value, 'a\nb');
  assert.strictEqual(ast.body[1].declarations[0].init.value, 1500);
});

// ---------- 2. 生成正确性（解析→生成→再解析，AST 一致） ----------
console.log('\n[2] 生成正确性（往返一致）');
const ROUND_TRIP = [
  'var x = 1 + 2 * 3 - (4 / 2);',
  'var s = "he\\"llo"; var b = true; var z = null;',
  'function f(a, b) { var c = a * b; return c; }',
  'if (x < 1) { y = 1; } else if (x < 2) { y = 2; } else { y = 3; }',
  'while (i < 10) { i++; if (i == 5) { break; } }',
  'for (var i = 0, j = 9; i < j; i++) { sum += i * j; }',
  'var a = [1, "two", [3]]; var o = { k: 1, "s k": 2, m: a };',
  'obj.prop[0].method(a, b + c);',
  'x = a && b || !c; y = typeof z === "number";',
  'var g = function (t) { return -t; }; var h = g(1) % 2;',
  'a += 1; b -= 2; c *= 3; d /= 4;'
];
for (const code of ROUND_TRIP) {
  test('往返一致: ' + code.slice(0, 40), () => {
    const ast1 = stripRaw(JSE.parse(code));
    const gen = JSE.generate(ast1);
    new vm.Script(gen); // 生成代码必须是合法 JS
    const ast2 = stripRaw(JSE.parse(gen));
    assert.deepStrictEqual(ast2, ast1);
  });
}

// ---------- 3. 变换正确性（语义等价） ----------
console.log('\n[3] 变换正确性（语义等价）');
const SEMANTIC = [
  'var result = 0; for (var i = 0; i < 10; i++) { result = result + i * 2; }',
  'function fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); } var result = fib(12);',
  'var result = 0; var i = 0; while (i < 100) { i += 7; if (i > 50) { break; } result = i; }',
  'var o = { a: 1, b: [1, 2, 3] }; var result = o.b[0] + o.b[2] * o.a;',
  'var result = (true && "x") || "y"; result = result + "!";',
  'var result = 0; function make() { var x = 5; return function () { return x; }; } var f = make(); result = f();',
  'var x = 1; function s(x) { var y = x + 1; return y; } var result = s(10) + x;',
  'var result = 1 + 2 * 3; if (result > 100 && false) { result = -1; } else { result = result + 1; }',
  'var result = 0; for (var i = 0; i < 5; i++) { if (i == 2) { continue; } result += i; }',
  'var result = typeof 1 + "," + typeof "s" + "," + typeof true;'
];
for (const code of SEMANTIC) {
  test('语义等价: ' + code.slice(0, 40), () => {
    const wrapped = code + '\n__result = result;';
    const expected = evalCode(pipeline(wrapped, {})); // 仅解析+生成
    const actual = evalCode(pipeline(wrapped, { fold: true, dead: true, rename: true }));
    assert.deepStrictEqual(actual, expected);
  });
}

test('常量折叠确实生效', () => {
  const out = pipeline('var x = 1 + 2 * 3;', { fold: true });
  assert.ok(/var x = 7;/.test(out), out);
});

test('死代码消除确实生效', () => {
  const out = pipeline('if (false) { a = 1; } else { a = 2; } while (false) { b = 1; }', { fold: true, dead: true });
  assert.ok(!/while/.test(out), out);
  assert.ok(/a = 2/.test(out), out);
});

test('重命名不破坏遮蔽与闭包', () => {
  const code = 'var value = 1; function f(value) { return value + 1; } var r = f(10) + value;\n__result = r;';
  const out = pipeline(code, { rename: true });
  assert.strictEqual(evalCode(out), 12);
});

// ---------- 4. 异常提示 ----------
console.log('\n[4] 异常提示');
const BAD_CODE = [
  ['var 1x = 2;', '标识符'],
  ['var x = ;', '表达式'],
  ['function f( {', '标识符'],
  ['var s = "abc', '字符串'],
  ['if (x { y = 1; }', '")"'],
  ['var a = [1, 2;', '"]"'],
  ['x = 1 @ 2;', '字符'],
  ['++1;', '操作数'],
  ['/* 未闭合', '注释']
];
for (const [code, hint] of BAD_CODE) {
  test('报错含位置与提示: ' + JSON.stringify(code.slice(0, 18)), () => {
    let err = null;
    try { JSE.parse(code); } catch (e) { err = e; }
    assert.ok(err, '应当抛出异常');
    assert.strictEqual(err.name, 'JSEError');
    assert.ok(typeof err.line === 'number' && err.line >= 1);
    assert.ok(typeof err.col === 'number' && err.col >= 1);
    assert.ok(err.message.includes('行'), err.message);
    assert.ok(err.message.includes(hint), err.message + ' 应包含提示「' + hint + '」');
  });
}

test('错误行号定位准确', () => {
  let err = null;
  try { JSE.parse('var a = 1;\nvar b = 2;\nvar c = ;'); } catch (e) { err = e; }
  assert.strictEqual(err.line, 3);
});

// ---------- 5. 性能 ----------
console.log('\n[5] 性能基准');
(function perf() {
  const parts = [];
  for (let i = 0; i < 4000; i++) {
    parts.push(
      'function benchFn' + i + '(x, y) {\n' +
      '  var total = x * ' + i + ' + y - 3;\n' +
      '  var arr = [1, 2, 3, total];\n' +
      '  var obj = { value: total, list: arr };\n' +
      '  if (total > 100 && y < 50) { total = total - arr[0] * 2; }\n' +
      '  else { total = total + obj.value % 7; }\n' +
      '  for (var k = 0; k < 3; k++) { total += k * 2; }\n' +
      '  return total;\n' +
      '}'
    );
  }
  const src = parts.join('\n');
  console.log('  源码规模: ' + (src.length / 1024).toFixed(0) + ' KB, 4000 个函数');

  let t = performance.now();
  const ast = JSE.parse(src);
  const parseMs = performance.now() - t;

  let nodes = 0;
  JSE.traverse(ast, { enter() { nodes++; } });

  t = performance.now();
  JSE.constantFold(ast);
  JSE.deadBranch(ast);
  JSE.rename(ast);
  const transformMs = performance.now() - t;

  t = performance.now();
  const gen = JSE.generate(ast);
  const genMs = performance.now() - t;

  new vm.Script(gen); // 生成结果必须可编译

  console.log('  解析: ' + parseMs.toFixed(1) + ' ms (' + nodes + ' 节点)');
  console.log('  变换: ' + transformMs.toFixed(1) + ' ms');
  console.log('  生成: ' + genMs.toFixed(1) + ' ms');
  console.log('  总计: ' + (parseMs + transformMs + genMs).toFixed(1) + ' ms');

  assert.ok(parseMs < 3000, '解析耗时过长: ' + parseMs);
  assert.ok(transformMs < 3000, '变换耗时过长: ' + transformMs);
  assert.ok(genMs < 3000, '生成耗时过长: ' + genMs);
  passed++;
  console.log('  ✓ 性能在可接受范围内');
})();

console.log('\n完成：' + passed + ' 项通过' + (process.exitCode ? '，存在失败项' : ''));
