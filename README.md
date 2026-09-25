# JSE Studio — JS 子集解析 · AST 变换 · 代码生成

纯前端实现的 JS 子集编译工具链：**解析（Parser）→ AST 变换（Transform）→ 代码生成（Generator）**，并使用 **Web Worker**（后台执行流水线）、**Canvas**（AST 树可视化）、**IndexedDB**（代码片段持久化）。

## 运行

```bash
cd A
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

> 直接双击 `index.html`（file://）也能用：Worker 被浏览器拦截时会自动回退到主线程执行，界面会提示执行方式。

## 测试

```bash
node test/run-tests.js
```

覆盖：解析准确性、生成往返一致性（parse→generate→parse AST 全等）、变换语义等价（在 VM 中运行原代码与变换后代码比对结果）、异常提示（行/列定位）、性能基准（约 1.2 MB / 4000 函数 / 33 万 AST 节点，全流程 < 1s）。

## 支持的 JS 子集

- 声明：`var` / `let` / `const`、函数声明、函数表达式
- 语句：`if/else`、`while`、`for`、`return`、`break`、`continue`、块、表达式语句
- 表达式：算术/比较/相等/逻辑运算、一元（`! - + typeof`）、`++/--`、赋值（`= += -= *= /=`）、调用、成员访问（`.` / `[]`）、数组/对象字面量
- 字面量：数字（含科学计数法）、字符串（含转义）、`true/false/null`
- 注释：`//` 与 `/* */`

## 内置变换

- **常量折叠**：`1 + 2 * 3` → `7`，逻辑短路化简
- **死代码消除**：`if (false) {...}`、常量条件分支、`while (false)` 移除
- **变量重命名**：作用域感知（遮蔽、闭包、函数参数正确处理），生成 `a, b, ..., aa` 短名并避开保留字

## 目录结构

```
index.html          页面入口
css/style.css       样式
src/lexer.js        词法分析（带行/列的错误）
src/parser.js       递归下降解析器（优先级爬升）
src/traverse.js     AST 通用遍历 / 节点替换
src/transform.js    常量折叠、死代码消除、作用域感知重命名
src/generator.js    优先级感知的代码生成器
src/worker.js       Web Worker（流水线 + 性能基准）
src/astview.js      Canvas AST 树（自动布局、平移缩放）
src/db.js           IndexedDB 封装
src/main.js         UI 装配（Worker 优先，失败回退主线程）
test/run-tests.js   Node 测试套件（38 项）
```
