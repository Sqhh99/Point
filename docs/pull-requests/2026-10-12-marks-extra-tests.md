# PR：test: 补 ④ 标记与一起问的迁移、外键、标记位置校验和一起问的测试

- **日期：** 2026-10-12 / **分支：** `test/marks-extra` → `main` / **基线 commit：** `5b43d8c` / **相关记录：** [工作日志](../work-logs/2026-10-12-marks-extra-tests.md)

## 关联
Related to #40

## 改了什么
新增 `apps/desktop/test/main/marks-extra.test.ts`（74 个用例）：
- **迁移 003：**
  - 是第三个迁移，会建 `marks_by_doc` 索引；
  - 依次执行 v1 → v2 → v3，v1 和 v2 都还没有 marks 表；
  - 重复执行、重新跑一遍 SQL 都不改变数据；
  - 磁盘上的 v2 数据库通过 `openWorkspace` 升级到 v3，文档保留。
- **外键：**
  - 打开、切换、重新打开工作区后，`foreign_keys` 都是 1；
  - 显式关掉外键时不会级联删除，证明这个设置起作用；
  - 在真实工作区里删除文档，只删它自己的标记，截图文件保留；
  - 用原始 SQL 也不能给不存在的文档插入标记；
  - 几个标记共用一个 sha 时，全部删除后截图文件仍在。
- **标记位置（anchor）：**
  - 文本标记各字段取到上限值时能原样读回；
  - **区域标记只断言 sha 和 page**，这样 fix/marks-followup 改成 rect 之后这条测试不会坏；
  - **存进数据库的 anchor_json 没有 path、imagePath、file、url 字段，也不含 `/` 或 `\`。** 现在的代码本来就不存路径，所以是普通 `it`，并且已经通过；
  - 文本会去掉首尾空白，未知字段和值为 null 的可选字段会被去掉；
  - 26 种非法输入都被拒绝；
  - 数据库里被手改坏的 anchor_json（4 种）在 list、get、updateNote 时都会被跳过。
- **`isCaptureSha`：** main 重新导出的就是 core 里的同一个函数，11 种输入的结果一致。
- **一起问：**
  - 内容按勾选顺序排列，不按创建顺序，图片紧跟在对应标记的位置；
  - 重复的标记 id 只保留第一次出现的位置；
  - 正好 20 个可以，21 个被拒绝，也不会创建对话；`buildBatchMessage` 本身也检查这个上限；
  - 其他文档的标记、混了两个文档的标记都被拒绝；
  - 区域标记的截图在之后被删掉了：明确报错，也不会创建对话；
  - 数据库里区域标记的 sha 被改成非法值：报“标记不存在”；
  - 创建区域标记时 sha 非法或文件不存在：被拒绝；
  - 模型不支持看图：返回 `code: no_vision`，不调用模型，不创建对话；
  - 标记和截图一起发、或者不是“问”这种任务：被拒绝；格式不对的标记 id 被拒绝。
  - **docId 为 `""` 或不传时，标记不检查属于哪个文档，标 `it.fails`。**

## 发现的 bug（未修，标 `it.fails`，已确认会失败）
1. `apps/desktop/src/main/marks-ipc.ts:38`（`loadBatch` 写的是 `if (!m || (docId && m.docId !== docId))`）和 `apps/desktop/src/main/tasks-ipc.ts:26`（`validate` 里 `docId: str(r.docId, 64)`）：docId 为空或不传时，不同文档的标记可以放进同一个问题。

## 与 fix/marks-followup 的关系
- 区域标记的往返测试只断言 sha 和 page，不断言 width/height 的具体形状，所以 RegionAnchor 改成 rect 后不会坏。
- “anchor_json 里没有 path/imagePath”这条现在就通过；followup 之后应该继续通过。

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 性能或重构（不改变行为）
- [x] 仅文档、CI 或构建（仅测试与记录）

## 版本号
不升版本。

## 如何测试
- [x] `pnpm lint` 和 `pnpm typecheck` 通过
- [x] `pnpm test` 通过（core 143；main 613 通过、4 跳过，都是已有 `open-extra` 里由平台条件控制的用例）
- [ ] `pnpm e2e` 通过 —— 没跑，本 PR 不改 e2e
- [ ] Windows 和 macOS 上的 CI 全绿 —— 推送后等 CI，结果以 PR 页面上的 checks 为准
- [ ] 在应用里实际走过受影响的流程 —— 不适用

## 检查项
- [ ] UI 改动附了改前改后截图 —— 无
- [ ] 数据库表结构变化附了迁移脚本和迁移测试 —— 不改表结构，只是测试迁移 003
- [ ] 打包布局、依赖、安全相关变化 —— 无
- [x] AI 声明：测试和记录由测试员 bot 生成，已在本地 Linux 上运行验证
