// Renders public/og.png (1200x630) and public/favicon-32.png as hard-edged pixel art. No dependencies.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function canvas(w, h, bg) {
  const px = new Uint8Array(w * h * 3);
  const c = hex(bg);
  for (let i = 0; i < w * h; i++) px.set(c, i * 3);
  const rect = (x, y, rw, rh, col) => {
    const k = hex(col);
    for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++) for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++) px.set(k, (j * w + i) * 3);
  };
  return { w, h, px, rect };
}
function png({ w, h, px }) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const HAM = [
  "....oo......oo....", "...ofpo....opfo...", "...offoooooooffo..", "..offffffffffffo..", "..offwefffffwefo..", ".offfeeffffffeefo.",
  ".offfffffpffffffo.", ".offbbbffffbbbffo.", ".offbbbbbbbbbbffo.", "..offbbbbbbbbffo..", "...offffffffffo...", "....oo.oo.oo.oo...",
];
const PAL = { o: "#0b1a13", f: "#ffc34d", b: "#ffe6a8", p: "#ff5fa2", e: "#0b1a13", w: "#e9fff4" };
// 5x7 block letters for the lettering inside the image.
const FONT = {
  H: ["10001","10001","10001","11111","10001","10001","10001"], A: ["01110","10001","10001","11111","10001","10001","10001"],
  M: ["10001","11011","10101","10101","10001","10001","10001"], S: ["01111","10000","10000","01110","00001","00001","11110"],
  T: ["11111","00100","00100","00100","00100","00100","00100"], E: ["11111","10000","10000","11110","10000","10000","11111"],
  R: ["11110","10001","10001","11110","10100","10010","10001"], U: ["10001","10001","10001","10001","10001","10001","01110"],
  N: ["10001","11001","10101","10011","10001","10001","10001"], P: ["11110","10001","10001","11110","10000","10000","10000"],
  O: ["01110","10001","10001","10001","10001","10001","01110"], L: ["10000","10000","10000","10000","10000","10000","11111"],
  I: ["11111","00100","00100","00100","00100","00100","11111"], V: ["10001","10001","10001","10001","10001","01010","00100"],
  F: ["11111","10000","10000","11110","10000","10000","10000"], D: ["11110","10001","10001","10001","10001","10001","11110"],
  C: ["01111","10000","10000","10000","10000","10000","01111"], "2": ["01110","10001","00001","00010","00100","01000","11111"], " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "·": ["00000","00000","00000","00100","00000","00000","00000"],
};
const text = (c, s, x, y, scale, col) => { let cx = x; for (const ch of s) { const g = FONT[ch]; g.forEach((r, j) => [...r].forEach((b, i) => b === "1" && c.rect(cx + i * scale, y + j * scale, scale, scale, col))); cx += 6 * scale; } };
const sprite = (c, x, y, s) => HAM.forEach((r, j) => [...r].forEach((ch, i) => PAL[ch] && c.rect(x + i * s, y + j * s, s, s, PAL[ch])));

const og = canvas(1200, 630, "#1a1f3d");
og.rect(40, 40, 1120, 550, "#0d1029");
og.rect(64, 64, 1072, 502, "#07140f");
for (let y = 64; y < 566; y += 4) og.rect(64, y + 3, 1072, 1, "#061009");
sprite(og, 110, 170, 22);
text(og, "HAMSTERRUN", 540, 210, 10, "#e9fff4");
text(og, "V2 · SEPOLIA", 540, 320, 7, "#8ef0c4");
text(og, "MINT FEED TRAIN RACE", 540, 410, 4, "#ffc34d");
og.rect(96, 500, 120, 24, "#ff5fa2");
og.rect(232, 500, 120, 24, "#ffc34d");
writeFileSync(new URL("../public/og.png", import.meta.url), png(og));

const fav = canvas(32, 32, "#07140f");
sprite(fav, -1, 4, 2);
writeFileSync(new URL("../public/favicon-32.png", import.meta.url), png(fav));
console.log("wrote public/og.png and public/favicon-32.png");
