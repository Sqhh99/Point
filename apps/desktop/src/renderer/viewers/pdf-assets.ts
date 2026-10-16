/// <reference types="vite/client" />
/**
 * pdf.js needs its standard-14 font programs (for PDFs that do not embed Helvetica/Times/…) and CMaps
 * (for CJK encodings). They ship inside the app bundle as lazy chunks and are handed to pdf.js through
 * its factory hooks, so nothing is fetched (no network, no file:// request) and the CSP stays as it is.
 */
const fonts = import.meta.glob("../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}", { query: "?inline", import: "default" }) as Record<string, () => Promise<string>>;
const cmaps = import.meta.glob("../../../node_modules/pdfjs-dist/cmaps/*.bcmap", { query: "?inline", import: "default" }) as Record<string, () => Promise<string>>;

const bytes = (dataUrl: string): Uint8Array => {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const find = (set: Record<string, () => Promise<string>>, file: string) => Object.entries(set).find(([k]) => k.endsWith(`/${file}`))?.[1];

export class BundledStandardFonts {
  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    const load = /^[\w.-]+$/.test(filename) ? find(fonts, filename) : undefined;
    if (!load) throw new Error(`standard font not bundled: ${filename}`);
    return bytes(await load());
  }
}

export class BundledCMaps {
  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    const load = /^[\w.-]+$/.test(name) ? find(cmaps, `${name}.bcmap`) : undefined;
    if (!load) throw new Error(`cmap not bundled: ${name}`);
    return { cMapData: bytes(await load()), isCompressed: true };
  }
}
