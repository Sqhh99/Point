import type { SheetView as Sheet } from "@point/core";

/** 0 → A, 25 → Z, 26 → AA (Excel column letters). */
export function colLabel(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Real grid: column letters, row numbers, merges, column widths, right-aligned numbers. */
export function SheetGrid({ sheet, index, zoom, markedIds }: { sheet: Sheet; index: number; zoom: number; markedIds: Set<string> }) {
  return (
    <div className="sheet-wrap" style={{ zoom: zoom / 100 }} data-testid="sheet-grid" data-sheet={sheet.name}>
      <table className="sheet-grid">
        <colgroup>
          <col style={{ width: "4ch" }} />
          {sheet.widths.map((w, c) => (
            <col key={c} style={{ width: `${w + 2}ch` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="corner" />
            {sheet.widths.map((_, c) => (
              <th key={c} scope="col" className="col-head">
                {colLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, r) => (
            <tr key={r} className={markedIds.has(`s${index}r${r}`) ? "block marked" : "block"} data-block-id={`s${index}r${r}`}>
              <th scope="row" className="row-head">
                {r + 1}
              </th>
              {row.map((cell, c) => (cell.x ? null : <td key={c} rowSpan={cell.rs} colSpan={cell.cs} className={cell.n ? "num" : undefined}>{cell.v}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.totalRows > sheet.rows.length && <p className="sheet-note">仅显示前 {sheet.rows.length} 行，共 {sheet.totalRows} 行</p>}
      {sheet.totalCols > sheet.widths.length && <p className="sheet-note">仅显示前 {sheet.widths.length} 列，共 {sheet.totalCols} 列</p>}
    </div>
  );
}

/** Bottom sheet tabs, Excel / Google Sheets style. */
export function SheetTabs({ sheets, active, onSelect }: { sheets: Sheet[]; active: number; onSelect(i: number): void }) {
  return (
    <div className="sheet-tabs" role="tablist" aria-label="工作表" data-testid="sheet-tabs">
      {sheets.map((s, i) => (
        <button key={i} role="tab" aria-selected={i === active} className="sheet-tab" onClick={() => onSelect(i)} title={s.name}>
          {s.name}
        </button>
      ))}
    </div>
  );
}
