import type { ChatMessage, ImageInput } from "@point/core";

export const NO_VISION_MESSAGE = "当前模型不支持图片。请在「设置」里换一个支持看图的模型（例如 gpt-4o、glm-4v-flash），或勾选「该模型支持看图」。";

/** Refuse before anything is stored or sent when an image is attached to a text-only model. */
export function assertVisionAllowed(vision: boolean, hasImage: boolean): void {
  if (hasImage && !vision) throw Object.assign(new Error(NO_VISION_MESSAGE), { code: "no_vision" });
}

/** Attach the image to the last user message (the current question); history stays text-only. */
export function withImage(messages: ChatMessage[], image: ImageInput | undefined): ChatMessage[] {
  if (!image) return messages;
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role !== "user") i--;
  if (i < 0) throw new Error("没有可以附图的用户消息");
  return messages.map((m, j) => (j === i ? { ...m, images: [...(m.images ?? []), image] } : m));
}
