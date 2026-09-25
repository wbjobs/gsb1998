// 主线程：UI 装配。优先使用 Web Worker 执行流水线，Worker 不可用时回退主线程。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const els = {
    src: $('src'),
    out: $('output'),
    err: $('errors'),
    stats: $('stats'),
    canvas: $('ast-canvas'),
    snippetName: $('snippet-name'),
    snippetList: $('snippet-list')
  };
  const view = JSE.createAstView(els.canvas);

  const SAMPLE = [
    '// 示例：斐波那契 + 常量折叠 + 循环',
    'function fib(n) {',
    '  if (n < 2) {',
    '    return n;',
    '  } else {',
    '    return fib(n - 1) + fib(n - 2);',
    '  }',
    '}',
    '',
    'var limit = 2 * 5;',
    'var total = 0;',
    'for (var i = 0; i < limit; i++) {',
    '  total += fib(i);',
    '}',
    '',
    'if (total > 100 && false) {',
    '  total = -1;',
    '} else {',
    '  total = total + 1;',
    '}',
    '',
    'var info = { label: "sum", values: [total, fib(5)] };',
    'var result = info.values[0] + info.values[1];'
  ].join('\n');
  els.src.value = SAMPLE;

  function getOptions() {
    return {
      fold: $('opt-fold').checked,
      dead: $('opt-dead').checked,
      rename: $('opt-rename').checked
    };
  }

  // ---------- 流水线执行（Worker 优先，失败回退主线程） ----------
  function runInWorker(code, options, bench) {
    return new Promise(resolve => {
      let w;
      try {
        w = new Worker('src/worker.js');
      } catch (e) {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => { w.terminate(); resolve(null); }, 15000);
      w.onmessage = e => {
        clearTimeout(timer);
        w.terminate();
        resolve(e.data);
      };
      w.onerror = () => {
        clearTimeout(timer);
        w.terminate();
        resolve(null);
      };
      w.postMessage(bench ? { type: 'bench' } : { type: 'run', code, options });
    });
  }

  function runLocal(code, options) {
    try {
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
      return { type: 'result', ast, generated, stats };
    } catch (err) {
      return { type: 'error', message: err.message, line: err.line, col: err.col };
    }
  }

  // ---------- 展示 ----------
  function showError(res) {
    els.err.classList.remove('hidden');
    let html = '<strong>出错了：</strong>' + escapeHtml(res.message);
    if (res.line !== undefined) {
      html += '<br>提示：请检查第 ' + res.line + ' 行第 ' + res.col
        + ' 列附近的语法（括号、引号、分号是否配对）。';
    }
    els.err.innerHTML = html;
  }

  function hideError() {
    els.err.classList.add('hidden');
    els.err.innerHTML = '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    }[c]));
  }

  function showStats(stats, via) {
    const rows = [
      ['执行方式', via],
      ['解析耗时', stats.parseMs.toFixed(2) + ' ms'],
      ['变换耗时', stats.transformMs.toFixed(2) + ' ms'],
      ['生成耗时', stats.generateMs.toFixed(2) + ' ms'],
      ['AST 节点数', String(stats.nodeCount)]
    ];
    if (stats.sourceBytes !== undefined) {
      rows.push(['基准源码大小', (stats.sourceBytes / 1024).toFixed(1) + ' KB']);
      rows.push(['生成代码大小', (stats.generatedBytes / 1024).toFixed(1) + ' KB']);
    }
    els.stats.innerHTML = rows
      .map(r => '<div class="stat-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>')
      .join('');
  }

  async function run() {
    hideError();
    const code = els.src.value;
    const options = getOptions();
    let res = await runInWorker(code, options, false);
    let via = 'Web Worker';
    if (!res) {
      res = runLocal(code, options);
      via = '主线程（Worker 不可用，已自动回退）';
    }
    if (res.type === 'error') {
      showError(res);
      els.out.textContent = '';
      return;
    }
    els.out.textContent = res.generated;
    view.render(res.ast);
    showStats(res.stats, via);
  }

  async function bench() {
    hideError();
    els.stats.textContent = '正在执行性能基准（约 4000 个函数）…';
    let res = await runInWorker(null, null, true);
    let via = 'Web Worker';
    if (!res) {
      // 主线程回退：构造同样的基准源码
      const src = [];
      for (let i = 0; i < 4000; i++) {
        src.push('function benchFn' + i + '(x, y) { var t = x * ' + i + ' + y; return t; }');
      }
      res = runLocal(src.join('\n'), { fold: true, dead: true, rename: true });
      if (res.stats) {
        res.stats.sourceBytes = src.join('\n').length;
        res.stats.generatedBytes = res.generated ? res.generated.length : 0;
      }
      via = '主线程（Worker 不可用，已自动回退）';
    }
    if (res.type === 'error') {
      showError(res);
      return;
    }
    showStats(res.stats, via + ' · 性能基准');
  }

  // ---------- IndexedDB 代码片段 ----------
  async function refreshSnippets() {
    try {
      const items = await JSE.db.listSnippets();
      if (items.length === 0) {
        els.snippetList.innerHTML = '<div class="muted">暂无已保存的代码片段</div>';
        return;
      }
      els.snippetList.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'snippet-row';
        const name = document.createElement('span');
        name.textContent = item.name + '（' + new Date(item.time).toLocaleString() + '）';
        const loadBtn = document.createElement('button');
        loadBtn.textContent = '加载';
        loadBtn.onclick = () => { els.src.value = item.code; run(); };
        const delBtn = document.createElement('button');
        delBtn.textContent = '删除';
        delBtn.onclick = async () => {
          await JSE.db.deleteSnippet(item.id);
          refreshSnippets();
        };
        row.appendChild(name);
        row.appendChild(loadBtn);
        row.appendChild(delBtn);
        els.snippetList.appendChild(row);
      }
    } catch (e) {
      els.snippetList.innerHTML = '<div class="muted">IndexedDB 不可用：'
        + escapeHtml(e.message) + '</div>';
    }
  }

  $('btn-run').onclick = run;
  $('btn-bench').onclick = bench;
  $('btn-save').onclick = async () => {
    const name = els.snippetName.value.trim()
      || '未命名 ' + new Date().toLocaleString();
    try {
      await JSE.db.saveSnippet(name, els.src.value);
      els.snippetName.value = '';
      refreshSnippets();
    } catch (e) {
      showError({ message: '保存到 IndexedDB 失败：' + e.message });
    }
  };

  refreshSnippets();
  run();
})();
