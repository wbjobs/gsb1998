// Web Worker：在后台线程执行解析/变换/生成，避免阻塞 UI。
// 消息协议：
//   请求  { id, action: 'run'|'benchmark', source, transforms }
//   响应  { id, ok, result?, error?, errorLine?, errorColumn? }

import { parse } from './parser.js';
import { generate } from './generator.js';
import { applyTransforms } from './transform.js';
import { ParseError } from './lexer.js';

function runPipeline(source, transforms) {
  const t0 = performance.now();
  const ast = parse(source);
  const t1 = performance.now();
  const transformed = applyTransforms(ast, transforms);
  const t2 = performance.now();
  const code = generate(transformed);
  const t3 = performance.now();
  return {
    ast: transformed,
    code,
    stats: {
      parseMs: +(t1 - t0).toFixed(2),
      transformMs: +(t2 - t1).toFixed(2),
      generateMs: +(t3 - t2).toFixed(2),
      totalMs: +(t3 - t0).toFixed(2),
      sourceBytes: source.length,
      nodeCount: countNodes(transformed),
    },
  };
}

function countNodes(node) {
  let count = 0;
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current.type !== 'string') continue;
    count += 1;
    for (const key of Object.keys(current)) {
      if (key === 'loc') continue;
      const child = current[key];
      if (Array.isArray(child)) stack.push(...child);
      else if (child && typeof child === 'object') stack.push(child);
    }
  }
  return count;
}

function benchmark(source, transforms, iterations) {
  const times = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    generate(applyTransforms(parse(source), transforms));
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    iterations,
    minMs: +times[0].toFixed(2),
    medianMs: +times[Math.floor(times.length / 2)].toFixed(2),
    maxMs: +times[times.length - 1].toFixed(2),
  };
}

self.onmessage = (event) => {
  const { id, action, source, transforms = [], iterations = 20 } = event.data;
  try {
    if (action === 'run') {
      self.postMessage({ id, ok: true, result: runPipeline(source, transforms) });
    } else if (action === 'benchmark') {
      self.postMessage({ id, ok: true, result: benchmark(source, transforms, iterations) });
    } else {
      throw new Error(`未知操作: ${action}`);
    }
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err.message,
      errorLine: err instanceof ParseError ? err.line : null,
      errorColumn: err instanceof ParseError ? err.column : null,
    });
  }
};
