# Issues: LearnHarness Mobile

Parent: `docs/PRD.md`. Labels: `needs-triage` on all. Status: `todo`, `doing`, `done`.
Each issue is a vertical slice: it is done only when its tests pass and the upstream suite in the fork still passes (except the known upstream failure in `tests/subscription-auth.test.ts`).

Order: 01 → 01b → 02 → 03 → 04 → (05, 06, 07, 08 in any order; 19 after 05) → 09 → 10 → 11 → 12 → (13, 14) → 15.
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

## 04 Full teach cycle `done`

Blocked by: 03.

Desktop reference: `questionNeedsReveal`, `phaseAt3`, `derivePlanStatuses`, `answerForPresentation`, `dismissedAnswer` and `endsInFailedTurn` are in the fork's `src/core` barrel. `SessionModel` has `steer`, `dismissQuestion`, `stop`, `questionDraft` and `saveQuestionDraft`, and it retries a 409 by itself (polls every 500 ms for up to 30 s). The gateway allows `/api/chat`, `/api/chats/:id/steer`, `/api/chats/:id/dismiss` and `/api/activity/abort`. Compaction has no client route: the Mac starts it, and the phone reads `compacting` from the record and the `compaction-changed` event.

Each slice lists its error states (`AGENTS.md`, "Error states"). Every error on screen goes through `describeError`.

**0. Error states and no raw text: done (2026-11-14, `25a442c`).** `src/lib/user-error.ts` (`UserMessage`, `userMessage`, `UserFacingError`, `describeError`), `ErrorText` takes only a `UserMessage`, ESLint blocks the ways around it, and the rule is in `AGENTS.md`. A text that the Mac refuses before it saves it goes back to the composer, and Try again sends it again; `retry` only for a saved turn that failed. Screen tests: refused opening text, failed saved turn, gateway 403.

**A. Check questions, explain and ask: done (2026-11-14, `d5d4581`).** `src/lib/reveal.ts` (`revealPlan`, `followsQuestion`), `RevealBar` and drafts in `src/components/question-dock.tsx`, `readingThinking` in `answerFor`. The hook (`use-session.ts`) keeps the last unsent input (text or answer), and Try again sends it again; the waiting question stays open when the status is `error`. Drafts live in `SessionModel` (they survive a dock remount, not a screen reopen). Explain and ask already worked from issue 03.

- A teach-phase check (`questionNeedsReveal`) arrives closed: "Check your understanding", a short preview, and Open. While it is closed, the reading-thinking field ("Whatever comes to mind as you read.") shows under the teaching text. It opens by itself when it follows another question (desktop `revealArrival`). A `predict` question arrives open.
- The answer carries `readingThinking` when it is not empty. Explain answers (text) and ask questions (single, multi, Other, text) use the same dock.
- Drafts: the form and the reading thinking survive a dock remount while the screen is open (`saveQuestionDraft`).
- Error states: an answer that the Mac refuses or that fails keeps the form and the reading thinking, and shows the mapped message; submit is off while the session compacts ("The Mac is making the history shorter…").

**B. Lesson map, phase and answered cards: done (2026-11-14).**

- Phase in the header under the title: Probing, Planning, Teaching (`phaseAt3Lh`, the desktop `PhaseChip` labels). Dividers (`src/lib/transcript.ts`): "Plan · N steps" at the probe-handoff marker (the step count of the first plan after it, else "Planning"), "Teaching" where the first tagged check is called (`phaseTimeline`, `teachStepIndex`).
- Lesson map: `src/lib/plan.ts` (`latestPlanTree`, `planSteps`: a stable prerequisite order, the indent is the longest prerequisite chain, statuses from `derivePlanStatusesLh`, "visited" shows as done). "Plan" in the session header and the plan row in the transcript open `src/components/plan-sheet.tsx` (a page sheet with Now, Done, Next).
- Answered cards: `src/lib/answer-card.ts` (`presentAnswer` with `answerForPresentation`). The card shows the kind label, correct, incorrect or didn't know, ✓ and ✗, the confidence, "Your thinking" and "Why" (tap to open), the reading thinking above the card, and "The answer" for explain. A skipped question shows "You skipped this question."
- Error states and their tests: a failed plan call (`output-error`, or `ok: false`) shows a failed tool row and no map; a plan with no nodes, bad nodes or no tree gives no map; a later failed plan keeps the earlier map; a check for a step that is not in the plan moves nothing; a cycle in the tree lists each step once; a malformed answer record shows "Answered. The phone cannot show this answer." and never raw data; bad fields in a record are left out. Tests: `tests/plan.test.ts`, `tests/transcript.test.ts`, `tests/app-session.test.tsx` (slice B).

**C. Steer, stop, retry, foreground: done (2026-11-14).** Code: `src/lib/use-session.ts`, `src/lib/session-events.ts` (`syncSession`, hooks `onSnapshot`, `onSyncError`, `onCompaction`), `src/app/session/[id].tsx`, `src/components/question-dock.tsx`.

- While a turn runs, the composer sends a steer (`SessionModel.steer`); "Waiting for the teacher: …" shows until the steer is in the record (`visibleQueuedSteers`). The send resolves when the Mac accepts the text, so the composer is free during the turn.
- Stop in the header while a turn runs (confirm "Stop this turn? The partial answer stays."), then `stop()` and `POST /api/activity/abort` `{kind:"turn", id}`, then a record read. Skip was here first; the acceptance check removed it (see below).
- Try again shows only for an unsent input or when `endsInFailedTurn` is true, and it waits while the Mac compacts. A failure that cannot be retried shows Close only, as on the desktop.
- Background: the phone stops reading the stream; the turn runs on. Foreground: the events channel connects again and the sync attaches again.
- Error states and their tests (`tests/app-session-controls.test.tsx`, `tests/user-error.test.ts`, `tests/session-events.test.ts`): a refused steer puts its text back with the mapped message; a steer that gets 409 while the phone still settles the turn keeps its text in the composer (SessionModel sends it as a message only when idle); an abort with 409 `not_running` is not an error; a failed abort shows "The phone could not stop the turn. It still runs on the Mac." and attaches again; a record read that fails after the foreground shows "The phone could not read this session from the Mac. Try again." with Try again; no Try again when nothing can be retried.

**D. Compaction state and error banner: done (2026-11-14).**

- `compacting` from the record (`readSession`, each sync) and from `compaction-changed`: "The Mac is making the history shorter…"; Send, Send answer and Try again wait. Reading and Stop still work. The transcript shows "Context compacted" and "History compacted · N K tokens".
- One banner for the session: the mapped text, Try again when an action applies, Close.
- Error states and their tests (`tests/app-session-compaction.test.tsx`, `tests/transcript.test.ts`): a missed `compaction-changed` is fixed by the next record read; a compaction that never ends does not lock the screen (the phone reads the record every 30 s); a compaction part with bad data shows the divider without a count.
- Test setup note: `renderRouter` turns on Jest's fake timers. `package.json` keeps `nextTick` and `queueMicrotask` real (`fakeTimers.doNotFake`): the web streams use them, and a new fake clock in the next test lost them, which stopped the streams of later tests. The shared fake Mac is `tests/helpers/fake-mac.ts`.

**E. Tests: done (2026-11-14).** Jest for each slice and each error state (261 pass). `npm run test:integration` passes (4 tests). Maestro on the Simulator (both passed 2026-11-14):

- `e2e/teach-cycle.yaml` (`npm run e2e:teach`): the Mac has no model set, the first text gets the clear refusal (no raw code), the model is set on the Mac, Try again sends the same text, then probe → plan (Planning, "Plan · 2 steps", the Plan sheet with Next) → "Ready." → teach (Teaching, the check behind "Check your understanding", the reading thinking) → the answered card (CHECK, CORRECT, the reading thinking) and the Plan sheet with Now.
- `e2e/first-turn.yaml` (`npm run e2e:test`): the issue 03 flow, with the new card text.
- `scripts/e2e-mac.ts` now scripts the plan and teach turns and has a control server on 127.0.0.1 (`POST /models/clear`, `POST /models/set`; URL in `e2e/.control.txt`, not in git). `scripts/e2e-test.sh` runs one flow. Each flow needs a new `npm run e2e:mac` (the scripted lesson and the one-use pairing code are for one run).
- A bug that the run found: the keyboard covered the message field. The session screen now uses `KeyboardAvoidingView` (`behavior="padding"`, `useHeaderHeight()` from `expo-router/react-navigation`, as the Expo keyboard guide says), the composer and the queued steers stay under the transcript, and the transcript scrolls to the end when the keyboard opens.

**Acceptance check: done (2026-11-14, fix `1f2f104`).** The user ran one real lesson on the Simulator, paired with the fork desktop app (dev server and Electron with a temporary `LH_DATA_DIR` and `LH_AUTH_FILE`), with the Claude Code CLI (`sonnet`): probe (4 questions), `probe_done`, plan (`plan_init`), teach (a prediction, then a check behind "Check your understanding"). All phases worked. The check found 3 problems, fixed in one change:

1. **Literal `\n` text.** The Claude Code CLI sent some tool arguments with the two characters `\` and `n` in place of line breaks, also in code fences. The Mac stores the text as it came. The desktop repairs it before display (`repairMathForDisplay`, `src/core/math-delims.ts`); the phone did not. Now `src/lib/teacher-text.ts` (`teacherText`) calls the same shared function for the teacher's text, the reasoning, the questions (dock, preview, transcript, answered card), the options, Why and "The answer". The learner's own text stays as typed, and the answer record keeps the original question text. The function repairs `\n` only in clear text layout (code fences, a blank line between paragraphs); a single `\n` stays, because it can be a math command such as `\nabla`. Tests: `tests/transcript.test.ts` ("literal \n text"), `tests/app-session.test.tsx` (prediction with literal `\n`).
2. **No kind label on the open question.** The dock now starts with the desktop's label (`dockLabel`, from `cardLabel`): PROBE, RECALL, PREDICTION, CHECK, EXPLAIN or QUESTION, and " · SELECT ALL THAT APPLY" for multi-select. Tests: PROBE, CHECK and PREDICTION in the screen tests.
3. **Skip removed (user decision).** "I don't know" gives the teacher an honest answer, and the desktop has no skip button (it dismisses a question only through the stop action, `components/chat.tsx`). Removed: both Skip buttons, the confirm, `skipQuestion` in `use-session.ts`, and the "could not skip" text in `describeError`. A question that the desktop dismissed still shows "You skipped this question." Tests: no Skip on the open probe and on the closed check; a dismissed record still shows skipped; the old dismissal text is no longer mapped.

Not a bug: each quiz starts at 50% confidence; the desktop slider also starts at 50%.

Found for later: rich rendering (issue 05: Markdown, code blocks, the probe assessment card, the plan graph), dictation (issue 07), the app icon and splash screen (issue 18).

Acceptance: the Maestro E2E passes; each error state above has a Jest test; the user checks one real teach cycle on the Simulator. All three are done.

## 05 Rich rendering `doing`

Blocked by: 03.

- Markdown, KaTeX math, code, Mermaid.
- Found in the issue 04 acceptance check (user screenshots of the desktop are the reference):
  - Teacher text shows raw Markdown on the phone: `## Step 1`, `**bold**`, `*italic*`, `- ` lists and backticks.
  - Code fences need a code block as on the desktop: a dark block with line numbers and syntax colors. Inline code (`true`, `count`) in small mono boxes, also in question options.
  - The `probe_done` call shows as a plain "Tool: probe_done" line. The desktop shows a "Probe concluded: your assessment" card with one block for each strand.
  - The lesson plan: the desktop draws the plan as a graph with arrows (prerequisites). The phone has only the list in the Plan sheet.
- Visual (SVG) and demo artifacts moved to issue 19 (user decision 2026-11-14).

**How the desktop renders (read 2026-11-14).**

- Markdown: `Streamdown` in `components/ai-elements/message.tsx` (GFM, `remark-breaks` in the cjk plugin's `remarkPluginsAfter`, dollar math with `singleDollarTextMath`). Remote images are blocked ("[Image blocked: alt]"). `transformMathDelimiters` reads the old `\(…\)` and `\[…\]` math. Tool text goes through `repairMathForDisplay` (`ToolContentResponse`).
- `components/md-blocks.tsx`: code fences use Streamdown's `CodeBlock` (Shiki `codeToTokens`, JavaScript regex engine, themes `github-light` and `github-dark`, line numbers unless the fence meta has `noLineNumbers`, `startLine=N`). Inline code: mono, `--lh-ink-code`. A copy icon on each block. GitHub alert markers (`[!IMPORTANT]` and 4 more) make a callout box.
- Math: KaTeX 0.18. Mermaid: `components/mermaid-render.ts` (`securityLevel: "strict"`, a theme for each mode, font size 16), a spinner while the fence is open, `MermaidError` with Try again.
- `probe_done`: `components/artifacts/probe-done-card.tsx`. The input goes through `parseProbeDoneInput` (shared core). A folded card "Probe assessment · N strands" that opens to one block for each strand and the summary.
- Plan graph: `components/plan-block.tsx`. The layout is dagre (`dagre-d3-es`) with no DOM (`blockLayout`, `edgePathD`, `wrapTitle`, `nodeWidth`). The SVG is drawn by hand. The transcript block has one color (no statuses); the popup shows statuses and has pan and zoom. The file also imports `lucide-react` and DOM components, so the phone cannot import it as it is.

**Decisions (user, 2026-11-14).** The user saw mockups of each option and chose A for all 4.

1. Native hybrid renderer. Markdown, code, inline code, the probe card and the plan graph are native views. Not a WebView for each message (rejected: a separate web bundle of the fork's components, a height sync for each message, more memory, Jest cannot see inside it).
2. Math in a KaTeX WebView island: one island for each paragraph or block that has math. The same engine as the desktop. Mermaid uses the same island. Not MathJax SVG (rejected: a different engine from the desktop).
3. Visual and demo artifacts are a separate issue (19).
4. Copy is in this issue: a long press on a block copies its source (code as text, a table as Markdown, math as TeX, Mermaid as the chart source). Uses `expo-clipboard`.

Accepted limit: inline code in native text gets only a color and a background (no padding, no rounded corners, from memory, check in slice A). Issue 18 decides the final look.

**Slices.**

- **0. Fork: shared plan layout. Done (2026-11-14, fork `c6e79ca`).** The pure layout is in the fork's `components/plan-layout.ts` (dagre placement, `edgePathD`, `wrapTitle`, the geometry constants and the arrowhead). `plan-block.tsx` imports it and re-exports every name, so the desktop does not change. Fork: lint and typecheck clean, the plan tests pass (58), `npm test` has only the 3 known upstream failures. Phone: `src/lib/shared.ts` exports the layout, Jest converts `dagre-d3-es` and `d3-shape` to CommonJS (`tests/setup/esm-to-cjs.cjs`), `tests/plan-layout.test.ts` (6: placement, a dangling edge, a cycle, an empty plan, a path, a long title). `npx expo export --platform ios` bundles it into Hermes bytecode.
- **A. Markdown. Done (2026-11-14).** `src/lib/markdown.ts` (`parseMarkdown`: `transformMathDelimiters`, then `remend` with `htmlTags: false`, then `mdast-util-from-markdown` with GFM and dollar math, as Streamdown on the desktop; `safeLinkUrl`, `alertContent`, `markdownPreview`). `src/components/markdown.tsx` (`Markdown`) draws the tree as native views, with an error boundary for each message. The parser packages come from the fork's `node_modules` (`tsconfig.json` paths, Metro `nodeModulesPaths`, Jest `esm-to-cjs`), so the versions are the same as the desktop's. Used for the teacher text, the reasoning, the dock question, context and options, the closed check preview (one plain line), the answered card (question, options, Why, "The answer") and the open question card. The learner's own text stays plain, as on the desktop. Code fences show as a plain mono block with line numbers (colors in slice B). Math shows as its TeX source (KaTeX in slice C). Tests: `tests/markdown.test.tsx` (24, also every teacher text in the fork's golden fixtures). Not checked yet on the Simulator.
- **B. Code blocks. Done (2026-11-15).** The Hermes check: a macOS build of the app's own Hermes VM (`ios/Pods/hermes-engine/destroot/Library/Frameworks/macosx/hermesvm.framework`, 260318099.0.5) runs Shiki 3.23.0 through a small C++ host. Hermes's `String.prototype.matchAll` drops `groups`, so 6,225 of 167,608 grammar regexes failed and 45 of 235 languages lost colors. The fix is `src/shims/match-all.ts` (`fixMatchAll`, on top of `exec`, only when the bug is there; called in `src/shims/polyfills.ts`). After the fix, 227 of 235 languages give the same tokens as Node. Hermes has no `v` RegExp flag, so 89 regexes (mostly Haskell and Stata) are skipped, and C++, PHP, Haskell and MATLAB color a few tokens differently. User decision 2026-11-15: use the shim and Shiki. `src/lib/code-highlight.ts`: `createHighlighterCoreSync` with the JavaScript engine (`forgiving: true`) and `github-light` / `github-dark`; 42 bundled languages with their fence aliases, each grammar loads on first use (`require`); a cache of 64 blocks; plain above 12,000 characters or 300 lines, lines over 1,000 characters plain, 2 s time limit for one line (the first line also compiles the regexes). `parseMarkdown` marks a fence that is not closed yet (`data.open`); it stays plain until it closes. The block takes the theme's background and the mode's colors (`useColorScheme`). Tests: `tests/match-all.test.ts` (4), `tests/code-highlight.test.ts` (7), `tests/markdown.test.tsx` (5 new: colors, dark mode, open fence, unknown language, failure and size). `npx expo export --platform ios` bundles it (9.5 MB Hermes bytecode). Copy: a long press on a code block, a table or a math block copies its source (`CopyBlock` in `src/components/markdown.tsx`; `tableMarkdown` in `src/lib/copy-source.ts` writes GFM with the alignment row, an image becomes its alt text, and only safe links keep their URL). A label shows "Copied" or "Could not copy." for 1.5 s. VoiceOver gets a "Copy" action. Tests: 5 more in `tests/markdown.test.tsx` (code, table and math, VoiceOver, error state 17). The dev build of 2026-11-15 has `expo-clipboard`, `react-native-svg` and `react-native-webview` (user decision: one build for slices B to E; `npx expo run:ios --no-bundler` built with 0 errors). **Simulator check passed (2026-11-15)** with the scripted Mac (`LH_E2E_RICH=1 npm run e2e:mac`, then `npm run e2e:teach`): headings, bold, italic, lists, inline code, a link, the table and the math source draw (slice A); TypeScript and Python in the Shiki colors on the real Hermes, `startLine=10`, the unknown language plain; dark mode uses `github-dark`; sideways and vertical scroll work; a long press copies the code and the table (checked with `xcrun simctl pbpaste`: the table has the alignment row and "moon" for the image, no URL) and shows "Copied". Found and fixed in the check: a `Pressable` around a block stopped the block's sideways scroll on iOS. The press target now sits inside the scroll view (`CopyTarget`), with a regression test. Seen in the check, for issue 18: a narrow table column wraps "[Image blocked: moon]" letter by letter.
- **C. Math and Mermaid islands.** `react-native-webview` with a local HTML page that has KaTeX and Mermaid in it (no network). The text goes in as escaped data. The island reports its height.
  - Facts (2026-11-15): the fork has KaTeX 0.18.2 and Mermaid 11.17.0 (`@streamdown/mermaid` uses the top-level copy). The desktop uses `rehype-katex` with `throwOnError: false`. `katex.min.js` is 268 KB, the CSS is 28 KB, the woff2 fonts are 296 KB, and `mermaid.min.js` is 3.4 MB. The react-native-webview 14.0.1 Guide says that local HTML files do not load reliably (#428, #518). `source={{ html }}` needs `originWhitelist={["*"]}`. `injectedJavaScriptObject` sends JSON into the page. On iOS, `onContentProcessDidTerminate` fires when the process stops. The library has no auto height. The docs say nothing about a CSP `<meta>` tag, so check it on the Simulator.
  - Decisions (user, 2026-11-15):
    1. KaTeX runs in Hermes (`katex.renderToString`). The island gets the finished HTML with the KaTeX CSS and fonts. Jest sees math errors (state 8) before a WebView starts. Check KaTeX on the real Hermes VM first, as in slice B.
    2. Two pages: a math page (CSS and fonts as `data:` URIs) and a Mermaid page (`mermaid.min.js`). A script builds both from the fork's files into a JS module. They load with `source={{ html }}`.
    3. An island starts its WebView only when it comes near the visible part of the transcript. Before that, it shows its source as a placeholder. It keeps its measured height.
    4. A paragraph with inline math goes into one island with all its text (bold, inline code, links as escaped HTML). A link tap goes back to the app and opens through `safeLinkUrl`.
  - Plan: CSP `default-src 'none'` with inline scripts and styles and `data:` fonts and images only; `onShouldStartLoadWithRequest` refuses every load after the first; no new windows, no data detectors, no link preview, `incognito`, no cache. Model text goes in only through `injectedJavaScriptObject`. A `ResizeObserver` sends the height; the app accepts only a finite number in a range, and after 3 s with no valid height it uses a minimum height and the content scrolls inside. Mermaid has a 10 s time-out. A stopped process loads again one time, then the fallback shows. A mode change sends new colors and the Mermaid theme.
  - **Code done (2026-11-15), Simulator check not done yet.**
    - Hermes check: `scripts/hermes-run/run.sh <entry>` (`npm run hermes:run`) bundles a file with the fork's esbuild and runs it on the app's own Hermes VM (`scripts/hermes-run/host.cpp`). KaTeX 0.18.2 gave byte-identical output on Hermes and Node for 140 renders (70 formulas, inline and display, 24 errors on both). One render takes about 0.7 ms on Hermes.
    - Pages: `scripts/island-pages/build.cjs` builds `.cache/island-pages/islands.js` (not in git) from the fork's files. Metro (`metro.config.js`, module name `lh-island-pages`) and Jest (`tests/setup/esm-to-cjs.cjs`, `moduleNameMapper`) call it; it builds again only when an input is newer. The HTML has no script: the CSP is `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'`. The page script (`common.js` with `math-runtime.js` or `mermaid-runtime.js`) and `mermaid.min.js` go in through `injectedJavaScript`, which WebKit runs outside the page CSP (check on the Simulator). The Mermaid script is written ASCII-only (`\uXXXX`), because Hermes keeps a string with one non-ASCII character as UTF-16: the iOS bundle is 14 MB (9.5 MB before slice C; 17 MB without the escape).
    - App side: `src/lib/math-html.ts` (`renderTex` with `throwOnError`, `trust: false`, `strict: "ignore"`; `paragraphIsland`, `mathBlockIsland`; links get `data-link` indexes and no `href`), `src/lib/island-messages.ts` (`parseIslandMessage`), `src/components/web-island.tsx` (lockdown, height, reload), `src/components/islands.tsx` (`MathIsland`, `MermaidIsland`), `src/components/island-viewport.tsx` (near the screen; the session screen gives the viewport), `src/components/copy.tsx` (copy helpers moved out of `markdown.tsx`), `src/lib/open-link.ts`. A live math island gets new text with `postMessage` while a reply streams, so it does not load again for each word. A heading or a table cell with math still shows the TeX source in mono.
    - Tests: `tests/math-html.test.ts` (11), `tests/island-messages.test.ts` (3), `tests/island-pages.test.ts` (4), `tests/island-runtime.test.ts` (8, the page scripts in a `jsdom` window), `tests/islands.test.tsx` (24, error states 8 to 12 and 16 with the WebView mock in `__mocks__/react-native-webview.tsx`). Jest: 369 pass.
- **D. Probe card.** Native, with `parseProbeDoneInput`. Each strand uses the slice A renderer.
- **E. Plan graph.** `react-native-svg` with the shared layout from slice 0. The transcript gets the one-color block, the Plan sheet gets the graph with statuses. The list stays in the Plan sheet.
- **F. Acceptance.** Jest for each slice and each error state. Maestro screenshots of a scripted lesson with Markdown, code, math, Mermaid, the probe card and the plan.

New native modules: `react-native-svg`, `react-native-webview`, `expo-clipboard`. Add them with `npx expo install`. They need a new dev build.

**Error states.** Each one gets a clear message (`userMessage`) and a test.

1. Unclosed fence or partial Markdown while a reply streams: a code block that is still in progress. Raw Markdown does not flicker on screen.
2. The renderer throws on a message: an error boundary shows that message as plain text (`teacherText`). The rest of the transcript still shows.
3. Unknown code language: a plain mono block with line numbers and no colors.
4. The highlighter fails, or the code is longer than a size limit: a plain block. The app does not freeze.
5. Remote images: blocked, with "[Image blocked: alt]", as on the desktop.
6. Links: only `http`, `https` and `mailto` open. Other schemes show as text. A link that does not open: "Could not open the link."
7. Raw HTML in the text: shown as text, never run.
8. A math error, or the island does not load: the TeX source in mono and "The phone cannot show this formula."
9. A Mermaid parse error or a time-out: "The phone cannot draw this diagram.", the source folded, and Try again.
10. The WebView process stops: load it again one time, then use the fallback of 8 or 9.
11. The island's height message is missing or wrong: a minimum height, and the content scrolls inside it.
12. The island tries to open a page: blocked. No network (CSP). Model text goes in only as escaped data.
13. `probe_done`:
    - Still writing: "Writing the assessment…"
    - Malformed (`output-error`): "The assessment was malformed. The teacher sent a corrected one."
    - Refused (`ok: false`): "The teacher retried with a corrected assessment." The desktop shows the raw `output.error`; the phone does not (`AGENTS.md`, "Error states").
    - No strands: the summary only.
14. Plan graph: the layout throws, so the Plan sheet shows the list only; an edge to a missing node is dropped; a cycle draws each node one time; a wide graph scrolls inside its block.
15. Wide tables or long code lines scroll inside the block. The page never scrolls sideways.
16. The light or dark mode changes: the code colors and the Mermaid theme draw again.
17. Copy fails: "Could not copy." Copy never copies a blocked image URL or a raw tool record.

Acceptance: golden-fixture sessions render without errors; each error state above has a Jest test; Maestro screenshots of the scripted lesson; the user checks one real lesson on the Simulator.

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
- App icon and splash screen: the app still uses the Expo starter images (`assets/images/icon.png`, `assets/expo.icon`, `assets/images/splash-icon.png` on blue `#208AEF`). Replace them with LearnHarness images (ask the user which ones).
  Acceptance: screenshots of the same session on the desktop and the phone side by side, approved by the user; screen tests still pass.
- Inline code: decide between the native band (color and background only) and a `View` inside the text (rounded and padded, but it cannot break across lines). See issue 05, "Accepted limit". Show the user Simulator screenshots of both.

## 19 Visual and demo artifacts `todo`

Blocked by: 05. Split from issue 05 (user decision 2026-11-14).

- Visual (SVG) and demo artifacts through `POST /api/chats/:id/artifact-ui` (the gateway allows it) in a sandboxed WebView inside the lesson.
- Until this issue is done, an artifact shows as a placeholder row: "Interactive demo. Open it on the Mac."
- Needs its own security review before code: the sandbox, no network, no access to the device token or the pinned fetch, no navigation out of the WebView.
- List the error states here before the code (`AGENTS.md`, "Error states").
  Acceptance: a scripted lesson with one SVG artifact and one demo artifact renders on the Simulator; each error state has a test.
