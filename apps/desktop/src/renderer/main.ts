import { renderSettings } from "./settings";

document.title = "Point";
const root = document.getElementById("app")!;
renderSettings(root, window.point).catch((err: unknown) => {
  root.textContent = `加载设置失败: ${(err as Error).message}`;
});
