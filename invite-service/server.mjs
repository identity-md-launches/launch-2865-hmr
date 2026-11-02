// HamsterRun invite service: off-chain handle -> invitee wallets + timestamps. Zero dependencies (Node 18+).
// POST /attribute {handle, wallet, stage: "connected" | "minted"}   GET /leaderboard   GET /health
// "minted" is only counted after the service confirms HamsterRunNFT.freeMinted(wallet) or balanceOf(wallet) > 0 on Sepolia.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 8787);
const DB = process.env.INVITE_DB ?? "./invites.json";
const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const NFT = "0x140128b9208ee5de9690cd96b3bb7bc601d5b4ec"; // HamsterRunNFT, deployment.json
const ORIGIN = process.env.ALLOW_ORIGIN ?? "*";

export const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export const WALLET = /^0x[0-9a-fA-F]{40}$/;

export function load(path = DB) {
  if (!existsSync(path)) return { invites: {} };
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return { invites: {} }; }
}
function save(db, path = DB) {
  writeFileSync(`${path}.tmp`, JSON.stringify(db, null, 1));
  renameSync(`${path}.tmp`, path);
}

/** First touch wins: a wallet is attributed to one handle forever; stage only upgrades connected -> minted. */
export function attribute(db, { handle, wallet, stage }, minted, now = Date.now()) {
  if (!HANDLE.test(handle ?? "") || !WALLET.test(wallet ?? "")) return { ok: false, error: "bad handle or wallet" };
  const w = wallet.toLowerCase();
  const prev = db.invites[w];
  if (!prev) db.invites[w] = { handle, connectedAt: now, mintedAt: null };
  const rec = db.invites[w];
  if (stage === "minted" && minted && !rec.mintedAt) rec.mintedAt = now;
  return { ok: true, record: rec };
}

export function leaderboard(db) {
  const by = new Map();
  for (const [wallet, r] of Object.entries(db.invites)) {
    const k = r.handle.toLowerCase();
    const row = by.get(k) ?? { handle: r.handle, invites: 0, connected: 0, wallets: [] };
    row.connected++;
    if (r.mintedAt) row.invites++;
    row.wallets.push(wallet);
    by.set(k, row);
  }
  return [...by.values()].sort((a, b) => b.invites - a.invites || b.connected - a.connected || a.handle.localeCompare(b.handle));
}

async function call(data) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: NFT, data }, "latest"] }) });
  const j = await r.json();
  return BigInt(j.result ?? "0x0");
}
/** balanceOf(address) selector 0x70a08231: a wallet that holds a HAM has minted or received one. */
async function hasMinted(wallet) {
  const arg = wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  try { return (await call(`0x70a08231${arg}`)) > 0n; } catch { return false; }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const db = load();
  createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", ORIGIN);
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("content-type", "application/json");
    if (req.method === "OPTIONS") return res.end();
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/health") return res.end('{"ok":true}');
    if (req.method === "GET" && url.pathname === "/leaderboard") return res.end(JSON.stringify({ rows: leaderboard(db), updated: Date.now() }));
    if (req.method === "POST" && url.pathname === "/attribute") {
      let body = "";
      for await (const c of req) { body += c; if (body.length > 2048) break; }
      let input;
      try { input = JSON.parse(body); } catch { res.statusCode = 400; return res.end('{"error":"bad json"}'); }
      const minted = input?.stage === "minted" ? await hasMinted(String(input.wallet)) : false;
      const out = attribute(db, input ?? {}, minted);
      if (!out.ok) { res.statusCode = 400; return res.end(JSON.stringify(out)); }
      save(db);
      return res.end(JSON.stringify(out));
    }
    res.statusCode = 404;
    res.end('{"error":"not found"}');
  }).listen(PORT, () => console.log(`invite service on :${PORT}, db ${DB}`));
}
