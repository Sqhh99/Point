# PR：test: 补 #34 打开路径、最近记录、拖放、Excel/CSV 的边界测试

- **日期：** 2026-10-12 / **分支：** `test/viewer-extra` → `feat/viewers` / **基线 commit：** `24ec7f2` / **相关记录：** [工作日志](../work-logs/2026-10-12-viewer-extra-tests.md)

## 关联
Related to #34

## 改了什么
- `packages/core/test/viewer-extra.test.ts`（36 个用例，没有 it.fails）：
  - 多个工作表，空表跳过，全部为空时显示提示；合并单元格；公式显示缓存值、不重新计算；日期按单元格格式显示（与时区无关）；
  - 2 万行在 5 秒内解析完，并截断到 2000 行；正好 2000 行时没有截断提示；
  - .xls（BIFF8）；损坏的、被截断的 xlsx 会报错；
  - CSV：UTF-8 有/无 BOM、引号/转义引号/单元格内换行、空文件、前导零；UTF-16、GBK（#34 `614264c` 修复后改为普通 it）；
  - 加密 PDF、0 字节的 pdf/docx/md、扩展名不对（pdf↔docx，docx 当 xlsx）；
  - `docTypeOf` 的边界文件名。
- `apps/desktop/test/main/open-extra.test.ts`（61 个用例，没有 it.fails）：
  - `resolveOpenTarget`：没规范化的 `..`、工作区外的绝对路径、目录、unicode/emoji 文件名、不存在的路径、超长路径、NUL、非字符串；POSIX 上的 Windows 风格路径；Windows 上的盘符相对路径、混合分隔符、末尾的点和空格；
  - 软链接：文件、目录、指向 scratch、循环、悬空；
  - 大小写不敏感的卷：文件名大小写不同也能打开；macOS 上用不同大小写的 scratch 路径会被拒绝（`ee902a6` 修复后改为普通 it）；
  - 最近记录序号：负数、小数、NaN、±Infinity、字符串、数组、对象、越界、-0；文件删除后、移走再移回；序号过期时被拒绝、不会打开别的文件；点击已移走的条目显示「找不到这个文件，可能已被移动或删除。」并从列表移除；序号对但期望的路径不对时被拒绝；
  - 拖放：http、https、javascript:、data:、about:、blob:、chrome:、前面带空格的 URL 都被拦截，什么也不打开；file:// 拖入文件或文件夹能打开；`%2e%2e` 会被规范化；不支持的文件弹错误框；带远程主机的 file URL 被忽略；编码的 NUL 被拒绝。

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 性能或重构（不改变行为）
- [x] 仅文档、CI 或构建（仅测试与记录）

## 版本号
不升版本。

## 如何测试
- [x] `pnpm lint` 和 `pnpm typecheck` 通过（合入 #34 的 `6187aab` 之后）
- [x] `pnpm test` 通过（core 138；main 265 通过、4 个由平台条件跳过）
- [ ] `pnpm e2e` 通过 —— 没跑，本 PR 不改 e2e
- [ ] Windows 和 macOS 上的 CI 全绿 —— 还没有全绿：
  - run 38279933704：Windows check 通过；macOS check 失败（#34 测试里 `/private/var` 的问题）。
  - run 38280550300：macOS check 通过（main 267 通过、2 跳过）；Windows check 失败（8.3 短路径，本 PR 16 个、#34 的 `open.test.ts` 4 个）。
  - run 38280997549（`4d10d75`）：macOS check 通过；Windows check 只有 #34 `open.test.ts` 的 4 个失败（短路径），本 PR 的测试全部通过。
  - 合入 `9615c0f` 后的新 run：推送前写的这一条，结果以 PR 页面上的 checks 为准。
- [ ] 在应用里实际走过受影响的流程 —— 不适用

## 检查项
- [ ] UI 改动附了改前改后截图 —— 无
- [ ] 数据库表结构变化附了迁移脚本和迁移测试 —— 无
- [ ] 打包布局、依赖、安全相关变化 —— 无（只测试路径校验）
- [x] AI 声明：测试和记录由测试员 bot 生成，已在本地 Linux 上运行验证

## 发现并已由 #34 修复的 bug
1. GBK、UTF-16 编码的 CSV 乱码 → `614264c`
2. 最近记录序号过期时打开别的文件 → `614264c`
3. macOS 上用不同大小写的 scratch 路径绕过检查（run 38279933704 在 macOS 上确认）→ `ee902a6`
