import { normalizeHandle } from "./game.ts";

/* Off-chain invites. Client-side attribution always; the optional invite service mirrors it. */
const REF_KEY = "ham.ref";
const MY_HANDLE = "ham.handle";
const LOCAL_LOG = "ham.attributions";

export type Attribution = { handle: string; wallet: string; stage: "connected" | "minted"; at: number };
export type BoardRow = { handle: string; invites: number; connected: number; wallets: string[] };

/** Reads ?ref=<handle> or #/invite/<handle>; the first valid referrer is kept (first touch). */
export function captureRef(loc: Location = location): string | null {
  const q = new URLSearchParams(loc.search).get("ref");
  const m = loc.hash.match(/^#\/invite\/([^/?#]+)/);
  const raw = q ?? (m ? decodeURIComponent(m[1]) : null);
  const h = raw ? normalizeHandle(raw) : null;
  if (h && !localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, h);
  return localStorage.getItem(REF_KEY);
}
export const getRef = () => localStorage.getItem(REF_KEY);
export const getMyHandle = () => localStorage.getItem(MY_HANDLE) ?? "";
export const setMyHandle = (h: string) => localStorage.setItem(MY_HANDLE, h);

export function inviteLink(handle: string, loc: Location = location) {
  return `${loc.origin}${loc.pathname}?ref=${encodeURIComponent(handle)}`;
}

export function localAttributions(): Attribution[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_LOG) ?? "[]") as Attribution[]; } catch { return []; }
}

/** Records (or upgrades) one wallet's attribution locally; self-invites are ignored. */
export function recordLocal(handle: string, wallet: string, stage: Attribution["stage"], myHandle = getMyHandle()): Attribution[] {
  const list = localAttributions();
  if (myHandle && myHandle.toLowerCase() === handle.toLowerCase()) return list;
  const w = wallet.toLowerCase();
  const found = list.find((a) => a.wallet === w);
  if (found) {
    if (stage === "minted" && found.stage !== "minted") { found.stage = "minted"; found.at = Date.now(); }
  } else list.push({ handle, wallet: w, stage, at: Date.now() });
  localStorage.setItem(LOCAL_LOG, JSON.stringify(list));
  return list;
}

/** Ranks by minted invites, then connected wallets, then handle. */
export function rankBoard(list: Attribution[]): BoardRow[] {
  const by = new Map<string, BoardRow>();
  for (const a of list) {
    const key = a.handle.toLowerCase();
    const row = by.get(key) ?? { handle: a.handle, invites: 0, connected: 0, wallets: [] };
    if (a.stage === "minted") row.invites++;
    row.connected++;
    row.wallets.push(a.wallet);
    by.set(key, row);
  }
  return [...by.values()].sort((x, y) => y.invites - x.invites || y.connected - x.connected || x.handle.localeCompare(y.handle));
}

let apiBase: string | null = null;
/** dist/config.json carries the invite service URL; empty means the service is offline. */
export async function loadInviteApi(): Promise<string> {
  if (apiBase !== null) return apiBase;
  try {
    const r = await fetch("./config.json", { cache: "no-store" });
    const j = (await r.json()) as { inviteApi?: string };
    apiBase = (j.inviteApi ?? "").replace(/\/+$/, "");
  } catch { apiBase = ""; }
  return apiBase;
}

async function withTimeout(url: string, init?: RequestInit, ms = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}

export async function postAttribution(a: Omit<Attribution, "at">) {
  const base = await loadInviteApi();
  if (!base) return false;
  try {
    const r = await withTimeout(`${base}/attribute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(a) });
    return r.ok;
  } catch { return false; }
}

export type BoardState = { status: "offline" | "error" | "ok"; rows: BoardRow[]; updated?: number };
export async function fetchBoard(): Promise<BoardState> {
  const base = await loadInviteApi();
  if (!base) return { status: "offline", rows: [] };
  try {
    const r = await withTimeout(`${base}/leaderboard`);
    if (!r.ok) return { status: "error", rows: [] };
    const j = (await r.json()) as { rows: BoardRow[]; updated?: number };
    return { status: "ok", rows: j.rows ?? [], updated: j.updated };
  } catch { return { status: "error", rows: [] }; }
}
