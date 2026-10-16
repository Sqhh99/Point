# 2026-10-15 encrypted PDF reject timeout

## 背景
main `d2ea08a`（0.2.0）上 Windows `check` 红：`viewer-extra.test.ts` → `encrypted PDF rejects` 在 15s vitest 预算内超时。macOS check 绿。

## 根因（测试员确认）
不是死锁。Windows CI 上 pdf.js 冷启动后再拒绝加密 PDF 常要约 15–20s；该用例只给了 15s。同一次 CI 里 `corrupt pdf (empty)` 花了约 19s（预算 20s）。mac/Linux 亚秒级。产品侧已能以 `No password given` / `PasswordException` 拒绝，无需改加密检测逻辑。

## 改动
- `packages/core/test/viewer-extra.test.ts`：该用例超时从 15s 提到 30s（对齐 CORRUPT_TIMEOUT + 余量）。
