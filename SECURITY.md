# Security review and release boundaries

This is the implementer's local review, not an independent audit. The supplied pinned eth-security material was read as a failure-mode reference. Independent network review and actual Sepolia deployment/explorer verification remain separate release steps. No live deployment, signing wallet, fork, external oracle or VRF service was used in these tests.

## Reviewed properties

| Area | Concrete protection and validation |
| --- | --- |
| Launch ownership | Explicit nonzero owner constructor argument, two-step handover, no renounce; factory rehearsal checks the actual requested owner and rejects implicit factory/origin ownership |
| Privileged writes | Food/mint/withdraw/binding are owner-only; match mutations accept only the once-bound queue; no public stat or points setter |
| NFT custody | OpenZeppelin ERC-721; common `_update` rejects all transfers during training/queue/match locks, including approved safe transfers |
| Callback reentrancy | Safe-mint state precedes callbacks; mutating care/queue functions and withdrawal use ReentrancyGuard; receiver and rejecting/reentrant owner tests check rollback |
| Fees | Exact payment; no user refund/prize liability; owner-only withdrawals check result; stateful tests conserve total paid fees against balance plus withdrawals |
| Snapshot integrity | Round snapshots precede the entropy block; feed, training, transfer and owner cancellation cannot change locked racers; later hunger and config changes do not alter scores |
| Roster steering | A pet is lockable only 10 blocks after it enqueued and a request locks every eligible pet in the band, so a caller cannot enter and lock in one transaction, lock a prefix to flush a queue, or pick which pet sits out; tests cover the atomic contract-wallet path, the flush path, the per-entry window after swap removal and the entropy-chosen bye |
| Randomness lifecycle | Exactly one future block, strict 256-block window, nonzero hash, domain-separated shuffle/noise/tie, no seed input or weak fallback; boundary and caller-independence tests |
| Recovery | Owner can leave waiting queues/cancel training; anyone can evict stale entries, expire missed pending rounds, or settle fulfilled races indefinitely |
| Points/reward integrity | Non-transferable counters; once-only settlement; reward failure rolls back both NFT gains and points; lock owner/week receives credit |
| Quota | NFT-bound, consumed at lock, retained on expiry and transfer, refunded only to a fulfilled round's bye, resets by epoch week; tests span week boundaries and delayed settlement |
| Arithmetic | Checked stamina additions, positive diminishing gain at full uint256 width with tiers kept strictly distinct for every valid configuration, bounded body score, bounded config multiplier, full-precision race multiplication; fuzzing and overflow rollback tests |
| Gas/liveness | At most 32 entries per band/round; O(1) queue removal, bounded shuffle/pruning/recovery, individual match settlement; no scans over all historical state |
| Release bytecode | Compiler pinned, no metadata hash, no link placeholders; application runtime/constructor sizes and reachable forbidden opcodes checked in local factory rehearsal |

The queue's external calls go only to its immutable NFT. Those NFT methods have no user receiver callbacks. Reentrancy guards protect each entry, effects precede outbound reward calls, and a failed second reward rolls back the first reward and ledger updates. A wallet that refuses ETH or NFTs cannot block anyone else's match settlement, because settlement sends neither asset to a wallet.

## Intentional trust and limitations

* **Future-block bias:** proposers/builders can bias or censor block hashes. Players cannot change committed stats or submit seeds, but this is not financially secure randomness. No wager, ETH prize, token yield, insurance or airdrop promise is offered.
* **Keeper participation:** every keeper/player can resolve rounds, but someone must pay gas within the hash window. Expiry recovers custody without rewards; the attempt still counts. Permissionless access is not an uptime guarantee. Because the result is computable once the entropy block exists, a racer may fulfil only when it wins; the other racer or any keeper has the same 256-block window to fulfil, and a player who lets rounds expire spends its own weekly attempts doing so.
* **Two-pet bands:** the wait window and whole-roster lock stop a caller from entering and locking atomically or from flushing a queue, but when exactly two pets wait in a band they race each other. The queue is public before anyone joins and a waiting pet can leave; nothing hides who is waiting. Stamina dominates weight within a 25-wide band (stamina 20 Obese always beats stamina 10 Fit), which is the documented race formula, not a steering defect.
* **Owner authority:** the owner can consume remaining supply with owner mints, change food prices/bps within bounds, withdraw earned fees, close free mint and select the queue once. An incorrect/malicious binding is a trust failure that cannot be upgraded away. Verify the confirmed queue's bytecode and NFT binding before activation. Existing feeds/training retain their captured parameters.
* **Sybil/point farming:** one free mint and one active racer per address are not identity checks. Multiple wallets and repeated opponents can earn points within each NFT's five weekly attempts. Points have no financial entitlement. A per-pair cooldown is not implemented.
* **Queue depth:** unbounded stamina can create sparse higher bands. Matching never crosses bands; owners can leave and retry. An odd last entry waits for another entrant. A failed insufficient-live-roster request rolls pruning back, so use individual eviction to clean such a band.
* **Time and rounding:** block timestamps schedule care, not randomness. Small race scores often tie. Score rounding, strict/inclusive deadlines, epoch-week alignment and lazy body projection are all specified in DESIGN.md.
* **Finite machine arithmetic:** uncapped means no game-imposed ceiling. At the uint256 representation limit, checked addition reverts; the protocol does not wrap or saturate. Production has no method that jumps stamina to that limit. A hypothetical max-stamina race cannot earn its next reward; practical growth from 10 cannot reach it.
* **Metadata and records:** on-chain metadata projects current care state and can change with time. The address recorder trusts the selected RPC's finalized-chain responses; it is a runtime/configuration check, not an independent consensus proof. It rejects unsupported block-hash references rather than silently checking a different block.

## Local validation

Final optimized local run: `forge build --sizes`, `forge test` with the supplied seed, and `forge fmt --check` passed. Foundry reported 67 passing tests, including its grouped three-property invariant campaign (8192 calls, zero reverts), plus the reviewer's roster-steering proof run from a scratch copy. The three offline Python deployment-recorder tests and exported ABI comparisons also passed. The README's NFT deployment script completed as a local rehearsal without broadcasting.

| Application | Runtime bytes | Initcode bytes before the single 32-byte constructor argument |
| --- | ---: | ---: |
| HamsterRunNFT | 14706 | 15736 |
| MatchQueue | 10631 | 10877 |

The project uses Foundry's pinned seed, 512 fuzz cases per fuzz test, and 128 × 64 stateful invariant calls. Test coverage includes real minting through token 9999, food tiers and bad payments, hungry gates, the newborn grace window, all weight transitions, the cheap-food ceiling, sustained inactivity, tier ordering at high stamina and for fuzzed configurations, checked full-width arithmetic, locked transfers, callback failure/reentrancy, the wait window and whole-roster lock, odd rosters with an entropy-chosen bye, random pairing as a permutation, race weight effects, quota transfers/week changes, simultaneous rounds, maximum-size rounds, last valid/missing/expired hashes, and atomic settlement failure.

The coverage run reached 100% of lines and functions in all four application source files. Statement coverage was 97.53% in HamsterRunNFT, 96.00% in GameMath and 100% in MatchQueue and PointsLedger. Branch coverage was 83.78% in HamsterRunNFT, 75.00% in GameMath (the unreachable tier-range guard) and 100% in MatchQueue. Coverage is a reachability metric, not proof of correctness.

The maximum-roster test measured approximately 6.5 million gas for locking 32 participants and 5.1 million for fulfillment on the optimized test build. It asserts each remains below 12 million. Gas includes test-call conditions, not a promise of a particular live transaction price.

`forge build` may emit conservative lint warnings around bounded external-call loops, intentional timestamp comparisons, state events and ReentrancyGuard's lock reset. These were reviewed against the actual immutable call graph and covered by lock, rollback and receiver tests; no lint detector is disabled in configuration. Library code is vendored from the archives pinned in `dependencies.json`; `forge fmt` ignores `lib/`, and any difference from those archives that a later formatting pass could introduce would be whitespace only, with no behavioural change. Slither and Mythril were not run in this worker; the network's independent checks are still required.

The protected launch inputs were read, but their environment-driven network harness was not fabricated locally. `test/Deployment.t.sol` independently rehearses the applicable constructor, explicit owner, dependency, runtime size and opcode properties. This does not attest an actual chain deployment or replace the network's owner/manifest checks.
