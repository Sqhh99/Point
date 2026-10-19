import type { ChatMessage, ImageInput } from "@point/core";

import { NO_VISION_CUSTOM_MESSAGE, NO_VISION_MESSAGE } from "../shared/vision-text.js";

export { NO_VISION_CUSTOM_MESSAGE, NO_VISION_MESSAGE };

/** Refuse before anything is stored or sent when an image is attached to a text-only model. */
export function assertVisionAllowed(vision: boolean, hasImage: boolean, custom = false): void {
  if (hasImage && !vision) throw Object.assign(new Error(custom ? NO_VISION_CUSTOM_MESSAGE : NO_VISION_MESSAGE), { code: "no_vision" });
}

/** Attach the image to the last user message (the current question); history stays text-only. */
export function withImage(messages: ChatMessage[], image: ImageInput | undefined): ChatMessage[] {
  if (!image) return messages;
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role !== "user") i--;
  if (i < 0) throw new Error("没有可以附图的用户消息");
  return messages.map((m, j) => (j === i ? { ...m, images: [...(m.images ?? []), image] } : m));
}
