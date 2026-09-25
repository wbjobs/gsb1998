// 主线程：UI 事件、Worker 通信、Canvas 渲染、IndexedDB 读写。

import { renderAST } from './ast-canvas.js';
import { saveSnippet, loadSnippet, listSnippets, deleteSnippet, addHistory, listHistory } from './storage.js';

const $ = (id) => document.getElementById(id);

const editor = $('editor');
const output = $('output');
const errorBox = $('error');
const statsBox = $('stats');
const canvas = $('ast-canvas');
const snippetList = $('snippet-list');
const historyList = $('history-list');

// ---------- Worker 通信 ----------

const worker = new Worker('./src/worker.js', { type: 'module' });
let nextId = 1;
const pending = new Map();

worker.onmessage = (event) => {
  const { id } = event.data;
  const handler = pending.get(id);
  if (handler) {
    pending.delete(id);
    handler(event.data);
  }
};

worker.onerror = (event) => {
  showError(`Worker 错误: ${event.message}`);
};

function callWorker(action, payload) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    worker.postMessage({ id, action, ...payload });
  });
}

// ---------- UI 辅助 ----------

function selectedTransforms() {
  return [...document.querySelectorAll('input[name="transform"]:checked')]
    .map((box) => box.value);
}

function showError(message, line = null, column = null) {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
  if (line !== null) highlightErrorLine(line, column);
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.remove('visible');
}

function highlightErrorLine(line, column) {
  // 简单提示：将光标移动到出错位置
  const lines = editor.value.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i += 1) offset += lines[i].length + 1;
  const pos = offset + Math.max(0, (column || 1) - 1);
  editor.focus();
  editor.setSelectionRange(pos, pos);
}

function showStats(stats) {
  statsBox.innerHTML = [
    ['解析', stats.parseMs], ['变换', stats.transformMs],
    ['生成', stats.generateMs], ['总计', stats.totalMs],
  ].map(([label, ms]) => `<span>${label} <b>${ms}ms</b></span>`).join('')
    + `<span>节点 <b>${stats.nodeCount}</b></span>`
    + `<span>源码 <b>${stats.sourceBytes}B</b></span>`;
}

// ---------- 核心动作 ----------

async function runPipeline() {
  clearError();
  const source = editor.value;
  const transforms = selectedTransforms();
  const response = await callWorker('run', { source, transforms });
  if (!response.ok) {
    output.value = '';
    showError(response.error, response.errorLine, response.errorColumn);
    return;
  }
  const { ast, code, stats } = response.result;
  output.value = code;
  showStats(stats);
  renderAST(canvas, ast);
  await addHistory({ transforms, stats, preview: source.slice(0, 80) });
  refreshHistory();
}

async function runBenchmark() {
  clearError();
  statsBox.textContent = '基准运行中…';
  const response = await callWorker('benchmark', {
    source: editor.value, transforms: selectedTransforms(), iterations: 30,
  });
  if (!response.ok) {
    showError(response.error, response.errorLine, response.errorColumn);
    statsBox.textContent = '';
    return;
  }
  const r = response.result;
  statsBox.innerHTML = `<span>${r.iterations} 次迭代</span>`
    + `<span>最快 <b>${r.minMs}ms</b></span>`
    + `<span>中位 <b>${r.medianMs}ms</b></span>`
    + `<span>最慢 <b>${r.maxMs}ms</b></span>`;
}

// ---------- IndexedDB 片段与历史 ----------

async function refreshSnippets() {
  const snippets = await listSnippets();
  snippetList.innerHTML = '';
  for (const item of snippets) {
    const li = document.createElement('li');
    const loadBtn = document.createElement('button');
    loadBtn.textContent = item.name;
    loadBtn.onclick = async () => {
      const source = await loadSnippet(item.name);
      if (source !== null) editor.value = source;
    };
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.className = 'danger';
    delBtn.onclick = async () => {
      await deleteSnippet(item.name);
      refreshSnippets();
    };
    li.append(loadBtn, delBtn);
    snippetList.appendChild(li);
  }
}

async function refreshHistory() {
  const records = await listHistory(10);
  historyList.innerHTML = '';
  for (const record of records) {
    const li = document.createElement('li');
    const time = new Date(record.createdAt).toLocaleTimeString();
    li.textContent = `${time} · ${record.transforms.join('+') || '无变换'} · ${record.stats.totalMs}ms · ${record.preview}`;
    historyList.appendChild(li);
  }
}

// ---------- 事件绑定 ----------

$('run').onclick = runPipeline;
$('benchmark').onclick = runBenchmark;
$('save').onclick = async () => {
  const name = $('snippet-name').value.trim();
  if (!name) {
    showError('请输入片段名称');
    return;
  }
  clearError();
  await saveSnippet(name, editor.value);
  refreshSnippets();
};

// 画布尺寸自适应
function resizeCanvas() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
}
window.addEventListener('resize', () => { resizeCanvas(); runPipeline(); });

// 初始示例
editor.value = `// 示例：斐波那契 + 常量折叠演示
function fib(n) {
  if (n <= 1) { return n; }
  return fib(n - 1) + fib(n - 2);
}

var offset = 1 + 2 * 3;
var unused = 100;

function main() {
  var total = fib(10) + offset;
  if (false) { total = -1; }
  return total;
  total = 999;
}
`;

resizeCanvas();
refreshSnippets();
refreshHistory();
runPipeline();
