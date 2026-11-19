/* eslint-disable @typescript-eslint/no-require-imports, no-undef -- plain node generator script */
// One letter-size page, 90 Helvetica 7pt lines: "Line NN" plus five rotating Greek words.
// Used to regress dragging past the last line / below the page (issue #81).
// Run from this folder: `node gen-long-90.cjs` — writes long-90-lines.pdf beside this script.
const fs = require("fs");
const path = require("path");
const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho", "sigma", "tau", "upsilon"];
const lines = Array.from({ length: 90 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  const words = Array.from({ length: 5 }, (__, k) => WORDS[(i + k) % WORDS.length]);
  return `Line ${n} ${words.join(" ")}`;
});
const esc = (s) => s.replace(/[\\()]/g, (m) => "\\" + m);
let cs = "";
for (let i = 0; i < lines.length; i++) cs += `BT /F1 7 Tf 72 ${770 - 8 * i} Td (${esc(lines[i])}) Tj ET\n`;
const objs = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
  `<< /Length ${cs.length} >>\nstream\n${cs}endstream`
];
let out = "%PDF-1.4\n";
const off = [];
objs.forEach((o, i) => {
  off.push(out.length);
  out += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const x = out.length;
out +=
  `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
  off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") +
  `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
const dest = path.join(__dirname, "long-90-lines.pdf");
fs.writeFileSync(dest, out);
