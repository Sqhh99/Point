# 2026-10-21 公式与标题排版跟进（fix/math-followup）

- 从 main 02fa3ad 起分支（#63 合并之后）。
- **货币**：先试过在解析前转义 `$`，评审要求不改字符串，于是改成解析后的 mdast 变换。
  - 不合规则的 inlineMath 变成 text 节点，值是源切片，position 不变。
  - 只处理单个 `$`；`$$…$$` 和由 `\(…\)` 改写来的不处理。判断方法：源切片以 `$$` 开头就跳过。
- **字体**：Vite 默认 4KB 以下的资源会内联，KaTeX_Size1–4 等字体会变成 `data:font/woff2`，被 CSP 拦截。现在 assetsInlineLimit 对字体返回 false，其他资源返回 undefined，走默认规则。
  - build 产物里 KaTeX_Size 字体文件 12 个，CSS 里没有 `data:` 字体。
- **`\dfrac`**：只在行内传入宏。annotation 仍然是原始 TeX，所以分支选区、复制出的 TeX 不变。#62 的分支用例全部通过。
- **e2e**：块级高度最开始和「普通行 ×1.8」比较，不稳定，因为块级 `\dfrac` 只有约 36px。改成和行内分式的 katex-html 高度比（×1.3）。
- **颜色**：`--danger` 现有值两个主题都 ≥ 4.5:1，值没有改，只加了测试。
- 截图对应提交 `b776f6c`。
