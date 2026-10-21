/* eslint-disable @typescript-eslint/no-require-imports, no-undef -- plain node generator script */
// Non-embedded standard-14 Times-Roman PDF: heading, 3 justified paragraphs (Tw), superscripts (Ts).
const fs=require("fs");
const esc=s=>s.replace(/[\\()]/g,m=>"\\"+m);
const paras=[
 ["Depth determination is a fundamental task for a hydrographer, which requires specific","knowledge of the techniques and equipment involved. According to the IHO publication","S-44 5^th Edition, the uncertainty of depth measurements shall be estimated at the 95%","confidence level for every sounding in the survey."],
 ["During the last decade, hydrographic surveying has experienced a conceptual change in","depth measurement, moving from single-beam echo sounders to multibeam and LiDAR","systems. The 2^nd generation of swath systems delivers dense coverage of the seafloor","with reduced survey time and improved accuracy."],
 ["Lead line and sounding pole were the earliest methods used for directly measuring water","depth. These methods are still applied in very shallow waters, where acoustic instruments","cannot be operated safely, and they remain useful as an independent check of the echo","sounder calibration."]];
// Times-Roman AFM widths (subset needed) for Tw justification
const W={" ":250,"a":444,"b":500,"c":444,"d":500,"e":444,"f":333,"g":500,"h":500,"i":278,"j":278,"k":500,"l":278,"m":778,"n":500,"o":500,"p":500,"q":500,"r":333,"s":389,"t":278,"u":500,"v":500,"w":722,"x":500,"y":500,"z":444,",":250,".":250,"-":333,"%":833,"0":500,"1":500,"2":500,"3":500,"4":500,"5":500,"6":500,"7":500,"8":500,"9":500,"A":722,"B":667,"C":667,"D":722,"E":611,"F":556,"G":722,"H":722,"I":333,"L":611,"O":722,"R":667,"S":556,"T":611,"W":944};
const width=(s,size)=>[...s].reduce((a,c)=>a+(W[c]??500),0)*size/1000;
const FS=11, X=72, WIDTH=468; let y=720; let cs=`BT /F2 16 Tf ${X} ${y} Td (${esc("4.1 Depth determination")}) Tj ET\n`; y-=30;
for(const p of paras){p.forEach((line,li)=>{
  const parts=line.split(/\^(\w+)/); // even: normal, odd: superscript
  const natural=parts.reduce((a,s,i)=>a+width(s,i%2?FS*0.6:FS),0);
  const spaces=(parts.filter((_,i)=>i%2===0).join("").match(/ /g)||[]).length;
  const tw= li<p.length-1 && spaces? ((WIDTH-natural)/spaces).toFixed(3):0;
  cs+=`BT /F1 ${FS} Tf ${tw} Tw ${X} ${y} Td `;
  parts.forEach((s,i)=>{ if(!s) return; if(i%2) cs+=`/F1 ${(FS*0.6).toFixed(1)} Tf 4 Ts (${esc(s)}) Tj /F1 ${FS} Tf 0 Ts `; else cs+=`(${esc(s)}) Tj `; });
  cs+="ET\n"; y-=14;}); y-=8;}
const objs=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [5 0 R] /Count 1 >>","<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>","<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>",
`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>`,`<< /Length ${cs.length} >>\nstream\n${cs}endstream`];
let out="%PDF-1.4\n";const off=[];objs.forEach((o,i)=>{off.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
const x=out.length;out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`+off.map(o=>String(o).padStart(10,"0")+" 00000 n \n").join("")+`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
fs.writeFileSync("hydro-times-std.pdf",out);
