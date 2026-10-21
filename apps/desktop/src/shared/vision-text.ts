/** Preset model ids (ModelSpec.id, the wire name) with vision, named as the model picker shows them. */
export const VISION_EXAMPLE_IDS = ["deepseek-flash", "gpt-4o", "glm-4v-flash"] as const;
/** Shown when an image goes to a preset model whose ModelSpec has no vision: switch models; no checkbox exists for presets. */
export const NO_VISION_MESSAGE = `当前模型不支持图片。请在输入框上方换一个支持看图的模型（例如 ${VISION_EXAMPLE_IDS.join("、")}）。`;
/** Custom endpoint / model: the user's declaration is the only source. */
export const NO_VISION_CUSTOM_MESSAGE = "当前模型不支持图片。如果这个自定义模型能看图，请在「设置」里勾选「声明此模型支持看图」。";
