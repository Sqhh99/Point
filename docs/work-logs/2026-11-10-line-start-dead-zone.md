# 2026-11-10 行首 0–8px 死点

#81 Priority 2：行首 0–8px 按下再拖应能起选。基于 main `a73c479`（#82 已合）开 `feat/line-start-dead-zone`。不混工具条，不混拖过文末。

根因：在字符边缘的亚像素 caret 边界（例如行内约 5px）按下时，Chromium 的拖选可能只移动 caret、不形成选区。#78 相对当时 main 只要求死点不更多，矩阵里仍有 dx=2/5 的失败。

做法：仅当按下点落在某行 glyph 盒左缘 0–8px 内时记下 caret；`pointermove` 后若选区仍无文本且指针已离开按下 caret，则 `setBaseAndExtent` 从按下点选到指针。页边按下不记录，避免把命中区扩到页边。

本地验证（Linux/Xvfb）：typecheck 通过；vitest 211、desktop test:main 804 passed；`pdf-embedded-fonts` e2e 7/7（含新矩阵与页边单击清选区）。
