import { test } from "node:test";
import assert from "node:assert/strict";
import { attribute, leaderboard } from "../../invite-service/server.mjs";

// Minimal localStorage for the client module.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const inv = await import("../src/invite.ts");

const W1 = "0x1111111111111111111111111111111111111111";
const W2 = "0x2222222222222222222222222222222222222222";

test("client: first-touch ref from ?ref= and #/invite/", () => {
  assert.equal(inv.captureRef({ search: "?ref=@alice", hash: "" }), "alice");
  assert.equal(inv.captureRef({ search: "", hash: "#/invite/bob" }), "alice");
});
test("client: attribution upgrades to minted, ranks by minted", () => {
  inv.recordLocal("alice", W1, "connected", "");
  inv.recordLocal("alice", W1, "minted", "");
  inv.recordLocal("bob", W2, "connected", "");
  const rows = inv.rankBoard(inv.localAttributions());
  assert.equal(rows[0].handle, "alice"); assert.equal(rows[0].invites, 1); assert.equal(rows[1].invites, 0);
  assert.equal(inv.recordLocal("me", W2, "minted", "me").length, 2, "self-invites ignored");
});
test("client: offline board when no service URL", async () => {
  globalThis.fetch = async () => ({ json: async () => ({ inviteApi: "" }) });
  const b = await inv.fetchBoard();
  assert.equal(b.status, "offline");
});
test("service: first touch wins and minted needs chain confirmation", () => {
  const db = { invites: {} };
  assert.equal(attribute(db, { handle: "alice", wallet: W1, stage: "connected" }, false).ok, true);
  attribute(db, { handle: "bob", wallet: W1, stage: "minted" }, false);
  assert.equal(db.invites[W1].handle, "alice");
  assert.equal(db.invites[W1].mintedAt, null);
  attribute(db, { handle: "alice", wallet: W1, stage: "minted" }, true, 5);
  assert.equal(db.invites[W1].mintedAt, 5);
  assert.equal(attribute(db, { handle: "no spaces", wallet: W2 }, false).ok, false);
  const rows = leaderboard(db);
  assert.deepEqual(rows[0], { handle: "alice", invites: 1, connected: 1, wallets: [W1] });
});
