import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import type { Abi, Address } from "viem";
import { CHAIN_ID, EXPLORER, FAUCETS, NFT_ADDRESS, OWNER_ADDRESS, QUEUE_ADDRESS, nftAbi, publicClient, queueAbi } from "./config";
import { explain, readBand, readGlobal, readOwned, readPet, readPlayer, readRounds, usePoll, type RoundView } from "./chain";
import {
  ACTIVITIES, BAND_WIDTH, FEED_SECONDS, MAX_SUPPLY, QUEUE_WAIT_BLOCKS, ROUND_STATUS, TIERS, TIER_BODY, TRAIN_SECONDS,
  WEEKLY_MATCH_LIMIT, WEIGHTS, bandOf, bandRange, canStartTraining, countdown, ethLabel, isHungry, normalizeHandle, short, tierGains,
} from "./game";
import {
  captureRef, fetchBoard, getMyHandle, inviteLink, localAttributions, postAttribution, rankBoard, recordLocal, setMyHandle, type BoardState,
} from "./invite";
import { ConnectSheet } from "./wallet/ConnectSheet";
import { Hamster } from "./components/Hamster";
import { Meter } from "./components/Meter";
import { blip, isMuted, setMuted } from "./sfx";

const SCREENS = [
  { id: "play", name: "Play" },
  { id: "race", name: "Race" },
  { id: "invite", name: "Invite" },
  { id: "help", name: "Help" },
] as const;
type ScreenId = (typeof SCREENS)[number]["id"];

const screenFromHash = (): ScreenId => {
  const h = location.hash.replace(/^#\/?/, "").split("/")[0];
  return (SCREENS.find((s) => s.id === h)?.id ?? "play") as ScreenId;
};

type Log = { kind: "info" | "ok" | "err"; text: string; hash?: string };

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function App() {
  const [screen, setScreen] = useState<ScreenId>(screenFromHash);
  const [muted, setMute] = useState(isMuted);
  const [ref] = useState(() => captureRef());
  const now = useNow();
  const { address, isConnected, chainId } = useAccount();
  const onSepolia = isConnected && chainId === CHAIN_ID;
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<Log>({ kind: "info", text: "Insert wallet to start. Reading Sepolia…" });
  const [selected, setSelected] = useState<bigint | null>(null);
  const [publicBand, setPublicBand] = useState(0n);
  const [roundLimit, setRoundLimit] = useState(6);

  useEffect(() => {
    const on = () => setScreen(screenFromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const go = (id: ScreenId) => {
    blip("click");
    location.hash = `#/${id}`;
  };
  const step = (d: number) => {
    const i = SCREENS.findIndex((s) => s.id === screen);
    go(SCREENS[(i + d + SCREENS.length) % SCREENS.length].id);
  };

  const global = usePoll(readGlobal, []);
  const g = global.data;
  const owned = usePoll(address && g ? () => readOwned(address, g.totalSupply) : null, [address, g?.totalSupply], 30000);
  const player = usePoll(address ? () => readPlayer(address) : null, [address]);
  const tokens = owned.data ?? [];
  useEffect(() => {
    if (tokens.length && (selected === null || !tokens.includes(selected))) setSelected(tokens[0]);
    if (!tokens.length) setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens.join(",")]);
  const pet = usePoll(selected !== null ? () => readPet(selected) : null, [selected], 10000);
  const band = pet.data ? bandOf(pet.data.ham.stamina) : publicBand;
  const bandState = usePoll(() => readBand(band), [band.toString()], 12000);
  const rounds = usePoll(g ? () => readRounds(g.roundCount, roundLimit) : null, [g?.roundCount.toString(), roundLimit], 15000);

  useEffect(() => {
    if (g && log.text.startsWith("Insert wallet")) setLog({ kind: "info", text: "Sepolia connected. Press A to begin." });
    if (global.error && !g) setLog({ kind: "err", text: "Sepolia RPC did not answer. Retrying every 12 seconds." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, global.error]);

  // Invite attribution: record the first-touch referrer once a wallet connects, then again after a mint.
  useEffect(() => {
    if (!address || !ref) return;
    const minted = player.data?.freeMinted || tokens.length > 0;
    recordLocal(ref, address, minted ? "minted" : "connected");
    postAttribution({ handle: ref, wallet: address, stage: minted ? "minted" : "connected" });
  }, [address, ref, player.data?.freeMinted, tokens.length]);

  const refreshAll = useCallback(() => {
    global.refresh(); owned.refresh(); player.refresh(); pet.refresh(); bandState.refresh(); rounds.refresh();
  }, [global, owned, player, pet, bandState, rounds]);

  /** Simulate, send, wait for one confirmation, then refresh. Never reports success before the receipt. */
  const send = async (key: string, label: string, contract: "nft" | "queue", functionName: string, args: unknown[], value?: bigint) => {
    if (!address) return;
    blip("click");
    setBusy(key);
    setLog({ kind: "info", text: `${label}: checking…` });
    const target = contract === "nft" ? { address: NFT_ADDRESS, abi: nftAbi as Abi } : { address: QUEUE_ADDRESS, abi: queueAbi as Abi };
    try {
      await publicClient.simulateContract({ ...target, functionName, args, value, account: address as Address });
      setLog({ kind: "info", text: `${label}: confirm in your wallet.` });
      const hash = await writeContractAsync({ ...target, functionName, args, value, chainId: CHAIN_ID } as Parameters<typeof writeContractAsync>[0]);
      setLog({ kind: "info", text: `${label}: sent, waiting for a block…`, hash });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`${label} reverted on chain.`);
      setLog({ kind: "ok", text: `${label}: confirmed in block ${rc.blockNumber}.`, hash });
      blip("confirm");
      if (functionName === "mint" && ref) {
        recordLocal(ref, address, "minted");
        postAttribution({ handle: ref, wallet: address, stage: "minted" });
      }
      refreshAll();
    } catch (e) {
      setLog({ kind: "err", text: `${label}: ${explain(e)}` });
      blip("error");
    } finally {
      setBusy(null);
    }
  };

  const txReady = onSepolia && !busy;
  const toggleMute = () => { setMuted(!muted); setMute(!muted); };

  return (
    <div className="console">
      <a className="skip" href="#screen">Skip to game screen</a>
      <header className="bezel-top">
        <div className="brand">
          <span className="led" aria-hidden="true" />
          <img src="./favicon.svg" width={32} height={32} alt="" className="brand-icon" />
          <span className="brand-name">HamsterRun</span>
        </div>
        <div className="top-actions">
          <button className="btn-soft btn-mute" onClick={toggleMute} aria-pressed={!muted}>
            {muted ? "Sound off" : "Sound on"}
          </button>
          <ConnectSheet />
        </div>
      </header>

      <main className="screen-wrap">
        <div className="screen" id="screen" tabIndex={-1}>
          <nav className="tabs" aria-label="Game screens">
            {SCREENS.map((s) => (
              <a key={s.id} href={`#/${s.id}`} className="tab" aria-current={screen === s.id ? "page" : undefined} onClick={() => blip("click")}>
                {s.name}
              </a>
            ))}
          </nav>

          <StatusBanner g={g} error={global.error} />
          {address && owned.error && <p className="banner banner-warn" role="status">Could not read all owned HAM. Retrying every 30 seconds.{owned.data ? " Showing the last complete ownership read." : " Care controls will appear after a complete read."}</p>}

          {screen === "play" && (
            <PlayScreen
              g={g} now={now} address={address} isConnected={isConnected} onSepolia={onSepolia} txReady={txReady} busy={busy}
              tokens={tokens} ownedLoading={!!address && owned.data === null && !owned.error} ownedError={owned.error} selected={selected} setSelected={setSelected}
              freeMinted={player.data?.freeMinted ?? false} pet={pet.data} send={send} go={go}
            />
          )}
          {screen === "race" && (
            <RaceScreen
              g={g} now={now} address={address} txReady={txReady} busy={busy} pet={pet.data} band={band}
              setBand={setPublicBand} bandState={bandState.data} bandError={bandState.error}
              rounds={rounds.data} roundsError={rounds.error} loadOlder={() => setRoundLimit((n) => n + 6)}
              send={send} points={player.data?.points} go={go}
            />
          )}
          {screen === "invite" && <InviteScreen address={address} ref_={ref} />}
          {screen === "help" && <HelpScreen />}

          <div className={`log log-${log.kind}`} role="status" aria-live="polite">
            <span className="log-caret" aria-hidden="true">&gt;</span>
            <span>{log.text}</span>
            {log.hash && (
              <a href={`${EXPLORER}/tx/${log.hash}`} target="_blank" rel="noreferrer">View transaction</a>
            )}
          </div>
        </div>
      </main>

      <footer className="bezel-bottom">
        <div className="dpad" role="group" aria-label="Screen pad">
          <button className="dp dp-up" aria-label="Previous pet" onClick={() => cyclePet(-1)} disabled={tokens.length < 2} />
          <button className="dp dp-left" aria-label="Previous screen" onClick={() => step(-1)} />
          <span className="dp dp-mid" aria-hidden="true" />
          <button className="dp dp-right" aria-label="Next screen" onClick={() => step(1)} />
          <button className="dp dp-down" aria-label="Next pet" onClick={() => cyclePet(1)} disabled={tokens.length < 2} />
        </div>
        <div className="pills">
          <button className="pill" onClick={() => go("help")}>Select: help</button>
          <button className="pill" onClick={() => go("play")}>Start: play</button>
        </div>
        <p className="fineprint">
          Independent Sepolia testnet game. No SQK yield, mining, insurance or airdrop. Points are not transferable and carry no prize.
        </p>
      </footer>
    </div>
  );

  function cyclePet(d: number) {
    if (tokens.length < 2 || selected === null) return;
    blip("click");
    const i = tokens.indexOf(selected);
    setSelected(tokens[(i + d + tokens.length) % tokens.length]);
  }
}

type Send = (key: string, label: string, contract: "nft" | "queue", fn: string, args: unknown[], value?: bigint) => Promise<void>;

function StatusBanner({ g, error }: { g: ReturnType<typeof useGlobalType>; error: boolean }) {
  if (!g) return <p className="banner banner-info">{error ? "Sepolia RPC unreachable. Retrying." : "Reading mint and queue status from Sepolia…"}</p>;
  if (g.mintOpen && g.queueBound) return <p className="banner banner-ok">Mint open · Match queue online</p>;
  return (
    <p className="banner banner-warn">
      {!g.mintOpen ? "Mint not open yet" : "Mint open"} · {g.queueBound ? "Match queue online" : "Match queue not bound yet"}. The owner{" "}
      <a href={`${EXPLORER}/address/${OWNER_ADDRESS}`} target="_blank" rel="noreferrer">{short(OWNER_ADDRESS)}</a> still has to{" "}
      {!g.queueBound ? "call setMatchQueue" : ""}{!g.queueBound && !g.mintOpen ? " then " : ""}{!g.mintOpen ? "call setMintOpen(true)" : ""}.
    </p>
  );
}
// Helper only for typing the banner prop.
function useGlobalType() { return null as Awaited<ReturnType<typeof readGlobal>> | null; }

function PlayScreen(p: {
  g: Awaited<ReturnType<typeof readGlobal>> | null; now: number; address?: Address; isConnected: boolean; onSepolia: boolean; txReady: boolean;
  busy: string | null; tokens: bigint[]; ownedLoading: boolean; ownedError: boolean; selected: bigint | null; setSelected: (id: bigint) => void; freeMinted: boolean;
  pet: Awaited<ReturnType<typeof readPet>> | null; send: Send; go: (s: ScreenId) => void;
}) {
  const { g, pet } = p;
  const canMint = !!g?.mintOpen && p.txReady && !p.freeMinted && (g?.totalSupply ?? 0n) < BigInt(MAX_SUPPLY);
  const mintNote = !g ? "Reading mint status…"
    : !g.mintOpen ? "Mint is closed until the owner opens it. Nothing can be minted yet."
    : !p.isConnected ? "Connect a wallet, then press Mint. One free HAM per wallet."
    : !p.onSepolia ? "Switch your wallet to Sepolia to mint."
    : p.freeMinted ? "This wallet already minted its free HAM."
    : "Free. You pay only Sepolia gas. Starts at stamina 10, Normal weight.";

  return (
    <section className="stack" aria-labelledby="play-title">
      <div className="hero">
        <Hamster weight={pet ? pet.ham.weight : 1} size={128} label="Pixel hamster" />
        <div className="hero-text">
          <h1 id="play-title">HamsterRun</h1>
          <p className="lead">Mint a free pixel hamster on Sepolia, then feed, train and race it.</p>
        </div>
      </div>

      <div className="panel mint">
        <div className="mint-stats">
          <div><span className="k">Minted</span><span className="v">{g ? `${g.totalSupply} / ${MAX_SUPPLY}` : "…"}</span></div>
          <div><span className="k">Mint</span><span className={`v ${g?.mintOpen ? "t-mint" : "t-amber"}`}>{g ? (g.mintOpen ? "Open" : "Closed") : "…"}</span></div>
          <div><span className="k">Your HAM</span><span className="v">{p.address ? (p.ownedError ? "Read error" : p.ownedLoading ? "…" : p.tokens.length) : "-"}</span></div>
        </div>
        <button className="btn-a btn-big" disabled={!canMint || p.busy === "mint"} onClick={() => p.send("mint", "Mint", "nft", "mint", [])}>
          <span className="a-dot" aria-hidden="true">A</span>{p.busy === "mint" ? "Minting…" : "Mint free HAM"}
        </button>
        <p className="note">{mintNote}</p>
      </div>

      {p.tokens.length > 0 && (
        <div className="panel">
          <h2>Your hamsters</h2>
          <div className="chips" role="radiogroup" aria-label="Choose a hamster">
            {p.tokens.map((id) => (
              <button key={id.toString()} role="radio" aria-checked={p.selected === id} className="chip" onClick={() => p.setSelected(id)}>
                HAM #{id.toString()}
              </button>
            ))}
          </div>
        </div>
      )}

      {pet ? <CareHud {...p} pet={pet} /> : (
        p.address && !p.ownedLoading && !p.ownedError && p.tokens.length === 0 && (
          <div className="panel"><h2>Care HUD</h2><p className="note">Mint a HAM and its status bars appear here: stamina, weight, food timer, training and weekly races.</p></div>
        )
      )}
      {!p.address && <HowTo go={p.go} />}
      {g && <p className="note">Contract <a href={`${EXPLORER}/address/${NFT_ADDRESS}`} target="_blank" rel="noreferrer">HamsterRunNFT {short(NFT_ADDRESS)}</a> on Sepolia.</p>}
    </section>
  );
}

function HowTo({ go }: { go: (s: ScreenId) => void }) {
  return (
    <div className="panel">
      <h2>How a run works</h2>
      <ol className="steps">
        <li>Connect a Sepolia wallet and mint one free HAM.</li>
        <li>Feed it. Food lasts 72 hours; a hungry HAM cannot train or race.</li>
        <li>Train for 6 hours to gain stamina. Better food gives more.</li>
        <li>Join your stamina band queue and race other pets.</li>
      </ol>
      <button className="btn-soft" onClick={() => go("help")}>Read the full rules</button>
    </div>
  );
}

function CareHud(p: Parameters<typeof PlayScreen>[0] & { pet: NonNullable<Parameters<typeof PlayScreen>[0]["pet"]> }) {
  const { pet, now, g } = p;
  const h = pet.ham;
  const id = pet.id;
  const hungry = isHungry(h.fedUntil, now);
  const fedLeft = Number(h.fedUntil) - now;
  const activity = ACTIVITIES[h.activity] ?? "Unknown";
  const training = h.activity === 1;
  const trainLeft = Number(pet.training.readyAt) - now;
  const trainDone = training && trainLeft <= 0;
  const bandNo = bandOf(h.stamina);
  const inBand = Number(h.stamina - bandNo * BigInt(BAND_WIDTH));
  const bps = g?.bps.length ? g.bps : [10000n, 15000n, 20000n];
  const gains = tierGains(h.stamina, bps);
  const used = Number(pet.usedThisWeek);
  const idle = h.activity === 0;
  const canTrain = idle && canStartTraining(h.fedUntil, now);
  const prices = g?.prices ?? [];

  return (
    <div className="panel hud" aria-labelledby="hud-title">
      <div className="hud-head">
        <h2 id="hud-title">HAM #{id.toString()}</h2>
        <span className={`tag ${hungry ? "t-magenta" : "t-mint"}`}>{hungry ? "Hungry" : "Fed"}</span>
        <span className="tag">{activity}</span>
      </div>
      <div className="meters">
        <Meter label="Stamina" value={`${h.stamina}`} pct={inBand / BAND_WIDTH} hint={`Band ${bandNo} (${bandRange(bandNo)}). No cap.`} />
        <Meter label="Weight" value={`${WEIGHTS[h.weight]} · ${h.bodyScore}/100`} pct={Number(h.bodyScore) / 100}
          tone={h.weight === 0 ? "mint" : h.weight === 1 ? "amber" : "magenta"} hint="Fit 70+, Normal 35-69, Obese under 35." />
        <Meter label="Food" value={h.fedUntil === 0n ? "Never fed" : hungry ? "Empty" : countdown(fedLeft)} pct={hungry ? 0 : fedLeft / FEED_SECONDS}
          tone={hungry ? "magenta" : fedLeft < TRAIN_SECONDS ? "amber" : "mint"} hint={`Last food: ${TIERS[h.foodTier] ?? "-"}. Lasts 72 hours.`} />
        <Meter label="Training" value={training ? (trainDone ? "Ready to settle" : countdown(trainLeft)) : "Not running"}
          pct={training ? Math.min(1, 1 - trainLeft / TRAIN_SECONDS) : 0} tone="amber"
          hint={training ? `Settles +${pet.training.gain} stamina.` : `Next gain with current food: +${pet.preview}.`} />
        <Meter label="Races this week" value={`${used} / ${WEEKLY_MATCH_LIMIT}`} pct={used / WEEKLY_MATCH_LIMIT} tone="magenta"
          hint="Five races per HAM per week. A bye refunds one." />
      </div>

      <h3>Feed</h3>
      <div className="feed-grid">
        {[0, 1, 2].map((t) => (
          <button key={t} className="btn-a" disabled={!p.txReady || !idle || !prices[t] || p.busy === `feed${t}`}
            onClick={() => p.send(`feed${t}`, `Feed ${TIERS[t]}`, "nft", "feed", [id, t], prices[t])}>
            <span className="a-dot" aria-hidden="true">A</span>
            <span className="feed-label"><span>{TIERS[t]} food</span><small>{prices[t] ? ethLabel(prices[t]) : "…"} · {TIER_BODY[t]} · train +{gains[t]?.toString()}</small></span>
          </button>
        ))}
      </div>
      {!idle && <p className="note">Food is only served while the HAM is idle ({activity.toLowerCase()} now).</p>}

      <h3>Train</h3>
      <div className="row-actions">
        {!training && (
          <button className="btn-a" disabled={!p.txReady || !canTrain || p.busy === "train"} onClick={() => p.send("train", "Start training", "nft", "startTraining", [id])}>
            <span className="a-dot" aria-hidden="true">A</span>Start 6h training
          </button>
        )}
        {training && (
          <button className="btn-a" disabled={!p.txReady || !trainDone || p.busy === "settle"} onClick={() => p.send("settle", "Settle training", "nft", "settleTraining", [id])}>
            <span className="a-dot" aria-hidden="true">A</span>{trainDone ? "Settle training" : `Ready in ${countdown(trainLeft)}`}
          </button>
        )}
        {training && (
          <button className="btn-b" disabled={!p.txReady || p.busy === "cancel"} onClick={() => p.send("cancel", "Cancel training", "nft", "cancelTraining", [id])}>
            <span className="b-dot" aria-hidden="true">B</span>Cancel (no gain)
          </button>
        )}
      </div>
      {!training && !canTrain && idle && (
        <p className="note">{hungry ? "Hungry: feed first. Training is locked." : "Training needs at least 6 hours of food left. Feed again first."}</p>
      )}
      <button className="btn-soft" onClick={() => p.go("race")}>Go to race queue</button>
    </div>
  );
}

function RaceScreen(p: {
  g: Awaited<ReturnType<typeof readGlobal>> | null; now: number; address?: Address; txReady: boolean; busy: string | null;
  pet: Awaited<ReturnType<typeof readPet>> | null; band: bigint; setBand: (band: bigint) => void;
  bandState: Awaited<ReturnType<typeof readBand>> | null; bandError: boolean;
  rounds: RoundView[] | null; roundsError: boolean; loadOlder: () => void; send: Send; points?: bigint; go: (s: ScreenId) => void;
}) {
  const { g, pet, bandState } = p;
  const block = g?.block ?? 0n;
  const entries = bandState?.entries ?? [];
  const mine = pet ? entries.find((e) => e.tokenId === pet.id) : undefined;
  const blocksLeft = mine ? Number(mine.joinedBlock + BigInt(QUEUE_WAIT_BLOCKS) - block) : 0;
  const idle = pet?.ham.activity === 0;
  const hungry = pet ? isHungry(pet.ham.fedUntil, p.now) : true;
  const quotaLeft = pet ? Number(pet.usedThisWeek) < WEEKLY_MATCH_LIMIT : false;
  const canEnqueue = !!g?.queueBound && !!pet && idle && !hungry && quotaLeft;
  const eligible = Number(bandState?.eligible ?? 0n);
  const [bandDraft, setBandDraft] = useState(() => p.band.toString());
  const [bandError, setBandError] = useState("");
  const [roundsOpen, setRoundsOpen] = useState(false);
  const shown = useMemo(() => (roundsOpen ? p.rounds : p.rounds?.slice(0, 3)) ?? [], [p.rounds, roundsOpen]);

  return (
    <section className="stack" aria-labelledby="race-title">
      <h1 id="race-title">Race queue</h1>
      <p className="lead">Pets race inside stamina bands of 25. Anyone can push a round forward.</p>
      {!g?.queueBound && g && <p className="banner banner-warn">The queue is not bound to the NFT yet, so nobody can enqueue. Rounds below are read-only.</p>}

      {!pet ? (
        <div className="panel"><p className="note">You can inspect any band and request a ready round without owning a HAM. To enqueue, mint or pick a HAM on the Play screen.</p>
          <button className="btn-soft" onClick={() => p.go("play")}>Go to Play</button></div>
      ) : null}
        <div className="panel">
          {!pet && (
            <form className="stack" noValidate onSubmit={(e) => {
              e.preventDefault();
              if (!/^\d{1,78}$/.test(bandDraft) || BigInt(bandDraft) >= 2n ** 256n) {
                setBandError("Enter a whole band number of 0 or greater, up to 78 digits."); return;
              }
              setBandError(""); p.setBand(BigInt(bandDraft));
            }}>
              <label htmlFor="band">Stamina band</label>
              <div className="input-row">
                <input id="band" name="band" inputMode="numeric" value={bandDraft} onChange={(e) => setBandDraft(e.target.value)}
                  aria-invalid={!!bandError} aria-describedby="band-msg" />
                <button className="btn-soft" type="submit">Inspect band</button>
              </div>
              <p id="band-msg" className={bandError ? "note t-magenta" : "note"}>{bandError || `Viewing band ${p.band} (stamina ${bandRange(p.band)}). Entries wait ${QUEUE_WAIT_BLOCKS} blocks.`}</p>
            </form>
          )}
          {pet && (
          <div className="hud-head">
            <h2>HAM #{pet.id.toString()} · band {p.band.toString()}</h2>
            <span className="tag">{ACTIVITIES[pet.ham.activity]}</span>
          </div>
          )}
          <div className="mint-stats">
            {pet && <div><span className="k">Stamina</span><span className="v">{pet.ham.stamina.toString()}</span></div>}
            <div><span className="k">Queue depth</span><span className="v">{bandState ? `${entries.length} / 32` : "…"}</span></div>
            <div><span className="k">Eligible now</span><span className="v">{bandState ? eligible : "…"}</span></div>
          </div>
          {mine && (
            <Meter label="Queue wait" value={blocksLeft > 0 ? `${blocksLeft} blocks left` : "Eligible"} pct={1 - Math.max(0, blocksLeft) / QUEUE_WAIT_BLOCKS}
              hint={`Entries wait ${QUEUE_WAIT_BLOCKS} blocks (about 2 minutes) before a round can include them.`} />
          )}
          <div className="row-actions">
            {pet && !mine && (
              <button className="btn-a" disabled={!p.txReady || !canEnqueue || p.busy === "enqueue"} onClick={() => p.send("enqueue", "Enqueue", "queue", "enqueue", [pet.id])}>
                <span className="a-dot" aria-hidden="true">A</span>Enqueue in band {p.band.toString()}
              </button>
            )}
            {pet && mine && (
              <button className="btn-b" disabled={!p.txReady || p.busy === "leave"} onClick={() => p.send("leave", "Leave queue", "queue", "leaveQueue", [pet.id])}>
                <span className="b-dot" aria-hidden="true">B</span>Leave queue
              </button>
            )}
            <button className="btn-a" disabled={!p.txReady || !bandState || bandState.band !== p.band || p.bandError || eligible < 2 || !g?.queueBound || p.busy === "request"}
              onClick={() => p.send("request", "Request round", "queue", "requestRound", [p.band])}>
              <span className="a-dot" aria-hidden="true">A</span>Request round
            </button>
          </div>
          <p className="note">
            {p.bandError ? "Could not read this band. Retrying."
              : !bandState ? "Reading this band…"
              : pet && !mine && !idle ? `This HAM is ${ACTIVITIES[pet.ham.activity].toLowerCase()} and cannot join now.`
              : pet && !mine && hungry ? "Hungry: feed first. The queue is locked."
              : pet && !mine && !quotaLeft ? "Weekly races used up. The quota resets each epoch week (Thursday 00:00 UTC)."
              : eligible < 2 ? "A round needs two eligible pets in this band." : "Two or more pets are eligible. Anyone can request the round."}
          </p>
          {entries.length > 0 && (
            <ul className="list" aria-label={`Band ${p.band} queue`}>
              {entries.map((e) => {
                const left = Number(e.joinedBlock + BigInt(QUEUE_WAIT_BLOCKS) - block);
                return (
                  <li key={e.tokenId.toString()}>
                    <span>HAM #{e.tokenId.toString()}</span>
                    <span className="dim">{short(e.player)}</span>
                    <span className={left > 0 ? "t-amber" : "t-mint"}>{left > 0 ? `${left} blocks` : "Eligible"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      <div className="panel">
        <h2>Recent rounds</h2>
        {!p.rounds && !p.roundsError && <p className="note">Reading rounds…</p>}
        {p.roundsError && <p className="note">Could not read rounds. Retrying.{p.rounds ? " Showing the last complete read." : ""}</p>}
        {p.rounds && p.rounds.length === 0 && <p className="note">No rounds yet. The first one starts when two pets in a band are eligible.</p>}
        {shown.map((r) => <RoundCard key={r.id.toString()} r={r} block={block} {...p} />)}
        {(p.rounds?.length ?? 0) > 3 && (
          <button className="btn-soft" aria-expanded={roundsOpen} onClick={() => setRoundsOpen(!roundsOpen)}>{roundsOpen ? "Show fewer rounds" : "Show more rounds"}</button>
        )}
        {roundsOpen && p.rounds && g && BigInt(p.rounds.length) < g.roundCount && (
          <button className="btn-soft" onClick={p.loadOlder}>Load older rounds</button>
        )}
        {p.points !== undefined && <p className="note">Your wallet points: {p.points.toString()} (win +10, loss +2, not transferable).</p>}
      </div>

      <div className="panel">
        <h2>Two-player bands</h2>
        <p className="note">When exactly two pets wait in a band, they race each other: the opponent is whoever is queued. Check the queue list before joining and leave while waiting if you prefer. With three or more, a future block shuffles pairs and an odd pet gets a bye with its weekly race refunded.</p>
      </div>
    </section>
  );
}

function RoundCard({ r, block, txReady, busy, send }: { r: RoundView; block: bigint; txReady: boolean; busy: string | null; send: Send }) {
  const status = ROUND_STATUS[r.status] ?? "Unknown";
  const ready = r.status === 1 && block > r.entropyBlock && block <= r.entropyBlock + 256n;
  const expired = r.status === 1 && block > r.entropyBlock + 256n;
  const wait = r.status === 1 && block <= r.entropyBlock ? Number(r.entropyBlock - block + 1n) : 0;
  return (
    <div className="round">
      <div className="round-head">
        <span>Round {r.id.toString()} · band {r.band.toString()} · {r.count.toString()} pets</span>
        <span className={r.status === 2 ? "t-mint" : r.status === 1 ? "t-amber" : "t-magenta"}>{status}</span>
      </div>
      {r.status === 1 && (
        <div className="row-actions">
          {wait > 0 && <span className="note">Entropy block in {wait} blocks.</span>}
          {ready && (
            <button className="btn-a" disabled={!txReady || busy === `ful${r.id}`} onClick={() => send(`ful${r.id}`, `Fulfil round ${r.id}`, "queue", "fulfillRound", [r.id])}>
              <span className="a-dot" aria-hidden="true">A</span>Fulfil round
            </button>
          )}
          {expired && (
            <button className="btn-b" disabled={!txReady || busy === `exp${r.id}`} onClick={() => send(`exp${r.id}`, `Expire round ${r.id}`, "queue", "expireRound", [r.id])}>
              <span className="b-dot" aria-hidden="true">B</span>Expire round
            </button>
          )}
        </div>
      )}
      {r.matches.map((m) => {
        const aWon = m.winner === m.a.tokenId;
        return (
          <div key={m.id.toString()} className="match">
            <span className={aWon ? "t-mint" : ""}>#{m.a.tokenId.toString()} {WEIGHTS[m.a.weight]} {m.scoreA.toString()}</span>
            <span className="dim">vs</span>
            <span className={!aWon && m.winner !== 0n ? "t-mint" : ""}>#{m.b.tokenId.toString()} {WEIGHTS[m.b.weight]} {m.scoreB.toString()}</span>
            {m.settled ? <span className="dim">Settled</span> : (
              <button className="btn-a btn-sm" disabled={!txReady || busy === `set${m.id}`} onClick={() => send(`set${m.id}`, `Settle race ${m.id}`, "queue", "settleMatch", [m.id])}>
                <span className="a-dot" aria-hidden="true">A</span>Settle
              </button>
            )}
          </div>
        );
      })}
      {r.bye > 0n && <p className="note">Bye: HAM #{r.bye.toString()} (race refunded).</p>}
    </div>
  );
}

function InviteScreen({ address, ref_ }: { address?: Address; ref_: string | null }) {
  const [handle, setHandle] = useState(getMyHandle);
  const [draft, setDraft] = useState(getMyHandle);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [board, setBoard] = useState<BoardState | null>(null);
  const local = rankBoard(localAttributions());

  useEffect(() => {
    let live = true;
    const load = () => fetchBoard().then((b) => live && setBoard(b));
    load();
    const t = setInterval(load, 20000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const h = normalizeHandle(draft);
    if (!h) { setErr("Use 1 to 15 letters, numbers or underscores, like hamfan_42."); return; }
    setErr(""); setMyHandle(h); setHandle(h); setDraft(h); blip("confirm");
  };
  const link = handle ? inviteLink(handle) : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); blip("confirm"); setTimeout(() => setCopied(false), 2000); }
    catch { setErr("Copy failed. Select the link and copy it by hand."); }
  };
  const rows = board?.status === "ok" ? board.rows : local;

  return (
    <section className="stack" aria-labelledby="invite-title">
      <h1 id="invite-title">Invite friends</h1>
      <p className="lead">Share your link. A friend who connects and mints through it counts for you. Off-chain only, no rewards.</p>
      <form className="panel" onSubmit={save} noValidate>
        <label htmlFor="handle">Your X handle</label>
        <div className="input-row">
          <span className="at" aria-hidden="true">@</span>
          <input id="handle" name="handle" autoComplete="off" spellCheck={false} placeholder="hamfan_42" value={draft}
            aria-invalid={!!err} aria-describedby="handle-msg" onChange={(e) => setDraft(e.target.value)} />
          <button className="btn-a" type="submit"><span className="a-dot" aria-hidden="true">A</span>Save</button>
        </div>
        <p id="handle-msg" className={err ? "note t-magenta" : "note"}>{err || "Saved in this browser only."}</p>
        {handle && (
          <>
            <label htmlFor="invite-link">Your invite link</label>
            <input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <div className="row-actions">
              <button type="button" className="btn-a" onClick={copy}><span className="a-dot" aria-hidden="true">A</span>{copied ? "Copied" : "Copy link"}</button>
              <a className="btn-soft" target="_blank" rel="noreferrer"
                href={`https://x.com/intent/post?text=${encodeURIComponent("Mint a free pixel hamster and race me on HamsterRun (Sepolia testnet)")}&url=${encodeURIComponent(link)}`}>
                Post on X
              </a>
            </div>
          </>
        )}
        {ref_ && <p className="note">You arrived through @{ref_}{address ? ". This wallet is credited to them once it mints." : ". Connect and mint to credit them."}</p>}
      </form>

      <div className="panel">
        <h2>Invite board</h2>
        {board === null && <p className="note">Checking the invite service…</p>}
        {board?.status === "offline" && <p className="banner banner-warn">Invite service offline: no service URL is configured. Showing invites recorded in this browser only.</p>}
        {board?.status === "error" && <p className="banner banner-warn">Invite service did not answer. Showing invites recorded in this browser only.</p>}
        {board && rows.length === 0 && <p className="note">No invites yet. Share your link to start the board.</p>}
        {board && rows.length > 0 && (
          <table className="board">
            <thead><tr><th scope="col">Rank</th><th scope="col">Handle</th><th scope="col">Minted</th><th scope="col">Wallets</th></tr></thead>
            <tbody>
              {rows.slice(0, 25).map((r, i) => (
                <tr key={r.handle}>
                  <td>{i + 1}</td>
                  <td>@{r.handle}</td>
                  <td>{r.invites}<span className="dim"> / {r.connected}</span></td>
                  <td className="dim">{r.wallets.slice(0, 3).map(short).join(", ")}{r.wallets.length > 3 ? ` +${r.wallets.length - 3}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="note">Ranked by invitees who connected and minted; connected-only wallets show after the slash.</p>
      </div>
    </section>
  );
}

function HelpScreen() {
  return (
    <section className="stack" aria-labelledby="help-title">
      <h1 id="help-title">Rules</h1>
      <p className="lead">Everything here is on Sepolia testnet. Formulas come from the v2 contracts.</p>
      <div className="panel">
        <h2>Care</h2>
        <ul className="steps">
          <li>Every HAM starts at stamina 10, body score 50, Normal weight. Stamina has no cap.</li>
          <li>Food lasts 72 hours from the feed. Hungry pets cannot train or join a queue.</li>
          <li>Food tiers cost 0.0001, 0.0002 and 0.0003 ETH by default (live prices shown on Play), with training bonus 1x, 1.5x and 2x.</li>
          <li>Training takes 6 hours and needs 6 hours of food left. Gain is 1 + 100 / (10 + stamina / 10), times the food bonus. Anyone may settle once ready.</li>
          <li>Body score 70+ is Fit, 35-69 Normal, under 35 Obese. Each idle day costs 5, each hungry day 5 more. Low food is -4, mid +6, high +12.</li>
        </ul>
      </div>
      <div className="panel">
        <h2>Racing</h2>
        <ul className="steps">
          <li>Band is floor(stamina / 25). Up to 32 pets wait per band; one active pet per wallet.</li>
          <li>An entry becomes eligible after 10 blocks. Anyone can request a round once two are eligible; it locks every eligible pet.</li>
          <li>Two blocks later anyone can fulfil the round within 256 blocks, otherwise anyone can expire it.</li>
          <li>Score is stamina times weight (Fit 1.15, Normal 1.0, Obese 0.85) with a random swing of up to 1000 bps. Winner +3 stamina and +10 points, loser +1 and +2.</li>
          <li>Five races per HAM per week. Points stay with the wallet and cannot be transferred.</li>
        </ul>
      </div>
      <div className="panel">
        <h2>Contracts and gas</h2>
        <ul className="steps">
          <li>HamsterRunNFT <a href={`${EXPLORER}/address/${NFT_ADDRESS}`} target="_blank" rel="noreferrer">{short(NFT_ADDRESS)}</a></li>
          <li>MatchQueue <a href={`${EXPLORER}/address/${QUEUE_ADDRESS}`} target="_blank" rel="noreferrer">{short(QUEUE_ADDRESS)}</a></li>
          <li>Need Sepolia ETH? {FAUCETS.map((f, i) => <span key={f.url}>{i ? " or " : ""}<a href={f.url} target="_blank" rel="noreferrer">{f.name}</a></span>)}.</li>
        </ul>
        <p className="note">Randomness comes from a future block hash. It is fine for a testnet game, not for anything of value.</p>
      </div>
    </section>
  );
}
