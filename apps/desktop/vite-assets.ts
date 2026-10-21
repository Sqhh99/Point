/**
 * Fonts are never inlined as data: URIs: the CSP has no font-src, so fonts fall back to
 * default-src 'self' and a data: font (Vite inlines assets under 4 KB, e.g. KaTeX_Size*) would be
 * blocked, leaving \bigg and friends unrendered. Other assets keep Vite's default rule.
 */
export const assetsInlineLimit = (file: string): boolean | undefined => (/\.(woff2?|ttf|otf|eot)$/i.test(file) ? false : undefined);
