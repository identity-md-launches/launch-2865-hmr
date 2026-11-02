# HamsterRun v2

Independent Sepolia game contracts: mint a HAM, feed it, train it, and enter a random race. This is a fresh implementation with no SqueekCore, CoreReader, TrainBook, MatchBook, or launch-2834 dependency. There are no claims of official Squeek mining, SQK yield, insurance, or guaranteed airdrops.

**Deployment status: prepared for the IdentityMD network deployer; not yet deployed by this worker.** [deployments/sepolia.json](deployments/sepolia.json) deliberately contains no invented contract addresses. The network publishes the confirmed addresses after acceptance. This repository contains the applications, vendored dependencies, tests, ABIs, deployment rehearsals, and a read-only address recorder.

## Applications

| Contract | Responsibility | Constructor, in launch order |
| --- | --- | --- |
| `HamsterRunNFT` | ERC-721, free mint, food fees, timed training, weight, locks and NFT weekly quota | `address initialOwner` = `$owner` |
| `MatchQueue` | Stamina bands, future-block shuffle, race snapshots, settlement and address points | `address nftAddress` = `$contract:HamsterRunNFT` |

`PointsLedger` is an abstract component of `MatchQueue`; `GameMath` has only internal functions. Neither needs separate deployment or bytecode linking. Contracts are immutable implementations, without proxies or upgrades. Constructors are nonpayable and make no dependency calls. Only the two applications above belong in the network's manifest; scripts and test harnesses are not applications. The later manifest step writes `launch.json`.

The chain is **Sepolia, 11155111**. The requested initial owner is **`0x6c14430adacc99e27f6180bc5a74d6768616bf4a`**. Ownership comes from the constructor argument, never from the factory or transaction origin. The queue has no administrator.

The NFT name is **HamsterRun**, symbol **HAM**, and lifetime supply limit **9999**. The brief's generic `hmr` / `100000000` fields do not create a fungible token: the approved scope explicitly excludes token launches and specifies the separate 9999 NFT limit. No ERC-20, distributor, pool, or contributor allocation is included.

## Build and check offline

The root project pins Solidity **0.8.26**, Cancun, optimizer 200 runs, and `bytecode_hash = "none"`. It enables neither FFI nor filesystem cheatcode permissions. OpenZeppelin Contracts 5.1.0 and forge-std 1.9.7 are vendored as ordinary files with licenses and exact commits in [dependencies.json](dependencies.json). No package manager, submodule, RPC connection, key, or environment variable is needed for compilation or tests. The verifier supplies the pinned compiler.

```sh
forge build
forge test
forge fmt --check
python3 tools/export_abis.py --check
python3 -m unittest discover -s test -p 'test_*.py' -v
```

The supplied fuzz seed is pinned in `foundry.toml`:
`0x144ded666ac8b406b18a386babcfea0c25dc02e78fa96c2aadd1498e601a604a`.
Fuzz tests use 512 cases; the stateful invariant campaign uses 128 runs of 64 calls. The supply test actually creates all 9999 NFTs; its bulk fixture disables gas metering only for setup, since those mints represent separate transactions. No production batch-mint function exists.

Application ABIs are delivered in [abi/HamsterRunNFT.json](abi/HamsterRunNFT.json) and [abi/MatchQueue.json](abi/MatchQueue.json). Regenerate them with `python3 tools/export_abis.py` after a build.

## Rules and parameters

All arithmetic, rounding, time boundaries and state transitions are pinned in [DESIGN.md](DESIGN.md).

| Rule | Value |
| --- | --- |
| Free mint | Once per wallet, when `mintOpen`; transferring away does not reset it |
| Owner mint | Available with mint closed; same 9999 total limit; no custom starting stats |
| Starting pet | Stamina 10, Normal weight, body score 50, hungry until first feed |
| Stamina | `uint256`, checked growth, no gameplay ceiling |
| Feeding | Exactly the tier price; resets expiry to `now + 72 hours`; excess ETH reverts |
| Low / mid / high price | 0.0001 / 0.0002 / 0.0003 ETH |
| Low / mid / high training multiplier | 10000 / 15000 / 20000 bps |
| Training | Fixed 6 hours; must be fed through completion; permissionless settlement |
| Base training gain | `1 + floor(100 / (10 + floor(stamina / 10)))` |
| Final training gain | `floor(baseGain * lastFeedBps / 10000)` |
| Weight | Fit (健美) at score ≥70; Normal (正常) at 35–69; Obese (肥胖) at 0–34 |
| Weight pressure | Food −4 / +6 / +12; training `+2 + 2*tier + min(gain,10)`; neglect as below |
| Neglect | −5 per full day since last training settlement; additional −5 per begun hungry day |
| Band | `floor(stamina / 25)`; weight modifies the race instead of fragmenting queues |
| Queue | At most 32 waiting entries per band; one active pet per address across all bands |
| Waiting expiry | Hungry or strictly older than 24 hours; owner can leave sooner |
| Round | Largest even live prefix, 2–32 pets, all snapshotted before randomness |
| Entropy | Block `request block + 2`; fulfill from target+1 through target+256 inclusive |
| Quota | 5 locked attempts per NFT per Unix-epoch week; expired attempts still count |
| Rewards | Winner: +3 stamina / +10 address points; loser: +1 stamina / +2 points |
| Race score | `floor(stamina * (weightBps + noiseBps) / 20000)` |
| Weight bps / noise | Fit 11500, Normal 10000, Obese 8500; independent noise −1000…+1000 |

At equal stamina and equal noise, better weight cannot produce a lower score. The common score divisor 20000 preserves ordering and accommodates the entire `uint256` stamina domain. Tie results use a separate entropy-derived bit. Points are non-transferable counters, with a weekly mapping credited to the **round lock week**, not the settlement week.

Low training causes deterioration even with high food at regular 72-hour intervals: 15 inactivity damage exceeds the 12 food benefit. Frequent paid feeds can improve weight faster; there is deliberately no feed cooldown. Body score is bounded to 0–100; stamina is not. No NFT burns on hunger.

**Randomness is not a VRF or economically secure lottery.** Block proposers can bias or censor a future block, and an unfulfilled round can expire. Use this design only for this independent testnet game, without wagering, cash prizes, or promised token value. Callers cannot choose a seed, opponent, entropy block, or cancel after round lock. See [SECURITY.md](SECURITY.md) for the remaining trust assumptions.

## After launch

Use the confirmed application addresses from the network's deployment handoff. No keys or signing accounts are stored or read by this project.

| Who | Call / operation | Input and source |
| --- | --- | --- |
| Owner | `HamsterRunNFT.setMatchQueue(queue)` **once** | Confirmed `MatchQueue` address; verify its bytecode and `nft()` binding first |
| Owner | `setFoodConfig(uint256[3],uint256[3])` | Prices `[100000000000000,200000000000000,300000000000000]` wei; bps `[10000,15000,20000]`, as requested; constructors already set these defaults |
| Owner | `setMintOpen(true)` | Opening decision; defaults to false |
| Players / permissionless keeper | `requestRound(band)`, `fulfillRound(roundId)`, `settleMatch(matchId)` | Discover bands/rounds/matches from events and getters; fulfill before the blockhash window closes |
| Players / keeper | `evictExpired(tokenId)`, `expireRound(roundId)` | Clean stale waiting entries and recover missed randomness windows |
| Owner | `withdraw(amount)` | Earned food fees, sent only to the current owner; no user escrow or prize pot |
| Network deployer | Explorer source verification and address publication | Exact pinned build and actual deployment receipts; independent release review remains a separate step |

Both constructors work without post-deployment initialization transactions by the factory. Care works before the queue binding; queue entry clearly reverts with `QueueNotConfigured` until the owner binds it. The owner can later change prices and multipliers within the documented bounds, close free mint, use owner mints, withdraw fees, or transfer ownership with acceptance by the new owner. Queue replacement and renouncing ownership are disabled. There is no pause that traps active pets.

Permissionless functions still need transactions and gas. There is no paid keeper, scheduled bot, or automation subscription in this delivery. Waiting pets can be removed by their owners, and all fulfilled matches remain settleable indefinitely. There is no optional 24-hour pair cooldown in this version; the five-attempt weekly limit applies even to repeated opponents.

For local constructor rehearsal (no RPC, no broadcast):

```sh
forge script script/Deploy.s.sol:DeployHamsterRunNFT \
  --chain-id 11155111 --sig 'run(address)' 0x6c14430adacc99e27f6180bc5a74d6768616bf4a
```

`DeployMatchQueue.run(address nftAddress)` rehearses the second application. These scripts intentionally contain no broadcast calls; the network factory handles actual deployment. `test/Deployment.t.sol` tests the scripts and factory ownership directly with arguments and an empty environment.

After actual deployment has finalized, `tools/record_deployment.py` accepts `--rpc-url`, `--nft`, and `--queue`. It reads Sepolia's finalized block, checks both exact runtimes (including the queue's immutable NFT address), verifies the requested owner and mutual binding, then updates `deployments/sepolia.json`. It fails without writing if anything is inconsistent. It neither signs, polls, nor stores the RPC URL. The provider must support EIP-1898 block-hash references. Run `forge build` first; coverage instrumentation is not deployment bytecode.

## Smoke path

The complete deterministic local smoke is:

```sh
forge test --match-test test_endToEndMintFeedTrainQueueRandomMatchSettle -vv
```

On Sepolia, after the owner setup above, two separate wallets can follow the same sequence through the ABIs:

1. Each calls `mint()`; read its token ID from the `Transfer` or `HamsterMinted` event. Assert starting stamina 10 with `hamster(tokenId)`.
2. Each calls `feed(tokenId, 2)` with exactly **0.0003 ETH**, then `startTraining(tokenId)`. `training(tokenId)` returns the completion timestamp and snapshotted gain (20 at initial stamina with default high food).
3. At or after `readyAt`, anyone calls `settleTraining(tokenId)` for each pet. Both now have stamina 30, putting them in band 1. `hamster` also returns effective weight and body score. The contract, not an off-chain timer, enforces the six hours; local tests advance simulated time.
4. Each owner calls `MatchQueue.enqueue(tokenId)`. Anyone calls `requestRound(1)` and records `roundId` and `entropyBlock` from `RoundLocked`. No opponent ID is submitted.
5. After `entropyBlock`, and no later than `entropyBlock+256`, anyone calls `fulfillRound(roundId)`. Read IDs from `roundMatchIds(roundId)` or `MatchCreated`.
6. Anyone calls `settleMatch(matchId)`. Check `matchInfo`, `points(wallet)`, `weeklyPoints(lockWeek,wallet)`, and `hamster(tokenId)`. The pair's combined stamina increased by 4, and its combined points by 12. Both NFTs are transferable again.

If feeding expires before entry, feed again. If waiting becomes stale, leave or evict and requeue. If no keeper fulfills in time, call `expireRound`; pets unlock without rewards and their weekly attempt remains consumed. A low-population stamina band requires another live entry in that band; the owner cannot manually choose an opponent.
