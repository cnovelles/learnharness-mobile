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

## 05 Rich rendering `done`

Blocked by: 03.

- Markdown, KaTeX math, code, Mermaid.
- Found in the issue 04 acceptance check (user screenshots of the desktop are the reference):
  - Teacher text shows raw Markdown on the phone: `## Step 1`, `**bold**`, `*italic*`, `- ` lists and backticks.
  - Code fences need a code block as on the desktop: a dark block with line numbers and syntax colors. Inline code (`true`, `count`) in small mono boxes, also in question options.
  - The `probe_done` call shows as a plain "Tool: probe_done" line. The desktop shows a "Probe concluded: your assessment" card with one block for each strand.
  - The lesson plan: the desktop draws the plan as a graph with arrows (prerequisites). The phone has only the list in the Plan sheet.
- Visual (SVG) and demo artifacts moved to issue 19 (user decision 2026-11-14).
- User feedback 2026-11-16 (real iPhone): code blocks, Mermaid charts, graphs and tables often need a sideways scroll. The user wants them to fit the screen width, shrunk if necessary, with a way to zoom into a part. Mockups first (options for fit and for zoom), then build.
- Wide-content decisions (user, 2026-11-16, from mockups at the SE width; A for all four):
  1. Code: wrap long lines at the normal text size. A wrapped line continues under itself; the line number shows only on its first part. No sideways scroll.
  2. Tables: fit the width. The text shrinks a little (to 13 pt at the smallest), then the words in each cell wrap. Not cards.
  3. Mermaid charts and plan graphs: always fit the width, with no minimum text size. Zoom gives the detail.
  4. Zoom: a corner button (expand icon) on each wide block opens a full-screen viewer: pinch, drag, double-tap to zoom in or back to fit, sharp text at each zoom, landscape allowed. Code opens in the viewer with no wrap. Not a tap or a long press on the block (a tap on the Plan block opens the Plan sheet; a long press copies).

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
  - **Done (2026-11-15). Simulator check passed** with the scripted Mac (`LH_E2E_RICH=1 npm run e2e:mac`, then `npm run e2e:teach`; the rich text now also has inline math with a link, a formula that KaTeX cannot draw, a good Mermaid chart and a broken one).
    - Hermes check: `scripts/hermes-run/run.sh <entry>` (`npm run hermes:run`) bundles a file with the fork's esbuild and runs it on the app's own Hermes VM (`scripts/hermes-run/host.cpp`). KaTeX 0.18.2 gave byte-identical output on Hermes and Node for 140 renders (70 formulas, inline and display, 24 errors on both). One render takes about 0.7 ms on Hermes.
    - Pages: `scripts/island-pages/build.cjs` builds `.cache/island-pages/islands.js` (not in git) from the fork's files. Metro (`metro.config.js`, module name `lh-island-pages`) and Jest (`tests/setup/esm-to-cjs.cjs`, `moduleNameMapper`) call it; it builds again only when an input is newer. The HTML has no script: the CSP is `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'`. The page script (`common.js` with `math-runtime.js` or `mermaid-runtime.js`) and `mermaid.min.js` go in through `injectedJavaScript`, which WebKit runs outside the page CSP (checked on the Simulator). The data goes in through `injectedJavaScriptBeforeContentLoaded` as a JSON literal (`islandDataScript`: `window.__lhIslandData = {…}`, with `<`, `>`, `&`, U+2028 and U+2029 as `\uXXXX`). The Mermaid script is written ASCII-only (`\uXXXX`), because Hermes keeps a string with one non-ASCII character as UTF-16: the iOS bundle is 14 MB (9.5 MB before slice C; 17 MB without the escape).
    - App side: `src/lib/math-html.ts` (`renderTex` with `throwOnError`, `trust: false`, `strict: "ignore"`; `paragraphIsland`, `mathBlockIsland`; links get `data-link` indexes and no `href`), `src/lib/island-messages.ts` (`parseIslandMessage`), `src/components/web-island.tsx` (lockdown, height, reload), `src/components/islands.tsx` (`MathIsland`, `MermaidIsland`), `src/components/island-viewport.tsx` (near the screen; the session screen gives the viewport), `src/components/copy.tsx` (copy helpers moved out of `markdown.tsx`), `src/lib/open-link.ts`. A live math island gets new text with `postMessage` while a reply streams, so it does not load again for each word. A heading or a table cell with math still shows the TeX source in mono.
    - Tests: `tests/math-html.test.ts` (11), `tests/island-messages.test.ts` (3), `tests/island-pages.test.ts` (4), `tests/island-runtime.test.ts` (8, the page scripts in a `jsdom` window), `tests/islands.test.tsx` (27, error states 8 to 12 and 16 with the WebView mock in `__mocks__/react-native-webview.tsx`). Jest: 372 pass.
    - Seen on the Simulator: the display formula and the inline math paragraph draw with KaTeX; the broken formula shows its source in mono with "The phone cannot show this formula."; the good chart draws; the broken chart shows "The phone cannot draw this diagram.", Show the source and Try again; a long press on the formula copies the TeX (`xcrun simctl pbpaste`); a hold and drag that starts on the chart copies nothing; a tap on the link in the math paragraph opens it; dark mode draws the formula in light text and the chart in Mermaid's dark theme.
    - Found and fixed in the check:
      1. react-native-webview 14.0.1 on iOS puts the JSON of `injectedJavaScriptObject` inside a JavaScript template literal with no escaping. A backslash or a newline broke the JSON (every island said "data"), and a backtick or `${` in model text would run as code in the page. The island no longer uses that prop (regression tests in `tests/islands.test.tsx`).
      2. The session screen scrolled to the end on each content size change. An island that starts near the screen changes its height, so a reader who scrolled up was pulled back to the end. It now follows new content only when the reader is at the end (`isAtEnd`, 80 pt).
      3. The long press: React Native sees no touches over a WebView (a `Pressable` around it never fired), and when the transcript takes over a drag, WebKit can send the page no `touchcancel`, so a 500 ms timer in the page copied during a scroll. The page now sends `longpress` on `touchend` after a still hold of 500 ms or more.
    - Simulator tool: the first screenshot after a swipe can be an old frame. Take a second screenshot before you tap by coordinate.
- **D. Probe card.** Native, with `parseProbeDoneInput`. Each strand uses the slice A renderer.
  - Decisions (user, 2026-11-15, from mockups):
    1. Layout A, as on the desktop: a folded card "PROBE ASSESSMENT · N strands". A tap on the header opens one block for each strand (the name, then the assessment) and the summary last. The open state is local to the card (not kept).
    2. The notes use the word "prober", as on the desktop.
    3. A long press on the card header copies the assessment as Markdown: each strand as a bold name and its text, then the summary. The same "Copied" label as the other blocks. Never the raw tool record.
  - Fact: the schema has `minItems: 1` for `strands`, so an empty list does not parse. The server refuses such a call (`output-error`).
  - **Done (2026-11-15). Simulator check passed** with the scripted Mac (`LH_E2E_RICH=1 npm run e2e:mac`, then `npm run e2e:teach`; the prober now sends a `probe_done` that the Mac refuses, then a rich assessment with 3 strands: bold, italic, inline code, a literal `\n\n`, inline math and a summary).
    - Code: `src/lib/probe-card.ts` (`probeCardData` reads the part in the desktop's order with the shared `parseProbeDoneInput`, now exported in `src/lib/shared.ts`; `PROBE_NOTE`; `probeMarkdown` for copy), `src/components/probe-card.tsx` (`ProbeCard`), a `probe` row in `src/lib/transcript.ts`. The strand text goes through `teacherText`, then the slice A `Markdown` (math islands work inside a strand).
    - Tests: `tests/probe-card.test.tsx` (20: the rows from native records, error state 13 with all 4 notes, the fold, Markdown in the strands, copy, VoiceOver, copy failure, a strand whose renderer throws).
    - Seen on the Simulator: the malformed note, the folded card "3 strands ▸", the open card with all strand formats and the KaTeX island, the summary last, dark mode, a long press copies the Markdown (`xcrun simctl pbpaste`) and leaves the card open or folded.
    - Found and fixed in the check:
      1. A strand name with its own bold gave broken Markdown in the copy (`**The Moon's **gravity****`). `probeMarkdown` now removes `**` and `__` inside the name.
      2. The transcript stopped following new content at the end (the Maestro step "Check your understanding" failed; the check card stayed under the screen). The app's own animated `scrollToEnd` sends scroll events, and a middle frame after an island grew was not at the end. Now only the reader's own scroll changes the decision: a drag, its momentum, or a tap on the status bar (`createEndFollow` in `src/components/island-viewport.tsx`, a test in `tests/islands.test.tsx`). After the fix, `npm run e2e:teach` passes from start to end.
      3. Second round (user check, 2026-11-15): on iOS the app's own animated scroll also sends `onMomentumScrollEnd`, so the follow stopped again. Now only a drag starts a reader scroll (`dragStart`), and the momentum after it ends it; a drag with no speed ends it at once.
      4. Table columns (user check): the width was a guess from the character count, and a blocked image counted as 0 characters, so "[Image blocked: moon]" wrapped letter by letter. A hidden layer now measures each cell on one line (`onLayout`); each column is as wide as its widest cell, up to 240 pt, then words wrap. The guess (now with the shown image label, `shownText`) is used only until the measure comes.
      5. Centering (user check): the Mermaid chart sat at the left edge of its island (`#root svg` now has `margin: 0 auto`), and a narrow table sat at the left (its sideways scroll now centers the content; a wide table still scrolls from the left edge).
    - Spacing scale (user request and decision, 2026-11-15, from mockups): option A, a 4-point grid, spacing only (font sizes and corner radii stay until issue 18). `src/components/spacing.ts` (`SPACE`: xs 4, sm 8, md 12, lg 16, xl 24, xxl 32). Every padding, margin and gap in `src/` now uses a `SPACE` name (12 files; old values mapped to the nearest step: 2–4 → xs, 6–8 → sm, 10–14 → md, 16 → lg, 32 → xxl). Sizes such as `minHeight` stay. ESLint `SPACING_RULES` (`eslint.config.js`) blocks a number in a padding, margin or gap (0 is allowed). Points, not percentages: iOS points already match each screen's density, and text does not grow with the width. Format, lint, typecheck and Jest (395) pass. **Simulator check passed (2026-11-15)** on an iPhone SE (3rd generation, 375 x 667 pt, iOS 26.5) and the iPhone 17 Pro Max (440 pt, iOS 26.3): `npm run e2e:teach` passes on both; the pairing screen, the home screen, the session screen (rich blocks, the probe card open, the answered card), the Plan sheet and Settings fit with no overlap. Wide tables and long code lines scroll inside their block (error state 15).
      - Found and fixed in the check: (1) on the SE the six confidence stops wrapped ("100%" on a second line); they are now one row of equal stops, and the text shrinks to fit with a large text size. (2) The dev build's warning toast covered "Send answer" on the SE (see the PRD facts); the fork's require cycles and one React Native warning no longer show it.
- **E. Plan graph.** `react-native-svg` with the shared layout from slice 0. The transcript gets the one-color block, the Plan sheet gets the graph with statuses. The list stays in the Plan sheet.
  - Decisions (user, 2026-11-15, from mockups; A for the first three, B for the fourth):
    1. The transcript block is the one-color graph at full width, as on the desktop (no statuses). A tap opens the Plan sheet.
    2. The Plan sheet shows the graph on top and the list under it, in one scroll.
    3. The sheet graph uses the desktop status colors: done in the strong line ink, the current step with a faint yellow glow, upcoming in gray (also the arrows that touch an upcoming step). The list keeps its colors until issue 18.
    4. A wide plan shrinks to fit the width down to a minimum text size, then scrolls sideways. In the Plan sheet the graph also has pinch zoom and drag (as the desktop popup).
  - **Done (2026-11-15). Simulator check passed** on the iPhone 17 Pro Max and the iPhone SE (3rd generation): `npm run e2e:teach` passes on both, the transcript block, the Plan sheet graph, pinch zoom, drag and dark mode were checked by hand.
    - `src/lib/plan-graph.ts` (pure): `planGraph(tree, pad)` runs the shared `blockLayout`, `wrapTitle` and `edgePathD` and gives boxes, text lines and edge paths, or null when the layout throws. A repeated step id keeps its first title; self and repeated edges are dropped. `graphScale`: the node text is 11 units; the scale is at most `TEXT_CAP_SCALE` (as the desktop) and at least 10 pt text (`MIN_SCALE`). The pinch and drag math has the desktop popup rules (`components/pan-zoom.ts`: the fit is the floor, a drag stops at the edges, a pinch keeps the point under the fingers, zoom up to 4) as a viewBox window: `fitViewport`, `pinchViewport`, `panViewport`, `canPan`, `viewWindow`.
    - `src/components/plan-graph.tsx`: `PlanGraph` (react-native-svg: rectangles with no corner rounding, the desktop arrowhead as a `Marker`, the blurred yellow glow with `FeGaussianBlur`, which works on iOS). `PlanBlock` (the transcript row: the one-color graph in a sideways scroll view, the tap target inside it; the text card when the layout fails). `PlanSheetGraph` (the graph above the list; pinch and drag with react-native-gesture-handler `usePinchGesture` and `usePanGesture` on the JS thread, two nested detectors with `simultaneousWith`; the list stops its scroll while a gesture runs). `src/components/plan-sheet.tsx` has a `GestureHandlerRootView` inside the modal.
    - Tests: `tests/plan-graph.test.tsx` (27: geometry, error state 14 with a layout that throws, a dangling edge, a cycle, repeated ids and edges, the scale range and a wide graph, the one-color block, the statuses and the glow, error state 16, the sheet with the graph and with the list only, the pinch and drag math). `tests/setup/gestures.ts` gives the gesture library no Reanimated in Jest. Jest: 422 pass.
    - Found and fixed in the check:
      1. The first version used the iOS zoom scroll view. iOS scales the drawn picture, so the graph was blurred at 4x. Now the SVG keeps the size of its frame and the zoom changes its viewBox: the text stays sharp at each zoom.
      2. A JS `PanResponder` got no gesture in the sheet: the SVG kept the JS responder, and the native scroll view of the list cancelled the touches. Native recognizers (react-native-gesture-handler) fix this.
      3. react-native-svg kept the old fill of a `Rect` and a `Text` in a `G` when only the color changed (dark mode drew white boxes). The SVG now has a key from the mode and the statuses, so a change draws a new SVG.
- **F. Acceptance.** Jest for each slice and each error state. Maestro screenshots of a scripted lesson with Markdown, code, math, Mermaid, the probe card and the plan.
  - **Done except the user check (2026-11-15).**
    - Jest: each of the 17 error states has a test (the test names start with the state number, in `tests/markdown.test.tsx`, `tests/code-highlight.test.ts`, `tests/math-html.test.ts`, `tests/island-messages.test.ts`, `tests/island-runtime.test.ts`, `tests/islands.test.tsx`, `tests/probe-card.test.tsx` and `tests/plan-graph.test.tsx`). New: `tests/golden-transcript.test.tsx` (7). The fork's 2 recorded sessions go through `projectView`, `transcriptRows` and `Transcript` with no plain fallback, no failure note, no raw record and no console error; the recorded plan draws as a graph and the recorded `probe_done` as the folded card. The fork's tool-rendering regressions (model text with math and escapes) draw as Markdown with no fallback. Jest: 429 pass.
    - Maestro: `e2e/rich-lesson.yaml` (`npm run e2e:rich -- --device <udid> --test-output-dir e2e/screenshots/<phone>`) runs the teach flow, then takes 7 screenshots: the probe card open, the plan block, Markdown and code, the table, math, Mermaid (the good chart and the broken one), and the Plan sheet graph with the glow. Maestro puts them in `<dir>/<run>/rich-lesson/takeScreenshot/` (not in git). It passes on the iPhone SE (3rd generation) and the iPhone 17 Pro Max. `scripts/e2e-test.sh` now passes extra Maestro options.
    - Flow facts: Maestro reads a text selector as a regex that must match the whole text (write `.*Image blocked: moon.*`, not `[Image blocked: moon]`). Maestro counts an element under the composer as visible, so a tap on it can hit the composer: move the target into the top half of the screen first.
    - Seen on the SE: the Mermaid chart is wider than the screen; it keeps its text size and scrolls sideways inside its island (checked by hand), as designed (error state 15).
    - CI: the first session screen test in `tests/app-session.test.tsx` took more than 5 s on the CI runner (about 1 s on the Mac), because it loads the whole rich renderer. The file now has a 20 s limit.
    - Done (2026-11-17): the user checked real lessons on the iPhone (Release build with `8c452a0`): the rich blocks and the wide content viewers. Claude cannot run a real lesson alone: it needs a model sign-in or an API key, and no key or local model is on this Mac (checked 2026-11-15).

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
    - Malformed (`output-error`): "The assessment was malformed. The prober sent a corrected one."
    - Refused (`ok: false`): "The prober retried with a corrected assessment." The desktop shows the raw `output.error`; the phone does not (`AGENTS.md`, "Error states").
    - Finished (`output-available`, `ok: true`) but the input does not parse: "The phone cannot show this assessment." (The desktop shows "Writing the assessment…" here.)
    - No summary: the strands only. An empty strand list does not parse (see the fact above).
    - The renderer throws on one strand: the slice A error boundary shows that text plain; the other strands still show.
14. Plan graph: the layout throws, so the Plan sheet shows the list only; an edge to a missing node is dropped; a cycle draws each node one time; a wide graph scrolls inside its block.
15. Wide tables or long code lines scroll inside the block. The page never scrolls sideways.
16. The light or dark mode changes: the code colors and the Mermaid theme draw again.
17. Copy fails: "Could not copy." Copy never copies a blocked image URL or a raw tool record.

Acceptance: golden-fixture sessions render without errors; each error state above has a Jest test; Maestro screenshots of the scripted lesson; the user checks one real lesson on the Simulator.

### Loading states: top-to-bottom reveal (2026-11-15)

- User decision 2026-11-15 (after animated examples of 4 options): the transcript shows top to bottom. A block shows only when it and every block above it are drawn, so content grows only at the bottom and nothing pushes the text. The block at the front waits at most 1.5 s (`REVEAL_LIMIT_MS`); then it shows its own loading box and the blocks under it go on.
- Code: `src/lib/reveal-gate.ts` (the order and the time limit, pure), `src/components/reveal.tsx` (`RevealProvider` in the session screen, `RevealSlot`, `RevealScope` for a text row, `useReportReady`). A text row is one slot for each top-level Markdown block; every other row is one slot. A hidden slot stays mounted in its place with no height, so its island loads and measures itself. A block that was hidden fades in (200 ms; none with Reduce Motion).
- Reporters: `MathIsland` (first height), `MermaidIsland` (drawn or failed; a streaming fence is ready), the Markdown table (measured columns), `PlanBlock` (width). A far island counts as ready (it loads later); `useNearScreenState` tells "not measured yet" from "far".
- A formula that is not drawn yet shows a quiet box with the size of its text, never the TeX source. The source shows only for a formula that cannot load or that KaTeX cannot draw (error state 8).
- Tests: `tests/reveal-gate.test.ts`, `tests/reveal.test.tsx`; the screen tests set the limit to 0 (Jest has no layout). Simulator: `npm run e2e:rich` passed on the Pro Max and the SE; a frame series of a session open shows the top-to-bottom growth with no jumps.

### Wide content: fit and zoom (2026-11-16)

User decisions: see "Wide-content decisions" at the top of this issue (A for all four).

Slices:

- **A. Fit.** Code: one row for each source line (the number and the wrapped text), no sideways scroll. Tables: `fitColumns` (pure, `src/lib/table-fit.ts`): the measured one-line widths; when they are wider than the block, the text shrinks to 13 pt at the smallest, then narrow columns keep their width and the wide columns share the rest (their words wrap). Mermaid: the chart takes the island width (`width: 100%`, never wider than its natural size). Plan block: always fit (no 10 pt floor in the transcript; the Plan sheet keeps its floor).
- **B. Viewer shell.** `ExpandButton` (top right of a code block, a table that was shrunk or wrapped, a drawn Mermaid chart, a plan block, a display formula wider than the block). `ZoomViewer`: a full-screen modal with Close, the block kind, Fit and Copy.
- **C. Native zoom** (code with no wrap, tables at their natural widths, the plan graph): the zoom math of the Plan sheet moves to `src/lib/zoom-viewport.ts` (fit is the floor, zoom up to 4, drag stops at the edges, pinch keeps the point under the fingers) plus double-tap (zoom to 2.5 at the point, or back to the fit). Code and tables draw again at the new text size when a pinch ends (sharp text); during the pinch a transform shows the change. The plan graph keeps the viewBox zoom.
- **D. Web zoom** (Mermaid and math): the island page in a viewer variant with WebKit's own pinch zoom (`user-scalable=yes`, up to 4). WebKit draws the vector again at each zoom (sharp). Check double-tap on the Simulator.
- **E. Landscape in the viewer.** `expo-screen-orientation`: the app stays in portrait; the viewer unlocks while it is open. `app.json` orientation `default`. Native change: new dev builds on both Simulators and a new Release build.
- **F. Acceptance.** Jest for each slice and each error state; `e2e/wide-content.yaml` (Maestro) screenshots of the fitted blocks and the viewer on the SE and the Pro Max; the user checks on the iPhone.

Error states (each has a message or a clear behavior, and a test):

- W1. A fence that is still open (streaming): the code wraps as it grows; no expand button until the fence closes. A streaming Mermaid fence has no button.
- W2. The table is not measured yet: the first guess of the widths, fitted the same way; no button until the measure comes.
- W3. A word longer than its column: it breaks inside the word (iOS does this); the table never scrolls sideways.
- W4. The viewer's island cannot load or draw: "The phone cannot draw this diagram." (or "… show this formula.") in the viewer, with Close.
- W5. The plan layout fails: the text card, no button (as error state 14).
- W6. Very large code (over the highlight limit): plain text in the block and the viewer; the viewer still zooms.
- W7. The screen turns while zoomed: the viewer goes back to the fit for the new size.
- W8. The orientation lock fails (the module throws): the viewer stays in portrait and still works. The error goes to the console, never to the screen.
- W9. The block changes while the viewer is open (a new streamed text): the viewer keeps the content it opened with.
- W10. The page never scrolls sideways (error state 15 stays true, now with no scroll inside the blocks either).

State (2026-11-16):

- A to E done in code. `src/lib/table-fit.ts`, `src/lib/zoom-viewport.ts` (moved from `plan-graph.ts`, which re-exports it; plus `doubleTapViewport`), `src/components/zoom-viewer.tsx` (`ExpandButton` with test id `md-expand-<kind>`, `ZoomViewer`, `NativeZoomPane`), `src/components/viewer-orientation.tsx`. `CodeLines` in `markdown.tsx` (one row for each line; `codeWidth` uses the JetBrains Mono advance 0.6 em). `TableRows` is shared by the block and the viewer. The island pages have viewer variants (`MATH_VIEWER_HTML`, `MERMAID_VIEWER_HTML`, viewport `maximum-scale=4, user-scalable=yes`; `fitToScreen` in `common.js`); the math page sends `{type:"wide"}` for a display formula wider than the island. `WebIsland` has a `fill` mode.
- Native change: `expo-screen-orientation` (plugin `initialOrientation: PORTRAIT_UP`), `app.json` orientation `default`, `ios.requireFullScreen: true`. The prebuild gives the four orientations in Info.plist; the ATS "pinned" policy, the mic and local-network keys stay.
- The rich lesson (`LH_E2E_RICH=1`) now has a 4-column table and a wider Mermaid chart. New flow: `e2e/wide-content.yaml` (`npm run e2e:wide`).
- Builds: the new dev build is on both Simulators (2026-11-17). No native change since then.
- F done (2026-11-17): `npm run e2e:wide` passes on the Pro Max and the SE (13 screenshots each; contact sheets in `e2e/screenshots/sheets/`, not in git). Maestro 2.12.1 accepts `setOrientation` and `doubleTapOn`. The run found and fixed:
  - The double-tap never worked. The gesture handler waits only 200 ms for the second tap on iOS (the docs say 500). Maestro's gap is 253 ms. Now `maxDelay: DOUBLE_TAP_MAX_DELAY_MS` (350, in `zoom-viewport.ts`).
  - The Mermaid chart was smaller in the viewer than in the lesson: `width: 100%` in the flex-centered page gave WebKit's default 300 px. The viewer SVG now has its natural width; `#root { margin: auto; }` centers it and keeps a zoomed chart reachable on the left.
  - WebKit has no double-tap zoom on a `width=device-width` page, and its `dblclick` missed some slow double-taps. `zoomOnDoubleTap` in `common.js` uses the native rule (second press at most 350 ms after the first release, within 30 px) and CSS zoom (2.5 times the fit, around the tapped point, then back to the fit). The app sends `doubleTapZoom` and `doubleTapMs` in the viewer data (`WebViewerPane`). `touch-action: manipulation` keeps WebKit's own double-tap off.
- Code viewer fit (user decision 2026-11-17, from mockups; this changes decision 4 for code): option B. At the fit the code text is 11 pt at the smallest (`CODE_VIEWER_MIN_SCALE` in `markdown.tsx`); a longer code line goes past the edge and a drag moves it. A comment line is text: it wraps at its words to the screen width of the fit, and the line number shows only on its first part. A comment at the end of a code line stays on that line (user choice: "End comments stay"). The lesson block keeps its wrap of all lines.
  - Code: `src/lib/code-comments.ts` (`commentLines`, pure: `//` and `/* */` in C-family languages, `#` in shell, Python, YAML and more, `--` in SQL and Lua; with no language or an unknown one, `//` and `# `). `codeWidth` skips the comment lines. `NativeZoomPane` has `minBase` (the fit floor) and `fillWidth` (the content is at least the frame width, so short code does not center); `render(scale, screenWidth)` gets the frame width of the fit. `CodeLines` has `wrapRows` and `rowWidth`.
  - Simulator: `npm run e2e:wide` passes on the SE and the Pro Max with this change. On the SE the comment wraps in two rows and the code goes past the edge at 11 pt. One SE run of three missed Maestro's double-tap (the screenshot after it did not change); the other two zoomed. Check the double-tap by hand on the iPhone.
- Release build with `8c452a0` installed on the iPhone over Wi-Fi (2026-11-17).
- User check on the iPhone (2026-11-17): "the zoom feature works well". The user first saw no sideways drag at the fit, then said it is probably not a bug. On the SE Simulator a drag at the fit moves a long code line with no zoom (new step `08b-code-drag` in `e2e/wide-content.yaml`, `9c68e0b`). On the iPhone 13 Pro Max (428 pt) the code of that lesson probably fit at 11 pt, so nothing was past the edge.
- User check on the iPhone, part 2 (2026-11-17): all pass. A drag at the fit moves a code line longer than the screen. The Mermaid and math viewers zoom, drag and go back with Fit. A turn while zoomed goes back to the fit for the new size, and the page never scrolls sideways. Copy gives the full code with no line numbers.
- Wide content is done (2026-11-17), and with it issue 05.
- Tests: `tests/table-fit.test.ts`, `tests/zoom-viewer.test.tsx` (W1, W2, W4, W5, W7, W8, W9, the double-tap delay, the viewer data, the 11 pt floor and the comment wrap), `tests/code-comments.test.ts`, page-script tests in `tests/island-runtime.test.ts` (also the page double-tap and the viewer CSS), `tests/helpers/code-text.ts`. Jest 617.

## 06 Practice on the phone `done`

Blocked by: 04.

- New practice session; `problem` dock with thinking submissions; `conclude` with solution reveal; Next problem; dismiss.
  Acceptance: Maestro E2E for one practice problem with the fake provider.

### How the desktop does it (fork, read 2026-11-15)

- Start: `POST /api/chats` with `kind: "practice"` (fork `components/home.tsx`, `new-session.tsx`). Graph picks (`graphContext`) come with issue 08 (graph list). The phone starts practice from text only.
- The practice agent has two tools (`src/agent/tools/practice.ts`): `problem` (statement, mode, target, modelSolution; it ends the turn) and `conclude` (outcome, verdict, rung, missClass, retest). Only one problem can be active. `activeProblemOf` (shared) is the gate.
- The dock (`components/practice-dock.tsx`): an active problem replaces the composer. "PROBLEM" eyebrow and the statement (Markdown and math), then "YOUR THINKING" field and "Submit thinking". It sends `{ type: "thinking", problemCallId, text }`. Each submission starts a turn. The model solution is never shown before `conclude`.
- Transcript (`components/practice-cards.tsx`, `src/core/view.ts`): `tool-problem` (problem card), `data-practice-thinking` (thinking row), `tool-conclude` (eyebrow "CONCLUDED", outcome chip, verdict at 50%, "MODEL SOLUTION" from `part.reveal`, and a "METADATA" box: mode, targets, outcome, hint rung, miss class, retest). Outcome "dismissed" shows only "Problem dismissed." `data-practice-next` shows a centered "→ NEXT PROBLEM" line.
- Next problem (`components/composer.tsx`, `chat.tsx` `nextReady`): in the practice pause (practice kind, no problem, no question, no turn, no compaction, at least one problem posed), an empty composer shows a green "NEXT PROBLEM →" button. It sends `{ type: "next" }`. Text in the field makes it the normal send again.
- Dismiss: Esc and a confirm on the desktop. `SessionModel.dismissProblem` adds the `problem-dismissed` marker and calls `POST /api/chats/:id/dismiss` with `dismiss-problem` (the gateway allows it). No turn starts. During a turn, the desktop also stops the turn (the Mac parks the dismissal and answers 202).
- Plugin problems (`pluginProblem`) need plugins. The gateway refuses plugin routes, so the phone does not run them.

### Slices

- A. Start a practice session: a second "New practice" button on the home screen, next to "New session" (user decision 2026-11-15, option B). It opens the new-session screen in practice mode (title "New practice", "What do you want to practice?", "Start practice"). The screen has no switch.
- B. Transcript rows: problem card, thinking row, conclude card with outcome chip, verdict, model solution and metadata, the dismissed line, the Next problem line. Golden transcript test. Metadata: a tap on "METADATA" opens the rows inside the card, a second tap closes them (user decision 2026-11-15, option A).
- C. Practice dock: statement, thinking field, Submit thinking, Dismiss with a confirm, the waiting states. A long statement scrolls inside the dock at a maximum of about 35% of the screen height. A chevron collapses the dock to a slim "PROBLEM · statement…" bar; a tap on the bar opens it again, and the thinking text stays (user decision 2026-11-15, option A). Dismiss: a quiet "Dismiss" text button in the PROBLEM row opens an iOS alert (Cancel / Dismiss) (user decision 2026-11-15, option A).
- D. Next problem button in the practice pause: a wide green "NEXT PROBLEM →" button over the composer (user decision 2026-11-15, option B). The composer stays, so a question about the last problem is also one tap. The rule is the desktop's `nextReady`; the button waits while the Mac compacts. Done.
- E. Fake Mac practice script, Maestro flow `e2e/practice.yaml` (pose, thinking, conclude, Next problem, second problem, dismiss), screenshots on the SE and the Pro Max. Done.

### State (2026-11-15, after slices D and E)

- Done: slices A (`aefab87`), B (`2def412`), C (`b6a7516`), D (`bff1b1a`) and E (the slice E commit). Jest 505 pass; format, lint and typecheck are clean.
- Slice D: `nextReady` and `sendNext` in `use-session.ts` (a refused or lost `next` is unsent, so Try again sends it again or reads the session); `NextProblemButton` in `src/app/session/[id].tsx`.
- Slice E: the practitioner script in `scripts/e2e-mac.ts` (`PRACTICE`: pose, conclude, closing words, a second problem, a third problem). `e2e/practice.yaml` (`npm run e2e:practice`) passed on the SE and on the Pro Max. Contact sheets: `e2e/screenshots/practice/se.png` and `promax.png` (the folder is not in git).
- Found in the Simulator check and fixed: the header showed the phase ("PROBING") in a practice session. It now shows the desktop's "PRACTICE" tag with a dumbbell.
- Desktop parity, not a bug: "Problem dismissed." shows only after the next input. The Mac adds the dismissed conclusion with that input (fork `view.ts`, `problem-dismissed` is UI-only). The flow checks it after the next Next problem.
- Maestro note: on the first Pro Max run the pairing text did not reach the field (no request was sent, so the code stayed unused). The second run with the same test Mac passed.
- No native change: the dev builds on both Simulators are still current.
- User check fix: after Dismiss, a fast Next problem reached the Mac before the dismissal (the first dismiss request on `next dev` compiles its route), and the Mac said a problem was still active. Next problem now waits until the Mac accepts the dismissal (`dismissing` in `use-session.ts`).

### Error states

| State                                                                        | What the learner sees                                                                                                                                                         | Test                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| The Mac refuses the new practice session (no model set, server error)        | The New session error banner from `describeError`. The text stays.                                                                                                            | Jest, new-session screen         |
| The Mac refuses a thinking submission (the problem is no longer active, 409) | The thinking text stays in the field. Banner: "This problem is not active anymore. Read the session again." with Try again (sync).                                            | Jest                             |
| Network loss while the thinking goes out                                     | The text stays in the field. The usual connection banner with Try again (resend).                                                                                             | Jest                             |
| The Mac compacts                                                             | Submit thinking and Next problem wait: "The Mac is making the history shorter…"                                                                                               | Jest                             |
| The turn after a submission fails                                            | The existing failed-turn banner with Try again (retry-turn). The problem stays active.                                                                                        | Jest                             |
| Dismiss fails (network, server error)                                        | Banner from `describeError` (never the raw "The dismissal failed (500)." text). The dock comes back after the sync.                                                           | Jest, `tests/user-error.test.ts` |
| A turn runs while a problem is active                                        | The dock hides and the composer shows (steer and Stop), as for a question. After the turn, the dock comes back with the thinking field and Dismiss.                           | Jest                             |
| Next problem refused (a turn or a problem is active on the Mac)              | Banner with Try again (sync).                                                                                                                                                 | Jest                             |
| Next problem while the dismissal is still on its way to the Mac              | Next problem waits (disabled) until the Mac accepts the dismissal. Without this, `next` can reach the Mac first and the Mac refuses it (found in the user's Simulator check). | Jest                             |
| A `problem` call with bad input (the agent gets an error and tries again)    | The quiet tool error row. No dock.                                                                                                                                            | Jest, transcript                 |
| A problem card or a conclude card with missing fields                        | The card shows what it has. No chip for an unknown outcome. Never raw data.                                                                                                   | Jest, transcript                 |
| A plugin problem (made on the Mac)                                           | Panel: "This problem uses a plugin. Work on it on the Mac." with Dismiss. No thinking field.                                                                                  | Jest                             |

## 07 Dictation `doing`

Blocked by: 04.

- On-device speech recognition into the active field (thinking, answer, reading thinking, composer). Default.
- Optional Deepgram: `GET /api/stt/token` through the gateway, WebSocket with the shared URL builder, native PCM capture.
  Acceptance: E2E injects an audio file and checks the text in the thinking field.

### Facts (2026-11-16)

- Desktop (fork `components/dictation.tsx`): Deepgram only. One primary target: the open question's field (text mode: the answer; select modes: "Your thinking"), else the composer. The text is deferred: the finals collect while you speak and go into the field once, when you stop. While it records, the desktop shows only a red Stop pill and a level meter (no live text). Esc cancels and drops the text. Deepgram: `nova-3`, `endpointing=300`, no interim results, token as WebSocket subprotocol `["bearer", token]`, `CloseStream` on stop, then a 3 s safety close. Language comes from the Mac setting `dictation.language` (`"en"` by default, `"multi"` possible).
- The gateway already allows `GET /api/stt/token` and `GET /api/settings`. No fork change is needed. The token route answers 503 when the Mac has no `DEEPGRAM_API_KEY`.
- iOS SDK 26.5 (checked in the swiftinterface): `SpeechAnalyzer`, `SpeechTranscriber`, `DictationTranscriber`, `SpeechDetector`, `AssetInventory` (model download: `status`, `assetInstallationRequest`), `supportedLocale(equivalentTo:)`, `bestAvailableAudioFormat`, and `start(inputAudioFile:finishAfterFile:)` (an audio file as input: the E2E path). All iOS 26 and later.
- The app supports iOS 16.4 and later. The user's iPhone has iOS 26.5.2.
- The iOS keyboard already has its own dictation mic. The app's button adds what the keyboard does not: no keyboard on screen, the meter, and one target as on the desktop.
- Community library `expo-speech-recognition` 58.0.1 (SFSpeechRecognizer) was looked at and not chosen.

### Decisions (user, 2026-11-16)

- Engine on the phone: Apple SpeechAnalyzer in our own Swift module (like `modules/pinned-fetch`), on the device only. On iOS 16–25 the app shows no on-device engine (the keyboard mic still works).
- Behavior as on the desktop: tap the mic, speak, tap Stop, the text goes into the target field once. No live text.
- Placement: option C. One mic button in the composer row, next to Send. While it records, the composer row shows Stop and the meter. The lesson screen hides the composer while a question or a problem is open, so each dock has the mic next to its main button (question: Send answer; practice: Submit thinking; reading: Open). One mic on screen at a time (user, 2026-11-16, after the dock mockup).
- Deepgram is part of issue 07 (not a later issue).
- The engine choice is a new "Dictation" section in the existing Settings screen: the engine, the language from the Mac, and the model state. Default: on this iPhone.

### Error states (each gets a user message and a test)

| State                                                                                           | Message and behavior                                                                                 |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Microphone access refused                                                                       | "Microphone access is off. Open Settings" (opens the app's iOS settings).                            |
| Speech recognition access refused (if SpeechAnalyzer needs it; slice A finds out)               | "Speech recognition is off for LearnHarness. Open Settings".                                         |
| iOS older than 26 with the on-device engine                                                     | The mic shows the reason: "Dictation on the iPhone needs iOS 26. Use Deepgram or the keyboard mic."  |
| The language has no on-device model                                                             | "The iPhone has no speech model for this language." The Settings section shows the same.             |
| The model download fails (no network)                                                           | "Could not get the speech model. Connect to the internet and try again."                             |
| The model download is canceled                                                                  | The row goes back to idle. No message.                                                               |
| No speech heard                                                                                 | "No speech heard." The field does not change.                                                        |
| An interruption (a call, Siri, another app takes the audio)                                     | The run stops and keeps the text so far.                                                             |
| The app goes to the background during a run                                                     | The run stops and keeps the text so far.                                                             |
| The target field goes away during a run (the question was answered on the Mac, the dock closed) | The text goes into the composer, not lost.                                                           |
| Deepgram: the Mac has no key (503)                                                              | "Dictation needs a Deepgram key on the Mac."                                                         |
| Deepgram: the Mac is not reachable                                                              | The normal connection message (`describeError`).                                                     |
| Deepgram: the token grant fails (502)                                                           | "Deepgram did not answer. Try again."                                                                |
| Deepgram: the socket fails or the network goes during a run                                     | The run stops and keeps the finals so far: "Dictation stopped: the connection to Deepgram was lost." |
| A second start while a run is on (double tap)                                                   | Ignored (one run at a time, a generation counter as on the desktop).                                 |

### Slices

- A. Spike: Swift module `modules/speech` with SpeechAnalyzer and SpeechTranscriber: permission, model status and download, start from the mic, levels, stop with the final text, start from an audio file. Check on the Simulator and on the iPhone. Record what needs which Info.plist key.
- B. TypeScript dictation core (pure, Jest): phases, generation counter, the target registry (dock field or composer), the deferred buffer, the error mapping to user messages.
- C. UI: the mic in the composer row, Stop and the meter while it records, the download row, the error line. Wire the targets (answer, thinking, reading thinking, practice work field, composer). Check on the SE and the Pro Max.
- D. Settings: the Dictation section (engine, language from the Mac, model state and download).
- E. Deepgram: native PCM capture and a native WebSocket in the Swift module, only to `wss://api.deepgram.com` (fixed in native code), token from the gateway through the pinned fetch. Update `docs/TRANSPORT-SECURITY.md` (a new network path: audit, guards, test).
- F. E2E: a Maestro flow that feeds an audio file (a dev-build-only input) and checks the text in the thinking field. Then the user's check on the iPhone.

### State (2026-11-16)

- A: done. `modules/dictation`: `DictationEngine.swift` (no Expo code; SpeechTranscriber where the device has it, else DictationTranscriber; model status and download; microphone and audio-file runs; RMS levels) and `DictationModule.swift` (permissions, audio session, interruptions, events with a run id). `npm run test:native-dictation` runs the engine on macOS with a `say` file. The engine logs facts (engine, locale, counts; never the text) with `os.Logger`, category `dictation`.
- Facts found: an Intel Mac has only DictationTranscriber (`SpeechTranscriber.isAvailable` is false). The iOS Simulator runs DictationTranscriber on a file but gives 0 finals (the same code on macOS gives the text). So the Simulator flow uses a scripted engine (`src/lib/dictation-scripted.ts`, dev builds only, `EXPO_PUBLIC_LH_E2E_DICTATION_TEXT`), and the native engine is checked on macOS and on the iPhone. `AVAudioApplication` needs iOS 17, so the module uses `AVAudioSession` for the permission (the pod targets iOS 16.4). A pod named `Speech` would hide Apple's `Speech` module: the pod is `Dictation`.
- B: done. `src/lib/dictation.ts` (phases, generation counter, deferred text, owner and orphan text, error codes to messages, a 5 s stop safety net), `src/lib/dictation-language.ts` (the Mac's `dictation.language`, the last known one offline, `multi` = the phone's language). Tests: `tests/dictation.test.ts`, `tests/dictation-language.test.ts`, `tests/dictation-scripted.test.ts`.
- C: done. `src/components/dictation.tsx` (MicButton, DictationRow with Stop and the meter, the download row, DictationProblemLine with Open Settings), `src/lib/dictation-context.tsx` (one controller; the app going to the background stops the run), `src/lib/native-dictation.ts` (the native module; tests mock it). The mic is in the composer, the question dock, the reading bar and the practice dock. `e2e/dictation.yaml` passed on the Pro Max and the SE before slices D and E.
- D: done. `src/lib/dictation-settings.ts` (the engine choice in the Keychain, key `lh.dictation.engine`, default on the iPhone), `src/components/dictation-settings.tsx` (the Dictation section in Settings: engine rows, the language from the Mac, the model state and a Download button). The model label "Downloaded" (not "On this iPhone", which is the engine's name).
- E: done in code. `modules/dictation/ios/DeepgramRun.swift` (socket only to `wss://api.deepgram.com/v1/listen` with the desktop's parameters, token as the `bearer` subprotocol, the system's certificate check, audio kept while the socket opens, `CloseStream` then a 3 s safety close), `MicrophoneCapture.swift` (shared by both engines), `startDeepgram` in `DictationModule.swift`, `src/lib/dictation-deepgram.ts` (the token from `GET /api/stt/token`; 503 = no key). Deepgram works on any iOS. Security: `docs/TRANSPORT-SECURITY.md` "Deepgram", and `tests/transport-security.test.ts` allows native network code only in `PinnedSession.swift` and `DeepgramRun.swift`. Checked on macOS: with `NSAllowsArbitraryLoads`, `performDefaultHandling` still refuses a self-signed certificate.
- Tests: Jest 575 (`tests/dictation*.test.ts`, `tests/app-dictation.test.tsx` with the fake Mac's `/api/settings` and `/api/stt/token`), `npm run test:native-dictation`, `npm run test:native-deepgram`. In a full parallel Jest run, `app-pairing`, `golden-transcript` and `markdown` can fail from load on this Intel Mac; they pass with `--runInBand`.
- F: done (2026-11-16). `npm run e2e:dictation` and `npm run e2e:dictation-settings` pass on the Pro Max and the SE. The first SE run failed at pairing (the known first-launch problem: Maestro typed the pairing text before the field was ready); it passed with a new `e2e:mac`. The new Release build (bundle 12:27) is on the iPhone (over Wi-Fi). The user's check on the iPhone passed: the on-device mic in a real lesson gives the text, and the run does not stop when the user scrolls.
- Not done: the Deepgram check on the iPhone. The user has no Deepgram key yet (user decision 2026-11-16: later). When the user has a key: put it on the Mac (Settings, Keys), select "Deepgram" in the phone's Settings, and speak the same sentence. To read the phone's logs after a failure: `sudo log collect --device-udid <iPhone UDID> --last 10m --output <dir>`, then `log show --predicate 'category == "dictation"'` on the archive (needs the user's Mac password).
- Next: the Deepgram check waits for the user's key. Issue 05 is done (2026-11-17).
- User remarks 2026-11-16: the keyboard mic stops when the user scrolls; the app's mic must not (it stops only on Stop, the background, or an iOS interruption). Check this on the iPhone. The user finds the iOS keyboard dictation poor and wants to compare Deepgram (and asked about Speechify; its engine is not known).

## 08 Graph list, cost and context `doing`

Blocked by: 03.

- Graph list and chain table from `GET /api/graph`; session cost and context use from the chat record.
  Acceptance: values match the desktop for the golden fixtures.

### Facts (fork `679599b`, read 2026-11-17)

- `GET /api/graph` returns `GraphSnapshot` (`src/core/contracts/graph.ts`): `propositions` (the chain table's list), `nodes` (also derived `arg_` nodes), `chains`, `sessions` (chat id to title), `fileSources`, `nodeSessions`, `clusters`, `positions`. There is no mastery or status level (removed upstream on 2026-09-27). The route comment about "understanding observations" is out of date.
- The desktop has no "graph list". Home is the canvas graph (`components/graph-view.tsx`) or `MinimalHome` (counts only). The chain table (`components/chain-table.tsx`) is an overlay from a "Chains" button. It groups chains by source (the birth session of the conclusion, inside the user's folders from `GET /api/graph/sources`), then chain lines (`A ∧ B ⟹ C`, KaTeX), then the statements. Columns: Name, Props, Created. Sort by name ascending first; fuzzy search over name, aliases, statement and source; practice sources are hidden; empty text "No matching chains."; header "N chains · M nodes". Nothing in it opens a session.
- The pure helpers are in the fork's `src/core` with no DOM or `node:` import: `chainsForSelection`, `formatChainLine` (`chains.ts`), `fuzzyScore` (`fuzzy.ts`), `sourceFileLabel` (`source-label.ts`), `chainSourceDirectory` (`source-organization.ts`). Import the files directly: the `@/src/core` barrel brings `node:crypto`. The sort, group and filter code is inside the component (`chain-table.tsx` lines 188 to 296), not in `src/core`.
- Session stats: `components/stats-bar.tsx` under the composer, `38k / 200k · $0.0123`; a tap opens "Session stats" (context, total cost, cache hit rate, unpriced turns, one row for each turn). Cost: `GET /api/chats/:id` already has `pricing` (`SessionPricing`, `sessionCost(chat)`). The dollars come from the Pi model catalog on the Mac, so the phone shows `pricing` and does not compute it. Context: `measuredContextTokens` (`src/core/context-usage.ts`, React Native safe) over the messages; the limit from `GET /api/models` (`catalogLimits`, `contextLimitForModel`); Claude Code CLI models use `cliContextWindowOf` (`native-messages.ts`, many imports). The format helpers are in `components/stats-bar.tsx` and `components/usage-format.ts` (pure, but in `components/`).
- Graph pipeline cost: `GET /api/graph/costs` (`GraphCostSummary`: extraction and audit dollars, recent runs). Runs in progress: `GET /api/graph/status` (queued, extracting, waiting, auditing, merging). The desktop refreshes them on the `activity-changed` event.
- The gateway allows `GET /api/graph`, `/status`, `/sources`, `/costs` and `/api/models`. It refuses all graph writes (delete node or source, rename, folders, positions, render settings, import). Issue 08 is read only.
- Golden fixtures: `../learnharness/tests/fixtures/golden-data/` (2 chats, about 282 node lines, 160 chain lines, 4 notes sources with 8 extraction runs). The fork's test checks only counts and shapes. Many nodes come from chats that are not in the fixture: their source is `missing` and shows as "unlabeled". No expected graph, cost or context values exist yet.

### Decisions (user, 2026-11-17, after the mockups)

The app gets a tab bar (issue 20). Issue 08 now lives in the **Graph tab**. The choices below were asked first; the answers:

- 1 is replaced by the tab bar (issue 20).
- 2B: two-line chain rows with search and a sort menu (the Chains screen opens from the Graph tab).
- 3A: one stats line under the composer and a stats sheet. Usage also goes in Settings.
- 4A: the cost chip and the run rows (on the Graph tab).
- 5: TeX as text in the list, math in an opened chain.
- 6 changed: the Graph tab shows the connectivity graph canvas, as the desktop (with Search, Chains, the cost chip). The canvas needs its own design step: mockups and a tech choice (for example Skia with gesture handler, or the desktop canvas code in a WebView) before code.
- Slice A (fork: chain rows and stats helpers into `src/core`) runs in the side session `fork-chain-rows` (`local_162677a1`, started 2026-11-17).

### Decisions (user, 2026-11-19, from the Graph tab mockups)

Ten mockups at 375 pt, light and dark: the canvas at fit zoom and zoomed in, the node card as a sheet and as a floating card, search, the cost sheet, Chains with the sort menu, an opened source, the session stats sheet, and the empty and error states.

- Canvas: **Skia** (`@shopify/react-native-skia`, an Expo SDK 58 module) with gesture handler and Reanimated (D-016). Read only: the phone draws the positions that the Mac saves (`snapshot.positions`, the desktop ledger) and computes no layout. It never writes positions. Nodes with no saved position get the desktop seed (`seedMissingNodePositions`). Draw layers as the desktop: session regions, edges with arrowheads, nodes, node labels (zoomed in) and region labels (zoomed out), faded on one zoom gate. Pan with one finger, pinch to zoom, double tap to fit.
- Controls over the canvas, as the desktop: the search field and "Chains" in one row; under them at the right, the cost number and one pill for each run in progress. The gear (Settings) stays in the header.
- Search: the desktop match on name and statement (`isNodeVisible`); other nodes hide; "N of M nodes" under the field; no match: "No matching nodes."
- Node card: a **bottom sheet** (option A): the name, the statement with math, then "Sessions": a session row opens the session, a notes file row is plain text. No sessions: "No sessions recorded." No delete (the gateway refuses graph writes).
- A session row opens the session **at the node's message** (the desktop `propositionSessionHref`). The paged draw (D-014) loads the page with that message first; the model input does not change. If the message is not in the record, the session opens at its normal position.
- Look: the fork's **default render settings** (`DEFAULT_RENDER_SETTINGS`), sized for the phone. No new gateway route.
- Cost: a tap on the cost number opens the cost sheet (stage totals and recent runs, the desktop `GraphCostPanel` numbers). Read only.
- Chains: a pushed screen from the Graph tab. The desktop folder groups, two-line source rows ("41 props · 2026-11-10"), search, and a sort menu (Name, Props, Created; a second tap turns the order). An opened source lists its chain lines with TeX as text; an opened chain shows its statements with math, and "Open <session>" opens the session.
- Session stats: one line under the composer ("38k / 200k · $0.0123"), a tap opens the "Session stats" sheet (context, total cost, cache hit rate, unpriced turns, one row for each turn).

### Design choices as first asked (2026-11-17)

1. Where the knowledge view lives: A, a "Your knowledge" section on home (counts and a Chains row; recommended), or B, a tab bar (Sessions, Knowledge).
2. Chain rows on a 375 pt screen: A, the desktop columns, or B, two-line rows (name, then "41 props · 2026-11-10") with search and a sort menu (recommended).
3. Session cost and context: A, one line under the composer and a stats sheet (recommended, as the desktop), or B, in the header under the phase.
4. Graph pipeline cost and the runs in progress: A, a cost chip and run rows on the chain list (recommended), or B, Mac only.
5. Math in chain names: draw TeX as text in the list and as math in an opened chain, or math islands in each row (many WebViews in a long list).
6. The canvas graph: not in issue 08 (recommended: a later issue if the user wants it).

### Error states

| State                                                                           | Message and behavior                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1. The Mac is not reachable when the list loads                                 | The connection banner; the last loaded list stays, with "Not up to date".  |
| 2. The Mac refuses a graph route (403, an older fork build)                     | "Update LearnHarness on your Mac to see your knowledge."                   |
| 3. The snapshot or sources body is not valid                                    | "Your knowledge could not be loaded. Pull to try again." No raw text.      |
| 4. The graph is empty                                                           | "Start a session to begin learning." (the desktop text).                   |
| 5. A search finds nothing                                                       | "No matching chains."                                                      |
| 6. The sources call fails, the graph call works                                 | Group by session titles and file names (the desktop fallback); no folders. |
| 7. A source is missing (its chat is gone)                                       | The row shows "unlabeled" and sorts last.                                  |
| 8. No turn has a price                                                          | Cost shows "—", never "$0.0000".                                           |
| 9. The model's context limit is not known (`/api/models` fails or has no entry) | Show only the tokens ("38k").                                              |
| 10. No measured context (no usage yet, or a compaction marker last)             | Show "?" for the tokens.                                                   |
| 11. The costs or status call fails                                              | Hide the cost chip and the run rows; the list still shows.                 |
| 12. A node has no saved position (the Mac's settle did not finish)              | The desktop seed position; no error.                                       |
| 13. A search finds no node                                                      | "No matching nodes."                                                       |
| 14. A node has no session                                                       | "No sessions recorded." in the sheet.                                      |
| 15. The node's message is not in the session record                             | The session opens at its normal position.                                  |
| 16. A session in the node card is gone (deleted on the Mac)                     | The row shows "unlabeled" and opens nothing.                               |
| 17. The Mac has no saved positions at all (the pipeline never ran)              | The first node at the origin, the others on the desktop seed ring.         |

### Slices (plan, updated 2026-11-19 after the Graph tab mockups)

- **A. Fork: pure chain rows.** `done` (fork `d99dd16`: `src/core/chain-rows.ts` and the usage format helpers in `src/core`; `79f70b5`: `src/core/folder-order.ts`).
- **B. Phone data.** `done` (2026-11-19). `src/lib/knowledge.ts`: fetch and check the snapshot, the sources, the costs and the status; the chain view model from the fork's `chain-rows.ts`; the canvas model (positions from the ledger, the seed for missing ones, regions, edges, search). Golden test: the fork's golden data through `graphSnapshot` and the desktop code, against the phone model (same counts, order, labels, dates, positions).
  - Fork `refactor(core): move the graph view helpers and canvas geometry to src/core`: `src/core/graph-view-model.ts` (`isNodeVisible`, `seedMissingNodePositions`, `displayCostTotals`) and `src/core/graph-canvas-geometry.ts` (`CLUSTER_LIGHTNESS`, `LABELS_FADE_RATIO`, `labelAlpha`, `zoomRatioOf`, `fitTransform`, `arrowGeometry`, `pickNearest`, `isImpNodeId`). The components re-export the old names; `tests/graph-view-model.test.ts` pins this. Fork `npm test`: 5419 of 5424 pass (the 3 known upstream failures).
  - Phone `src/lib/graph-api.ts`: `readGraphSnapshot`, `readGraphCosts`, `readGraphStatus` and stricter source rows. A bad item is dropped; a bad body throws a `SessionApiError` with no status.
  - Phone `src/lib/knowledge.ts`: `loadKnowledge` (four reads at the same time; only the graph is required), `describeKnowledgeError`, `canvasModel` and `canvasPositions` (no layout on the phone), `canvasSearch` ("N of M nodes"), `nodeSheet` (the message id from the desktop `propositionSessionHref`), `chainList` (the desktop `buildChainRows` and `folderTree`, two-line rows).
  - Tests: `tests/knowledge.test.ts` (30, every error state of this slice), `tests/knowledge-golden.test.ts` (6): the helper `tests/helpers/fork-knowledge.mts` reads a copy of the golden data through the fork server code and runs the desktop code. The phone model gives the same bodies, positions (38 seeded nodes), 13 chain cases, 4 searches and 200 node cards.
- **C. Canvas.** `in progress` (C1 done 2026-11-19; C2 done 2026-11-21; the iPhone frame rate is measured and fixed 2026-11-21, `fae0464`, PR #3; region labels option D done 2026-11-21, `ee1ff24`, PR #4; the search key rebuild fixed 2026-11-21, 183 to 24 ms, `35779ad`, PR #5). Plan: add `@shopify/react-native-skia` with `npx expo install` (D-016), rebuild the dev builds on both Simulators. `src/components/graph-canvas.tsx`: the draw layers, the camera (pan, pinch, double tap to fit), hit test, search, the node sheet, the open at the node's message. Performance check on the iPhone with the user's graph (frame rate during a pinch).
  - **C1 done (2026-11-19).** Fork `cc2b9ce` (pushed to `fork`): `refactor(core): move the canvas draw helpers to src/core`. The label and region label wrap, `clusterHue`, `edgeGlyphs`, `regionAnchors`, `regionSplat`, `boxBlurRound`, `blurRegionPixels`, the draw constants, `FIT_PADDING` and `ZOOM_EXTENT` are in `src/core/graph-canvas-geometry.ts`; the desktop renderer uses them. New `tests/graph-canvas-geometry.test.ts` (18). Fork `npm test`: 5437 of 5442 pass (the 3 known upstream failures).
  - Phone: `@shopify/react-native-skia` 2.14.0. `src/lib/graph-scene.ts` (pure): `CANVAS_SETTINGS` (the fork `DEFAULT_RENDER_SETTINGS`, checked by the golden test), `buildScene`, the camera worklets (`panCamera`, `pinchCamera`, `clampScale`, `nodeLabelOpacity`), `fitCamera`, `pickNode`, the region colors. `src/components/graph-canvas.tsx`: Skia draw of the desktop layers (the region splat on a CPU surface, blurred with the desktop code; edges; discs; the node labels as one picture; the selected node glow; the region labels at a constant screen size). Pan, pinch and double tap run on the UI thread (Reanimated shared values with `get()` and `set()`); a tap picks on the JS thread. `src/components/node-sheet.tsx`: the bottom sheet. `src/lib/use-knowledge.ts`: load on focus, `activity-changed` and `chats-changed`; an old read never replaces a new one. `graphTabView` in `knowledge.ts`. The Graph tab screen: search ("N of M nodes", "No matching nodes."), canvas, sheet, error states 1 to 4, 6, 11, 13 to 16. `Field` has a `search` option (no autocorrect). `TabScreen` has `scroll={false}`.
  - Tests: `tests/graph-scene.test.ts` (19), `tests/app-graph-tab.test.tsx` (11), 4 more in `knowledge.test.ts`, 1 more in `knowledge-golden.test.ts`. Jest cannot load Skia: `tests/setup/graph-canvas.ts` puts a stand-in canvas (one button for each node) in every test. Phone Jest: 790 of 790.
  - Simulator check (2026-11-19, golden data): the new dev build on the SE and the Pro Max (iOS 26.5); `e2e/tabs.yaml` passes on the SE (dark) and the Pro Max (light). By hand on the SE: pinch, pan, double tap to fit, node labels in and region labels out on zoom, a tap opens the sheet with the glow, close, search with 21 of 278 nodes and with no match. Screenshots: `perf/results/2026-11-19-graph-tab-se-dark.png`, `perf/results/2026-11-19-graph-tab-promax-light.png`.
  - Found and fixed in the check: the app root has no `GestureHandlerRootView` (the canvas brings its own); a worklet does not capture a default parameter value (`nodeLabelOpacity` takes the gate); Skia's default picture cull rect starts at (0, 0) and dropped the labels at negative positions; iOS autocorrect in the search field. Gotcha: the first build failed with `Sealable` missing (the Pods flavor mix, see issue 21); `rm -rf ios/Pods` and `pod install` fixed it.
  - **C2 done (2026-11-21, `4471458`, PR #2).** The session screen reads the `message` route param. `messageRow` in `src/lib/transcript-window.ts` finds the row of the message's first teacher text (the desktop anchor, fork `firstSourceTextParts`). The page window now has an end: `openWindow` draws one page from that row (the message at the top), `wantsLater` and `laterEnd` add one page of later rows near the bottom ("Loading later messages"), and `keepWindow` keeps the window when rows change. The transcript does not follow the end at a message (`createEndFollow({ atEnd: false })`). "↓ Latest" and a send from the composer go back to the last page. A message that is not in the record, or that has no teacher text, gives the normal open (state 15). D-014: only the drawn rows change; the record and what the phone sends do not.
  - Tests: 6 in `transcript-window.test.ts`, 1 in `end-follow.test.ts`, 5 in `app-session-window.test.tsx`. Found: the old page test called `fireEvent(…, "contentSizeChange")` with no `await`; the open `act()` scope left the next test with an empty screen (fixed). Phone Jest: 801 of 801.
  - Simulator check (golden data): the golden graph has no message links, so the new test Mac option `LH_E2E_LINK=1` links the node "Relational model (Information Principle)" to a teacher message in the middle of the golden teach session. New flow `e2e/graph-open-message.yaml` (`npm run e2e:graph-open`, in `e2e:suite`): it opens the node's route by a link (a canvas node has no element that Maestro can tap), checks the message text, then "↓ Latest". Passes on the SE (dark) and the Pro Max (light). Screenshots: `perf/results/2026-11-21-open-at-message-se-dark.png`, `perf/results/2026-11-21-open-at-message-promax-light.png`. The tap from the node sheet to the route is covered by `app-graph-tab.test.tsx`, not by a Simulator check.
  - Release build on the iPhone (2026-11-21, with Skia): the profile now expires 2026-11-28 17:08 UTC. Gotcha: Xcode reused the old cached profile (same expiry); move it out of `~/Library/Developer/Xcode/UserData/Provisioning Profiles` and build again to get a new 7-day profile.
  - **Frame rate on the iPhone (2026-11-21, `fae0464`, PR #3).** Measured with Instruments over the cable (no password; steps and numbers in `perf/results/2026-11-21-iphone-graph-pinch.md`). Before: about 62 fps while the graph moves, 21% of frames at 120 Hz. The cause: Skia filled the one stroked path of all edge shafts on the CPU at screen size on each frame (Ganesh `SoftwarePathRenderer`), and the discs and heads were one path each too. After: the shafts are separate lines with flat ends (GPU `drawStrokedLine`), the discs and heads are one picture of single shapes. About 107 fps, 95% of frames at 120 Hz, and no CPU path fill; the Skia draw time on the main thread is 72% less. Bugs found in the same check: the node labels did not fade (a picture ignores the group opacity), the graph jumped to the side when one pinch finger lifted (user report, `pinchStep`), and two pinch fingers could count as a double tap and fit the graph (user report, `tapAllowed`). Left: the node labels are the largest draw cost when zoomed in (new glyphs for each scale); some frames of 58 to 67 ms, not explained yet.
  - **Region labels (2026-11-21, `ee1ff24`, PR #4, user choice option D after four mockups).** At fit zoom on a 375 pt screen the desktop labels (14 pt, wrap 220 pt) overlapped. The phone now uses 11 pt and a wrap width of 140 pt (`PHONE_REGION_LABEL`; the desktop settings stay the same). `placeRegionLabels` runs on the UI thread on each frame: a label whose region center is in the canvas moves inside the canvas edge (8 pt), then, largest region first (visible members), a label that overlaps a shown label (4 pt clearance) is hidden. A hidden label shows again when a zoom makes space. Tests: 8 in `graph-scene.test.ts`. SE (dark) with the golden data: no overlap, and the label at the right edge is now complete (`perf/results/2026-11-21-region-labels-se-dark.png`).
  - **Scene rebuild on each search key (measured 2026-11-21).** Time Profiler on the iPhone, Release build, the user's graph (`perf/results/2026-11-21-iphone-graph-search.md`). Each key keeps the JS thread busy for 135 to 219 ms (median 183 ms, 43 keys). The main thread is not blocked. The frame types point to the region blur in JS (`blurRegionPixels`: Float32 writes and `Math.min`/`Math.max` are about a third of the samples). The bitmap has a fixed size (256 px), so the cost is almost the same for each key. A test build with the region tints off gives a median of 14 ms for each key (12 to 46 ms, 47 keys): the region bitmap is about 92% of the cost. Fix (user choice, option A): the phone blurs the region bitmap in Skia (C++, a Gaussian filter, `regionBlurSigma` with 2 tests) and not in JS. After: a median of 24 ms for each key (12 to 50 ms, 49 keys), 87% less. On the SE Simulator the canvas changed by 3 of 255 or less in each pixel. No debounce (it saves almost nothing at 24 ms). Phone Jest: 817 of 817.
- **D. Chains screen.** Search, sort, open and close a source and a chain, statements with math. Every error state above with a test.
  - **Mockups and choice (2026-11-21).** Mockups at 375 pt, light and dark: "Chains" next to the node search field (with the cost number under it), the list (the header "N chains · M nodes", search, a sort button "Name ↑" that opens a native menu Name / Props / Created, folder sections as the inset grouped cards of the Teach tab, two-line source rows "41 props · 2026-11-10", a notes source with a NOTES tag, "unlabeled" muted), and the states ("No matching chains.", the error with "Try again"). User choice **3C** (from 3A in place, 3B pushed screen and sheet, 3C): a tap on a source opens it in place and shows its chain lines (the desktop chips `A ∧ B ⟹ C`, TeX as text); a search opens the matching sources, as the desktop (`isSourceOpen` with `foldedForSearch`). A tap on a chain line opens a bottom sheet (as the node sheet): the chain line, the statements with math (`Markdown`), and "Open <session>". Why: the desktop search and overview stay, and only one chain draws math at a time (WebView count, issue 21). 3B lost the search overview; 3A could open many math WebViews and has three indent levels on the SE.
  - Plan: route `src/app/(tabs)/graph/chains.tsx` (the Graph tab Stack), the "Chains" button in the Graph tab controls row, `src/components/chain-sheet.tsx` (copy the `NodeSheet` frame), the list from `chainList()` in `src/lib/knowledge.ts` (`sources`, `folders` = the fork `folderTree` over `ChainSourceGroup`, `empty`, `header`), `nextChainSort` and `DEFAULT_CHAIN_SORT` from the fork `src/core/chain-rows.ts`, the chain line text from `formatChainLine` (fork `chains.ts`). The open session goes through the birth session of the chain (the source group `birth`); a notes source has no session (no button). Reuse the shelf card styles (`src/components/shelf.tsx`). Tests: the screen states 1 to 7 and 11, the sort, open and close a source, the sheet. Then a Maestro flow with the golden data on the SE (dark) and the Pro Max (light).
  - **State (2026-11-22, done: squash-merged as `7afeab3`, PR #6; CI passed).**
    - Screen `src/app/(tabs)/graph/chains.tsx`, pushed by "Chains" next to the node search field. The Graph tab layout holds one knowledge load for both screens (`src/lib/knowledge-context.tsx`), so the Chains screen shows the graph at once and a change on the Mac reads the graph one time.
    - Model in `src/lib/knowledge.ts`: `chainSections` (each top folder is one inset grouped card; a subfolder is a row that opens in place; the sources in no folder go last in "Unfiled"; with no folders, one card with no label), `ChainOpenState` with `isChainEntryOpen` and `toggleChainEntry` (the desktop `isSourceOpen` rule: a search opens all, a source closed during a search stays closed until the search changes), `chainLines`, `chainSheet`, `chainSortLabel`.
    - Sort: a native SwiftUI menu (`@expo/ui` `Menu`, `src/components/chain-sort-menu.tsx`); Jest uses a stand-in (`tests/setup/native-menu.ts`).
    - Chain line chips: `src/components/chain-line.tsx` (premises in the desktop order, ∧ between, ⟹ before the conclusion; VoiceOver reads `formatChainLine`).
    - Chain sheet: `src/components/chain-sheet.tsx`, on the new shared frame `src/components/bottom-sheet.tsx` (the node sheet uses it too). "Open <session>" opens the birth session at the conclusion's message (`nodeMessageId`); a notes or unlabeled source has no button.
    - Fixes found in the Simulator check: the sheet body did not scroll (the scroll view grew past the 60% sheet; now `flexShrink: 1`; this was also in the node sheet). A search that hides all folders showed an empty screen; the desktop shows "No matching chains." only with no folders, the phone now also shows it when no section is left.
    - Tests: 8 new model tests in `tests/knowledge.test.ts`, 14 screen tests in `tests/app-graph-chains.test.tsx` (entry, sections, open and close, search, sort, sheet and Open, states 1 to 7 and 11). Jest 839 of 839 in 4 of 6 full runs (see the flaky test below; format, lint and typecheck clean).
    - Maestro: `e2e/graph-chains.yaml` (`npm run e2e:graph-chains`, also in `e2e:suite`), test Mac `LH_E2E_GOLDEN=1 LH_E2E_SHELF=1 LH_E2E_LINK=1 LH_E2E_CHAIN_BIRTH=1`. The new option `LH_E2E_CHAIN_BIRTH=1` puts the link first, so the teach session is the birth of a chain (the golden graph has no chain born in a session that still exists). Passed on the SE (dark) and the Pro Max (light). The Pro Max had an old dev build with no Skia: the SE dev build was installed on it.
    - Flaky Jest test (found 2026-11-21, not from slice D; also seen on master): in about 1 full run of 4, a test in `tests/golden-transcript.test.tsx` passes its time limit. The golden session test took more than 5 s under load (now 20 s, `jest.setTimeout`). "tool-rendering regressions › draws each text as Markdown" takes 0.4 s alone but once passed 20 s in a full run. **Cause (found 2026-11-22, branch `fix/jest-markdown-flake`):** the WebView mock never sends a height, so each math island keeps its `Spinner`. Each `Spinner` sets its state every 80 ms with a real `setInterval`. The test keeps all 15 drawn texts mounted, so 28 spinners tick at the end. These updates come inside the `act` of `await render`. On a busy CPU, one pass of updates takes more than 80 ms, so `act` never finishes (a livelock). Proof: 2 ms of added work in each tick made the test take 16 s; 4 ms made it pass 60 s. The same loop in `tests/markdown.test.tsx` › "draws every teacher text" can hang too. A load harness (outside the repo: each real interval tick costs 4 ms of CPU) proves it on master: these 2 tests fail, and no other file has interval ticks. The slow first tests of the app screen files have no ticks, so their 20 s limits have a different cause. **Fix:** fake timers in these 2 tests (`golden-transcript` in `beforeEach`, `markdown` in the one test), so the spinners do not tick. The tests check what draws, not the timers. With the harness at 4 ms and 8 ms: 839 of 839 pass and no file ticks. Not chosen: Reduce Motion on in a global Jest setup. It also passes, but it moves the reveal fade in all files to the Reduce Motion path. Jest: 6 full runs in a row pass.
    - Flow notes: Maestro `scrollUntilVisible` moves the list behind a modal sheet, so the flow swipes inside the sheet. `hideKeyboard` is not reliable: the flow presses the Search key.
- **E. Session stats.** `done` (2026-11-23, merged as `d07ae13`, PR #9). The line and the sheet: `pricing` from the record, `measuredContextTokens`, the limit from `/api/models`; update after each turn and after a compaction. Golden test with the fork's recorded teach chat (25 turns, 1 compaction).
  - Slices E and F ran in parallel (slice F in its own worktree). The two PRs added lines at the same places in four files; slice E moved its lines, so both merge orders were clean. The combined code passed Jest 890 of 890, and CI passed for both PRs.
  - Mockup check shown 2026-11-23 (375 pt, light and dark; the user said "Yes, build it"): the line "36.9k / 128k · $0.0123" under the composer, the "Session stats" sheet, states 8, 9 and 10.
  - Fork `0a9bb9d` (pushed to `fork`): `src/core/session-stats.ts` `sessionStatsSummary` has the stats bar strings (the context label and limit, the honest cost, the cache hit rate, the plan names, one row for each turn). `components/stats-bar.tsx` uses it; the desktop output does not change (the stats bar tests pass, new test `tests/session-stats-core.test.ts`). The user's Mac does not need a new build for it.
  - Phone: `src/lib/session-stats.ts` wraps the fork summary and adds the error notes (`NO_PRICE`, `NO_LIMIT`, `NO_CONTEXT`), the body checks (`turnsOf`, `pricingOf`, `chatSettingsOf`) and the reads `readModelLimits` (`GET /api/models`) and `readStrongModel` (`GET /api/settings`). `readSession` and each record snapshot give `usage` (turns, pricing, model setting). `useSessionModel` reads the record again (adoption "none") when a turn ends and when a compaction ends (`useEndOfWork`). `useSessionStats` adds the limits and the strong slot. `src/components/session-stats.tsx`: the line (testID `session-stats`) and the sheet (`session-stats-sheet`, rows `stats-sheet-*`, turns `stats-turn-N`). The model is the session's own setting, else the strong slot, as the desktop model control.
  - Tests: `tests/session-stats.test.ts` (19, the model and the reads), `tests/app-session-stats.test.tsx` (10, the screen with the fake Mac: the line, the sheet, the update after a turn and after a compaction, states 8, 9 and 10, the strong slot), `tests/session-stats-golden.test.ts` (4): the golden teach chat through the fork server's real Pi pricing and the catalog, against the phone path (record read, reads, `SessionModel` context). Values: 36.9k, $0.0141, 81.9%, 25 rows; "? / 131.1k" right after the compaction. Jest 872 of 872.
  - Maestro: `e2e/session-stats.yaml` (`npm run e2e:session-stats`, in `e2e:suite`), test Mac `LH_E2E_GOLDEN=1`. The golden data has no provider key, so the line is "36.9k · $0.0141" with the state 9 note. Passed on the SE (dark) and the Pro Max (light).
  - Gotchas: the first flow on a newly booted Simulator can fail the pairing (the app reloads after the text is typed): run it again. A newly booted Simulator can need `MAESTRO_DRIVER_STARTUP_TIMEOUT=300000`. A failed flow once left its test Mac `next dev` running, and the next test Mac could not start ("Another next dev server is already running"): check its `LH_DATA_DIR` is a temp folder, then stop it. The Mac sends `record-changed` and then `compaction-changed` at the end of a compaction; a test compaction marker needs `details.firstKeptMessageId`.
- **F. Pipeline cost.** `done` (2026-11-23, merged as `d92fd30`, PR #8; branch `feat/08-f-pipeline-cost`, side session `local_7323e6ae` in the worktree `~/Development/learnharness-mobile-08f`). The cost number, the cost sheet and the run pills; refresh on the `activity-changed` event.
  - Mockup check (2026-11-23, user OK): the cost number under "Chains" at the right, the pills under it, the cost sheet in the shared bottom sheet (the stage tokens on a second line, so a row fits on the SE), and state 11 (no number, no pills, the graph shows).
  - Fork `7a23c03` (pushed to `fork`), `refactor(core): move the graph cost labels to src/core`: the private label helpers of `components/graph-view.tsx` (`graphUsageLabel`, the run cost, the tokens, the run age, the pill seconds) are now `src/core/graph-cost-format.ts`. The desktop output does not change; new test `tests/graph-cost-format.test.ts`. Fork `npm test`: 5444 of 5449 pass (the 3 known upstream failures).
  - Phone: `src/lib/pipeline-cost.ts` (`costNumber`, `costSheet`, `runPills`), `src/components/cost-sheet.tsx` (`CostNumber`, `CostSheet`), `src/components/run-pills.tsx` (the seconds count up once a second), the Graph tab controls. The phone computes no dollars: the labels are the fork code. As the desktop, the cost number shows only when the Mac has a recent run. State 11: a failed costs call hides the number and closes an open sheet; a failed status call hides the pills; the graph still shows, with no raw server text.
  - Tests: `tests/pipeline-cost.test.ts` (10), 7 new screen tests in `tests/app-graph-tab.test.tsx` (the number and the sheet, no recent run, the pills count up, refresh on `activity-changed`, state 11 three ways), a golden test in `tests/knowledge-golden.test.ts` (the number, the sheet header, the stage rows and the 8 recent runs equal the desktop panel values on the fork's golden data). Jest 857 of 857.
  - Maestro: `e2e/graph-cost.yaml` (`npm run e2e:graph-cost`, also in `e2e:suite`), test Mac `LH_E2E_GOLDEN=1 LH_E2E_RUN=1`. The new option `LH_E2E_RUN=1` starts one notes import and holds it in "extracting" (a slow scripted extractor), so the Graph tab shows one run pill; the test Mac aborts that import when it stops. Passed on the SE (dark) and the Pro Max (light).
  - Flow notes: Maestro reads a button by its VoiceOver label ("Graph costs, $0.02"), not by its text. On a Simulator that was just booted, the Maestro driver can time out ("Timed out while loading Accessibility"): set `MAESTRO_DRIVER_STARTUP_TIMEOUT=240000`.
- **G. Checks.** `npm run test:integration` against the fork server on a copy of the golden data (the phone values equal the desktop helper values); a Maestro flow on both Simulators (Pro Max and SE); screenshots for the user; a Release build on the iPhone.
  - Plan (2026-11-23, not started; branch `feat/08-g-checks`): (1) a new integration test `tests/integration/graph-stats.test.ts` with the real fork server on a COPY of the golden data (as `scripts/e2e-mac.ts` with `LH_E2E_GOLDEN=1` does) through the HTTPS gateway: the phone's knowledge read (`src/lib/knowledge.ts`), the pipeline cost labels (`src/lib/pipeline-cost.ts`) and the session stats (`src/lib/session-stats.ts`, `readModelLimits`, `readStrongModel`, `usageOf`) against the desktop helpers on the same server bodies; today `tests/integration/session-flow.test.ts` covers only issue 03. (2) `sh scripts/e2e-suite.sh <udid> <outdir>` (all FLOWS) on the SE (dark) and the Pro Max (light); take the e2e lock. (3) Screenshots for the user. (4) A Release build on the iPhone (profile until 2026-11-28 17:08 UTC; do not edit files during it).
  - Warning: the fork's `next dev` runs only once for each fork folder ("Another next dev server is already running"). Do not run `test:integration` and a Maestro test Mac at the same time.

## 20 Tab bar, Teach and Practice tabs, folders `done`

User request 2026-11-17 (screenshots of the "Hello Interview" app as the reference; keep our colors, no theme change now). Plan: `~/.claude/plans/twinkly-swinging-snowglobe.md`.

### Decisions (user, 2026-11-17, from mockups)

- A bottom tab bar with 3 tabs: **Teach**, **Practice**, **Graph**. No fourth tab. Settings is a gear at the top of each tab; usage goes in Settings.
- A tap on a session opens it full screen with no tab bar; back returns to the tab.
- Teach tab: a "Continue learning" card (the newest teach session, plan step "3 of 7", "Your turn" badge, Continue). Then the sessions grouped by the **desktop folders** (the Chains table folders from `GET /api/graph/sources`), and a "Not in a folder" group. The row number is the **concepts learned** (propositions whose birth session, `provenance[0].chatId`, is that session).
- Folders change from the phone with a **long press** (option A): on a session, "Move to folder…" (a sheet: the folders, Not in a folder, New folder…) and "Rename"; the "…" on a folder header gives Rename, New subfolder, Delete (only when empty).
- Practice tab: a "Continue practice" card, then the sessions **by time** (Today, This week, Earlier) with the problem count on each row. The desktop keeps practice sessions out of the folders.
- "+" in each tab header opens New session with the right kind.

### Decisions (user, 2026-11-17, from the issue 20 mockups)

- Mockups of six screens: the Teach tab, the long press menu on a session, the Move to folder sheet, the folder "…" menu, the Practice tab, the error and empty states.
- Teach tab order: the desktop order (fork `renderLevel` in `components/source-folder-tree.tsx`, default sort by name, `DEFAULT_CHAIN_SORT`): at each level, folders and sessions mix, sorted by name; subfolders indent. Sessions with no folder go in a separate "Not in a folder" group after all folders (the user kept this; the desktop mixes them with the top-level folders).
- The Graph tab shows the placeholder text "The graph comes in a later update." until issue 08. The tab bar keeps 3 tabs.
- The folder menu's Delete on a folder that is not empty is grey; a tap says "Move the sessions out first." On an empty folder it is red and asks before the delete.
- Move the fork's folder order (`renderLevel`, the sort and the visible folder filter) to the fork's `src/core` as pure code, so the phone imports it (as `src/core/chain-rows.ts`).
- Style (user, after the second mockups): the inset grouped style of the reference app, in our colors. A section label over each group (the folder name, or Today / This week / Earlier). The rows of a group sit in one rounded card (`panel` color, `line` border, radius 14, dividers). A row: the title (prose font, 15 pt), then the count ("12 concepts", "4 problems") and a chevron on the right; one line only, plus a small mono second line only when something waits ("A question waits", "A problem waits"). Rows at least 44 pt high. The active tab uses `accent` in light mode and `text` in dark mode.
- Subfolders: option A. Each subfolder is its own section, with the path in the label ("Databases › Postgres"), in the desktop order (depth first, by name). All sessions show on one screen (no folder screen). A folder with no sessions and no subfolders still shows its section with an empty-folder line, so its "…" menu stays reachable.

- Tab bar: the native iOS tab bar (`expo-router/native-tabs`, option A, user choice 2026-11-17 after a mockup of native and JS tabs). On iOS 26 it is the floating glass bar with system labels; only the active color is ours.

### Facts

- Slice A layout: `src/app/(tabs)/_layout.tsx` (`NativeTabs`, triggers `(teach)`, `practice`, `graph`). Each tab is a folder with its own Stack (`_layout.tsx`), because native tabs have no header. URLs: `/` is Teach, `/practice`, `/graph`. `session/[id]`, `new-session`, `settings` and `pair` stay in the root Stack, so they cover the tab bar. The shared header options are in `src/components/stack-options.ts`; the tab frame (status line, banner, gear, "+") is `src/components/tab-screen.tsx`.
- Native tabs mount all tabs at once (also in Jest). A query on the whole screen finds the status line three times: scope screen tests with `inTab()` and `headerButton()` from `tests/helpers/tabs.ts`. Each tab has `testID` `tab-teach`, `tab-practice` or `tab-graph`. The "+" keeps the old testIDs (`new-session` in Teach, `new-practice` in Practice). Maestro taps a tab by its label (`tapOn: "Practice"`).
- No native rebuild for native tabs: the dev build already has the tab views of react-native-screens 4.30.
- `GET /api/chats` gives `ChatListItem` (title, dates, kind, messageCount, phase, `pendingQuestion`, `pendingProblem`, busy, compacting). It has no problem count: load the practice records for the visible rows and cache by `updatedAt`.
- The folder route: `POST /api/graph/sources` with `OrganizationAction` (`create-folder`, `rename-folder`, `rename-source`, `move`, `delete-folder`; fork `src/core/source-organization.ts`). It changes only the folder list and the display names, never a session. The server checks the input (`SourceOrganizationInputError`, `canMoveFolder`, empty folder delete). `DELETE /api/graph/sources` deletes sources: it stays refused.
- Folder order in core (fork `79f70b5`, 2026-11-18): `src/core/folder-order.ts`, `folderTree({ groups, organization, query, sort, allSourceNodes })`. It gives `level(parentId)` (folders and sources mixed, sorted by the active column, then the name, then the id; no label last), `folderNodeIds`, `isFolderVisible`, `hasChildren`, `parentOf`, `isInFolder`. A source is `{ key, birth, label, nodeIds, newestCreatedAt }`: for the phone, `birth` is the chat id, `label` the session title, `nodeIds` the concepts born in it. Import the file directly (no barrel). It has a cycle guard. The desktop tree uses it; fork tests `tests/folder-order.test.ts`.
- The gateway refuses `POST /api/graph/sources` now. Opening it lowers a security floor: audit first (`docs/TRANSPORT-SECURITY.md`), one place for phone writes in `electron/phone-access.cjs` (a `PHONE_WRITES` table with a body guard: JSON, at most 4 KB, the 5 actions), fork tests.

### Slices

- A. `done` (2026-11-17). Tab shell: `(tabs)` group (`teach`, `practice`, `graph`), the root Stack keeps `session/[id]`, `new-session`, `settings`, `pair` over the tabs. Read the SDK 58 router docs first (native or JS tabs).
  - Checks: Jest 635 pass in band (new `tests/app-tabs.test.tsx`, 7 tests). `npm run e2e:open-long` passed on the Pro Max (golden test Mac); `npm run e2e:practice` passed on the SE on the second run. The first SE run failed late, after a dismissal: "Next problem" started no turn within 60 s. No code in that area changed; watch for it again.
- B. `done` (2026-11-18). Teach tab: `src/lib/teach-shelf.ts` (pure: `teachSections`, `conceptsBySession`, `continueSession`, `continueLine`, `continueBadge`, `rowNote`), `src/lib/graph-api.ts` (`readSourceDirectory`, `readPropositions`, body checks), `src/components/teach-shelf.tsx` (`useTeachShelf`, `ContinueCard`, `ShelfGroup`), `src/app/(tabs)/(teach)/index.tsx`.
  - Facts: the concept count is the propositions whose `provenance[0].chatId` is the session. The golden teach session has 0 concepts (the golden nodes come from sessions that are not in the fixture). A folder that holds only notes files shows the empty-folder line. A session in a missing folder (or a folder cycle) goes in "Not in a folder", so no session is lost. The tab shows "Loading…" until the folders load or fail, so sessions do not jump into the folders. Folders read again on `sources-changed`, concepts on `activity-changed` (one graph read at a time). The continue card reads the newest session's record for "step N of M"; the rows show no phase or time now (only a note when something waits).
  - Test data: `LH_E2E_GOLDEN=1 LH_E2E_SHELF=1 npm run e2e:mac` adds folders (Algebra, Databases, Databases/Postgres with the golden session, the empty Reading list) and 4 teach sessions through the desktop API. Flow `npm run e2e:teach-shelf`. A row is one button for Maestro: match it with a regex ("Eigenvalues, .*"); on the SE, scroll before checking the lower rows.
  - Checks: Jest 654 pass in band; lint, typecheck, format clean. `e2e:teach-shelf` passed on the Pro Max (light) and the SE (dark). After the commit, on the Pro Max: `e2e:practice` passed on the second run (the first run lost the typed pairing text: the cold Metro bundle after `--clear` took 34 s and reloaded the app; the code was not used). `e2e:open-long` passed after a flow fix: it tapped the session title on the "Continue learning" card (plain text, not a button), so the flow now taps the row (`"test session, no probing.*concepts.*"`). Tip: fetch the iOS bundle once with curl before a Maestro run after `--clear`.
- C. `done` (2026-11-18). Practice tab: `src/lib/practice-shelf.ts` (pure), time groups, problem counts.
  - Decisions (user, 2026-11-18, from the slice C mockup): the row number is all problems in the session ("4 problems", "1 problem", "0 problems"; option A). The continue card is the newest practice session, with the line "Problem 4 · 3 done" and the badge ("A problem waits", "Your turn", "Working…"). The count comes from a new summary field in the fork's `GET /api/chats` (`problemCount`, and the done count for the card), not from a read of each record. Until the user's Mac runs a fork build with the field, the rows show no number. Time groups by `updatedAt` in the iPhone time zone: Today (since midnight), This week (the 6 days before today), Earlier.
  - Facts for the build (2026-11-18, read only, no edit yet): the fork builds the list in `src/store/chats.ts` `listChats()` (the summary map next to `pendingProblem: activeProblemOf(messages) !== null`); the type is `ChatSummary` in `src/core/contracts/chat.ts`; tests in `tests/chat-kind.test.ts`. A problem counts only through a clean result (`cleanToolCallIds` and `practiceProblemForCall` in `src/core/native-messages.ts`: the `problem` tool or a plugin problem). Plan: one new field `problemCount` (clean poses, the same rule as `activeProblemCallOf`); the phone computes done = `problemCount` − 1 when `pendingProblem`, else `problemCount`, so no second field. The phone treats a missing field as "no number" (an older fork build).
  - Build (2026-11-18): fork `e725d12` (pushed to `fork`): `problemCountOf` in `src/core/native-messages.ts`, `problemCount` in `ChatSummary` and `listChats()`, tests in `tests/chat-kind.test.ts`, the plugin API reference regenerated. Phone: `src/lib/practice-shelf.ts` (pure: `timeGroupOf`, `practiceGroups`, `problemCount`, `doneCount`, `problemLabel`, `practiceLine`, `practiceBadge`), `src/components/shelf.tsx` (the continue card and the section parts, now shared by both tabs), `src/app/(tabs)/practice/index.tsx`. The old flat `SessionList` row, `sessionMarks` and `src/lib/time-ago.ts` are removed (no user left). The card line: "Problem 4 · 3 done" while a problem waits, "Practice · 3 done" between problems, "Practice" with no problem or no count.
  - Practice tab error states: the chats call fails (the banner from `describeError`, no raw text); no practice sessions ("Start a practice session to begin."); an older fork build with no `problemCount` (no numbers on the rows, the card line "Practice"). Each has a test in `tests/app-practice-tab.test.tsx`.
  - Test data: `LH_E2E_GOLDEN=1 LH_E2E_PRACTICE_SHELF=1 npm run e2e:mac` adds 2 copies of the golden practice session: "Linear recurrences" (today, the first problem waits) and "Bayes rule practice" (3 days ago, 2 problems); the golden one (2 problems) is in Earlier. Flow `npm run e2e:practice-shelf`.
  - Checks: Jest 663 pass in band (new `tests/practice-shelf.test.ts` and `tests/app-practice-tab.test.tsx`); lint, typecheck, format clean. Fork: `tests/chat-kind.test.ts` and `tests/plugin-api-reference.test.ts` pass; the full fork suite has only the 3 known upstream failures. `e2e:practice-shelf` passed on the Pro Max (light) and the SE (dark). The first SE run failed: the tab tap right after the pairing did not change the tab. The flow now waits for "CONTINUE LEARNING" and taps again if the tab did not change (one tap was enough on the second run). The user's Mac shows no numbers until it runs a fork build with `e725d12`.
  - CI: phone `9594eb0` passed. Fork `e725d12`: the first run failed in the upstream test `tests/notes-import-route.test.ts` ("out-of-order completion remains supported": a 25 ms timer on a busy runner; it passes 3 of 3 times on this Mac, and the code is not ours). The rerun passed the tests, lint and typecheck. The mac-arm64 job waits for a GitHub runner (capacity, not code).
- D. Folder changes: fork gateway write (audit, guard, tests, push to `fork`), phone long press menu, Move sheet, folder menu, refresh on `sources-changed`.
  - Audit and decision (2026-11-18): `docs/TRANSPORT-SECURITY.md` "Gateway writes", D-015. The user approved the guards with the 500-folder limit, and the mockups (long press menu, Move sheet, folder menu, error states 5 and 7).
  - Fork (`bd6525c`, `251fde8`, pushed to `fork`): `PHONE_WRITES` in `electron/phone-access.cjs` is the only place for phone writes with a body. `POST /api/graph/sources`: JSON only (415), at most 4 KB, declared or real (413), the 5 actions with their exact keys, ids and names at most 200 characters on one line (400), a new folder refused at 500 folders (409, `code: "folder-limit"`). The gateway sends the checked body, not the phone's stream. The checked writes run one at a time (the limit check to the end of the answer, at most 30 s), a body must arrive in 10 s, and the gateway checks again that the phone is still paired (two findings of the automatic security review). `DELETE /api/graph/sources` stays refused. Tests: `tests/phone-access.test.ts` (37 pass) and one real-server test in `tests/integration/phone-gateway-server.test.ts` (10 pass). Full fork suite: only the 3 known upstream failures.
  - Phone: `src/lib/folder-actions.ts` (pure: `folderChoices`, `folderOfSession`, `canDeleteFolder` with the desktop's `folderIsEmpty`, `checkName`, `describeFolderError`), `changeFolders` in `src/lib/graph-api.ts`, `src/components/folder-menus.tsx` (`MenuSheet`, `MoveSheet`, `askName` with the iOS prompt, `useFolderActions`), long press and the "…" button in `src/components/shelf.tsx`, the wiring in `src/app/(tabs)/(teach)/index.tsx`. A good answer shows the new folders at once (`useTeachShelf().apply`); `sources-changed` also reads them again. A chosen menu item runs in the modal's `onDismiss`, because iOS cannot show a sheet or a prompt while a modal still closes. No folder changes while the folders are not loaded.
  - Tests: `tests/folder-actions.test.ts` (11), `tests/app-teach-folders.test.tsx` (9: move, new folder from the Move sheet, rename a session, rename a folder and add a subfolder, delete an empty folder after a confirm and the grey Delete, error states 5, 6 and 7, a bad name, no menus without folders). The fake Mac uses the desktop's own folder rules. Jest 719 pass.
  - Simulator check (2026-11-18, dev build, `LH_E2E_GOLDEN=1 LH_E2E_SHELF=1 npm run e2e:mac`, flow `npm run e2e:teach-folders`): passed on the Pro Max (light) and the SE (dark). The flow moves "Bayes rule" into the empty "Reading list" from the long press menu and the Move sheet, adds the subfolder "Algebra › Matrices" from the folder menu, and deletes it after the confirm. Each change goes through the real gateway checks of the test Mac. The screenshots match the mockups (the grey Delete on a folder with sessions, the red Delete in the confirm).
  - Two fixes from the Simulator check: the menu backdrop was one accessible button, so VoiceOver and Maestro did not see the menu items (the backdrop is now its own layer behind the menu). The icons added their names to the row labels ("move, Move to folder…"); each menu row and Move row now has a plain label.
  - Tip: the test Mac makes one pairing code for each start. Start it again before each flow run.
- E. `done` (2026-11-19). Checks: all Maestro flows on both Simulators after the tabs, screenshots light and dark.
  - New runner `npm run e2e:suite -- <udid> <output dir> [flow ...]` (`scripts/e2e-suite.sh`): it starts a new test Mac with the right options for each flow, runs the flow, and writes `summary.txt`. It tries the test Mac start again, at most 3 times (next dev stops at its notice on about every second start), and stops a flow after `FLOW_LIMIT` seconds (default 600; Maestro hung once for 2 hours after "Request for viewHierarchy failed"). The flow `dictation` (`e2e/dictation-suite.yaml`, both dictation flows on one test Mac) runs only by name, with Metro started with `EXPO_PUBLIC_LH_E2E_DICTATION_TEXT`.
  - New flow `e2e/tabs.yaml` (`npm run e2e:tabs`): Teach, Practice and Graph, the gear opens Settings over the tab bar, back returns to Graph, and Teach keeps its list. One screenshot of each.
  - Flow fix: `first-turn.yaml` scrolls up to the answered card ("CORRECT"); on the SE, the teacher's reply pushes it off the top.
  - Results (screenshots in `e2e/screenshots/slice-e/promax` and `.../se`, not in git): first-turn, teach-cycle, rich-lesson, wide-content, practice, open-long, teach-shelf, teach-folders, practice-shelf, tabs and dictation all pass on the Pro Max (light) and the SE (dark). Flakes seen, none from the app: the Maestro driver hang (SE practice; the rerun passed) and the lost pairing text (Pro Max first-turn; the rerun passed).

### Error states

| State                                                                                   | Message and behavior                                                                            |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. The sources call fails                                                               | All sessions under "Not in a folder"; a quiet note "Folders could not be loaded."               |
| 2. The graph call fails                                                                 | No numbers on the rows.                                                                         |
| 3. The chats call fails                                                                 | The connection banner or "Your sessions could not be loaded. Pull to try again."                |
| 4. A tab is empty                                                                       | "Start a session to begin learning." and the "+" button.                                        |
| 5. The Mac refuses the folder route (older fork build)                                  | "Update LearnHarness on your Mac to change folders."                                            |
| 6. The Mac refuses a folder change (400: bad name, a cycle, a folder that is not empty) | The server's case as a message from `describeError` (never raw text). The list stays as it was. |
| 7. The network fails during a folder change                                             | "Not saved. Check the connection to your Mac." The list stays as it was.                        |

## 21 Performance: session open, WebView leak, local timing marks `todo`

User decision 2026-11-18: add this issue after the walkthrough numbers. The app is local and single user, so it gets no cloud dashboards and no alerts. It gets local timing marks, a developer panel, MetricKit, and performance budgets in the tests. Source: `docs/reviews/2026-11-18-e2e-walkthrough.md` (dev build, Simulators, golden data).

### Facts (walkthrough 2026-11-18)

- A large session open (golden teach session, 360 KB, 95 messages) takes 8.2–9.1 s on the Pro Max and about 12 s on the SE. About 83% is JS work with a frozen screen (6.7–6.9 s: the mount of the whole transcript, the reveal slots, `projectView`). The Mac route takes 47–88 ms; the fetch is at most about 0.5 s.
- Thus a prefetch of the newest N records saves little on the test rig. Check again in a Release build on the iPhone (faster JS, slower network) before a decision.
- WebView leak: each open of the golden session starts about 29 `com.apple.WebKit.WebContent` processes that do not end when the session closes (102 after 3–4 opens, gone only when the app quits). iOS can stop the app for memory.
- The reveal gate cost grows with the square of the block count (Node: 300 blocks 18 ms, 1000 blocks 170 ms).
- The `Spinner` runs on a JS `setInterval`, so it stops while the JS thread is busy (up to 7 s).
- The Teach tab reads the whole graph (429 KB) and the newest record on each focus.

### Slices (plan, order by impact)

- A. Timing marks: tap, record fetched, record parsed, first transcript commit, reveal idle, follow at end; the island count for each session. A small ring buffer, shown in the developer section of Settings. Measure the Release build on the iPhone. This gives the baseline for B to E.

### Slice A state (2026-11-18, built; the iPhone baseline is not measured yet)

- User decisions (2026-11-18, after the panel mockup): the panel as in the mockup; start with the five phases; add the sub-phases of the transcript draw (`projectView`, `transcriptRows`, `revealPlan`, the React commit) only after the first profile. The panel says which phase is slow. A profiler (Hermes sampling profiler, React Profiler, Instruments) says which function.
- `src/lib/perf-marks.ts` (pure): one trace for each open; the marks `fetched`, `parsed`, `drawn`, `idle`, `atEnd` (ms from the tap); the five phases (Fetch, Parse, First transcript draw, Reveal to idle, Scroll to the end); the longest frame gap (the JS thread was busy); the islands started; a ring buffer of 50 opens; median and p95 (nearest rank) of the opens that reached the end; the outcomes `end`, `left`, `timeout` (60 s). Each open keeps the build: type, commit (`app.config.ts` puts `git rev-parse --short HEAD`, with `-dirty`, in `extra.commit`), device, OS.
- `src/lib/perf.ts`: the one store with `performance.now()`, `requestAnimationFrame`, and the file `Documents/perf-opens.json` (new dependency `expo-file-system`, an Expo SDK module).
- Mark points: `openSession` in `src/components/shelf.tsx` (the tap); `readSession` `onResponse` (fetched); `useSessionRecord` (parsed); the first effect of `SessionBody` (drawn); `RevealProvider` `onIdle` (idle); the first scroll, size or layout event at the end after the idle (atEnd). A screen that no tap opened (a new session) starts its open at mount (`from: "mount"`). `WebIsland` counts its mounts.
- Fix found by the test: `RevealProvider` never called `onIdle` for a transcript with no block (only a learner message), so the opening of the end follow did not end either. It now checks once after the first render.
- The panel: `src/components/perf-panel.tsx`, "Developer: performance" in Settings (where the developer section shows). The summary uses only the opens of the last open's build. "Island WebViews mounted now" counts mounted island components; the leaked WebKit processes of slice B are processes, so the slice B check also counts `com.apple.WebKit.WebContent` processes.
- Tools: `npm run e2e:perf-open` (`e2e/perf-open.yaml`: the fixed scenario, the golden session opened 5 times from its row), `npm run perf:collect` (the Simulator file, or `--file` for a shared iPhone file, into `perf/results/<commit>-<type>-<device>.json`), `npm run perf:chart` (`perf/chart.html`, a stacked bar of the median phases for each build, with the p95; publish it as an artifact page).
- Simulator check (2026-11-18, dev build of `941c873` plus this change, Pro Max Simulator, `LH_E2E_GOLDEN=1 LH_E2E_MATH=1`, `npm run e2e:perf-open`): all 5 opens reached the end; total median 10.69 s, p95 12.21 s; Fetch 0.15 s, Parse 0.21 s, First transcript draw 4.54 s, Reveal to idle 4.48 s, Scroll to the end 1.24 s; longest frozen frame median 5.79 s; 77 to 89 islands started per open. A dev build on the Simulator is not the baseline (measurement rule 1): the baseline is a Release build on the iPhone. The panel showed as in the mockup.
- Slice B evidence from the same run: after the 5 opens, "Island WebViews mounted now" was 0, but the Simulator had 291 `com.apple.WebKit.WebContent` processes. The components unmount; the WebKit processes stay.
- **iPhone baseline (2026-11-18, Release build of `98a44fd`, iPhone 13 Pro Max, iOS 26.5.2, the user's real sessions):** `perf/results/98a44fd-release-iPhone-13-Pro-Max.json`, chart `npm run perf:chart -- --all` (artifact page https://claude.ai/artifact/6GydcJHK7JrRkXXRzXouDg). The phases of each open, in s (fetch, parse, draw, reveal, end; total):
  - Short session (22 messages), 3 of 3 reached the end: total 0.48 to 0.57 s; 0 islands; longest frozen frame 0.08 to 0.12 s. No problem.
  - Medium session (240 messages), 1 of 1: 0.22, 0.21, 4.33, 1.77, 3.88; total 10.41 s; frozen 6.2 s; 5 islands.
  - Longest session (407 messages, 184 concepts), only 1 of 3 reached the end: 0.15, 0.54, 6.66, 27.28, 13.15; total 47.77 s; frozen 15.2 s; 542 islands. The other 2 opens hit the 60 s timeout (draw marks at 15.3 s and 12.3 s; frozen 16.9 s and 20.9 s; 508 and 518 islands). The user had to close the app: the screen froze and did not load.
  - Conclusion: the fetch is never the problem (0.1 to 1.3 s). The draw of the whole transcript and the reveal of all islands take the time, and they grow with the session size. This confirms slice D (draw only the end first, older rows on scroll up, islands only near the screen) as the main fix; slice B (the WebKit leak) adds to the freeze. The user asked for this paged load (2026-11-18).
  - The install did not make a new profile: the app on the iPhone stops opening on 2026-11-23 03:23 UTC.
  - `perf-chart.ts` has a new `--all` option: one row for each build and session, with "reached the end" as "n of total".
- Gotcha (build): a Release build and a Debug build share `ios/Pods`, and the prebuilt React core, Hermes and Expo modules switch their flavor in place (`.last_build_configuration` markers). After the Mac restarted during a build, the markers said Debug but some files were Release: the link failed (`Sealable::ensureUnsealed` missing), then the app crashed at launch (`CDPDebugAPI` missing, then a `Props` layout crash in `ExpoModulesCore`). Fix: `rm -rf ios/Pods`, `pod install` (with `LANG=en_US.UTF-8`), then build. Also: `expo-file-system` was already in the app as a dependency of `expo`; the new direct dependency changes no native code.
- Tests: `tests/perf-marks.test.ts` (17), `tests/app-perf.test.tsx` (a row tap records all five marks in order; the panel and Clear). `tests/app-pairing.test.tsx` now has the 20 s timeout of the other app tests (its first test timed out at 5 s under full-suite load; it takes about 2 s alone, with and without this change).

### Slice D state (2026-11-18, built; the iPhone check is not done yet)

- User decisions (2026-11-18, after the mockups, D-014): open at the end in the first frame, with no scroll motion and no top-to-bottom reveal; near the top the next page of older rows loads by itself (mockup 2A); a formula or chart starts its WebView only near the screen and closes when far. Rule: the paged draw must not change the model's use of the session (the phone sends only `{ chatId, input }`; the record stays whole in `SessionModel`).
- `src/lib/transcript-window.ts`: `PAGE_ROWS` (30), `firstStart`, `earlierStart`, `keepStart`, `wantsEarlier` (within one screen of the top). The session screen draws `rows.slice(start)`; `EarlierLine` ("Loading earlier messages", testID `earlier-rows`) is child 0 of the scroll content, and `maintainVisibleContentPosition={{ minIndexForVisible: 1 }}` keeps the visible row in place when a page comes in above it. One page at a time: the next page waits for the next content size change.
- `Transcript` (`start` prop) renders its rows as direct children of the scroll content (no wrapper view), with slot keys from the row's place in the whole record. The content has no `gap`; the lines and the dock under the transcript are in one `tail` view. Tests use `transcript-scroll`, not `transcript`.
- The reveal gate has `hold: false` (`RevealProvider hold={false}` in the session screen): every block shows at once; the gate only reports when the blocks are drawn (the `idle` mark and the end of the opening). Each block has its own 1.5 s limit, and the limits run at the same time (the first try ran them one after the other: "Reveal to idle" grew to 8.4 s).
- `createIslandViewport({ waiting: true })`: the islands measure their place only after the frame of the jump to the end (`requestAnimationFrame(viewport.start)` after the first `scrollToEnd`). Without it, the islands at the top of the page window counted as near in the first frame (47 to 52 islands for each open). The opening scrolls with `animated: false`.
- Simulator check (2026-11-18, dev build, Pro Max, `LH_E2E_GOLDEN=1 LH_E2E_MATH=1`, `e2e:perf-open`): 5 of 5 reached the end; total median 5.08 s (slice A: 10.69 s), draw 2.02 s (4.54 s), reveal 2.75 s (4.48 s), longest frozen frame 4.38 s (5.79 s), 3 to 11 islands for each open (77 to 89), 0 WebKit processes after the 5 opens with the app still open (slice A: 291; the 291 ended when the app stopped). `e2e:open-long` passed. A dev build is not the baseline: the label of these opens is the old `941c873-dirty`, because a dev build keeps the commit of its native build.
- Known trade-off: older rows show the quiet formula box first, and the formula draws when it comes near. The box has the size of the TeX source, so the text near it moves a little when the formula draws. Before, the held reveal drew every formula of the session during the open (the freeze).
- Tests: `tests/transcript-window.test.ts`, `tests/app-session-window.test.tsx` (the last page first, a page near the top, then the rest), `tests/reveal-gate.test.ts` (hold off, limits at the same time), `tests/islands.test.tsx` (a waiting viewport). Jest 693 pass.
- **iPhone check (2026-11-18, Release `6099033`, iPhone 13 Pro Max, `perf/results/6099033-release-iPhone-13-Pro-Max.json`):** the longest session (407 messages) reached the end in 5 of 5 opens (baseline: 1 of 3). Total 4.67 to 5.08 s, median 4.81 s (baseline 47.77 s, and 2 timeouts at 60 s). Phases (median): fetch 0.21 s, parse 0.45 s, draw 1.97 s, reveal 2.10 s, end 0 ms. Longest frozen frame 4.1 to 4.3 s (baseline 15 to 21 s). 7 to 9 islands for each open (baseline 508 to 542). The medium session was not opened again. Chart: https://claude.ai/artifact/6GydcJHK7JrRkXXRzXouDg.
- Still slow: the JS thread is busy for about 4 s in one frame (the draw of 30 rows, 2 s, and the island start, 2 s). The draw time is the same as on the Simulator dev build, so it is probably work over the whole record, not the 30 rows (for example `transcriptRows` and `phaseAt3Lh` over all 407 messages, or the Markdown of the 30 rows). Next: a Hermes profile of one open of this session (now the profile measures the code that stays), then fix the top cost and measure again. Then decide on slice B: count the WebKit processes on the iPhone (Instruments), because the Simulator count is now 0.
- **Hermes profile (2026-11-18, `b92e2a7`, Pro Max Simulator, dev client, golden session with `LH_E2E_MATH=1`, 3 opens):** the 3 long frozen stretches are 4.3, 3.7 and 3.4 s. Of the 14.5 s busy time in the stretches over 0.5 s:
  - `transcriptRows` over the whole record (`SessionBody`): 4.4 s, about 1.5 s for each open. Nearly all of it is `teacherText` → `repairMathForDisplay` (fork `src/core/math-delims.ts`), which runs the micromark parser 3 times for each teacher text (`recoverDocumentLayout`, `mapMathContent`, `transformMathDelimiters` through `readContentSpans`). It runs for all 407 messages, but the screen draws only 30 rows.
  - `MarkdownTree` (the 30 drawn rows): 2.1 s, of which `parseMarkdown` 1.2 s (a 4th parse of the same text).
  - The plan graph layout (dagre) 0.4 s, the reveal gate 0.3 s, `renderTex` 0.15 s. The rest is React commit and native view creation (`completeRoot`, `createNode`, `createTask`).
  - Caveat: the bundle had `dev=true` (the dev client ignored `--no-dev`), so React dev checks add some time. The order of the costs is clear.
  - **Fix (`b26e8bd`, user decision 2026-11-18):** text and reasoning rows keep the stored text, and the drawn row repairs it (`teacherText` in `components/transcript.tsx`). `teacherText` keeps a cache of 1000 repaired texts (the oldest use goes first), so a redraw, a new page or a second open does not repeat the repair. Question rows and answer cards still repair when the rows are built (about 0.1 s for each open), now through the cache. The record and the phone's request do not change (D-014). Profile after the fix, same 3 opens: `transcriptRows` 4.4 s to 0.36 s; busy time in the long stretches 14.5 s to 8.5 s; longest stretch 4.3 s to 3.1 s (the first open; the cache makes the next opens shorter, 2.2 and 1.3 s). Left: `MarkdownTree` 1.4 s (a 4th parse of each drawn text) and React commit. A later fix can parse each text one time, but that code is shared with the desktop (fork `src/core`).
  - **iPhone check of the fix (2026-11-18, Release `fdb5370` = the code of `b26e8bd`, `perf/results/fdb5370-release-iPhone-13-Pro-Max.json`):** the longest session (407 messages), 5 of 5 reached the end. Total 3.47 to 4.72 s, median 3.87 s (`6099033`: 4.81 s). Draw median 0.80 s (1.97 s). Reveal median 2.27 s (2.10 s). Longest frozen frame median 3.30 s (4.12 s). 7 to 9 islands. The medium session (240 messages, 1 open): 4.31 s (`98a44fd`: 10.41 s), draw 1.77 s, reveal 2.16 s, frozen 4.19 s, **0 islands**.
  - What is left: "Reveal to idle" is about 2.1 s also with 0 islands, so it is not the island WebViews. It is probably the React commit and the native layout of the 30 drawn rows before each slot reports its size (the profile shows `completeRoot`, `createNode`, `createTask` and `MarkdownTree`). User decision (2026-11-18): slice B first. Later: profile one open of the medium session (no islands) to split this time, then decide between fewer rows in the first page, a cheaper Markdown draw (one parse for each text) and a lighter view tree for each row.
  - How to record: the debugger proxy of Metro (`/json/list`, then CDP `Profiler.start` and `Profiler.stop` over its WebSocket, with the origin `http://127.0.0.1:8081` and a browser user agent; other values close the socket). Map the frames with the bundle's `.map` from Metro.

- B. Fix the WebView leak: an island WebView ends when its slot unmounts or goes far. An E2E check of the WebKit process count after a session closes.
  - **iPhone count (2026-11-18, Release `fdb5370`, `perf/results/2026-11-18-iphone-webkit-count.log`):** `xcrun devicectl device info processes --device <id> --json-output <file>` lists the iPhone processes over the network (no Instruments). The script counted `com.apple.WebKit.WebContent` every 5 s. The user opened the longest session 3 times, scrolled up through about half of it each time, went back to the list, then quit the app.
    - Before the app started: 1 to 2 (other apps).
    - During the scroll up: peaks of 61, 51 and 48. The count falls again in 5 to 30 s (to 4, 6 and 11), so the processes end when the islands unmount. The old leak (about 29 processes for each open that never end) is gone.
    - On the session list for 60 s after the 3rd open: 11, with no change. After the quit: 1.
    - Open points: the peak of about 50 to 60 processes during a scroll, and the 10 processes that stay on the list (this can be a WebKit process cache or a slow growth; 3 opens do not show which).
  - **Pick up later (user decision 2026-11-18: park slice B, go on with other issues, come back to it):**
    1. A longer count: 6 open-and-back cycles of the longest session with no long scroll, then 2 minutes on the list. Use the poll script below. If the count stays near 10, it is a cache: close the leak finding. If it grows with each open, find the island that does not end and fix it, with a test.
    2. Then decide whether to limit the number of islands that mount at the same time during a scroll (the peak of about 60 processes).
    3. Then profile one open of the medium session to split the 2.1 s reveal (see "Slice D state").
    - Poll script: every 5 s, run `xcrun devicectl device info processes --device <device id> --json-output <file> -q`, then count the `executable` values that contain `WebKit.WebContent` in `result.runningProcesses`. The JSON gives no owner app, so subtract the count before the app starts (1 to 2).
- C. Spinner on the UI thread (native driver or `ActivityIndicator`).
- D. Do not mount the whole transcript at once: a virtualized list from the end, or the last rows first and older rows in idle chunks. Make the reveal gate cheaper (ordered insert, notify only changed slots). Absorbs the bug "Choppy load of a large session". Show the title and phase from the list item at once.
- E. Prefetch, only if A shows that the fetch matters on the iPhone: first keep the record that the continue card read and give it to the session screen.
- F. MetricKit (launch time, hangs) through a small native module; performance budgets in Jest (for example the number of islands that start at once).

Other walkthrough findings go to the issue of their screen: the native network error text is not mapped in `describeError` and a failed send does not call `monitor.check()`; the refresh spinner shows on each tab focus; small rough edges (empty session hint, plan sheet close tap, SE placeholder wraps, "Forget this Mac" blank second, "+" field focus).

## 22 Rebrand: LearnHarness to OrbiTutor `todo`

User request 2026-11-23: after the current work, rename the app from LearnHarness to LearnLoop, with a new color scheme and a new logo. Do not start before issue 08 is done.

Style references from the user (for style only; the logo and colors must be our own, not a copy):

- Hello Interview: the color scheme and the logo style (the same app is the reference for issue 20).
- Scale: the logo style.
- The current LearnHarness logo style ("pretty cool"): keep what works.

Facts to remember:

- The fork and upstream are AGPL-3.0-only, and so is the phone repo. A rename is permitted, but the license and the copyright notices stay, and the source stays open.
- The bundle id `dev.local.learnharnessmobile` and the scheme `learnharnessmobile` are in `app.json`. A new bundle id makes a new app on the iPhone: the user pairs again, and the old app stays until the user deletes it.
- The desktop fork follows upstream LearnHarness (`docs/UPSTREAM-SYNC.md`). A rename in the fork makes each upstream merge conflict in many files.

Decisions (user, 2026-11-23). Plan: `~/.claude/plans/curried-baking-mountain.md`.

1. Scope: everything, in both repos, code names too (the user: "this has to be kept open source").
2. Timing: after issue 08 (slices E, F and G).
3. Colors: one new palette for both apps (the phone tokens and a new fork theme, made the default).
4. iPhone: a new bundle id and URL scheme. The user pairs again and deletes the old app.

Upstream sync (the user asked how to keep merges easy): the rename is a script (`scripts/rebrand.mjs` in the fork), not hand edits. For each upstream sync, run the script on the new upstream tag, commit it, and merge that commit. Both sides then have the same rename, so only real code changes can conflict. This comes from how a three-way merge works; phase A proves it with a dry run first. An allowlist keeps `LICENSE`, the copyright lines and the upstream URLs. A `--check` step in CI finds new old-name strings.

Risks with a guard each (details in the plan):

- The user's real data: the app name sets the `userData` folder. The first LearnLoop start COPIES the LearnHarness folder (never moves it) and keeps the old one. Back up with `ditto` before the install.
- Credential and keychain names: copy the old entries, keep them.
- The phone protocol (`x-learnharness-desktop`, the TLS name, the pairing check): rename all at once and raise the pairing protocol number.
- The tool bridge name and the tool namespace: the recorded golden chats must still load.
- Plugins: package names and the plugin API reference (rebuild it).
- The `../learnharness` paths in the phone repo, the GitHub repo names, the remotes, the claims file and the memory.

Name and phase A (user and side session `local_d7c35fba`, 2026-11-23). Report: `docs/reviews/2026-11-23-rebrand-proof.md`.

- The name is **OrbiTutor**. "LEARNLOOP" is a registered US trademark for educational software, so LearnLoop is rejected. Forms: `OrbiTutor` (display), `orbitutor` (code, packages), `ORBITUTOR` (constants). The new bundle id is `dev.local.orbitutormobile`. Read "LearnLoop" in the text above as "OrbiTutor".
- Upstream sync: method (b) above (codemod on the new tag, then merge) does NOT remove the name conflicts (12 files, one more than a plain merge). Use method (b2): a renamed upstream line made with `commit-tree`, and one fork `merge -s ours` of its first commit. See the report.
- Logo idea that the user likes: a leaf with a curved stem in orbit loops, green glow on a dark tile. The phase A files (vector logo, codemod prototype, merge simulation) are in the `orbitutor-brand/` folder of the main session's notes folder, not in a repo. Phase B makes our own vector version and checks it at 29 pt, at 16 px and on light backgrounds.
- Domains: the user registers all OrbiTutor domains together near the launch (at least `orbitutor.com` and `orbitutor.ai`). They were free on 2026-11-23.
- Open: keep or change the upstream links in README, SECURITY and CONTRIBUTING (phase E). The phase E data migration must keep the old folder name (the `rebrand-keep` marker).

Phases (one branch and one PR each, from master):

- A. The dry run of the script on a throwaway clone (count the conflicts with and without it). A name check for "LearnLoop" (App Store, trademarks).
- B. Mockups: 3–4 logo directions and 2–3 palettes at 375 pt, light and dark, next to the references and on the desktop. WCAG AA contrast. The user chooses.
- C. The palette (phone tokens, fork theme).
- D. The logo and icons (fork `build/icon*`, `components/lh-mark.tsx`; phone `assets/` icon and splash).
- E. The rename in the fork (script, allowlist, data copy with tests, CI check, `docs/UPSTREAM-SYNC.md`).
- F. The rename in the phone (`app.json` name, slug, scheme, bundle id `dev.local.orbitutormobile`, texts, docs).
- B2. A one-page static website (logo, short description, downloads, GitHub repo, AGPL source notice) in the new palette, on a static host with HTTPS.
- G. The GitHub repos and local folders; fix the remotes and paths.

## Choppy load of a large session (bug, 2026-11-17) `todo`

- The user's report (iPhone 13 Pro Max, Release build of `e1b060e`): the scroll is very choppy while a large session loads.
- Likely cause (not checked): a hidden block of the reveal has no height (`RevealSlot`, `styles.hidden`), so all hidden blocks under the front are at the same place, near the bottom of the screen. Thus each of their formulas, charts and tables counts as near the screen (`useNearScreenState`) and starts its WebView at the same time. Also each scroll event (`scrollEventThrottle` 100 ms) calls `measureInWindow` for every island (`viewport.notify`).
- Next: measure first. Build a Release build for the Simulator (`xcodebuild -configuration Release -sdk iphonesimulator`, `-derivedDataPath ../build/release-sim`), open the golden session with `LH_E2E_MATH=1`, and record the screen (`xcrun simctl io <udid> recordVideo`). Count the WebViews that start, and time the load. Then show the user the fix options as mockups (for example: an island starts only when its slot is at the front or shown).

## Session open position (bug, 2026-11-17) `done` (the behavior of `e1b060e`)

- The user's report: a session opens at the top, not at the last message. The user thinks a touch during the load stopped the scroll to the end.
- Cause (confirmed on the Pro Max, 2026-11-17): the top-to-bottom reveal starts at the top. Each formula, chart or table near the screen holds the reveal for up to 1.5 s, so a session with many formulas opens at the top and crawls down for seconds. The golden session with no formulas opened at the end at once, also with a drag. With `LH_E2E_MATH=1` (a formula in each teacher reply) the first frame showed the top of the session. A drag during that crawl ended the follow under the old rules (any drag that ended away from the end).
- User decisions (2026-11-17, after the animated mockups): keep the open motion (the session opens and scrolls down to the end). The "↓ Latest" button shows when the reader is more than one screen up from the end.
- Fix: an opening phase in `createEndFollow` (`src/components/island-viewport.tsx`). During the opening, a touch does not stop the follow; only a drag up by more than `OPEN_DRAG_UP` (80 pt), with its momentum, does. The opening ends when the reveal is idle (`RevealProvider` `onIdle`, `RevealGate.busy()`) or with a tap on the status bar. `showsLatest` decides the button; a tap calls `toEnd()` and scrolls to the end. The button is `LatestButton` in `src/app/session/[id].tsx` (testID `go-latest`).
- Tests: `tests/end-follow.test.ts` (the opening, a touch, a drag up, its momentum, idle, the button rule), `tests/reveal-gate.test.ts` (`busy`), `tests/reveal.test.tsx` (`onIdle` after all blocks of a render), `tests/app-session.test.tsx` (the button shows and hides).
- E2E: `LH_E2E_GOLDEN=1 LH_E2E_MATH=1 npm run e2e:mac`, then `npm run e2e:open-long` (`e2e/open-long-session.yaml`: a touch during the opening, the last text, two swipes up, the button, its tap). Passed on the Pro Max and the SE (2026-11-17).
- iPhone check (user, 2026-11-17, Release build of `e1b060e`): **not fixed**. A touch during the open still stops the scroll down. The Simulator E2E passes, so it does not show the iPhone case.
- Likely cause (not checked yet): on iOS a touch stops the native animated `scrollToEnd`. During the opening the follow stays on, but the screen calls `scrollToEnd` only on the next `onContentSizeChange`. When the content does not grow after the touch, nothing scrolls again, and the view stays where the touch stopped it. In the Maestro run the reveal still grew the content after the swipe, so the scroll went on. A second possible cause: `onIdle` ends the opening too early (a short idle moment between two loads of the record, or before the islands register), and then the old rules stop the follow.
- Next: (1) in `dragEnd` and `momentumEnd` during the opening, when the follow is still on, call `scrollToEnd` again (make `createEndFollow` return that decision, so a unit test covers it); (2) log when `onIdle` ends the opening, and check on the iPhone; (3) add an E2E step: a touch after the reveal is done and the content has stopped (`waitForAnimationToEnd`, then a swipe, then the last text must show). Then a new Release build on the iPhone and the user's check.
- Second fix (2026-11-17, `e64c041`, REVERTED): `dragEnd`, `momentumEnd` and a new `touchEnd` in `createEndFollow` asked the screen to call `scrollToEnd` again when the follow was on and the view was not at the end. The opening ended only when the reveal was idle and the view was at the end. On the iPhone this was much worse: the view stopped at random places and took a long time to reach the end. Not explained; possibly the extra animated scrolls restart each other, and each scroll measures all islands again. Maestro could not show it: the new touch step also passed with the fix turned off (Maestro cannot touch during the native scroll of about 0.3 s on the Simulator).
- User decision (2026-11-17, after the second fix): keep the behavior of `e1b060e`. A touch before the view reaches the end can still stop the scroll down, but the "↓ Latest" button makes this a low-impact issue. The code is again the code of `e1b060e` (the revert commit). Release build on the iPhone.
- Do not try again without a device trace: a fix for the touch case must first log the follow decisions and the scroll events on the iPhone.
- Gotcha: the fork's `next dev` sometimes stops at a Next.js security notice (exit code 1). Start `e2e:mac` again. The notice also has text for AI agents; it is not a user instruction.

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

## 15 Personal build and setup guide `done`

Blocked by: 04.

- Unsigned local build of the fork for the user's Mac (no upstream notarization profile). Phone install with a development build or TestFlight (user's Apple account; the user does the sign-in).
- Guide: install Tailscale on Mac and iPhone (the user creates the account), turn on Phone Access, pair.
  Acceptance: the user pairs a real iPhone and does one lesson away from home.

### Facts (2026-11-15)

- The user runs LearnHarness 0.4.1 (upstream build, x86_64) from `~/Development/learnharness/dist/mac` on the real data (3.3 MB, 4 chats, Claude Code provider). A fork build must never write to `dist/`: the running app is there.
- The fork's `desktop:dist` builds arm64 only, signs with the upstream team and notarizes. This Mac is an Intel MacBook Pro (`MacBookPro16,1`). The personal build is x64, unsigned, not notarized, with its own output folder.
- No upstream data migration between 0.4.1 and 0.6.1 was found (only atomic-write fixes in the stores). The upgrade is still one-way, so take a backup first.
- System sleep is off on the power adapter (`pmset sleep 0`). A closed lid still puts the Mac to sleep.
- Tailscale is not installed. The gateway already sends Tailscale addresses (100.64.0.0/10) first, but only the addresses that exist at pairing time.
- Phone: iPhone 13 Pro Max, iOS 26.5.2, Developer Mode on, paired with Xcode. Xcode has the Personal Team `52B7323R6Q` (free). The upstream 0.4.1 build in `dist/mac` is signed with the same team, so the user built it on this Mac. Expo sets the team with `ios.appleTeamId` in `app.json`. On the paid team, change that ID.
- Not checked yet (from memory, can be wrong): iOS App Transport Security accepts the self-signed HTTPS connection to a 100.x address as it does for a LAN address. Check it in the Simulator after Tailscale is on.

### Decisions (2026-11-15)

- Replace 0.4.1 with the fork build in `/Applications`, on the real data, after a backup of the data folder.
- Free Apple ID (Personal Team) now: the app stops after 7 days. The user moves to the paid Developer Program on 2026-11-16 (1-year profile, TestFlight possible).
- Release build on the iPhone (JavaScript inside the app, no Metro).
- The Phone Access window warns when the Mac has no Tailscale address. Mockups first.

### Slices

- A. Fork: `npm run desktop:personal` (x64 unsigned build into `dist-personal/`). Start it once with a temporary data folder.
- B. Fork: the "no Tailscale address" warning in the Phone Access window (mockups, then code and tests).
- C. Install: back up the data, quit 0.4.1, install the fork build, open the real sessions.
- D. Tailscale on the Mac and the iPhone (the user). Check the 100.x address and the ATS question in the Simulator.
- E. Phone: Release build on the iPhone with the Personal Team. Pair over Tailscale.
- F. Guide: `docs/SETUP.md` (build, install, Tailscale, pair, keep the Mac awake, reinstall each 7 days on a free Apple ID, problems and fixes).
- G. Acceptance: one lesson with Wi-Fi off on the iPhone (cellular through Tailscale).

### State (2026-11-16)

- A and B: done (fork `a1f16a1`, pushed to `fork`). The fork suite has only the 3 known upstream failures. A start with a temporary `--user-data-dir` passed (server up, updater off).
- C: done. Backup `~/Library/Application Support/LearnHarness/data-backup-2026-11-15-v0.4.1` (same as `data` after 0.4.1 quit). The fork build 0.6.1 x64 is in `/Applications/LearnHarness.app` and runs on the real data. The user still has to confirm that the sessions show.
- E: the Release build is on the iPhone (profile until 2026-11-23). `expo run:ios` failed with "No profiles" (no `-allowProvisioningUpdates`); `xcodebuild -allowProvisioningUpdates` and `devicectl device install` worked. iOS refused the first start until the user trusts the Apple ID.
- F: `docs/SETUP.md` is written.
- D: done. Tailscale is on the Mac (`100.102.253.62`, `macbook-pro`) and the iPhone (`100.115.17.124`, `iphone-13-pro-max`), same account; `tailscale ping` works. The phone paired again with Tailscale on (device record `tailscale: true`).
- G found a blocker: on cellular the phone could not connect. Cause (proved in the Simulator log): iOS ATS refuses the self-signed certificate on the 100.x address ("ATS failed system trust") before the pin check. `NSAllowsLocalNetworking` covers only LAN addresses. User decision 2026-11-16: ATS off ("pinned" policy), behind one config plugin so that another policy is easy later, and a check of every other network path. Done in the phone repo (see `docs/TRANSPORT-SECURITY.md`): `plugins/with-transport-security.js`, ESLint network guards for `src/`, `tests/transport-security.test.ts`. The audit found no other network path (WebView CSP has no network source, remote images blocked, links open in Safari).
- `scripts/e2e-mac.ts` has `LH_E2E_GATEWAY_HOST` (listen and pair on another address, for example the Tailscale one) and logs the gateway lines.
- One open oddity: in the first Simulator run, a handshake to the 100.x address stalled at `read_server_hello` for 4 s (no server answer); the second run got a HelloRetryRequest and went on to the ATS error. Watch for it in the next check.
- Done 2026-11-16: prebuild (the Info.plist has only `NSAllowsArbitraryLoads = true`). The new dev build is on both Simulators. Simulator check on `100.102.253.62`: `e2e/first-turn.yaml` passes on the Pro Max, no TLS errors in the gateway log. The 4 s `read_server_hello` stall did not come back.
- E again: the new Release build is on the iPhone. The phone was connected only over Wi-Fi (`transportType: localNetwork`, the charging port is broken). The first `devicectl` install timed out (`NWError 60`) while it mounted the developer disk image; a second try worked (keep the phone unlocked).
- G: done. The user did one lesson with Wi-Fi off, on cellular through Tailscale. The Mac log has no TLS errors after the new build. It has 3 `upstream error socket hang up` lines: `proxy()` in the fork's `electron/phone-access.cjs` logs them when the phone closes a stream and the gateway destroys the upstream request. They are noise, not failures. Fork `679599b` stops them (the installed Mac build does not have it yet: `npm run desktop:personal` and install again).
- Apple team: Xcode still has only the free Personal Team `52B7323R6Q`. When the paid team is active, change `ios.appleTeamId`, prebuild, build again. The free profile ends on 2026-11-23.

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

## 18 Visual design that matches the desktop `done`

Blocked by: 04, 05. Requested by the user on 2026-11-14, after the real lesson check: the phone looks too plain next to the desktop.

- Take the desktop's look as the reference: the dark theme (and light), the monospace small-caps labels ("YOU", "AGENT'S THINKING", "PROBE"), card borders and radius, spacing and typography. Read the fork's Tailwind theme and components for the exact values; do not guess (upstream `AGENTS.md`: ask the user about design decisions).
- Question cards as on the desktop: the kind tag (PROBE, CHECK), the CORRECT or INCORRECT tag, ✓ on the correct option and ✗ on the chosen wrong one, the confidence bar with its stops, and "Your thinking" folded.
- Tool rows as on the desktop: the tool name in small caps with its main argument (for example `LIST_PROPOSITIONS chat_…`), folded, and they open to show the input and the output.
- Error states: errors, empty lists and loading states get the same design care (see `AGENTS.md`, "Error states").
- App icon and splash screen: the app still uses the Expo starter images (`assets/images/icon.png`, `assets/expo.icon`, `assets/images/splash-icon.png` on blue `#208AEF`). Replace them with LearnHarness images (ask the user which ones).
  Acceptance: screenshots of the same session on the desktop and the phone side by side, approved by the user; screen tests still pass.
- Inline code: decide between the native band (color and background only) and a `View` inside the text (rounded and padded, but it cannot break across lines). See issue 05, "Accepted limit". Show the user Simulator screenshots of both.

**Desktop values (read 2026-11-15, fork files).**

- Fonts (`app/layout.tsx`, `app/globals.css`): JetBrains Mono for the UI, the small-caps labels and code (`--font-ui`, `--font-mono`; `body` is mono); Source Sans 3 (variable, 200–900) for prose and inputs (`.lh-prose`, `.lh-input`); CMU Serif Bold for titles (`public/fonts/cmunbx.ttf`, OFL, `--font-title`, weight 900 class). All three are OFL.
- Default theme (dark, `globals.css:38-83`): bg #141414, panel #1c1c1c, line #434343, text and line-strong #e6e6e6, muted #8d8d8d, hover #2a2a2a, success #22c55e, error #ef4444, warning #f59e0b. Buttons (`--primary`) are the text color with the bg color on top. Ivory (`src/core/themes.ts:191-195`): bg #faf9f5, surface #f0eee6, border #e0ddd2, text #3d3d3a, muted #83827d, accent #d97757, code #c4613f, error #c43d3d, success #3f8f6b. Code block bg: bg mixed with black, 86% (dark) or 96% (light).
- Type scale (`globals.css:120-133`): 11, 12.5, 14, 16, 20, 25, 32 px. Prose 16 px, line height 1.5. Labels: 11 px mono, weight 500, uppercase, 0.025em, muted. Headings weight 900; bold 700.
- Radii: the fork's ladder is `rounded-sm` 4, `rounded-md` and bare `rounded` 8, `rounded-lg` 12, `rounded-xl` 16 (`globals.css:134-139`); `rounded-2xl` is 16 (Tailwind default). So cards are 16, option rows 12, badges 8. Code block `rounded-xl`-like 12 px (`0.75rem` in CSS). The first read of 2026-11-15 used 12 for cards; slice D fixed it. Borders 1 px. Answered card `rounded-xl border bg-card p-4`; option rows `rounded-lg border px-3 py-1.5`; composer `rounded-2xl border bg-card shadow-lg` (the only shadow); probe card `rounded-xl border bg-card/60 p-3`; agent prose has no card.
- User message: a full-width band, left rail `calc(3ch - 14px)` in muted at 30%, bg-card, label YOU (`components/chat.tsx:1863-1869`).
- Question card: kind tag eyebrow; `StatusBadge` (status color text on a 15% tint, `rounded px-1.5 py-0.5`); option tints (correct chosen: success 60% border, 10% bg; wrong chosen: error; correct not chosen: success 40% border); ✓/✗ glyphs 14 px; confidence rail `h-1.5 rounded-full border`, stops 0/30/50/70/90/100 with colors #ef4444 #f97316 #eab308 #84cc16 #22c55e #10b981, ticks at 30/50/70/90, the % readout; "Your thinking" folded with a chevron, open text italic at 50%; "Why" in a muted box.
- Tool rows (`components/artifacts/tool-call-card.tsx`): folded; 11 px muted summary with the tool name in small caps (error color on failure), the main argument, a chevron; open panel `rounded-xl border bg-card p-3` with Input, Output or Error and 11 px mono blocks.
- Icon: `build/icon-flat.svg` (1024 viewBox), `build/icon.png` (512), `build/icon.icon/` (Icon Composer, bg #141414). Mark: `components/lh-mark.tsx`.

**Decisions (user, 2026-11-15, from mockups).**

1. Fonts A: the desktop fonts (JetBrains Mono, Source Sans 3, CMU Serif), bundled in the app.
2. Light mode A: the desktop Ivory theme. Dark mode is the desktop default theme.
3. The learner's message A: the desktop band with the rail and YOU.
4. Icon A: the desktop icon (`build/icon-flat.svg`) and the mark on the splash (#141414 dark).
5. Inline code as a `View` (2026-11-15, from Simulator screenshots of both): rounded (8), a 1 pt line, the code tint, 12.5 pt mono in 16 pt prose. Accepted limit: one code span cannot break across lines; a span wider than the line is cut.
6. Session header A (2026-11-15, mockups): the title in the title font at 17 pt and the phase label in the iOS bar, the desktop Plan chip (pill, waypoints mark, PLAN) on the right.
7. Stop in the composer (2026-11-15): as on the desktop, the send button is a Stop square while a turn runs and the field is empty; typed text sends a steer. The confirm alert stays. This replaces the header Stop of 2026-11-14.
8. The other slice D screens as in the mockups (2026-11-15): home as the desktop sidebar list (connection as one mono line with a dot, a bordered NEW SESSION button, SESSIONS label, rows with the title in prose and a mono line "state or phase · time ago", pull to refresh), Settings and pairing as desktop settings sections, the Plan list with mono NOW/DONE/NEXT and a yellow current mark (#eab308), the desktop error banner, the braille spinner with a small-caps line.
9. The back button is only the arrow (`headerBackButtonDisplayMode: "minimal"`, user request 2026-11-15).

**Slices and state (2026-11-15).**

- **A. Colors, type and fonts. Done** (`db685a3`). `src/components/ui.tsx`: `Palette` with the desktop tokens (dark default theme, Ivory light, emphasis colors `strong`, `italic`, `code`; `primary` ink buttons; `hover`), `alpha()`, `FONT` (ui JetBrains Mono, prose Source Sans 3, title CMU Serif), `TYPE` (the desktop scale), `LABEL` (11 pt mono, 500, uppercase). Fonts are embedded with the `expo-font` plugin in `app.json` (`@expo-google-fonts/*` and `assets/fonts/cmunbx.ttf` with its OFL): iOS picks the weight and the italic inside a family, so Markdown bold and italic work with no extra code (checked on the Simulator). The Markdown base is the prose font; code is JetBrains Mono; headings weight 900.
- **F. Icon and splash. Checked on the Pro Max (2026-11-15).** The home screen icon is the desktop mark. The splash is the mark on #faf9f5 (light) and #141414 (dark). Note: after an icon or splash change, iOS can show its old launch snapshot (the Expo blue) also after a reinstall: delete `Library/SplashBoard` in the app's data container and restart the Simulator device. The name under the icon is "LearnHarness" (`app.json` `name`, user request 2026-11-15; prebuild renamed the native project to `ios/LearnHarness.xcodeproj`, the bundle identifier is unchanged).
- **B. Transcript. Done, first Simulator look passed** (`db685a3`): the YOU band with the rail, the small-caps labels, the status badge, the option tints, `src/components/confidence-rail.tsx`, folded "Your thinking", "AGENT'S THINKING" folded with the rail.
- **C. Tool rows. Done** (`db685a3`): `src/lib/tool-row.ts` (the desktop `headlineArg` and `outputText`, cut at 2,000 and 8,000 characters, never throws, a failed call shows "The tool failed." and never the raw error). Tests: `tests/design.test.tsx` (14). Note: the desktop shows the card only for read, ls, find, grep, list_sessions and list_propositions, and nothing for other unregistered tools; the phone shows a folded row for every other tool (it cannot draw their own cards yet).
- **D. Other screens. Done** (`2c0c7bb` and the slice D commit). `ui.tsx`: `Spinner` (the desktop braille frames as SVG dots, 80 ms, still with Reduce Motion), `StatusLine`, `ErrorBanner` (danger 50% line, 10% fill), `Section` and `SectionLabel`, `Icon` (SF Symbols through `expo-symbols`), `Button size="sm"`, a tinted `danger` button, `Panel` at radius 16. Session: header A, Plan chip, the composer (rounded-2xl, the only shadow, a 40 x 40 send button with the return mark, the Stop square), THINKING… and the compaction line with the spinner, the error banner. Probe card, Plan sheet list, home (`src/lib/time-ago.ts`, the desktop `timeAgo`), Settings, pairing and new session restyled. Code block background is the app's `codeBg` (the desktop mix in oklab: #0e0e0e dark, #edece8 light; the old values were mixed in sRGB). Note: `Link asChild` drops a `Pressable` style function: use `router.push` where the pressed style matters. Simulator check passed on the Pro Max (light and dark) and the SE (dark): home, Settings, the Not connected banner, the session, the probe card, the code block, the Plan sheet; `npm run e2e:rich` passes on both. Not seen on the Simulator: the running state (spinner and the Stop square); Jest covers it.
- **E. Inline code. Done** (the slice E commit): a `View` in the text (decision 5), moved down 3 pt to center on the line. Screenshots of both forms: `e2e/screenshots/inline-code-*-band-vs-view.png` (not in git).
- Acceptance: screenshots of the same session on the desktop and the phone, side by side. **Approved by the user 2026-11-15** (as they are, with the differences below): `e2e/screenshots/side-by-side/` (`all.png` and one file per row; not in git). Desktop: the fork's `npm run dev` on a copy of the test Mac's data folder, in the built-in browser at 1280 x 860, default dark theme (the test server needs the desktop secret header, so a browser cannot open it directly; the dev server and the test Mac share the `.next/dev` lock). Phone: the Pro Max in dark mode, `npm run e2e:rich` and one screenshot at the end. Differences seen: the failed Mermaid card (the desktop uses a red-tinted box with a small Retry; the phone has red text and a filled Try again), the gray fill behind Mermaid edge labels on the phone, and the plan divider text ("PLANNING" on the desktop, "PLAN · 2 STEPS" on the phone).
- Seen on the Pro Max (2026-11-15): light (Ivory) and dark (default) both look like the desktop; `npm run e2e:rich` still passes.

## 19 Visual and demo artifacts `todo`

Blocked by: 05. Split from issue 05 (user decision 2026-11-14).

- Visual (SVG) and demo artifacts through `POST /api/chats/:id/artifact-ui` (the gateway allows it) in a sandboxed WebView inside the lesson.
- Until this issue is done, an artifact shows as a placeholder row: "Interactive demo. Open it on the Mac."
- Needs its own security review before code: the sandbox, no network, no access to the device token or the pinned fetch, no navigation out of the WebView.
- List the error states here before the code (`AGENTS.md`, "Error states").
  Acceptance: a scripted lesson with one SVG artifact and one demo artifact renders on the Simulator; each error state has a test.
