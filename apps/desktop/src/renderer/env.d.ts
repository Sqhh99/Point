import type { PointAPI } from "../shared/ipc";

declare global {
  interface Window {
    point: PointAPI;
  }
}
