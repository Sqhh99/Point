# 测试：Windows 目录联接（junction）下的截图加固

日期：2026-10-12　分支：`test/capture-junction` → `main`　基线：`f2204b0`
相关记录：`docs/work-logs/2026-10-12-capture-junction-tests.md`

## 关联
- `capture.test.ts` 里的软链接用例在 Windows 上会跳过（创建软链接需要管理员权限）。这次改用目录联接来补 Windows 上的覆盖，创建联接不需要管理员权限。

## 改了什么
- 新增 `apps/desktop/test/main/capture-junction.test.ts`，共 10 个用例。
  - 用 `describe.runIf(win32)` 限定平台：Windows 上必须运行，其他平台跳过。
  - 本地可以设 `POINT_JUNCTION_AS_SYMLINK=1`，用目录软链接模拟联接，在 Linux 上也能跑；CI 不设这个变量。
- 覆盖的情形：
  - 前置检查：联接能创建，并且 `realpath.native` 会把它解析到目标目录。
  - `.point/captures` 是指向外部目录的联接：
    - `readCapture` 和 `captureImage` 都报「截图不存在或已被删除」。
    - `writeCapture` 被拒绝，外部目录不变；即使要写的字节在外部已经存在，也一样被拒绝。
    - 协议处理返回 404，并且不是 `image/png`。
  - `.point` 是指向外部目录的联接：读取报不存在、协议返回 404、写入被拒绝，外部没有新增文件。
  - 整个工作区经由联接访问：写入、读取、协议返回 200 都正常。
- 只能测目录级别：Windows 不支持对单个文件建联接。

## 发现的问题（产品 bug，已用 it.fails 标出）
- `capture.ts` 的 `capturesDir` 先执行 `mkdirSync(.point/captures, { recursive: true })`，然后才检查真实路径是否在工作区内。
- 结果：`.point` 是指向外部空目录的联接时，写入虽然被拒绝，外部却多出一个空的 `captures/` 目录。
- 已在本地确认：把 `it.fails` 改回 `it` 后，用例失败，报 `expected [ 'captures/' ] to deeply equal []`。
- 建议修复：先对已存在的父目录做真实路径检查，再创建目录。

## 改动类型
- [x] 仅测试、文档、CI 或构建

## 版本号
- 不升版本

## 如何测试
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`：core 143 项通过；main 613 项通过、14 项跳过（Linux 本地，新增的 10 项因为不是 Windows 被跳过）。
- [x] 本地用 `POINT_JUNCTION_AS_SYMLINK=1` 模拟：10 项全部通过（含 1 项 it.fails）。
- [ ] Windows 上真实联接的结果：本地没有 Windows 环境，以 CI 的 windows-latest check 任务为准。

## 检查项
- 没有改产品代码，没有改版本号，没有改 workflow。

## AI 声明
- 测试和本文档由 AI（测试员）编写。
