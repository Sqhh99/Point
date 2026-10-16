# fix(test): Windows 上加密 PDF 拒绝用例超时放宽至 30s

## 摘要
Windows CI 上 `encrypted PDF rejects` 因 pdf.js 冷启动拒绝偏慢（约 15–20s）撞上 15s 预算而失败。将超时调到 30s；不改产品解析路径。

## 动机
测试员确认非死锁：同 run 中 corrupt empty PDF 拒绝约 19s（20s 预算通过），加密用例 15s 不够。mac/Linux 亚秒即拒绝。

## 主要改动
- `viewer-extra.test.ts`：加密 PDF 用例 `15_000` → `30_000`

## 测试计划
- [x] 本地跑该用例
- [ ] 六项 CI（check/e2e/package × macos/windows）全绿
