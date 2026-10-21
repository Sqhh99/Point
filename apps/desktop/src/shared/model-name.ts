/** What the UI shows for a model: the model id the API is called with, nothing else
 *  (no marketing label, no 看图/思考 tags — vision is in the status bar, effort has its own control). */
export const modelDisplayName = (m: { id: string }): string => m.id;

/** Status-bar tooltip: 「服务名 · 模型 id」 for a preset endpoint; just the model id when there is no
 *  service name (a custom endpoint: main sends providerName ""). */
export const modelTooltip = (m: { providerName: string; model: string }): string => (m.providerName ? `${m.providerName} · ${m.model}` : m.model);

/** Settings form's starting model field: the saved model only once that service has a key. Without a key
 *  nothing is chosen yet, so the field starts empty (no deepseek-flash, no 「看图：支持」 implied). */
export const settingsFormModel = (cfg: { hasKey: boolean; model: string }): string => (cfg.hasKey ? cfg.model : "");
