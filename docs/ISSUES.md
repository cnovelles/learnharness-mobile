# Issues: LearnHarness Mobile

Parent: `docs/PRD.md`. Labels: `needs-triage` on all. Status: `todo`, `doing`, `done`.
Each issue is a vertical slice: it is done only when its tests pass and the upstream suite in the fork still passes (except the known upstream failure in `tests/subscription-auth.test.ts`).

Order: 01 → 02 → 03 → 04 → (05, 06, 07, 08 in any order) → 09 → 10 → 11 → 12 → (13, 14) → 15.

---

## 01 Fake provider + gateway against the real server `done`
Blocked by: none.

Build the deterministic test base and prove the gateway with the real upstream server.
- A fake OpenAI-compatible provider server (loopback) that replays scripted model responses (prober, teacher, practitioner, extractor). Configure it as a custom provider in a temporary `LH_DATA_DIR` (see upstream `docs/custom-providers.md`).
- Integration test: start the upstream server (`next start` or dev) with that data folder, put the gateway in front, pair, create a chat, `POST /api/chat`, read `/api/chats/:id/stream` through the gateway, reattach after a disconnect, read `/api/events`.
- Run the fork with `npm run desktop:dev`. Open "Phone Access…", turn it on, show the QR, pair with `curl`, remove the device. Fix what the real Electron window shows.

Acceptance: integration test passes; manual window check done; never touches the user's real data folder.

Result (fork commit `2657a55`): `npm run test:phone-integration` passes (8 tests). The window check found two bugs: the device list did not update after a pairing, and the spent QR code stayed on screen. Both are fixed and checked in the real window. The allowlist now matches the real routes. "Copy pairing text" (from 02) is done.

## 02 Phone pairing `todo`
Blocked by: 01.

- Unit tests for `src/lib/pairing.ts` (payload parse, first-answer-decides, unreachable fallthrough, 401 unpaired, remote fetch adds token and base URL). Test runner: Jest via `jest-expo` or node:test with tsx.
- Unit test: `src/shims/node-crypto.ts` gives the same SHA-256 hex as Node for the coverage fingerprint inputs.
- Connection store in the secure store (save, load, forget).
- Rewrite `src/app/_layout.tsx` (polyfills first, Stack) and `src/app/index.tsx`.
- Pairing screen: camera QR scan (`expo-camera`, `barcodeTypes: ["qr"]`) and a paste field.
- Desktop window: add "Copy pairing text" for the Simulator. (Done in 01.)
- `app.json`: camera permission text, `NSLocalNetworkUsageDescription`, ATS local networking. Development build (`npx expo run:ios`).
- Settings screen: connected Mac name, address in use, "Forget this Mac".

Acceptance: in the iOS Simulator, pair with the fork through the paste field; ping shows "connected"; removing the device on the Mac makes the phone ask to pair again.

## 03 First teaching turn on the phone (mode 1) `todo`
Blocked by: 02.

- Check that Metro bundles `components/session-core.ts` and the `src/core` barrel from the fork (watchFolders, `.ts` extension imports, `node:crypto` shim). Fix bundling problems in the phone project, not in shared code, where possible.
- Session list (`GET /api/chats`) with phase and pending marks. New session (`POST /api/chats`, then the first text input).
- Session screen: `SessionModel` with `remoteFetch`; transcript of text and reasoning parts while streaming.
- Question dock for probe (options, confidence stops, "I don't know", thinking field) and recall (text), with `questionDataForCall` + `buildAnswer` + `submitAnswer`.
- Maestro E2E with the fake provider: start a session, answer one probe, see the next turn.

Acceptance: E2E passes; one real lesson turn works with the Claude Code CLI on the Mac.

## 04 Full teach cycle `todo`
Blocked by: 03.
- Check questions behind the reveal (`questionNeedsReveal`) with the reading-thinking field; explain answers; ask questions (single, multi, other, text).
- Lesson map (plan tree) and phase display.
- Answered cards (correct answer, explanation, committed answer).
- Steer, stop, retry, dismiss; 409 backoff; reattach when the app returns to the foreground.
- Compaction running state; error banner.
Acceptance: Maestro E2E for probe → plan → teach → check with the fake provider.

## 05 Rich rendering `todo`
Blocked by: 03.
- Markdown, KaTeX math, code, Mermaid (WebView or native renderers; choose and document).
- Visual (SVG) and demo artifacts through `/api/chats/:id/artifact-ui` in a sandboxed WebView.
Acceptance: golden-fixture sessions render without errors; snapshot or screenshot checks.

## 06 Practice on the phone `todo`
Blocked by: 04.
- New practice session; `problem` dock with thinking submissions; `conclude` with solution reveal; Next problem; dismiss.
Acceptance: Maestro E2E for one practice problem with the fake provider.

## 07 Dictation `todo`
Blocked by: 04.
- On-device speech recognition into the active field (thinking, answer, reading thinking, composer). Default.
- Optional Deepgram: `GET /api/stt/token` through the gateway, WebSocket with the shared URL builder, native PCM capture.
Acceptance: E2E injects an audio file and checks the text in the thinking field.

## 08 Graph list, cost and context `todo`
Blocked by: 03.
- Graph list and chain table from `GET /api/graph`; session cost and context use from the chat record.
Acceptance: values match the desktop for the golden fixtures.

## 09 Local store and outbox `todo`
Blocked by: 04.
- SQLite (WAL) adapters behind the shared storage ports; one row per message; images as files; summary index for the session list.
- Mirror the remote sessions into the local store in mode 1 and 2.
- Outbox table for changes made on the phone.
Acceptance: adapter unit tests for each port; golden fixtures load and project the same view as upstream `projectView`.

## 10 Sync `todo`
Blocked by: 09.
- Sync service inside the fork's server process (writes through the upstream stores). Routes behind the gateway.
- Phone sync client: on app open, every few minutes while in front, "Sync now"; last sync time; waiting count.
- Merge: graph union by id; chats by message id; conflict copies; tombstones; running-turn session lock.
- Confirmation by id + content hash; outbox entries removed only after confirmation.
Acceptance: unit tests for merge and outbox; integration against golden fixtures; all data-loss tests in the PRD pass.

## 11 Mode switch and Settings `todo`
Blocked by: 10.
- Settings: mode 1, 2, 3; sync before switching; clear state when the target is not reachable.
Acceptance: E2E: start in mode 3, switch to mode 1, continue on the desktop, switch back.

## 12 Mode 3 engine on the phone `todo`
Blocked by: 11.
- Upstream agents, tools, prompts (bundled as strings) and the turn runner with SQLite ports; Anthropic key in the Keychain; compaction; cost meter; extraction and auditor.
- Remove tools that cannot run (file tools, Claude Code CLI); demos in a WebView without headless verification.
Acceptance: ported upstream flow tests (`chat-flow`, `practice-flow`, `extraction`) pass against the phone runner; E2E lesson offline from the Mac (fake provider).

## 13 Export all data `todo`
Blocked by: 09.
- Desktop-format folder export; share sheet.
Acceptance: the upstream stores read the export without errors.

## 14 Cloud host `todo`
Blocked by: 10.
- Docker image of the fork in browser mode with the gateway and sync service; `tailscale serve`; deploy guide (Hetzner or Fly.io).
Acceptance: the mode 1 E2E suite passes against the container.

## 15 Personal build and setup guide `todo`
Blocked by: 04.
- Unsigned local build of the fork for the user's Mac (no upstream notarization profile). Phone install with a development build or TestFlight (user's Apple account; the user does the sign-in).
- Guide: install Tailscale on Mac and iPhone (the user creates the account), turn on Phone Access, pair.
Acceptance: the user pairs a real iPhone and does one lesson away from home.
