/* Game constants and formulas pinned from DESIGN.md (contract section) and the deployed ABIs. */
export const FEED_SECONDS = 259200; // 72 h
export const TRAIN_SECONDS = 21600; // 6 h
export const BAND_WIDTH = 25;
export const QUEUE_WAIT_BLOCKS = 10;
export const WEEKLY_MATCH_LIMIT = 5;
export const MAX_SUPPLY = 9999;
export const START_STAMINA = 10;
export const DEFAULT_PRICES = [100000000000000n, 200000000000000n, 300000000000000n] as const;
export const DEFAULT_BPS = [10000, 15000, 20000] as const;

export const WEIGHTS = ["Fit", "Normal", "Obese"] as const;
export const ACTIVITIES = ["Idle", "Training", "Queued", "Matched"] as const;
export const ROUND_STATUS = ["None", "Pending", "Fulfilled", "Expired"] as const;
export const TIERS = ["Low", "Mid", "High"] as const;
export const TIER_BODY = ["-4 body", "+6 body", "+12 body"] as const;

export type Hamster = {
  stamina: bigint;
  fedUntil: bigint;
  trainBps: bigint;
  bodyScore: bigint;
  weight: number;
  activity: number;
  foodTier: number;
};

export const bandOf = (stamina: bigint) => stamina / BigInt(BAND_WIDTH);
export const bandRange = (band: bigint) => `${band * 25n}-${band * 25n + 24n}`;

/** Hungry means never fed or past fedUntil; equality is still fed. */
export const isHungry = (fedUntil: bigint, now: number) => fedUntil === 0n || BigInt(now) > fedUntil;

/** Training start needs at least six hours of food left. */
export const canStartTraining = (fedUntil: bigint, now: number) => fedUntil >= BigInt(now + TRAIN_SECONDS);

/** Mirrors GameMath: base gain shrinks as stamina grows, never reaching zero. */
export const baseGain = (stamina: bigint) => 1n + 100n / (10n + stamina / 10n);

/** Chained floor so every food tier is strictly better than the one below it. */
export const tierGains = (stamina: bigint, bps: readonly bigint[]) => {
  const b = baseGain(stamina);
  const out: bigint[] = [];
  for (let t = 0; t < 3; t++) {
    const raw = (b * bps[t]) / 10000n;
    out.push(t === 0 ? raw : raw > out[t - 1] + 1n ? raw : out[t - 1] + 1n);
  }
  return out;
};

export const weightFromScore = (score: bigint) => (score >= 70n ? 0 : score >= 35n ? 1 : 2);

/** "2h 05m" style countdown; returns "now" at or below zero. */
export const countdown = (seconds: number) => {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
};

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** X handles: 1 to 15 letters, digits or underscores, stored without the @. */
export const normalizeHandle = (raw: string): string | null => {
  const h = raw.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? h : null;
};

export const ethLabel = (wei: bigint) => {
  const s = (Number(wei) / 1e18).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${s} ETH`;
};
