import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("point", {
  platform: process.platform
});
