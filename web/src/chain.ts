import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError, ContractFunctionRevertedError, parseAbiItem, zeroAddress, type Address } from "viem";
import { DEPLOY_BLOCK, NFT_ADDRESS, QUEUE_ADDRESS, nftAbi, publicClient, queueAbi } from "./config";
import type { Hamster } from "./game";

const nft = (functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address: NFT_ADDRESS, abi: nftAbi, functionName, args }) as Promise<unknown>;
const q = (functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address: QUEUE_ADDRESS, abi: queueAbi, functionName, args }) as Promise<unknown>;

export type Global = {
  mintOpen: boolean;
  totalSupply: bigint;
  matchQueue: Address;
  queueBound: boolean;
  prices: bigint[];
  bps: bigint[];
  block: bigint;
  roundCount: bigint;
};
export type Entry = { tokenId: bigint; player: Address; joinedAt: bigint; joinedBlock: bigint };
export type Racer = { tokenId: bigint; player: Address; stamina: bigint; weight: number };
export type MatchView = { id: bigint; a: Racer; b: Racer; scoreA: bigint; scoreB: bigint; winner: bigint; settled: boolean };
export type RoundView = { id: bigint; band: bigint; entropyBlock: bigint; status: number; count: bigint; bye: bigint; matches: MatchView[] };
export type PetView = {
  id: bigint;
  ham: Hamster;
  training: { readyAt: bigint; gain: bigint; tier: number };
  usedThisWeek: bigint;
  preview: bigint;
};

export async function readGlobal(): Promise<Global> {
  const [mintOpen, totalSupply, matchQueue, p0, p1, p2, b0, b1, b2, block, roundCount] = await Promise.all([
    nft("mintOpen"), nft("totalSupply"), nft("matchQueue"),
    nft("foodPrices", [0n]), nft("foodPrices", [1n]), nft("foodPrices", [2n]),
    nft("foodTrainBps", [0n]), nft("foodTrainBps", [1n]), nft("foodTrainBps", [2n]),
    publicClient.getBlockNumber(), q("roundCount"),
  ]);
  const mq = matchQueue as Address;
  return {
    mintOpen: mintOpen as boolean, totalSupply: totalSupply as bigint, matchQueue: mq,
    queueBound: mq !== zeroAddress && mq.toLowerCase() === QUEUE_ADDRESS.toLowerCase(),
    prices: [p0, p1, p2] as bigint[], bps: [b0, b1, b2] as bigint[], block, roundCount: roundCount as bigint,
  };
}

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

/** No enumeration on the NFT: find candidates from Transfer logs (or an ownerOf scan), then confirm with ownerOf. */
export async function readOwned(owner: Address, totalSupply: bigint): Promise<bigint[]> {
  let candidates: bigint[] = [];
  try {
    const logs = await publicClient.getLogs({ address: NFT_ADDRESS, event: transferEvent, args: { to: owner }, fromBlock: DEPLOY_BLOCK, toBlock: "latest" });
    candidates = [...new Set(logs.map((l) => l.args.tokenId as bigint))];
  } catch {
    // IDs are sequential, with no burns. A log-range limit must not hide later mints.
    candidates = Array.from({ length: Number(totalSupply) }, (_, i) => BigInt(i + 1));
  }
  const owned: bigint[] = [];
  for (let start = 0; start < candidates.length; start += 40) {
    const batch = candidates.slice(start, start + 40);
    // Propagate failed reads: a partial scan is not an authoritative empty balance.
    const owners = await Promise.all(batch.map((id) => nft("ownerOf", [id])));
    owned.push(...batch.filter((_, i) => (owners[i] as string).toLowerCase() === owner.toLowerCase()));
  }
  return owned.sort((a, b) => Number(a - b));
}

export async function readPet(id: bigint): Promise<PetView> {
  const [ham, training, used, preview] = await Promise.all([
    nft("hamster", [id]), nft("training", [id]), nft("matchesThisWeek", [id]), nft("previewTrainingGain", [id]).catch(() => 0n),
  ]);
  const t = training as readonly [bigint, bigint, number];
  return { id, ham: ham as Hamster, training: { readyAt: t[0], gain: t[1], tier: Number(t[2]) }, usedThisWeek: used as bigint, preview: preview as bigint };
}

export async function readBand(band: bigint) {
  const [entries, eligible] = await Promise.all([q("queueEntries", [band]), q("eligibleCount", [band])]);
  return { band, entries: entries as Entry[], eligible: eligible as bigint };
}

export async function readRounds(roundCount: bigint, howMany = 6): Promise<RoundView[]> {
  const ids: bigint[] = [];
  for (let i = roundCount; i >= 1n && ids.length < howMany; i--) ids.push(i);
  return Promise.all(
    ids.map(async (id) => {
      const [info, matchIds, bye] = await Promise.all([q("roundInfo", [id]), q("roundMatchIds", [id]), q("roundBye", [id]).catch(() => 0n)]);
      const r = info as readonly [bigint, bigint, bigint, number, `0x${string}`, bigint];
      const matches = await Promise.all(
        (matchIds as bigint[]).map(async (mid) => {
          // matchInfo has one named Race tuple output; viem decodes it as an object.
          const m = (await q("matchInfo", [mid])) as Omit<MatchView, "id"> & { roundId: bigint };
          return { id: mid, a: m.a, b: m.b, scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner, settled: m.settled };
        }),
      );
      return { id, band: r[0], entropyBlock: r[1], status: Number(r[3]), count: r[5], bye: bye as bigint, matches };
    }),
  );
}

export async function readPlayer(addr: Address) {
  const [freeMinted, activeToken, points] = await Promise.all([nft("freeMinted", [addr]), q("activeToken", [addr]), q("points", [addr])]);
  return { freeMinted: freeMinted as boolean, activeToken: activeToken as bigint, points: points as bigint };
}

/** Friendly copy for the contracts' custom errors; each says what to do next. */
const ERRORS: Record<string, string> = {
  MintClosed: "Mint is not open yet. The owner still has to call setMintOpen(true).",
  AlreadyMinted: "This wallet already used its free mint.",
  SoldOut: "All 9999 HAM are minted.",
  Hungry: "Your HAM is hungry. Feed it first.",
  IncorrectPayment: "Food price changed. Reload and pay the exact amount.",
  InsufficientFeedDuration: "Training needs 6 hours of food left. Feed again first.",
  Locked: "This HAM is busy (training, queued or racing).",
  WrongActivity: "This HAM is busy with another activity right now.",
  TrainingNotReady: "Training is not finished yet.",
  NoTraining: "No training is running.",
  NotTokenOwner: "Only the HAM owner can do that.",
  QueueNotConfigured: "The match queue is not bound yet. The owner still has to call setMatchQueue.",
  WeeklyQuotaExceeded: "This HAM used all 5 races this week.",
  PlayerAlreadyActive: "This wallet already has a HAM in a queue or race.",
  QueueFull: "This band queue is full (32). Try later.",
  NotEnoughPlayers: "Fewer than two pets are eligible in this band yet.",
  RandomnessNotReady: "Wait for the entropy block to pass, then fulfil.",
  RandomnessExpired: "The 256-block window passed. Expire the round instead.",
  RandomnessStillLive: "This round can still be fulfilled, so it cannot be expired.",
  RoundNotPending: "This round is already resolved.",
  MatchAlreadySettled: "This race is already settled.",
  NotQueued: "This HAM is not in a queue.",
  EntryStillLive: "That entry is still live.",
  InvalidTier: "Pick one of the three food tiers.",
};

export function explain(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && ERRORS[name]) return ERRORS[name];
    if (name) return `The contract refused: ${name}.`;
    if (/User rejected|denied/i.test(err.message)) return "Request declined in the wallet.";
    if (/insufficient funds/i.test(err.message)) return "Not enough Sepolia ETH for this transaction. Use a faucet from the Help screen.";
    return err.shortMessage || "Transaction failed.";
  }
  return (err as Error)?.message ?? "Transaction failed.";
}

/** Polls a loader on an interval and on demand; keeps last good data and flags read errors. */
export function usePoll<T>(load: (() => Promise<T>) | null, deps: unknown[], ms = 12000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const ref = useRef(load);
  ref.current = load;
  const run = useCallback(async () => {
    if (!ref.current) return;
    try { setData(await ref.current()); setError(false); } catch { setError(true); }
  }, []);
  useEffect(() => {
    setData(null);
    if (!load) return;
    run();
    const t = setInterval(run, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, refresh: run };
}
