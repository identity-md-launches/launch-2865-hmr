# HamsterRun v2 design

This file has two parts. Part 1 documents the public site in `web/` as implemented (tokens, type, components, responsive behavior). Part 2 is the unchanged deterministic specification of the deployed v2 contracts, which the site's formulas are pinned to.

## Part 1. Site design: 8-bit handheld console

Source of truth: `web/src/styles.css` (tokens and components), `web/src/App.tsx` (screens), `web/src/components/` (sprite, meter), `web/src/wallet/ConnectSheet.tsx` (wallet sheet).

### Concept

The whole site sits inside a handheld console. A navy plastic bezel holds a black-green CRT screen; scanlines and a vignette are drawn on the screen only (`.screen::after`, `pointer-events: none`). Primary game actions are chunky A buttons (pink round "A" badge, hard drop shadow, 4px press travel). Undo-style actions (leave queue, cancel training, expire round) are B buttons (amber badge). Secondary navigation and links are thin-outline soft buttons. A working D-pad under the screen switches screens (left/right) and pets (up/down); Start and Select pills jump to Play and Help.

### Color tokens

Two surfaces, each with its own limited palette (`:root` in `web/src/styles.css`).

| Token | Value | Role |
| --- | --- | --- |
| `--plastic` | `#1a1f3d` | Bezel body, wallet sheet |
| `--plastic-hi` | `#2b3263` | Bezel highlight edge, A/B button face |
| `--plastic-lo` | `#0d1029` | Screen inset frame, D-pad, page background |
| `--bezel-ink` | `#c9cfff` | Text on the bezel |
| `--btn-a` | `#ff5fa2` | A badge, power LED |
| `--scr-bg` | `#07140f` | Screen background, meter track |
| `--scr-panel` | `#0e261c` | Screen panels and banners |
| `--scr-line` | `#1f4a37` | Dividers, empty meter segments, input borders |
| `--mint` | `#8ef0c4` | Main screen text, fed/ok state, active tab |
| `--mint-dim` | `#6cc39d` | Notes and secondary text |
| `--amber` | `#ffc34d` | Links, warnings ("not open yet"), B badge |
| `--magenta` | `#ff79b4` | Hungry, errors, race-quota meter |
| `--ink-hi` | `#e9fff4` | Headings, values, focus ring |

Meaning is never color-only: every meter has a text value, status tags say "Hungry"/"Fed", banners say "not open yet" in words.

### Typography

| Token | Size | Used for |
| --- | --- | --- |
| `--fs-sm` | 14px | Pixel buttons, tabs, labels, hints |
| `--fs-body` | 16px | Body (Pixelify Sans), h2, stat values, inputs |
| `--fs-lead` | 20px | Lead line under h1 (16px under 640px) |
| `--fs-h` | 24px | h1 under 640px |
| `--fs-title` | 32px | h1 on wider screens |

Faces: **Press Start 2P** 400 (`--font-pixel`) for headings, buttons, tabs, labels and numbers; **Pixelify Sans** 400/600 (`--font-body`) for readable prose. Both are bundled locally from `@fontsource` (no font CDN). Letter-spacing is never changed, no text is transformed to capitals, `-webkit-font-smoothing: none` keeps glyph edges hard, sprites use `shape-rendering: crispEdges` and `image-rendering: pixelated`. Changing numbers use `tabular-nums`.

### Spacing and shape

Base unit `--u: 4px`; gaps are 4/8/12/16/20/24px. Corners are square on the screen (pixel look) and rounded only on the bezel plastic (20px, with the classic 64px bottom-right handheld curve, 40px on phones). Depth is hard offset shadows (`0 4px 0`), never blur.

### Components

- **Console** (`.console`, `.bezel-top`, `.screen-wrap`, `.screen`, `.bezel-bottom`): bezel, inset screen, D-pad (`.dpad`, 48px cells), Start/Select pills (44px high), fine-print disclaimer.
- **A / B buttons** (`.btn-a`, `.btn-b`): min 48px high, pixel label, circular 32px badge, states rest/hover (lighter face)/pressed (moves 4px down, shadow drops)/disabled (60% opacity)/focus (2px `--ink-hi` ring, 2px offset). `.btn-big` 56px for Mint; `.btn-sm` 44px for Settle.
- **Soft button** (`.btn-soft`): 44px outline button for secondary actions (sound toggle, Disconnect, Go to race, Show more rounds, Post on X).
- **Tabs** (`.tabs`, `.tab`): hash links `#/play`, `#/race`, `#/invite`, `#/help`; the current one is inverted mint and carries `aria-current="page"`.
- **Status banner** (`.banner-ok|warn|info`): live mint/queue status read from `mintOpen()` and `matchQueue()`; a 4px left rule in the state color.
- **Meter** (`components/Meter.tsx`, `.meter`, `.bar`, `.seg`): RPG status bar of ten 14px segments with label and text value, `role="meter"`. Used for stamina (progress within the 25-wide band, value uncapped), weight (body score 0-100, tone by class), food (time left of 72h), training (progress of 6h), races this week (of 5) and queue wait (of 10 blocks).
- **Hamster sprite** (`components/Hamster.tsx`): 18-column character-grid SVG; Fit narrows the belly, Obese adds two belly rows. Hops in two steps unless reduced motion is requested.
- **Pet chips** (`.chip`, `role="radio"`): pick an owned HAM.
- **Round card** (`.round`, `.match`): status, fulfil/expire/settle actions, scores with winner in mint.
- **Invite form and board** (`.input-row`, `.board`): handle input with inline error, read-only link, copy/post actions, ranked table.
- **Log line** (`.log`, `aria-live="polite"`): the console's message line for every transaction step, with an explorer link.
- **Wallet sheet** (`.sheet-bg`, `.sheet`, `.row`, `.x`): 420px dialog with 48px rows, bottom sheet under 640px, closes by backdrop, Escape and ×, focus returns to Connect.

### Responsive behavior

- Above 640px: centered 1040px console with 24px outer margin; meters flow in `auto-fit` columns of at least 240px; feed buttons in columns of at least 220px.
- 640px and below: the console goes full-bleed like a portrait Game Boy (no outer margin, 40px bottom-right curve), the screen inset shrinks to 6px, h1 drops to 24px, the sprite to 64px, tabs tighten so all four fit one row at 390px, the Mint button stretches full width, the D-pad and pills center under the screen, and the wallet sheet docks to the bottom.
- 360px and below: stat grid becomes two columns and the sound toggle hides (it stays in the header at larger widths).
- Every tap target is at least 44px (D-pad 48px, sheet rows 48px, A buttons 48-56px).
- `prefers-reduced-motion: reduce` stops the sprite hop; the only other motion is a 60ms button press.

### Accessibility notes

Skip link to the screen, `<header>`/`<main>`/`<footer>`/`<nav>` landmarks, one h1 per screen, labelled inputs with `aria-invalid` and a described-by message, `aria-current` tabs, `aria-pressed` sound toggle, a polite live region for transaction progress, and a modal dialog for the wallet sheet.

## Part 2. Contract design (HamsterRun v2 deterministic design)

This specification describes the delivered contracts, including their deliberate testnet assumptions. Solidity 0.8.26 checked arithmetic is the default. All divisions below round down unless explicitly stated otherwise.

### Deployment and ownership

Two non-upgradeable applications are deployed in order: `HamsterRunNFT(initialOwner)`, then `MatchQueue(nftAddress)`. Neither constructor calls another contract, creates another contract, receives ETH, nor derives ownership from its caller. NFT ownership is OpenZeppelin `Ownable2Step` with an explicit nonzero owner. MatchQueue has no owner and no configurable race parameters.

The NFT owner binds the queue once with `setMatchQueue`. The queue must have code and report this NFT through `nft()`. Its address can never be replaced. The binding is an administrative trust decision; the owner should verify the confirmed queue implementation before setting it. There is no upgrade, initializer, delegatecall, selfdestruct, arbitrary stat setter, or arbitrary points issuer.

The owner controls free-mint opening, the three food prices and multipliers, owner mints within supply, fee withdrawal to itself, and a two-step ownership handover. Renouncing ownership reverts so fees and administration remain recoverable. Setting a zero pending owner only cancels a pending handover as supported by Ownable2Step.

### Mint, ownership and locks

IDs are sequential from 1 to 9999 inclusive. `totalSupply` counts all lifetime mints; no burns exist. Free mint is nonpayable, requires `mintOpen`, and consumes `freeMinted[msg.sender]` before the safe receiver callback. Sending the NFT away never resets that flag. `ownerMint(player)` works with free mint closed and does not consume the recipient's free-mint allocation. It cannot mint different stats or exceed the shared cap.

Every pet starts with stamina 10, body score 50, Normal weight, Idle activity, `fedUntil=0`, tier 0 and trainBps 10000. A newly minted pet is hungry for every gameplay gate, but its first 72-hour window after mint carries no hunger damage, so minting and feeding in different blocks gives the same start as doing both at once. Initializing stats, supply and free-mint flags precedes the ERC-721 receiver callback; callback failure rolls everything back.

Only the actual ERC-721 owner can feed, start/cancel training, enqueue, or leave a waiting queue. Approval is sufficient for an ordinary ERC-721 transfer, never for gameplay. Every transfer path passes through the NFT's `_update` lock check, including approved operators and both safe-transfer overloads.

| Activity | Allowed transitions |
| --- | --- |
| Idle | Owner feed (stays Idle), owner transfer, start training → Training, enqueue → Queued |
| Training | Permissionless earned settlement → Idle; owner cancellation without gain → Idle |
| Queued | Owner leave / permissionless stale eviction → Idle; permissionless round request after the 10-block wait → Matched |
| Matched | Permissionless fulfilled settlement → Idle; entropy-chosen bye of an odd roster → Idle with the attempt refunded; permissionless expired-round recovery → Idle |

Food, transfers and new training are blocked while Training, Queued or Matched. Approvals may still change, but cannot bypass the transfer lock. No owner function can seize a pet or clear an active lock.

### Food and hunger

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

### Body score and effective weight

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
hungerStart = (fedUntil == 0 ? birthTime + 259200 : fedUntil)
H = 0                              if t <= hungerStart
H = 1 + floor((t - hungerStart - 1) / 86400) otherwise
damage = 5*(I - idleDaysApplied) + 5*(H - hungerDaysApplied)
B = max(0, B - damage)
idleDaysApplied = I
hungerDaysApplied = H
```

Thus inactivity costs 5 per completed day, and hunger costs an additional 5 per begun day after expiry. At expiry exactly there is no hunger damage; one second later the first hunger penalty applies. A never-fed newborn is treated as if it had a feed window from birth: hunger damage starts only 72 hours after mint, although the hungry gates apply until the first real feed. There are no loops proportional to elapsed time. Repeated transfers, views or early feeds cannot reset or double-apply fractional inactivity days. The last successful training settlement is the only reset of the inactivity clock. Food resets the hunger clock because it establishes a new expiry.

After applying prior neglect:

* Low feed: `B = max(0, B-4)`; mid feed: `B = min(100, B+6)`; high feed: `B = min(100, B+12)`.
* Training settlement: `cap = (tierAtStart == 0 ? 60 : 100)`; if `B < cap` then `B = min(cap, B + 2 + 2*tierAtStart + min(staminaGain,10))`, otherwise `B` is unchanged; then `lastTrainAt=now` and `idleDaysApplied=0`. `LOW_FOOD_BODY_CEILING = 60` is a named constant.

Higher food and larger recent training gains therefore improve health. Cheap food caps what training can build: a pet fed only tier 0 can train its stamina without limit, but its body score never rises above 60 (Normal), each low feed still costs 4, and any lapse in training costs 5 per day, so a long cheap-food diet drifts a Fit pet down to Normal and a neglected one on to Obese. Only mid or high food can make a pet Fit. With no training and a high feed every 72 hours, 15 inactivity damage exceeds the 12 food bonus, so the body still drifts toward Obese. Buying several feeds close together can counteract this; it is explicit game behavior. Long neglect saturates score at zero; food and training can always restore it after unlocking.

### Training and overflow safety

Owner `startTraining` requires Idle, currently fed, and `fedUntil >= now + 21600`. It computes and stores:

```text
baseGain = 1 + floor(100 / (10 + floor(S / 10)))
raw(bps) = floor(baseGain * bps / 10000)
gain_0   = raw(bps_0)
gain_t   = max(raw(bps_t), gain_{t-1} + 1)        for t = 1, 2
gain     = gain_tier, where bps_tier is the multiplier captured at the pet's last feed
           and bps_t for the lower tiers is the configuration current at training start
readyAt  = now + 21600
```

The chained floor keeps every tier strictly better than the one below at every stamina and for every configuration `setFoodConfig` accepts; plain flooring would give 1 stamina to both low and mid food from stamina 910. With the defaults the chain changes nothing below stamina 240 (base ≥ 3): at S=10 the gains are 10, 15, 20; at S=909 they are 2, 3, 4; from S=910 upward they are 1, 2, 3. A captured multiplier is never reduced by the floor; the floor only lifts a higher tier that rounding would otherwise collapse onto a lower one. The pet is locked for six hours. `settleTraining` is permissionless at `now >= readyAt`, awards the stored gain once, updates body state, clears training and unlocks. All work completes within the fed interval required at start, so a late claim remains allowed after hunger, with neglect applied before body improvement. Cancellation by the owner forfeits the gain without modifying stamina or resetting training activity time.

At S=10, baseGain=10 and default tier gains are 10, 15 and 20. The base is monotonically non-increasing in current stamina. At sufficiently large S it is 1, so valid multipliers always produce positive growth (1, 2 and 3 for the three tiers). It does not become zero or stop at a gameplay cap.

Stamina storage and all additions are `uint256` with Solidity checked arithmetic. There is no `MAX_STAMINA`, saturation, narrowing cast or unchecked wrap. The denominator `10 + S/10` fits even for `uint256.max`; baseGain ≤11 and configured bps ≤50000 make the training product safe. At the theoretical uint256 arithmetic limit an addition reverts atomically; a training owner can still cancel. A race reward would similarly revert at that unreachable practical extreme rather than wrap or silently saturate. Starting at 10 with at most 52 stamina per six-hour training (50 from the multiplier plus at most 2 from the tier floor) makes that edge physically impractical. Tests exercise it using an unshipped test harness, including atomic rollback of both match rewards and points.

### Queue and round protocol

Band key is `S / 25`: [0,24], [25,49], etc. Weight modifies racing rather than creating separate low-depth queues. A band can contain at most 32 waiting pets. `activeToken[player]` permits one waiting or matched pet per address across all bands, preventing self-matches by one address. Separate wallets remain Sybil-capable; there is no claim of person-level resistance.

`enqueue(tokenId)` verifies ownership, fed status, Idle activity and an available weekly attempt. It locks the NFT as Queued and records `joinedAt` (timestamp) and `joinedBlock`. No quota is spent yet. The owner can `leaveQueue` at any time before a round. Anyone can `evictExpired` if `now > joinedAt+86400` or the pet is hungry. Exact TTL equality is still live. Removal uses swap-and-pop with repaired position indexes, so there are no accumulating tombstones or scans of historical entries; each entry keeps its own join block through swaps.

An entry is **eligible** once `block.number >= joinedBlock + QUEUE_WAIT_BLOCKS` with `QUEUE_WAIT_BLOCKS = 10` (about two minutes on Sepolia). `eligibleCount(band)` reports how many live entries a request would lock now.

Anyone can `requestRound(band)`:

1. Prune stale/hungry waiting entries with a bounded scan of at most 32 entries.
2. Collect every live entry that is eligible. Require at least two. If this fails, the whole call (including pruning) reverts; individual `evictExpired` calls still recover stale entries.
3. Lock **all** eligible entries, 2–32 participants, odd counts included. The caller cannot lock a subset, a prefix, or a pet that joined fewer than 10 blocks ago; entries still inside their wait window simply stay Queued and keep waiting.
4. Revalidate feed state, apply current neglect, consume one weekly attempt and snapshot `(tokenId, owner, stamina, weight)` for every participant. These pets become Matched. Active address locks stay set.
5. Record `entropyBlock = block.number + 2`, the current epoch week, and Pending status. The caller supplies only the band, never pet IDs or a seed.

**Why the wait and the whole-roster lock.** Without them a caller could choose its opponent by timing: enqueue and `requestRound` in one transaction against a lone waiting pet, or lock a prefix to flush unwanted pets and then take the remaining one. Now a pet is visible in the queue for at least 10 blocks before any round can include it, every pet that is eligible when a round is requested is in that round, and with three or more participants the future-block shuffle decides both pairings and the bye. What remains is inherent to two-player racing in a sparse band: when exactly two pets are waiting, they race each other. A player can read `queueEntries(band)` before joining, and can `leaveQueue` while waiting, so nobody is forced into a specific pairing except by the public state of the queue.

New entrants can form another round in the same band while older rounds are pending. Each round's storage, quota charge, seed and matches are independent. All loops are capped by the 32-player roster; no function scans all pets, bands, rounds or matches.

### Future-block randomness and race formula

Permissionless `fulfillRound(roundId)` requires Pending status and:

```text
entropyBlock < currentBlock <= entropyBlock + 256
entropy = blockhash(entropyBlock) != 0
seed = keccak256(abi.encode(entropy, chainId, address(MatchQueue), roundId))
```

There is no fallback to a known earlier hash, current timestamp, caller address, prevrandao, or caller-selected seed. The committed roster and stats cannot change while waiting for the target block.

Fisher–Yates shuffles a memory copy of the roster, from last index down to 1, with swap index `keccak256(abi.encode(seed,"PAIR",i)) % (i+1)`. Adjacent entries in the shuffled roster form matches; each pet appears at most once. With an odd roster the last shuffled entry is the **bye**: `roundBye(roundId)` records it, `RoundBye` is emitted, its address lock is cleared and the NFT's `releaseBye` returns it to Idle and refunds the weekly attempt consumed at lock (`MatchQuotaRefunded`). A bye earns no stamina and no points and can enqueue again at once. Hash-modulo sampling has negligible modulo bias, not mathematically perfect uniform sampling. With two players the opponent is necessarily the other player; larger rounds randomize the opponents, the bye and the outcomes.

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

### Settlement, expiry, points and quotas

`settleMatch(matchId)` requires an existing unsettled match. It marks settled and clears address locks before rewarding either pet. The winner receives +3 stamina and +10 address points; the loser +1 stamina and +2 points. Points go to the owner snapshot taken at lock; transfers during the lock are impossible. The NFT applies elapsed neglect and returns to Idle. Food expiry, later weight changes, owner food config changes, and settlement timing cannot change stored race outcomes. Any reward failure reverts both rewards, points and settlement status atomically. The NFT reward methods cannot call ERC-721 receivers.

Settlement has no deadline and no ETH payout, external token transfer, or user receiver call. A losing or offline player cannot prevent the other player/keeper from settling. A fulfilled round cannot be expired to erase an unfavorable outcome. Settling again reverts.

If `currentBlock > entropyBlock+256` while Pending, anyone can `expireRound` to mark Expired and unlock every participant. There are no rewards, no weak fallback entropy and no quota refund, not even for the pet that would have been the bye, because no bye is drawn without the entropy. The consumed quota limits selective-expiry retries: a player who locks a round and then declines to fulfil a losing result spends one of its own five weekly attempts each time, and either racer, or anyone else, can fulfil within the 256-block window. There is no queue entry fee to refund; feeding purchased care independent of the round. Expiring twice or fulfilling an expired round reverts.

Weeks are `floor(block.timestamp / 604800)`, anchored to the Unix epoch (Thursday 00:00 UTC), not ISO/Monday weeks. NFT quota is consumed at round lock, even if the pet queued in an earlier week. Five attempts are allowed per pet per week; transferring the NFT cannot reset it. Cancellation/eviction while merely waiting consumes none, and a bye gets its attempt back (`used` is decremented if above zero). Waiting across the boundary consumes the new week's quota when locked; already Matched pets cannot enter another round until released.

Points live in `points[address]`, `weeklyPoints[lockWeek][address]`, and `totalPoints`. There are no transfer, approval, redemption, burn or arbitrary award functions. Events support an off-chain weekly board; enumerating all addresses or ranking them on chain is intentionally omitted. No prize or token entitlement is attached. There is no optional 24-hour rematch cooldown; immediate rematches are possible while both NFT quotas allow them.

### Operational boundaries

Players or keepers pay transaction gas. Monitor `Enqueued`/`RoundLocked`/`MatchCreated`/`RoundBye`, request bands where `eligibleCount(band) >= 2`, fulfill in the 256-block window, and settle matches. Clean expired entries if a band fills up. There is no guarantee of queue depth at high stamina; players can leave waiting queues and retain their pets. Keepers can batch off chain, but each on-chain operation has bounded work.

The address recorder is read-only until writing a local JSON record: finalized Sepolia block, exact runtime comparison with immutable patching, explicit owner check, and queue binding checks. It cannot deploy or initialize applications. Real deployment, explorer verification and independent release review are the network's responsibilities. No owner key, RPC credential, provider account, or machine configuration is part of this repository.
