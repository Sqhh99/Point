/** What the UI shows for a model: the model id the API is called with, nothing else
 *  (no marketing label, no 看图/思考 tags — vision is in the status bar, effort has its own control). */
export const modelDisplayName = (m: { id: string }): string => m.id;
