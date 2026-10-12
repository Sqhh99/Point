export type DocType = "pdf" | "docx" | "md" | "xlsx";

interface BlockBase {
  /** Stable within a document: same input always yields the same ids. */
  id: string;
  /** 1-based source page (PDF only). */
  page?: number;
}

export type Block = BlockBase &
  (
    | { type: "heading"; level: number; text: string }
    | { type: "paragraph"; text: string }
    | { type: "list"; ordered: boolean; items: string[] }
    | { type: "code"; lang?: string; text: string }
    | { type: "table"; rows: string[][] }
    | { type: "image"; alt: string }
  );

export interface OutlineItem {
  blockId: string;
  level: number;
  text: string;
}

export interface ParsedDoc {
  type: DocType;
  title: string;
  blocks: Block[];
  outline: OutlineItem[];
}

export type BlockInput = Block extends infer B ? (B extends Block ? Omit<B, "id"> : never) : never;
