// Run from the repository root after building dist/. All chain and wallet responses are fixtures.
// No signed transaction or real RPC request is sent by this script.
import { pathToFileURL } from "node:url";
const { chromium, webkit } = await import(
  process.env.IMD_PLAYWRIGHT
    ? pathToFileURL(resolve(process.env.IMD_PLAYWRIGHT)).href
    : "playwright"
);
const {
  decodeFunctionData,
  encodeFunctionResult,
  decodeFunctionResult,
  encodeEventTopics,
} = await import(
  process.env.IMD_VIEM
    ? pathToFileURL(resolve(process.env.IMD_VIEM)).href
    : "viem"
);
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
const baseline = process.argv.includes("--baseline");
const root = process.cwd();
const nft = JSON.parse(await readFile("abi/HamsterRunNFT.json"));
const queue = JSON.parse(await readFile("abi/MatchQueue.json"));
const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const third = "0x3333333333333333333333333333333333333333";
const nftAddress = "0x140128b9208ee5de9690cd96b3bb7bc601d5b4ec";
const queueAddress = "0x98d449abfaeaa0d0ebd0cf073f19faae24d32308";
const zeroHash = "0x" + "00".repeat(32);
const a = { tokenId: 1n, player: wallet, stamina: 10n, weight: 1 };
const b = { tokenId: 2n, player: other, stamina: 10n, weight: 1 };
const race = {
  roundId: 1n,
  a,
  b,
  scoreA: 5n,
  scoreB: 4n,
  winner: 1n,
  settled: false,
};
const decoded = decodeFunctionResult({
  abi: queue,
  functionName: "matchInfo",
  data: encodeFunctionResult({
    abi: queue,
    functionName: "matchInfo",
    result: race,
  }),
});
assert.equal(decoded.a.tokenId, 1n);
assert.equal(decoded[1], undefined);
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://local").pathname,
    ).replace(/^\/preview\//, "");
    const file = resolve(root, "dist", path || "index.html");
    if (!file.startsWith(resolve(root, "dist") + "/")) throw Error();
    const body = await readFile(file);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
      }[extname(file)] || "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
await mkdir("test/scratch/revision-shots", { recursive: true });
const report = [];
const browser = await (
  process.argv.includes("--webkit") ? webkit : chromium
).launch({ headless: true });
async function setup(width, scenario, connected = false) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) =>
    route.request().url().startsWith(url) ||
    /^https:\/\/(ethereum-sepolia-rpc.publicnode.com|rpc.sepolia.ethpandaops.io|sepolia.rpc.sentio.xyz)\/?$/.test(
      route.request().url(),
    )
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const state = { scenario, block: 1000n, calls: [], errors: [], ...scenario };
  page.on("pageerror", (e) => {
    state.errors.push(e.message);
    console.log("pageerror: " + e.message);
  });
  await context.route(
    /^https:\/\/(ethereum-sepolia-rpc.publicnode.com|rpc.sepolia.ethpandaops.io|sepolia.rpc.sentio.xyz)\/?$/,
    async (route) => {
      const raw = route.request().postDataJSON();
      function respond(req) {
        try {
          let result;
          if (req.method === "eth_blockNumber")
            result = "0x" + state.block.toString(16);
          else if (req.method === "eth_chainId") result = "0xaa36a7";
          else if (req.method === "eth_getLogs") {
            state.calls.push({ name: "getLogs" });
            if (state.logError)
              return {
                jsonrpc: "2.0",
                id: req.id,
                error: { code: -32005, message: "block range exceeds limit" },
              };
            result = state.owned
              ? [
                  {
                    address: nftAddress,
                    topics: encodeEventTopics({
                      abi: nft,
                      eventName: "Transfer",
                      args: {
                        from: "0x0000000000000000000000000000000000000000",
                        to: wallet,
                        tokenId: BigInt(state.owned),
                      },
                    }),
                    data: "0x",
                    blockNumber: "0xb7d63e",
                    transactionHash: zeroHash,
                    blockHash: zeroHash,
                    logIndex: "0x0",
                    transactionIndex: "0x0",
                    removed: false,
                  },
                ]
              : [];
          } else if (req.method === "eth_call") {
            const call = req.params[0];
            const abi = call.to.toLowerCase() === nftAddress ? nft : queue;
            const { functionName: name, args = [] } = decodeFunctionData({
              abi,
              data: call.data,
            });
            state.calls.push({ name, args: args.map(String) });
            const id = args[0];
            switch (name) {
              case "mintOpen":
                result = state.closed ? false : true;
                break;
              case "totalSupply":
                result = BigInt(state.supply ?? 2);
                break;
              case "matchQueue":
                result = queueAddress;
                break;
              case "foodPrices":
                result = [100000000000000n, 200000000000000n, 300000000000000n][
                  Number(id)
                ];
                break;
              case "foodTrainBps":
                result = [10000n, 15000n, 20000n][Number(id)];
                break;
              case "roundCount":
                result = BigInt(state.rounds ?? 0);
                break;
              case "freeMinted":
                result = !!state.owned || !!state.logError;
                break;
              case "activeToken":
                result = state.matched ? 1n : 0n;
                break;
              case "points":
                result = 0n;
                break;
              case "ownerOf":
                if (state.ownerError && id === 2n)
                  throw Error("ownership RPC unavailable");
                result = id === BigInt(state.owned ?? 0) ? wallet : other;
                break;
              case "hamster":
                result = {
                  stamina: 10n,
                  fedUntil: BigInt(Math.floor(Date.now() / 1000) + 259200),
                  trainBps: 10000n,
                  bodyScore: 50n,
                  weight: 1,
                  activity: state.matched ? 3 : 0,
                  foodTier: 0,
                };
                break;
              case "training":
                result = [0n, 0n, 0];
                break;
              case "matchesThisWeek":
                result = 0n;
                break;
              case "previewTrainingGain":
                result = 10n;
                break;
              case "queueEntries":
                result =
                  state.ready && id === 0n
                    ? [
                        {
                          tokenId: 2n,
                          player: other,
                          joinedAt: 1n,
                          joinedBlock: 980n,
                        },
                        {
                          tokenId: 3n,
                          player: third,
                          joinedAt: 1n,
                          joinedBlock: 980n,
                        },
                      ]
                    : [];
                break;
              case "eligibleCount":
                result = state.ready && id === 0n ? 2n : 0n;
                break;
              case "roundInfo":
                result = [
                  id - 1n,
                  998n,
                  0n,
                  state.fulfilled ? 2 : 1,
                  zeroHash,
                  2n,
                ];
                break;
              case "roundMatchIds":
                result = state.fulfilled ? [1n] : [];
                break;
              case "roundBye":
                result = 0n;
                break;
              case "roundRacers":
                result = [
                  { ...a, tokenId: id * 2n - 1n },
                  { ...b, tokenId: id * 2n },
                ];
                break;
              case "matchInfo":
                result = { ...race, settled: !!state.settled };
                break;
              case "requestRound":
              case "fulfillRound":
              case "expireRound":
              case "settleMatch":
              case "enqueue":
              case "leaveQueue":
                result = name === "requestRound" ? 1n : undefined;
                break;
              default:
                throw Error("unexpected call " + name);
            }
            result = encodeFunctionResult({ abi, functionName: name, result });
          } else throw Error("unexpected RPC " + req.method);
          return { jsonrpc: "2.0", id: req.id, result };
        } catch (e) {
          return {
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32000, message: e.message },
          };
        }
      }
      await route.fulfill({
        json: Array.isArray(raw) ? raw.map(respond) : respond(raw),
      });
    },
  );
  if (connected)
    await page.addInitScript(
      ({ wallet }) => {
        window.testTx = [];
        window.ethereum = {
          on() {},
          removeListener() {},
          async request({ method, params }) {
            if (method === "eth_requestAccounts" || method === "eth_accounts")
              return [wallet];
            if (method === "eth_chainId") return "0xaa36a7";
            if (method === "net_version") return "11155111";
            if (method === "wallet_getCapabilities") return {};
            if (method === "eth_sendTransaction") {
              window.testTx.push(params[0]);
              throw Object.assign(Error("User rejected request."), {
                code: 4001,
              });
            }
            if (method === "wallet_switchEthereumChain") return null;
            throw Error("unexpected wallet method " + method);
          },
        };
      },
      { wallet },
    );
  return { context, page, state };
}
async function connect(page) {
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("button", { name: "Browser wallet", exact: true })
    .click();
  await page.getByRole("button", { name: /Disconnect/ }).waitFor();
}
async function check(name, fn) {
  console.log("Checking " + name);
  try {
    report.push({ name, ...(await fn()) });
    console.log(JSON.stringify(report.at(-1)));
  } catch (e) {
    report.push({ name, failed: e.stack });
    console.error(e.stack);
    if (!baseline) throw e;
  }
}
try {
  for (const width of [390, 1440])
    await check("fulfilled-" + width, async () => {
      const { context, page, state } = await setup(
        width,
        { fulfilled: true, rounds: 1 },
        !baseline,
      );
      try {
        await page.goto(url + "#/race");
        await page.waitForFunction(
          () =>
            document.body.innerText.includes("Round 1") ||
            document.getElementById("root")?.childElementCount === 0,
          {},
          { timeout: 8000 },
        );
        await page.waitForFunction(
          () =>
            !!document.querySelector(".round") ||
            document.getElementById("root")?.childElementCount === 0,
          {},
          { timeout: 8000 },
        );
        if (!baseline) {
          await page
            .getByRole("button", { name: "Settle", exact: true })
            .waitFor();
          await connect(page);
          await page
            .getByRole("button", { name: "Settle", exact: true })
            .click();
          await page.getByText(/Request declined in the wallet/).waitFor();
          assert(
            state.calls.some(
              (c) => c.name === "settleMatch" && c.args[0] === "1",
            ),
          );
          assert.equal((await page.evaluate(() => window.testTx)).length, 1);
          assert.deepEqual(state.errors, []);
          assert.match(
            await page.locator(".match").innerText(),
            /#1 Normal 5[\s\S]*#2 Normal 4/,
          );
          state.settled = true;
          await page.reload();
          await page
            .locator(".match")
            .getByText("Settled", { exact: true })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "Settle", exact: true })
              .count(),
            0,
          );
        }
        return {
          pageErrors: state.errors,
          bodyLength: (await page.locator("body").innerText()).length,
          settle: await page
            .getByRole("button", { name: "Settle", exact: true })
            .count(),
        };
      } finally {
        await context.close();
      }
    });
  for (const width of [320, 390])
    await check("board-" + width, async () => {
      const { context, page, state } = await setup(width, {});
      try {
        await page.addInitScript(
          ({ wallets }) =>
            localStorage.setItem(
              "ham.attributions",
              JSON.stringify(
                wallets.map((wallet) => ({
                  handle: "abcdefghijklmno",
                  stage: "minted",
                  at: 1,
                  wallet,
                })),
              ),
            ),
          { wallets: [wallet, other, third] },
        );
        await page.goto(url + "#/invite");
        await page.locator(".board tbody tr").waitFor();
        await page.evaluate(() => document.fonts.ready);
        const measured = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          tableWidth: document.querySelector(".board").getBoundingClientRect()
            .width,
          tableRight: document.querySelector(".board").getBoundingClientRect()
            .right,
        }));
        await page.screenshot({
          path: `test/scratch/revision-shots/${baseline ? "before" : "after"}-board-${width}.png`,
          fullPage: true,
        });
        if (!baseline) {
          assert.equal(measured.scrollWidth, measured.clientWidth);
          assert.equal(await page.locator(".board th").count(), 4);
          assert.match(
            await page.locator(".board").innerText(),
            /@abcdefghijklmno/,
          );
          assert.deepEqual(state.errors, []);
        }
        return measured;
      } finally {
        await context.close();
      }
    });
  await check("ownership-601", async () => {
    const { context, page, state } = await setup(
      390,
      { supply: 601, owned: 601, logError: true },
      true,
    );
    try {
      await page.goto(url);
      await connect(page);
      await page.waitForFunction(
        () => {
          const v = [...document.querySelectorAll(".mint-stats .k")].find(
            (n) => n.textContent === "Your HAM",
          )?.nextElementSibling?.textContent;
          return v === "0" || !!document.querySelector("#hud-title");
        },
        {},
        { timeout: 45000 },
      );
      const owners = state.calls.filter((c) => c.name === "ownerOf");
      if (!baseline) {
        assert.equal(await page.locator("#hud-title").innerText(), "HAM #601");
        assert(owners.some((c) => c.args[0] === "601"));
        await page
          .getByRole("button", { name: "Low food", exact: false })
          .waitFor();
        assert.deepEqual(state.errors, []);
      }
      return {
        ownerCalls: owners.length,
        largestId: Math.max(...owners.map((c) => Number(c.args[0]))),
        hud: await page.locator("#hud-title").allTextContents(),
      };
    } finally {
      await context.close();
    }
  });

  if (!baseline) {
    await check("ownership-9999", async () => {
      const { context, page, state } = await setup(
        390,
        { supply: 9999, owned: 9999, logError: true },
        true,
      );
      try {
        await page.goto(url);
        await connect(page);
        await page
          .getByRole("heading", { name: "HAM #9999", exact: true })
          .waitFor({ timeout: 45000 });
        assert.equal(
          new Set(
            state.calls
              .filter((c) => c.name === "ownerOf")
              .map((c) => c.args[0]),
          ).size,
          9999,
        );
        assert.deepEqual(state.errors, []);
        return {
          hud: await page.locator("#hud-title").innerText(),
          scanned: 9999,
        };
      } finally {
        await context.close();
      }
    });
    await check("ownership-error-and-recovery", async () => {
      const { context, page, state } = await setup(
        390,
        { supply: 3, owned: 3, logError: true, ownerError: true },
        true,
      );
      try {
        await page.goto(url);
        await connect(page);
        await page
          .getByText("Read error", { exact: true })
          .waitFor({ timeout: 30000 });
        assert.match(
          await page.locator("body").innerText(),
          /Could not read all owned HAM/,
        );
        assert.equal(
          await page
            .getByText("Mint a HAM and its status bars appear here:", {
              exact: false,
            })
            .count(),
          0,
        );
        state.ownerError = false;
        await page.reload();
        await page
          .getByRole("heading", { name: "HAM #3", exact: true })
          .waitFor({ timeout: 30000 });
        assert.equal(
          await page.getByText("Read error", { exact: true }).count(),
          0,
        );
        assert.deepEqual(state.errors, []);
        return {
          errorShown: true,
          recovered: await page.locator("#hud-title").innerText(),
        };
      } finally {
        await context.close();
      }
    });
  }
  await check("public-request", async () => {
    const { context, page, state } = await setup(390, { ready: true }, true);
    try {
      await page.goto(url + "#/race");
      await connect(page);
      await page.getByText("Recent rounds", { exact: true }).waitFor();
      await page.getByText("No rounds yet.", { exact: false }).waitFor();
      const count = await page
        .getByRole("button", { name: "Request round", exact: true })
        .count();
      if (!baseline) {
        const request = page.getByRole("button", {
          name: "Request round",
          exact: true,
        });
        await request.click();
        await page.getByText(/Request declined in the wallet/).waitFor();
        assert(
          state.calls.some(
            (c) => c.name === "requestRound" && c.args[0] === "0",
          ),
        );
        assert.equal((await page.evaluate(() => window.testTx)).length, 1);
        await page.getByLabel("Stamina band").fill("1");
        await page
          .getByRole("button", { name: "Inspect band", exact: true })
          .click();
        await page
          .getByText("A round needs two eligible pets in this band.", {
            exact: true,
          })
          .waitFor();
        assert(await request.isDisabled());
        assert(
          state.calls.some(
            (c) => c.name === "queueEntries" && c.args[0] === "1",
          ),
        );
        assert.equal(
          await page.getByRole("button", { name: /Enqueue in band/ }).count(),
          0,
        );
        await page.getByLabel("Stamina band").fill("-1");
        await page
          .getByRole("button", { name: "Inspect band", exact: true })
          .click();
        assert.equal(
          await page.getByLabel("Stamina band").getAttribute("aria-invalid"),
          "true",
        );
        const maxBand = (2n ** 256n - 1n).toString();
        await page.getByLabel("Stamina band").fill(maxBand);
        await page
          .getByRole("button", { name: "Inspect band", exact: true })
          .click();
        await page.waitForFunction(
          (band) =>
            document
              .getElementById("band-msg")
              .textContent.includes(`Viewing band ${band}`),
          maxBand,
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          390,
        );

        assert.deepEqual(state.errors, []);
      }
      return {
        requestButtons: count,
        queueReads: state.calls
          .filter((c) => c.name === "queueEntries")
          .map((c) => c.args[0]),
      };
    } finally {
      await context.close();
    }
  });
  await check("older-round", async () => {
    const { context, page, state } = await setup(
      390,
      {
        supply: baseline ? 14 : 26,
        owned: 1,
        matched: true,
        rounds: baseline ? 7 : 13,
      },
      true,
    );
    try {
      await page.goto(url + "#/race");
      await connect(page);
      await page.getByText("HAM #1 · band 0", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Show more rounds", exact: true })
        .click();
      if (!baseline) {
        await page
          .getByRole("button", { name: "Load older rounds", exact: true })
          .click();
        await page
          .getByText("Round 2 · band 1 · 2 pets", { exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Load older rounds", exact: true })
          .click();
        await page
          .getByText("Round 1 · band 0 · 2 pets", { exact: true })
          .waitFor();
        const round = page
          .locator(".round")
          .filter({ hasText: "Round 1 · band 0" });
        await round
          .getByRole("button", { name: "Fulfil round", exact: true })
          .click();
        await page.getByText(/Request declined in the wallet/).waitFor();
        assert(
          state.calls.some(
            (c) => c.name === "fulfillRound" && c.args[0] === "1",
          ),
        );
        state.block = 1270n;
        await page.reload();
        await page
          .getByRole("button", { name: "Show more rounds", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Load older rounds", exact: true })
          .click();
        await page
          .getByText("Round 2 · band 1 · 2 pets", { exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Load older rounds", exact: true })
          .click();
        await round
          .getByRole("button", { name: "Expire round", exact: true })
          .click();
        await page.getByText(/Request declined in the wallet/).waitFor();
        assert(
          state.calls.some(
            (c) => c.name === "expireRound" && c.args[0] === "1",
          ),
        );
        assert.deepEqual(state.errors, []);
      }
      return {
        roundIds: [
          ...new Set(
            state.calls
              .filter((c) => c.name === "roundInfo")
              .map((c) => c.args[0]),
          ),
        ],
        oldestVisible:
          (await page
            .getByText("Round 1 · band 0 · 2 pets", { exact: true })
            .count()) > 0,
      };
    } finally {
      await context.close();
    }
  });
  await check("dialog-focus", async () => {
    const { context, page } = await setup(390, {});
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      const stops = [];
      for (let i = 0; i < 9; i++) {
        stops.push(
          await page.evaluate(() => ({
            name: document.activeElement?.textContent,
            inside: !!document.activeElement?.closest("[role=dialog]"),
          })),
        );
        await page.keyboard.press("Tab");
      }
      if (!baseline) {
        assert(stops.every((s) => s.inside));
        await page.keyboard.press("Shift+Tab");
        assert(
          await page.evaluate(
            () => !!document.activeElement?.closest("[role=dialog]"),
          ),
        );
        assert(await page.locator("#root").evaluate((e) => e.inert));
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(
          await page.locator("#root").evaluate((e) => e.inert),
          false,
        );
        assert.match(
          await page.evaluate(() => document.activeElement.textContent),
          /Connect/,
        );
      }
      return { stops };
    } finally {
      await context.close();
    }
  });
} finally {
  await writeFile(
    `test/scratch/${baseline ? "baseline" : "regression"}${process.argv.includes("--webkit") ? "-webkit" : ""}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));
}
