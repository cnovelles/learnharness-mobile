# Issues: LearnHarness Mobile

Parent: `docs/PRD.md`. Labels: `needs-triage` on all. Status: `todo`, `doing`, `done`.
Each issue is a vertical slice: it is done only when its tests pass and the upstream suite in the fork still passes (except the known upstream failure in `tests/subscription-auth.test.ts`).

Order: 01 → 01b → 02 → 03 → 04 → (05, 06, 07, 08 in any order) → 09 → 10 → 11 → 12 → (13, 14) → 15.
17 (feature flags) is done. Later modes and features add their flag there.
16 (ChatGPT sign-in test on the iPhone) can run at any time after a development build runs on the user's iPhone. Its result decides the sign-in part of 12.

---

## 01 Fake provider + gateway against the real server `done`

Blocked by: none.

Build the deterministic test base and prove the gateway with the real upstream server.

- A fake OpenAI-compatible provider server (loopback) that replays scripted model responses (prober, teacher, practitioner, extractor). Configure it as a custom provider in a temporary `LH_DATA_DIR` (see upstream `docs/custom-providers.md`).
- Integration test: start the upstream server (`next start` or dev) with that data folder, put the gateway in front, pair, create a chat, `POST /api/chat`, read `/api/chats/:id/stream` through the gateway, reattach after a disconnect, read `/api/events`.
- Run the fork with `npm run desktop:dev`. Open "Phone Access…", turn it on, show the QR, pair with `curl`, remove the device. Fix what the real Electron window shows.

Acceptance: integration test passes; manual window check done; never touches the user's real data folder.

Result (fork commits `2657a55`, `78bb2bf`, `82fdb3e`): security fixes added (per-code pairing lockout; revoke closes open streams). CI job `phone-integration` added; it runs `npm run test:phone-integration`, which passes locally, also against upstream v0.6.1. Earlier result (`2657a55`): `npm run test:phone-integration` passes (8 tests). The window check found two bugs: the device list did not update after a pairing, and the spent QR code stayed on screen. Both are fixed and checked in the real window. The allowlist now matches the real routes. "Copy pairing text" (from 02) is done.

## 01b HTTPS with certificate pinning `done`

Blocked by: 01. User decision 2026-11-14: "Tailscale + LAN TLS now".

Why: the phone sends its token to saved LAN addresses before it knows that the server is the Mac (on another network, a device at the same IP gets the token), and LAN traffic is plain text.

- Gateway: HTTPS only, on every address. Self-signed certificate, made once, kept in userData, key file mode 0600. No plain HTTP listener.
- QR payload: add the SPKI SHA-256 pin of the certificate.
- Phone: store the pin with the connection; pin every request (pair, ping, API, SSE streams). Never send the token to a server that fails the pin. A 401 from a server that fails the pin does not delete the pairing.
- Phone: check URLs with `new URL()` (refuse user info, query, fragment, non-http(s)).
- Phone library: first check whether an Expo-compatible pinning library (for example react-native-ssl-public-key-pinning) also covers the SDK 58 global fetch (expo/fetch, streaming). If not, write a small local Expo module in Swift that does a pinned, streaming fetch behind the `remoteFetch` interface. Tell the user which option and why.
- Tests: gateway HTTPS and the pin in the QR payload; the phone refuses a wrong pin (unit test with an injected verifier); integration test with a wrong certificate; certificate rotation (a new certificate means pairing again).

Acceptance: all tests pass; no plain HTTP listener; the phone sends no token to a server with a wrong pin.

State (fork `8c1744d`, phone see PRD Status): all code and tests done.

- Certificate: own `node:crypto` code (user choice), P-256, no new dependency.
- Phone library: a local Swift Expo module (`modules/pinned-fetch`). The library option does not fit (TrustKit refuses self-signed certificates and hooks only React Native networking).
- Tests: fork 22 + 7 + 9 integration; phone 86 Jest; `npm run test:native-pin` checks the Swift pin check and URLSession on macOS against a real HTTPS server.
- Simulator check (2026-11-14, Xcode 26.6, iOS 26.5 SDK): the iOS build compiles `PinnedFetchModule.swift` with 0 errors. Pairing works over HTTPS with the pin: the app reached the Mac, got "connected", and the Mac listed the phone.
- Follow-up for the 02 screens (done 2026-11-14): the home screen shows a specific message for `wrongCertificate` (another device at the Mac's address, or a new certificate on the Mac). Tests: `tests/home-status.test.ts` and the pin test in `tests/app-pairing.test.tsx`.

## 02 Phone pairing `done`

Blocked by: 01, 01b.

- Unit tests for `src/lib/pairing.ts` (payload parse, first-answer-decides, unreachable fallthrough, 401 unpaired, remote fetch adds token and base URL). Test runner: Jest via `jest-expo` or node:test with tsx.
- Unit test: `src/shims/node-crypto.ts` gives the same SHA-256 hex as Node for the coverage fingerprint inputs.
- Connection store in the secure store (save, load, forget).
- Rewrite `src/app/_layout.tsx` (polyfills first, Stack) and `src/app/index.tsx`.
- Pairing screen: camera QR scan (`expo-camera`, `barcodeTypes: ["qr"]`) and a paste field.
- Desktop window: add "Copy pairing text" for the Simulator. (Done in 01.)
- `app.json`: camera permission text, `NSLocalNetworkUsageDescription`, ATS local networking. Development build (`npx expo run:ios`).
- Settings screen: connected Mac name, address in use, "Forget this Mac".

Acceptance: in the iOS Simulator, pair with the fork through the paste field; ping shows "connected"; removing the device on the Mac makes the phone ask to pair again.

State: done. Simulator check passed on 2026-11-14: the paste field paired with the fork (HTTPS with the pin), the home screen showed "Connected to MacBook-Pro-10.local.", and after "Remove" on the Mac the next ping showed "This phone was removed on the Mac. Pair again."

Found in the check and fixed:

- iOS changes typed straight quotes to curly quotes, also with `autoCorrect={false}`. The parser refused the text ("This is not a LearnHarness pairing code."). `parsePairingPayload` now changes curly double quotes back to straight quotes (test in `tests/pairing.test.ts`).
- The paste field placeholder showed `{"lh":1,...}`. It now shows `{"lh":2,...}`.

## 03 First teaching turn on the phone (mode 1) `done`

Blocked by: 02.

- Check that Metro bundles `components/session-core.ts` and the `src/core` barrel from the fork (watchFolders, `.ts` extension imports, `node:crypto` shim). Fix bundling problems in the phone project, not in shared code, where possible.
- Session list (`GET /api/chats`) with phase and pending marks. New session (`POST /api/chats`, then the first text input).
- Session screen: `SessionModel` with `remoteFetch`; transcript of text and reasoning parts while streaming.
- Question dock for probe (options, confidence stops, "I don't know", thinking field) and recall (text), with `questionDataForCall` + `buildAnswer` + `submitAnswer`.
- Maestro E2E with the fake provider: start a session, answer one probe, see the next turn.

Acceptance: E2E passes; one real lesson turn works with the Claude Code CLI on the Mac.

State (2026-11-14, commits `38b25db`, `41714af` and the follow-up commit): code and automatic tests are done. Two acceptance steps are open:

1. **Maestro E2E: passed (2026-11-14).** `e2e/first-turn.yaml` passed all 23 steps against the test Mac. Maestro 2.12.1 is in `~/.maestro` (official script; the Homebrew install built the whole openjdk chain from source on this Intel Mac and was stopped). It uses the installed Java 17. `npm run e2e:test` adds `~/.maestro/bin` to PATH. Two fixes from the run: `hideKeyboard` fails for a multiline field on iOS, so the flow taps static text (the screen uses `keyboardShouldPersistTaps="handled"`); the new-session prompt has the `testID` `new-session-prompt`, because its text is the same as the field's accessibility label.
2. **Real lesson turn: passed (2026-11-14).** The user paired the Simulator with the fork desktop app (dev shell, repo `data/` folder) and ran a lesson with the Claude Code CLI. The prober called `list_sessions` (it reads the knowledge graph first, as on the desktop), then the probe streamed into the dock, and the answered probes show on the desktop too. Findings, moved to later issues: raw error text on screen (fixed in `25a442c`, see issue 04), the refused-send retry bug (fixed in `25a442c`), plain look and raw Markdown (issues 05 and 18).

To run the E2E: `npm run e2e:mac` in the background (wait for "Test Mac ready"), then `LANG=en_US.UTF-8 npx expo start --clear --port 8081` in the background, then `npm run e2e:test`. Stop both servers after the run: the test Mac holds the fork's `.next/dev` lock. Each `e2e:mac` start makes a new one-use pairing code. The code expires after 5 minutes (`PAIRING_TTL_MS`), so run `npm run e2e:test` soon after "Test Mac ready".

The same steps passed by hand in the Simulator (2026-11-14) against the test Mac: pair, new session, the streamed probe, the answer (the Moon, 90%), the answered card ("Correct"), `probe_done`, and the teacher's wake turn without a reopen. This also proves streaming through the native pinned fetch on Hermes (`TextDecoder` and `ReadableStream` work).

What was built:

- Shared code: `src/lib/shared.ts` is the one place that imports from the fork (`@lh/*` alias in `tsconfig.json` and Jest). Metro bundles it with no change. Jest cannot load the fork's ES-only packages (typebox, d3-force, mdast, micromark), so `tests/setup/esm-to-cjs.cjs` bundles them once into CommonJS with the fork's esbuild (`tests/.cache`, not in git).
- `src/lib/mac-fetch.ts`: one stable fetch that uses the address in use, or the last address that worked (`useMacFetch()`).
- `src/lib/sessions.ts`: list, start (the opening text is kept in memory and sent once by the session screen, as on the desktop), read.
- `src/lib/use-session.ts`: the hooks over `SessionModel` (an external store for `useSyncExternalStore`; reattach on mount when a turn runs; `continueIfOwed`; stop on unmount).
- `src/lib/question-form.ts` and `src/components/question-dock.tsx`: probe and quiz (options, "I don't know", confidence stops, thinking), recall and explain (text), ask (options, Other).
- `src/lib/transcript.ts` and `src/components/transcript.tsx`: text, reasoning (closed by default), question cards with answer, grade and confidence, a short line for other tools. The question in the dock is not shown twice.
- Malformed questions: a question call that the shared check finds malformed shows "Ask again", which sends `retry-question` (as on the desktop).
- Events: `src/lib/events-channel.ts` reads `/api/events` through the Mac fetch (reconnect 1, 2, 5, 10 s; 60 s silence is a drop; 401 stops). `src/lib/session-events.ts`: `turn-started` attaches, `turn-settled` and `record-changed` read the record, a reconnect reads it again. Without this, the teacher's turn after the probe showed only after a reopen. The session list also reads again on these events.
- Screens: home (session list with phase and marks), `new-session`, `session/[id]`.
- Tests: Jest 159 (unit, screen tests with a fake Mac, a wake-turn test). `npm run test:integration` (4 tests) runs the phone code against the real fork server through the HTTPS gateway with the fake model, also in CI (job `integration`).
- `scripts/e2e-mac.ts` (`npm run e2e:mac`): a test Mac for the Simulator (temporary data folder, scripted lesson, gateway on 127.0.0.1). It writes the pairing text to `e2e/.pairing.txt` (not in git).

Notes:

- `next dev` compiles a route on its first request. A short fake turn can end before the phone attaches, so the integration test warms up the stream route first.
- After `probe_done`, the phase is "plan" until the first teaching question.
- Metro warns about two require cycles in the fork's `src/core` (upstream code; harmless).

## 04 Full teach cycle `todo`

Blocked by: 03.

- Check questions behind the reveal (`questionNeedsReveal`) with the reading-thinking field; explain answers; ask questions (single, multi, other, text).
- Lesson map (plan tree) and phase display.
- Answered cards (correct answer, explanation, committed answer).
- Steer, stop, retry, dismiss; 409 backoff; reattach when the app returns to the foreground.
- Compaction running state; error banner.
- **Error states first (user rule, 2026-11-14: every feature handles its error states, not only the happy path).** The phone never shows raw server text. Each state has a clear message and a Jest test (done 2026-11-14, see below):
  - `models_not_configured` (503): name the missing slot and tell the user to select a model in LearnHarness settings on the Mac. Read it with the fork's `parseModelsRefusal` (`components/chat.tsx`) through `src/lib/shared.ts`.
  - Provider key refusal (503): `parseProviderKeyRefusal`. Tell the user that the model's key is missing on the Mac.
  - A refused send is not a failed turn. Bug found 2026-11-14: the gate refuses before it saves the message, `SessionModel.send()` returns `false`, and the phone ignores it. "Try again" then sends `retry`, and the server answers "retry input requires a failed turn to retry". Fix: when a send is not accepted, put the text back in the composer, and "Try again" sends the same text again. Send `retry` only for a saved turn that failed.
  - 401: back to pairing (done in issue 02). 403 (route refused by the gateway): "The phone cannot do this yet." 409: backoff and reattach, no error shown.
  - Mac unreachable or network drop: "Lost the connection to the Mac", with automatic retry. Stream dropped mid-turn: `STREAM_DROPPED` with Try again.
  - Any other error: a plain message; the raw body goes to the log only.
    - **Done 2026-11-14:** `src/lib/user-error.ts` (`UserMessage`, `userMessage`, `UserFacingError`, `describeError`) with `tests/user-error.test.ts`. `ErrorText` takes only a `UserMessage`; all 7 error displays use `describeError`. ESLint `no-restricted-syntax` blocks `.message` in JSX, casts to `UserMessage`, and non-literal text in `userMessage()`. Rule in `AGENTS.md` ("Error states"). The refused-send bug is fixed: SessionModel removes the bubble (`onAccepted`), the text goes back to the composer, and Try again sends it again; `retry` only for a saved failed turn. Screen tests: refused opening text, failed saved turn, gateway 403. Open: the Maestro case below, and a check of each state on the Simulator.
      Acceptance: Maestro E2E for probe → plan → teach → check with the fake provider, and a Maestro case for `models_not_configured` (refusal, set the model, send again, the turn runs).

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

## 16 ChatGPT sign-in on a real iPhone (test) `todo`

Blocked by: a development build on the user's iPhone (needs Xcode 26.4 or later).

Goal: find out if "Sign in with ChatGPT" works inside the phone app, so that mode 3 can use the learner's ChatGPT plan with no API key.

Facts (OpenAI SIWC docs for open-source and local apps, read 2026-11-14):

- Self-serve: start with `client_id=dynamic_agent_client`, `ext_agent_host_id` and `agent_name_hint`; save the issued `oaiapp_...` client ID. No client secret and no partner key.
- PKCE S256, a new `state` and OIDC `nonce` for each attempt.
- The return address must be an HTTP loopback address on `127.0.0.1` (not `localhost`). Only the port can change later. Custom app links and HTTPS return addresses are not supported. The docs do not mention mobile apps.
- Requests: `POST https://api.openai.com/v1/responses` with `stream: true` and `store: false`. No `temperature`, `max_output_tokens` or system role items (use `instructions`). Never call ChatGPT `backend-api` endpoints.

Work:

- Small test screen in a development build: start a loopback server on `127.0.0.1` in the app, open the OpenAI sign-in page in an in-app browser sheet (ASWebAuthenticationSession or SFSafariViewController), catch the return code, exchange it, store the tokens in the Keychain.
- Then list models (`GET /v1/models`, `visibility == "list"`) and stream one short Responses request.
- Test the fallback: the learner copies the final address from the browser and pastes it into the app (pi-ai already accepts a pasted callback URL).
- Test the refresh token after the app was in the background and after a restart.

Acceptance:

- On the user's real iPhone (not only the Simulator): sign-in completes, one streamed reply arrives, and the token refresh works.
- A short report in this issue: works / works only with the paste fallback / does not work, with the iOS version and the steps. If it does not work, mode 3 uses API keys only, and the learner signs in to ChatGPT on the Mac for mode 1.
- No real tokens in the repository, logs or tests. Automatic tests use a fake OAuth server.

## 17 Feature flags for the modes `done`

Asked by the user on 2026-11-14: turn each mode on or off without a new design.

- `src/lib/feature-flags.ts`: flags `macRemote`, `onPhone`, `cloudHost`. Base defaults: only Mac remote is on, because only finished modes are on by default.
- Build defaults: `EXPO_PUBLIC_LH_FLAGS`, for example `onPhone=1,cloudHost=0`. Unknown names and bad values are reported and ignored.
- Local overrides on this phone only (Keychain, this device only). No remote flags, because the free path has no server.
- At least one mode is always on. `resolveMode` moves the learner off a turned-off mode to the first mode that is on. Issue 11 must sync first when it can. A flag change never deletes learner data.
- Settings: a hidden developer section. Tap "Version" 7 times to open it in a release build. Development builds always show it. It has a switch for each mode and "Use the build defaults".
- When a mode is built (03–04 for Mac remote, 12 for On phone, 14 for Cloud host), the mode reads its flag, and the base default turns on only after its E2E tests pass.
  Acceptance (met): unit tests for parsing, overrides, the last-mode rule, resolveMode, save failures and damaged records; app tests for the hidden unlock and the switches.

## 18 Visual design that matches the desktop `todo`

Blocked by: 04, 05. Requested by the user on 2026-11-14, after the real lesson check: the phone looks too plain next to the desktop.

- Take the desktop's look as the reference: the dark theme (and light), the monospace small-caps labels ("YOU", "AGENT'S THINKING", "PROBE"), card borders and radius, spacing and typography. Read the fork's Tailwind theme and components for the exact values; do not guess (upstream `AGENTS.md`: ask the user about design decisions).
- Question cards as on the desktop: the kind tag (PROBE, CHECK), the CORRECT or INCORRECT tag, ✓ on the correct option and ✗ on the chosen wrong one, the confidence bar with its stops, and "Your thinking" folded.
- Tool rows as on the desktop: the tool name in small caps with its main argument (for example `LIST_PROPOSITIONS chat_…`), folded, and they open to show the input and the output.
- Error states: errors, empty lists and loading states get the same design care (see `AGENTS.md`, "Error states").
  Acceptance: screenshots of the same session on the desktop and the phone side by side, approved by the user; screen tests still pass.
