# Site validation record

Checks run by the worker on 2026-11-02 against the export in `dist/`. The verifier only checks paths and bytes; these results are the worker's own.

## Revision validation (current export)

Scope: reproduce and repair the five high findings and the advisory wallet-focus finding. All six reproduced on the accepted export before their corresponding edits. The existing console design, contract ABIs/addresses, transaction sender, dependencies and build configuration are preserved. No Solidity source changed and no on-chain transaction was signed or broadcast. The original accepted validation record is retained below as history; the revision results here supersede its wallet-focus limitation.

### Reproductions, fixes and rechecks

| Finding | Before (Chromium, original export) | Fix and final export result |
| --- | --- | --- |
| Fulfilled race crash | At 390/1440px, `matchInfo` decoded to a named object; positional indexing produced the `tokenId` exception and an empty body. | `web/src/chain.ts:92` reads named Race fields. Both racers/scores and Settle render; `settleMatch(1)` simulation and test-wallet handoff work. A settled fixture shows Settled and removes its action. |
| Populated invite board overflow | At 320/390px: 354px table, 398px document width. | `web/src/styles.css:237` fixes table layout and permits header/cell wrapping. Table widths: 232/302px; document widths: 320/390px. All four columns and values remain; screenshots inspected. |
| Ownership above 600 | Log errors triggered exactly 600 owner reads; HAM #601 disappeared. | `web/src/chain.ts:51` scans the complete minted range in batches of 40. `web/src/App.tsx:163` announces failed ownership reads, with Read error in the stats and no misleading mint-empty prompt. HAM #601 and #9999 both reach the Care HUD; failed scan and subsequent recovery verified. |
| Public request without HAM | No band reads, selector, queue entries or Request round control. | `web/src/App.tsx:81` reads a public band independently; `RaceScreen` at line 388 exposes the selector/panel. A zero-HAM wallet reads band 0 and reaches `requestRound(0)` simulation and wallet handoff. Switching to empty band 1 disables Request; no Enqueue/Leave appears. |
| Older active round hidden | With seven rounds, Show more still fetched only IDs 7 through 2. | `web/src/App.tsx:83` uses an expandable round limit; Load older rounds at line 502 adds six each time. With thirteen rounds, two loads reach round 1, then its fulfilment and expiry actions reach the correct simulation/wallet handoffs at blocks 1000/1270. Previously loaded older rounds stay in the expanded list. |
| Wallet dialog focus escape | Close → Browser wallet → Coinbase Wallet → Play, then other background controls. | `web/src/wallet/ConnectSheet.tsx:38` makes the app root inert and traps Tab/Shift+Tab; a portal keeps the dialog outside that root. Nine Tab stops remain inside. Escape/Close restore interactivity and Connect focus; the visible wallet-row focus ring was inspected. |

An additional stress check of the new band selector found a very large valid band widened the 390px page to 740px. `web/src/styles.css:161` now wraps `#band-msg`; the maximum uint256 input remains within 390px. Negative input produces the inline error. Request remains disabled while the selected band's complete data is unavailable.

### Actual commands and outcomes

Build dependencies were installed outside the repository in an isolated copy made from the unchanged `web/package.json` and `web/package-lock.json`. No repository `node_modules`, cache, dependency archive or ignore-file change was needed. The final typecheck, unit tests and build were run after the last source change:

| Command | Result |
| --- | --- |
| `npm ci --prefix /tmp/hamsterrun-revision/web --cache /tmp/hamsterrun-revision/npm-cache --no-audit --no-fund` | Pass; 52 packages installed using the existing lockfile. |
| `npm run typecheck --prefix /tmp/hamsterrun-revision/web` | Pass, exit 0. |
| `npm test --prefix /tmp/hamsterrun-revision/web` | Pass, 10/10 existing game/invite tests. |
| `npm run build --prefix /tmp/hamsterrun-revision/web` | Pass, exit 0; 1817 modules transformed. Main JS 641.64 kB / 189.48 kB gzip, lazy SDK chunk 98.95 kB, CSS 16.04 kB. Vite reports `node:worker_threads` externalized from a transitive `ox` module; no related runtime error was observed. The resulting complete export was copied back to `dist/`, replacing obsolete hashed assets. |
| `node test/scratch/revision-check.mjs --baseline` | Eight baseline scenarios recorded all six reported failures before repair. The pre-repair scratch harness used the same ABI fixtures as the delivered runner. |
| `IMD_PLAYWRIGHT=… IMD_VIEM=… node web/tests/browser-regressions.mjs` | Pass, exit 0, all 10 final Chromium scenarios (including the full 9999-ID fallback, error recovery, two older-round loads, large-band wrapping and modal focus). |
| `IMD_PLAYWRIGHT=… IMD_VIEM=… node test/scratch/navigation.mjs` | Pass, exit 0. Play/Race/Invite/Help visited at 320/390/640/1440 × 844; no horizontal scrolling, console errors, page errors or failed local resources. Invalid handle feedback and saved invite link checked. Mint is disabled for the closed fixture and no wallet sheet opens automatically. At 390px Mint is at y=513.94, height 56px, fully within the first viewport. |
| `IMD_PLAYWRIGHT=… node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | Completed on the final export: 15/16 checks pass. Only `chrome` flags the intentional console bezel / inset-screen nesting required by the brief. Offline RPC-unavailable copy is expected in this run. |
| `git diff --check` | Pass. Export has 31 files / 916059 bytes. Added or modified Git-visible files totaled 916835 bytes at the integrity check (plus 3561 bytes of task response metadata), well below 8388608 bytes. Subsequent edits affect only this documentation. |

Baseline execution used the scratch harness with the same committed ABI fixtures and eight original scenarios. The `…` values above name the isolated Playwright 1.56.1 module and viem 2.57.14 module, both outside the repository. Browser libraries/fonts were also installed in temporary directories and supplied through the process environment. The test runner hosts a local `/preview/` subpath and intercepts the three configured public Sepolia RPC URLs with committed-ABI encodings. Test wallet `eth_sendTransaction` requests are recorded and rejected locally; nothing is forwarded to a chain. These tests validate reads, controls, simulations and handoffs, not mined transactions.

Evidence generated under `test/scratch/` (removed before submission): `baseline.json`, `regression.json`, `navigation.json`, `revision-shots/{before,after}-board-{320,390}.png`, Play/Race/Invite/Help and focused wallet-dialog screenshots at each navigation width, plus `taste/taste.json` and `taste/shots/390.png`, `1440.png` and full-page variants. The worker viewed the phone board, Race, focused dialog, first phone screen and desktop Play images.

### Better Interface review: revision coverage

| Domain | Coverage | Findings/fixes and limits |
| --- | --- | --- |
| Accessibility | Checked: labels and described errors, disabled action states, modal semantics, focus containment/restoration, inert background and visible focused wallet row. | Fixed the advisory focus escape. No screen-reader session, native-device session or full accessibility audit performed. |
| Layout | Checked: production screens at 320/390/640/1440, populated board at both phone widths, unusually long band, older round disclosure. | Fixed table overflow; wrapped the new band status; product and Mint stay on the first 390px screen. Native 200% zoom and RTL are unperformed. |
| Writing | Checked: new public-band instructions, request eligibility, incomplete ownership read, retained data and older-round action labels against their handlers. | Errors explain retry; public request describes its permissionless role. No reward/referral guarantees introduced. |
| Typography | Checked: source tokens unchanged, loaded local pixel fonts visible in screenshots, long headers/handles/displayed wallets wrap. Probe type scale/families/tracking/casing pass. | Five-size/two-family system retained. No physical-device or zoom-specific pixel-grid assessment performed. |
| Colors | Checked: unchanged semantic palette; final probe's measured text pairs meet 4.5:1 / 3:1-large thresholds. | No new color pairs. Did not measure every interaction state or claim a comprehensive contrast audit. |
| UI | Checked: queue loading/empty/ready states, failed ownership read/recovery, round disclosure, unsettled/settled match, pending handoff/rejection, sheet keyboard flow and navigation. | Existing A/B controls and CRT/bezel preserved. Audio, real extension/passkey flows and mined transactions not tested. |

Guidance: Jakub Krehel's Better Interface (MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`); documentation method adapted from Paul Bakaus's Impeccable (Apache-2.0, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). The provided pinned guides were read locally; no inaccessible skill is claimed.

### Remaining limitations

- Chromium export checks completed. The provided browser tool could not start because its Chrome distribution was absent, so screenshots/interactions used a foreground Playwright script with its own local server. A newer Playwright browser download returned HTTP 403; the isolated 1.56.1 Chromium installation worked after supplying runtime libraries and fonts.
- WebKit initially reported missing runtime libraries. After an isolated runtime setup, launch reached the first scenario but page creation did not complete; it was stopped (exit 130). No WebKit behavior is reported as passed. The system-library cache preflight was bypassed for that last attempt because temporary libraries were available to the loader rather than installed globally.
- No production Sepolia transaction was signed or broadcast. Current live owner initialization and multi-wallet mined gameplay were not reverified in this revision. Fixture values are test data, not claims about the live deployment.
- The invite service URL remains unset, with the existing honest offline/local-only board. Hosting the service and publishing the static export remain external steps. No publish command was run.
- Full-supply fallback can issue up to 9999 owner reads, bounded to 40 at a time, when log queries fail; failed reads surface errors instead of a partial ownership result. Loading extensive round history also increases read traffic as the expanded list is polled.

Implementation complete for all six reported findings; Chromium checks completed, WebKit and the other manual/live checks above remain unperformed. No deployment, dependency/build-configuration changes or unrelated redesign were made.

## Original accepted validation record (historical)

## Commands and results

| Check | Command (from `web/`) | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` (`tsc --noEmit -p .`) | Pass, no errors |
| Production build | `npm run build` (typecheck then `vite build` into `../dist`) | Pass; JS 640 kB (189 kB gzip) + 99 kB lazy chunk, CSS 16 kB, fonts bundled; `dist/` is about 1 MB |
| Unit tests | `npm test` (`node --test tests/*.test.mjs`) | 10/10 pass: training gains at S=10/909/910, band floor(S/25), hunger equality, weight thresholds, X handle parsing, countdown, `?ref=` and `#/invite/` capture, attribution upgrade and ranking, offline board, service first-touch and chain-confirmed mint |
| ABI hashes | canonical (sorted-key, compact) JSON keccak of `abi/*.json` | HamsterRunNFT and MatchQueue both match `abiHash` in deployment.json |
| Relative asset URLs | inspected `dist/index.html` | `./assets/…`, `./favicon.svg`, `./og.png`; app routes are hash routes |

## Interaction test (Playwright, Chromium, 390x844 and 1440x844)

A scratch script served `dist/` locally with live Sepolia RPC reads and checked, at both widths:

- the status banner renders from live `mintOpen()`/`matchQueue()`; at test time it read "Mint not open yet · Match queue not bound yet" (owner steps still pending), so the banner is honest;
- the Mint button is on the first screen and disabled while mint is closed / no wallet is connected;
- the wallet sheet does not open on first paint, opens from Connect with wallet rows, never says "Injected", and closes with Escape;
- Race screen loads and rounds resolve to "No rounds yet" (no endless loading);
- D-pad right moves from Race to Invite;
- invalid X handle shows the inline error; `@ham_fan` saves and produces `…/?ref=ham_fan`;
- the invite board says "Invite service offline" when `config.json` has no URL;
- a visit with `?ref=@tester_1` is captured and shown as the referrer;
- Help screen renders; no horizontal overflow; no console errors or page errors.

All 34 assertions passed (one initially failed because the test did not wait for the hash change; the test was fixed, not the site).

Not exercised: signing transactions (no wallet extension or funded Sepolia key in the test browser). Mint, feed, train, enqueue, request/fulfil/settle are wired through `simulateContract` then the wallet then `waitForTransactionReceipt`; success is only reported after a successful receipt. With mint closed and queue unbound on chain, those flows cannot complete on Sepolia until the owner runs `setMatchQueue` and `setMintOpen(true)`.

## Design probe (taste@1)

`IMD_PLAYWRIGHT=… node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`

First run: 14/16. Failures: `layout` (at 320px the hero title and stat values were clipped by the screen's `overflow: hidden`) and `chrome` (card inside card). Fixes: removed `overflow: hidden` from `.screen`, let the hero wrap with `min-width: 0`, a 64px sprite under 640px, content-width stat columns, tighter tabs so all four fit one row at 390px.

Final run: 15/16 pass (render, layout, targets, contrast, casing, tracking, eyebrows, type-sizes, type-faces, glyphs, slogans, repetition, copy-budget, motion, share). Remaining: `chrome` flags `main.screen-wrap` inside `div.console`. That nesting is the console bezel with an inset screen the brief explicitly asks for, so it is kept by design. The 390 screenshot shows the brand, Connect, the live status banner, the HamsterRun title, the one-line description and the Mint button on the first screen.

## Better Interface review (six domains)

Rendered checks were done through Playwright screenshots and the probe; no separate interactive browser tool was used. Contrast numbers below are the probe's measured pass (4.5:1 body / 3:1 large), not hand-measured ratios.

| Domain | Coverage | Findings and fixes | Remaining |
| --- | --- | --- | --- |
| Accessibility | Source review + probe targets/contrast + keyboard Escape on sheet | Added skip link (`web/src/App.tsx` header), `aria-current` tabs, `role="meter"` with text values, labelled handle input with `aria-invalid` and described-by message, dialog focus moved to × and returned to Connect (`web/src/wallet/ConnectSheet.tsx`), polite live log | Screen reader pass not performed; the sheet does not trap Tab inside the dialog |
| Layout | Probe at 320/390/1440 + screenshots | Fixed hero clipping at 320 (`web/src/styles.css` `.hero`, `.stack > *`), tabs wrapping at 390 (`.tab` padding under 640px), stat value wrapping (`.mint-stats` content columns) | Bezel-in-bezel nesting kept (brief) |
| Writing | Source review | Verb-first buttons (Mint free HAM, Start 6h training, Enqueue in band N, Copy link); every disabled action has a sentence saying why and what to do; contract errors mapped to fix-it copy (`web/src/chain.ts` `ERRORS`); honest "not open yet" banner names the owner step | None known |
| Typography | Probe type-sizes/type-faces/tracking/casing | Five sizes, two families, no tracking, no forced caps, tabular numbers on counters | Press Start 2P at 14px is a 1.75x scale of its 8px grid, so stems can land on half pixels at some zoom levels |
| Colors | Probe contrast + palette review | One meaning per color (mint ok, amber warning/link, magenta hungry/error); text magenta is `#ff79b4`, lighter than the A badge `#ff5fa2`, so it passes on the dark screen | None known |
| UI | Screenshots + interaction test | Chunky A/B controls for primary actions, soft buttons for secondary, D-pad works, pending/disabled states on every tx button, no fake success | Sound effects verified only by code (no audio capture) |

## Limitations

- `og:image` is a relative URL (`./og.png`) so it works on any host; some unfurlers require an absolute URL and will only show it once the site has a final address.
- The invite service (`invite-service/server.mjs`) is source only. It is not hosted by this job; until its URL is written to `dist/config.json` the board shows "offline" plus invites recorded in the visitor's own browser.
- Hosting is done by the network after this job; no publish command was run.
