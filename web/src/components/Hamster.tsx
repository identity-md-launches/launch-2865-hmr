/* Pixel hamster drawn from a character grid. Weight class widens the body; crisp edges, no smoothing. */
const PALETTE: Record<string, string> = { o: "#0b1a13", f: "#ffc34d", b: "#ffe6a8", p: "#ff5fa2", e: "#0b1a13", w: "#e9fff4" };

const BASE = [
  "....oo......oo....",
  "...ofpo....opfo...",
  "...offoooooooffo..",
  "..offffffffffffo..",
  "..offwefffffwefo..",
  ".offfeeffffffeefo.",
  ".offfffffpffffffo.",
  ".offbbbffffbbbffo.",
  ".offbbbbbbbbbbffo.",
  "..offbbbbbbbbffo..",
  "...offffffffffo...",
  "....oo.oo.oo.oo...",
];

function rows(weight: number) {
  if (weight === 1) return BASE;
  if (weight === 0) return BASE.map((r, i) => (i >= 7 && i <= 9 ? r.replace("offbbb", "oofbbb").replace("bbbffo", "bbbfoo") : r));
  // Obese: two extra belly rows.
  return [...BASE.slice(0, 9), ".offbbbbbbbbbbffo.", "offbbbbbbbbbbbbffo", ...BASE.slice(9)];
}

export function Hamster({ weight = 1, size = 144, label }: { weight?: number; size?: number; label?: string }) {
  const grid = rows(weight);
  const w = 18;
  const h = grid.length;
  return (
    <svg className="sprite" width={size} height={(size * h) / w} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {grid.flatMap((r, y) => [...r].map((c, x) => (PALETTE[c] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={PALETTE[c]} /> : null)))}
    </svg>
  );
}

export const SPRITE_ROWS = BASE;
