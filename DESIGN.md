# HamsterRun v2 deterministic design

This specification describes the delivered contracts, including their deliberate testnet assumptions. Solidity 0.8.26 checked arithmetic is the default. All divisions below round down unless explicitly stated otherwise.

## Deployment and ownership

Two non-upgradeable applications are deployed in order: `HamsterRunNFT(initialOwner)`, then `MatchQueue(nftAddress)`. Neither constructor calls another contract, creates another contract, receives ETH, nor derives ownership from its caller. NFT ownership is OpenZeppelin `Ownable2Step` with an explicit nonzero owner. MatchQueue has no owner and no configurable race parameters.

The NFT owner binds the queue once with `setMatchQueue`. The queue must have code and report this NFT through `nft()`. Its address can never be replaced. The binding is an administrative trust decision; the owner should verify the confirmed queue implementation before setting it. There is no upgrade, initializer, delegatecall, selfdestruct, arbitrary stat setter, or arbitrary points issuer.

The owner controls free-mint opening, the three food prices and multipliers, owner mints within supply, fee withdrawal to itself, and a two-step ownership handover. Renouncing ownership reverts so fees and administration remain recoverable. Setting a zero pending owner only cancels a pending handover as supported by Ownable2Step.

## Mint, ownership and locks

IDs are sequential from 1 to 9999 inclusive. `totalSupply` counts all lifetime mints; no burns exist. Free mint is nonpayable, requires `mintOpen`, and consumes `freeMinted[msg.sender]` before the safe receiver callback. Sending the NFT away never resets that flag. `ownerMint(player)` works with free mint closed and does not consume the recipient's free-mint allocation. It cannot mint different stats or exceed the shared cap.

Every pet starts with stamina 10, body score 50, Normal weight, Idle activity, `fedUntil=0`, tier 0 and trainBps 10000. A newly minted pet is hungry. Initializing stats, supply and free-mint flags precedes the ERC-721 receiver callback; callback failure rolls everything back.

Only the actual ERC-721 owner can feed, start/cancel training, enqueue, or leave a waiting queue. Approval is sufficient for an ordinary ERC-721 transfer, never for gameplay. Every transfer path passes through the NFT's `_update` lock check, including approved operators and both safe-transfer overloads.

| Activity | Allowed transitions |
| --- | --- |
| Idle | Owner feed (stays Idle), owner transfer, start training → Training, enqueue → Queued |
| Training | Permissionless earned settlement → Idle; owner cancellation without gain → Idle |
| Queued | Owner leave / permissionless stale eviction → Idle; permissionless round request → Matched |
| Matched | Permissionless fulfilled settlement → Idle; permissionless expired-round recovery → Idle |

Food, transfers and new training are blocked while Training, Queued or Matched. Approvals may still change, but cannot bypass the transfer lock. No owner function can seize a pet or clear an active lock.

## Food and hunger

Tier defaults are:

| Tier | Price in wei | trainBps | Feed body delta |
| --- | ---: | ---: | ---: |
| 0, low | 100000000000000 | 10000 | −4 |
| 1, mid | 200000000000000 | 15000 | +6 |
| 2, high | 300000000000000 | 20000 | +12 |

`setFoodConfig(prices,bps)` updates all tiers atomically. Prices must be positive and strictly increasing. Multipliers must be strictly increasing with `10000 ≤ bps[0] < bps[1] < bps[2] ≤ 50000`. This multiplier bound controls bonus configuration, not stamina growth. Previous feeds and active training retain their captured multipliers/gains.

`feed(tokenId,tier)` requires Idle, actual ownership, tier 0–2, and **exact** `msg.value`. Underpayment and overpayment both revert. Old neglect is applied first. The new deadline is `block.timestamp + 259200`, not the previous deadline plus 259200. Feeding overwrites the tier and snapshots its current bps, resets the applied hunger counter for the new deadline, and applies the tier's body delta. Refeeding early is allowed, always costs the full fee, and can speed weight recovery.

Hungry means `fedUntil == 0 || now > fedUntil`. Equality is still fed. Hungry pets cannot start training, enqueue, or lock a race. The hungry rule does not prevent canceling training, leaving a queue, settling already earned work, settling a locked match, or recovering an expired round. No death, burn, tax token, or hibernation payment is implemented.

Food proceeds are earned fees with no refund liability. Only `withdraw(amount)` sends ETH out, only to the current owner. It rejects zero/oversized amounts and failed transfers, and is reentrancy guarded. The NFT and queue have no payable receive/fallback. Forced ETH, if any, is also withdrawable by the NFT owner; it creates no user entitlement. MatchQueue never accepts or pays ETH.

## Body score and effective weight

Body score `B` is an integer in [0,100]. It is distinct from uncapped stamina `S`. Each NFT stores `B` **and** a `WeightClass` enum:

| Enum value | Name | Score |
| ---: | --- | --- |
| 0 | Fit / 健美 | 70–100 |
| 1 | Normal / 正常 | 35–69 |
| 2 | Obese / 肥胖 | 0–34 |

Neglect is computed lazily on feed, training start/settlement/cancellation, queue lock/unlock, match lock/release, and idle transfers. `hamster(tokenId)` projects the same neglect in a view, so clients never need a maintenance transaction to see current weight. In storage, score and enum are updated together. A race stores a separate immutable-in-practice weight snapshot at round lock.

Each pet stores birth time, last successful training settlement time, and the number of already-applied inactivity/hunger days. At time `t`:

```text
I = floor((t - lastTrainAt) / 86400)
hungerStart = (fedUntil == 0 ? birthTime : fedUntil)
H = 0                              if t <= hungerStart
H = 1 + floor((t - hungerStart - 1) / 86400) otherwise
damage = 5*(I - idleDaysApplied) + 5*(H - hungerDaysApplied)
B = max(0, B - damage)
idleDaysApplied = I
hungerDaysApplied = H
```

Thus inactivity costs 5 per completed day, and hunger costs an additional 5 per begun day after expiry. At expiry exactly there is no hunger damage; one second later the first hunger penalty applies. A newborn waiting after mint is also in its first hungry period. There are no loops proportional to elapsed time. Repeated transfers, views or early feeds cannot reset or double-apply fractional inactivity days. The last successful training settlement is the only reset of the inactivity clock. Food resets the hunger clock because it establishes a new expiry.

After applying prior neglect:

* Low feed: `B = max(0, B-4)`; mid feed: `B = min(100, B+6)`; high feed: `B = min(100, B+12)`.
* Training settlement: `B = min(100, B + 2 + 2*tierAtStart + min(staminaGain,10))`, then `lastTrainAt=now` and `idleDaysApplied=0`.

Higher food and larger recent training gains therefore improve health. Low food with little training degrades it. With no training and a high feed every 72 hours, 15 inactivity damage exceeds the 12 food bonus, so the body still drifts toward Obese. Buying several feeds close together can counteract this; it is explicit game behavior. Long neglect saturates score at zero; food and training can always restore it after unlocking.

## Training and overflow safety

Owner `startTraining` requires Idle, currently fed, and `fedUntil >= now + 21600`. It computes and stores:

```text
baseGain = 1 + floor(100 / (10 + floor(S / 10)))
gain = floor(baseGain * trainBpsFromLastFeed / 10000)
readyAt = now + 21600
```

The pet is locked for six hours. `settleTraining` is permissionless at `now >= readyAt`, awards the stored gain once, updates body state, clears training and unlocks. All work completes within the fed interval required at start, so a late claim remains allowed after hunger, with neglect applied before body improvement. Cancellation by the owner forfeits the gain without modifying stamina or resetting training activity time.

At S=10, baseGain=10 and default tier gains are 10, 15 and 20. The base is monotonically non-increasing in current stamina. At sufficiently large S it is 1, so valid multipliers always produce positive growth. It does not become zero or stop at a gameplay cap.

Stamina storage and all additions are `uint256` with Solidity checked arithmetic. There is no `MAX_STAMINA`, saturation, narrowing cast or unchecked wrap. The denominator `10 + S/10` fits even for `uint256.max`; baseGain ≤11 and configured bps ≤50000 make the training product safe. At the theoretical uint256 arithmetic limit an addition reverts atomically; a training owner can still cancel. A race reward would similarly revert at that unreachable practical extreme rather than wrap or silently saturate. Starting at 10 with at most 50 stamina per six-hour training makes that edge physically impractical. Tests exercise it using an unshipped test harness, including atomic rollback of both match rewards and points.

## Queue and round protocol

Band key is `S / 25`: [0,24], [25,49], etc. Weight modifies racing rather than creating separate low-depth queues. A band can contain at most 32 waiting pets. `activeToken[player]` permits one waiting or matched pet per address across all bands, preventing self-matches by one address. Separate wallets remain Sybil-capable; there is no claim of person-level resistance.

`enqueue(tokenId)` verifies ownership, fed status, Idle activity and an available weekly attempt. It locks the NFT as Queued. No quota is spent yet. The owner can `leaveQueue` at any time before a round. Anyone can `evictExpired` if `now > joinedAt+86400` or the pet is hungry. Exact TTL equality is still live. Removal uses swap-and-pop with repaired position indexes, so there are no accumulating tombstones or scans of historical entries.

Anyone can `requestRound(band)`:

1. Prune stale/hungry waiting entries with a bounded scan of at most 32 entries.
2. Require at least two live pets. If this fails, the whole call (including pruning) reverts; individual `evictExpired` calls still recover stale entries.
3. Select the largest even prefix of the live queue: 2–32 participants. With an odd count the last entry remains Queued, pays no quota, and can leave or join a later round. Swap removals can affect pre-lock queue order; the captured prefix is fixed before removal.
4. Revalidate feed state, apply current neglect, consume one weekly attempt and snapshot `(tokenId, owner, stamina, weight)` for every participant. These pets become Matched. Active address locks stay set.
5. Record `entropyBlock = block.number + 2`, the current epoch week, and Pending status. The caller supplies only the band, never pet IDs or a seed.

New entrants can form another round in the same band while older rounds are pending. Each round's storage, quota charge, seed and matches are independent. All loops are capped by the 32-player roster; no function scans all pets, bands, rounds or matches.

## Future-block randomness and race formula

Permissionless `fulfillRound(roundId)` requires Pending status and:

```text
entropyBlock < currentBlock <= entropyBlock + 256
entropy = blockhash(entropyBlock) != 0
seed = keccak256(abi.encode(entropy, chainId, address(MatchQueue), roundId))
```

There is no fallback to a known earlier hash, current timestamp, caller address, prevrandao, or caller-selected seed. The committed roster and stats cannot change while waiting for the target block.

Fisher–Yates shuffles a memory copy of the roster, from last index down to 1, with swap index `keccak256(abi.encode(seed,"PAIR",i)) % (i+1)`. Adjacent entries in the shuffled roster form matches; each pet appears exactly once. Hash-modulo sampling has negligible modulo bias, not mathematically perfect uniform sampling. With two players the opponent is necessarily the other player; larger rounds randomize the opponents as well as outcomes.

For zero-based pair index `p` and token ID `id`:

```text
noise = uint256(keccak256(abi.encode(seed, "NOISE", p, id))) % 2001
noiseBps = noise - 1000                   // conceptual signed range [-1000,1000]
weightBps = 11500 (Fit), 10000 (Normal), 8500 (Obese)
score = floor(S_snapshot * (weightBps - 1000 + noise) / 20000)
```

Implementation keeps the multiplier unsigned and positive (7500–12500). OpenZeppelin `Math.mulDiv` handles the full-precision intermediate multiplication. Since 12500/20000 <1, the final score fits for any uint256 stamina. The common scale changes no ordering except the explicitly specified integer rounding. For S=100 and noise=1000, Fit scores 57, Normal 50, Obese 42. Fit's worst noise scores 52; Obese's best scores 47. Weight therefore affects actual results independently of stamina. Small stamina values produce more ties.

Higher score wins. On equality, A wins iff `keccak256(abi.encode(seed,"TIE",p)) % 2 == 0`; otherwise B wins. PAIR, NOISE and TIE domains are distinct. Fulfillment persists snapshots, scores and winner and marks the round Fulfilled, then each race can settle separately. Changing fulfillment caller or timestamp cannot alter the result for the same entropy.

**Threat boundary:** a future block prevents participants knowing the exact seed before commitment, but block proposers/builders can bias or censor it. Fulfillment can also be withheld if every potential keeper declines to call. Anyone, including either player, can fulfill; there is no trusted designated keeper or private reveal secret. This is testnet randomness, not a VRF or a source for financially valuable outcomes.

## Settlement, expiry, points and quotas

`settleMatch(matchId)` requires an existing unsettled match. It marks settled and clears address locks before rewarding either pet. The winner receives +3 stamina and +10 address points; the loser +1 stamina and +2 points. Points go to the owner snapshot taken at lock; transfers during the lock are impossible. The NFT applies elapsed neglect and returns to Idle. Food expiry, later weight changes, owner food config changes, and settlement timing cannot change stored race outcomes. Any reward failure reverts both rewards, points and settlement status atomically. The NFT reward methods cannot call ERC-721 receivers.

Settlement has no deadline and no ETH payout, external token transfer, or user receiver call. A losing or offline player cannot prevent the other player/keeper from settling. A fulfilled round cannot be expired to erase an unfavorable outcome. Settling again reverts.

If `currentBlock > entropyBlock+256` while Pending, anyone can `expireRound` to mark Expired and unlock every participant. There are no rewards, no weak fallback entropy and no quota refund. The consumed quota limits selective-expiry retries. There is no queue entry fee to refund; feeding purchased care independent of the round. Expiring twice or fulfilling an expired round reverts.

Weeks are `floor(block.timestamp / 604800)`, anchored to the Unix epoch (Thursday 00:00 UTC), not ISO/Monday weeks. NFT quota is consumed at round lock, even if the pet queued in an earlier week. Five attempts are allowed per pet per week; transferring the NFT cannot reset it. Cancellation/eviction while merely waiting consumes none. Waiting across the boundary consumes the new week's quota when locked; already Matched pets cannot enter another round until released.

Points live in `points[address]`, `weeklyPoints[lockWeek][address]`, and `totalPoints`. There are no transfer, approval, redemption, burn or arbitrary award functions. Events support an off-chain weekly board; enumerating all addresses or ranking them on chain is intentionally omitted. No prize or token entitlement is attached. There is no optional 24-hour rematch cooldown; immediate rematches are possible while both NFT quotas allow them.

## Operational boundaries

Players or keepers pay transaction gas. Monitor `Enqueued`/`RoundLocked`/`MatchCreated`, request live bands with at least two entries, fulfill in the 256-block window, and settle matches. Clean expired entries if a band fills up. There is no guarantee of queue depth at high stamina; players can leave waiting queues and retain their pets. Keepers can batch off chain, but each on-chain operation has bounded work.

The address recorder is read-only until writing a local JSON record: finalized Sepolia block, exact runtime comparison with immutable patching, explicit owner check, and queue binding checks. It cannot deploy or initialize applications. Real deployment, explorer verification and independent release review are the network's responsibilities. No owner key, RPC credential, provider account, or machine configuration is part of this repository.
