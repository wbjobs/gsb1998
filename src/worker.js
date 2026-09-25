// Web Worker：在后台线程执行 解析 → 变换 → 生成，避免阻塞 UI
importScripts('lexer.js', 'parser.js', 'traverse.js', 'transform.js', 'generator.js');

const JSE = self.JSE;

function runPipeline(code, options) {
  const stats = {};

  let t = performance.now();
  const ast = JSE.parse(code);
  stats.parseMs = performance.now() - t;

  stats.nodeCount = 0;
  JSE.traverse(ast, { enter() { stats.nodeCount++; } });

  t = performance.now();
  if (options.fold) JSE.constantFold(ast);
  if (options.dead) JSE.deadBranch(ast);
  if (options.rename) JSE.rename(ast);
  stats.transformMs = performance.now() - t;

  t = performance.now();
  const generated = JSE.generate(ast);
  stats.generateMs = performance.now() - t;

  return { ast, generated, stats };
}

function buildBenchSource(n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      'function benchFn' + i + '(x, y) {\n' +
      '  var total = x * ' + i + ' + y - 3;\n' +
      '  var arr = [1, 2, 3, total];\n' +
      '  var obj = { value: total, list: arr };\n' +
      '  if (total > 100 && y < 50) {\n' +
      '    total = total - arr[0] * 2;\n' +
      '  } else {\n' +
      '    total = total + obj.value % 7;\n' +
      '  }\n' +
      '  for (var k = 0; k < 3; k++) {\n' +
      '    total += k * 2;\n' +
      '  }\n' +
      '  return total;\n' +
      '}'
    );
  }
  parts.push('var benchResult = benchFn0(1, 2);');
  return parts.join('\n');
}

self.onmessage = function (e) {
  const { type, code, options } = e.data;
  try {
    if (type === 'run') {
      const r = runPipeline(code, options || {});
      self.postMessage({ type: 'result', ast: r.ast, generated: r.generated, stats: r.stats });
    } else if (type === 'bench') {
      const src = buildBenchSource(4000);
      const r = runPipeline(src, { fold: true, dead: true, rename: true });
      r.stats.sourceBytes = src.length;
      r.stats.generatedBytes = r.generated.length;
      r.stats.bench = true;
      self.postMessage({ type: 'result', ast: null, generated: '', stats: r.stats });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err.message || String(err),
      line: err.line,
      col: err.col
    });
  }
};
