/* Tiny square-wave blips. Nothing plays until the visitor acts, and the mute toggle is remembered. */
const KEY = "ham.muted";
let ctx: AudioContext | null = null;
export const isMuted = () => localStorage.getItem(KEY) === "1";
export const setMuted = (m: boolean) => localStorage.setItem(KEY, m ? "1" : "0");

function tone(freq: number, start: number, dur: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.05, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.02);
}

export function blip(kind: "click" | "confirm" | "error") {
  if (isMuted()) return;
  try {
    ctx ??= new AudioContext();
    if (kind === "click") tone(660, 0, 0.05);
    if (kind === "confirm") { tone(523, 0, 0.08); tone(784, 0.09, 0.08); tone(1046, 0.18, 0.14); }
    if (kind === "error") { tone(220, 0, 0.12); tone(165, 0.13, 0.18); }
  } catch { /* audio is optional */ }
}
