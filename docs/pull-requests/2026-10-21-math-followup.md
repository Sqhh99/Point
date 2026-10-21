# fix(chat): 公式与标题排版跟进

v0.2.2 批次，是 #62（公式渲染）的跟进。不改版本号。

## 问题与修复
1. **价格被当成公式**：`价格 $5 和 $10 都行。` 被渲染成公式。
   - 现在在解析之后做一次 mdast 变换，按 Pandoc 规则判断：单个 `$` 的行内公式，如果开头 `$` 后面是空白，或结尾 `$` 前面是空白、后面紧跟数字，就不算公式。
   - 不算公式的节点改成 text 节点，值是源切片，position 不变。
   - 解析前不改写、不转义字符串。
   - rendered-map 和渲染端共用这一判断，所以价格文字的追问锚点和源文完全一致。
2. **公式字号**：对话里 `.katex` 是正文的 1.05em（KaTeX 默认是 1.21em）。标题里的公式是 1em。
3. **标题字号**：
   - h1 18px/600，margin 20px 0 8px；
   - h2 16px/600，margin 16px 0 6px；
   - h3 15px/600；
   - 第一个标题没有上边距（沿用 `.markdown > :first-child`）。
4. **字体不内联**：renderer 的 `build.assetsInlineLimit` 对 .woff/.woff2/.ttf/.otf/.eot 一律不内联（`apps/desktop/vite-assets.ts`）。
   - 原因：小字体（如 KaTeX_Size*）原本会被内联成 `data:` URI，被 CSP（`default-src 'self'`）拦截，`\bigg` 会显示错。
   - CSP 不变。
5. **行内 `\dfrac`**：只在 `displayMode: false`（行内公式、标题里的公式）时用 KaTeX 宏 `{"\\dfrac": "\\frac"}`，行内分式不再把行高撑大。
   - 块级公式里的 `\dfrac` 不变。
   - 保存的消息文字、rendered-map 的 LaTeX 源码和 TeX annotation 都还是 `\dfrac`。
6. **块级公式框**：
   - margin 12px 0，没有左右边距，占满正文宽度；
   - padding-block 4px；
   - 横向滚动条高 6px，轨道透明；
   - 滑块 `color-mix(in srgb, currentColor 20%, transparent)`，悬停 35%，圆角 3px。
   - 没有写死颜色，深浅主题通用。
7. **错误公式颜色**：用 `var(--danger)`，值不需要改。对比度：

   | 主题 | --danger | --bg | --panel | --bg-elevated |
   | --- | --- | --- | --- | --- |
   | 浅色 | #cf222e | 5.13:1 | 4.74:1 | 5.36:1 |
   | 深色 | #ff6b6b | 6.20:1 | 5.72:1 | 5.16:1 |

   全部 ≥ 4.5:1，有单测锁定。

## 截图（提交 `b776f6c`）
浅色：

![](https://raw.githubusercontent.com/Sqhh99/Point/b776f6c6aa20996b2a92c239344d244e39d56bc6/docs/assets/pr/2026-10-21-math-followup.png)

深色：

![](https://raw.githubusercontent.com/Sqhh99/Point/b776f6c6aa20996b2a92c239344d244e39d56bc6/docs/assets/pr/2026-10-21-math-followup-dark.png)

## 测试计划
- [x] core vitest 208 项。`rendered-map.test.ts` 新增「Pandoc dollar rule」：
  - 价格行没有公式，可见文字等于源文；
  - 选中「$5 和 $10」得到锚点 `{start:3,end:11}`，quote 与源切片一致；
  - 空白和数字的几种情况；
  - `$$x$$`、`\(y\)`、块级 `$$` 仍然是公式；
  - 代码里的不受影响。

  其中 3 项修复前失败。
- [x] desktop test:main。
  - `math-render.test.ts` 新增 3 项：行内 `\dfrac` 和 `\frac` 输出一致（annotation 除外，仍是 `\dfrac`）；块级不受影响；价格不渲染。修复前有 2 项失败。
  - 新增 `chat-typography.test.ts`：KaTeX 字号、标题、块级框和滚动条、`--danger` 对比度 ≥ 4.5:1（两个主题、三种背景），以及 assetsInlineLimit。
  - fork-sibling-extra 有一次在满负载下超时，单独重跑 23/23 通过，和本 PR 无关。
- [x] e2e 36 项全部通过（本地 xvfb + keyring）。新增 TYPO-PROBE 用例：
  - 价格行是纯文字，没有 `.katex`；
  - 行内公式字号比例 1.05±0.01，标题内 1±0.01；
  - h1/h2 的 computed 字号、字重、边距；
  - 行内分式所在行和普通行高度差 ≤ 4px；块级 `\dfrac` 高度 > 行内分式的 1.3 倍；
  - 块级框 margin、padding、宽度等于正文宽度；长公式可以滚动，滚动条高 6px；
  - 错误文字颜色等于 `--danger`；
  - 没有 `data:` 字体，KaTeX_Size 字体已加载，控制台没有 CSP 报错。
- [x] 本地 `pnpm install --frozen-lockfile` 通过（pnpm 10.34.6），lockfile 没有改动
- [ ] 六项 CI 全绿
