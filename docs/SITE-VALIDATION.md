# Site validation record

Checks run by the worker on 2026-11-02 against the committed export in `dist/`. The verifier only checks paths and bytes; these results are the worker's own.

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
