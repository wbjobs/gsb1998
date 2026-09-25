# JS 子集 AST 工作室

纯前端实现的 JS 子集编译工具链：解析 → AST 变换 → 代码生成，
使用 **Web Worker**（后台计算）、**Canvas**（AST 可视化）、**IndexedDB**（片段与历史持久化）。

## 运行

```bash
npm run serve   # 打开 http://localhost:8080
npm test        # 运行正确性与性能测试（Node 环境）
```

## 支持的 JS 子集

- `var` / `let` / `const` 声明，函数声明、函数表达式、箭头函数
- `if` / `else`、`while`、`for`、`return`、`break`、`continue`、块语句
- 数字 / 字符串 / 布尔 / `null` 字面量，数组、对象字面量
- 二元（算术 / 比较 / 逻辑 / 位运算移位）、一元（`!` `-` `+` `typeof`）、
  三元、赋值（`=` `+=` 等）、自增自减表达式
- 函数调用、成员访问（点与下标）

## 模块结构

| 文件 | 职责 |
| --- | --- |
| `src/lexer.js` | 词法分析，产出带行列号的 Token 流；`ParseError` 异常类型 |
| `src/parser.js` | 递归下降语法分析，产出 ESTree 风格 AST |
| `src/transform.js` | 遍历器 + 常量折叠 / `var`→`let` / 死代码消除 / 重命名 |
| `src/generator.js` | AST → 格式化代码，按优先级自动补括号 |
| `src/worker.js` | Web Worker：后台执行管线与基准，回传耗时统计 |
| `src/ast-canvas.js` | Canvas 绘制 AST 树形图（tidy 布局、自适应缩放） |
| `src/storage.js` | IndexedDB：代码片段存取、运行历史记录 |
| `src/main.js` | UI 事件、Worker 通信、错误高亮、统计展示 |
| `test/run.mjs` | 15 项测试：解析准确性 / 变换正确性 / 生成正确性 / 异常提示 / 性能基准 |

## 验收标准对应

- **解析准确**：优先级、结合性测试 + 解析→生成→再解析往返一致
- **变换正确**：每种变换有断言；管线变换前后用 `Function` 执行对比语义
- **生成正确**：生成代码可直接执行并验证结果（如 1..100 求和 = 5050）
- **性能可接受**：14 万字符源码解析 ≈30ms、变换 ≈80ms、生成 ≈8ms；
  页面内「性能基准」按钮可在 Worker 中跑 30 次迭代取中位数
- **异常有提示**：`ParseError` 携带行列号，页面红色横幅提示并自动定位光标
