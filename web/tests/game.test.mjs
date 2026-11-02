// Logic checks for the site's pure modules, compiled on the fly by Node's type stripping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tierGains, baseGain, bandOf, isHungry, canStartTraining, normalizeHandle, countdown, weightFromScore } from "../src/game.ts";

test("training gains match DESIGN.md examples", () => {
  const bps = [10000n, 15000n, 20000n];
  assert.deepEqual(tierGains(10n, bps), [10n, 15n, 20n]);
  assert.deepEqual(tierGains(909n, bps), [2n, 3n, 4n]);
  assert.deepEqual(tierGains(910n, bps), [1n, 2n, 3n]);
  assert.equal(baseGain(10n ** 30n), 1n);
});
test("band is floor(stamina / 25)", () => {
  assert.equal(bandOf(24n), 0n); assert.equal(bandOf(25n), 1n); assert.equal(bandOf(10n), 0n);
});
test("hunger: equality is still fed, zero is hungry", () => {
  assert.equal(isHungry(0n, 100), true); assert.equal(isHungry(100n, 100), false); assert.equal(isHungry(100n, 101), true);
  assert.equal(canStartTraining(1000n + 21600n, 1000), true); assert.equal(canStartTraining(1000n + 21599n, 1000), false);
});
test("weight classes", () => {
  assert.equal(weightFromScore(70n), 0); assert.equal(weightFromScore(69n), 1); assert.equal(weightFromScore(35n), 1); assert.equal(weightFromScore(34n), 2);
});
test("X handle normalization", () => {
  assert.equal(normalizeHandle("@ham_fan"), "ham_fan");
  assert.equal(normalizeHandle("https://x.com/hamfan42?s=1"), "hamfan42");
  assert.equal(normalizeHandle("bad handle"), null);
  assert.equal(normalizeHandle("a".repeat(16)), null);
});
test("countdown format", () => {
  assert.equal(countdown(0), "now"); assert.equal(countdown(21600), "6h 00m"); assert.equal(countdown(259200), "3d 0h 00m");
});
