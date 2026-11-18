# Decision log: LearnHarness Mobile and the desktop fork

This file records the big decisions of the project: the problem, how we found it, the options, the choice and why, the change, and how we checked that the result got better and not worse. It covers the iPhone app (this repo) and the desktop fork (`~/Development/learnharness`, branch `mobile/phone-access`). The fork keeps its decisions here too, so its own docs stay close to upstream and merge without conflicts.

Use it to explain the design in a demo. Each entry stands alone.

## Rules

- Add an entry for a decision that changes the architecture, the security, the data, the performance, or what the user sees on many screens. Small choices stay in `docs/ISSUES.md`.
- Write the entry when the decision is made. Add the validation when the result is measured. Never delete an entry: a decision that changes later gets a new entry, and the old one gets the status "Replaced by D-NNN".
- Give numbers when they exist. When something is not measured, write "Not measured".
- Link the commits, the issue and the evidence (a report, a test, a log).

## Template

```markdown
## D-NNN Title (YYYY-MM-DD) `status`

- Area: phone | desktop fork | both
- Problem: what was wrong or missing, and for whom.
- How we found it: the report, test, log or measurement.
- Options: each option with its main cost.
- Decision and why: the choice, who made it (user or proposal), and the reason.
- Change: commits, files.
- Validation: how we measured it; the numbers before and after; the tests that keep it.
- Impact and trade-offs: what got better, what got worse, what we accept.
- Links: issue, report, docs.
```

Status values: `proposed`, `accepted`, `done`, `reverted`, `replaced by D-NNN`.

## Measurement rules (for every performance decision)

1. Fixed scenarios: the same golden data, the same device, the same build type (Release for the final number), and many runs of each scenario (`npm run e2e:perf-open` opens the golden session 5 times). Report the median and the p95.
2. A baseline before the change, from the commit before it.
3. One result file for each measured build: `npm run perf:collect` writes `perf/results/<commit>-<type>-<device>.json` (issue 21 slice A).
4. When possible, a feature flag selects the old or the new code in the same build, so only the code changes.
5. A chart for each step: before and after, and over the commits. `npm run perf:chart` writes `perf/chart.html`; publish it as an artifact page, not as a hosted dashboard (the app is local).
6. A budget test, so that a slow change fails CI.

---

## D-001 The phone is a remote for the desktop app, through a fork with a gateway (2026-11-13) `accepted`

- Area: both
- Problem: LearnHarness is a desktop app. The user wants to continue lessons on an iPhone with the same sessions and the same knowledge graph. The user does not want an always-on program on the Mac and must never lose a long phone session.
- How we found it: the user's request and the investigation plan (`~/.claude/plans/there-is-this-open-source-ethereal-pearl.md`).
- Options: (a) a phone app that talks to the desktop app on the Mac (mode 1); (b) a cloud engine (mode 2); (c) the agents on the phone (mode 3). All three are in the PRD; the order was the choice.
- Decision and why: mode 1 first ("free path first", user, 2026-11-14). The Mac runs the agents, so the Claude Code CLI keeps working at no extra cost. A fork of the desktop app adds "Phone Access": a gateway in the Electron main process with pairing, device tokens, a route allowlist, and a stream proxy to the local server. The phone uses the same HTTP protocol as the desktop browser UI, so no new server API.
- Change: fork `4800177` (gateway), `2657a55` (issue 01), `78bb2bf` (security fixes); phone `ce6da79` (issue 02).
- Validation: `npm run test:phone-integration` (9 tests) runs the gateway against the real fork server; the phone's `npm run test:integration` runs the phone code against the real fork server. Both run in CI.
- Impact and trade-offs: the phone works only while the Mac app is open and reachable. Sync and mode 3 come later (issues 09 to 12).
- Links: `docs/PRD.md` "Solution" and "Implementation Decisions".

## D-002 Share the desktop's TypeScript code with the phone (2026-11-13) `accepted`

- Area: both
- Problem: the phone must show the same sessions, phases, questions, chain rows and folder order as the desktop. A copy of the logic drifts.
- How we found it: design choice at the start; confirmed again for the chain rows (issue 08) and the folder order (issue 20).
- Options: (a) Expo (React Native) with TypeScript, importing the fork's pure code through Metro; (b) a native Swift app with its own copy of the logic.
- Decision and why: (a). The phone imports `SessionModel`, `projectView`, the plan layout and the `src/core` helpers directly from the fork. When a helper lives inside a desktop component, we move it to the fork's `src/core` with no behavior change, and the desktop uses the moved code.
- Change: `src/lib/shared.ts` (the one list of what the phone takes from the fork); fork `d99dd16` (chain rows and usage format), `79f70b5` (folder order).
- Validation: fork tests pin each moved module (`tests/chain-rows.test.ts`, `tests/folder-order.test.ts`) and the desktop tests still pass (only the 3 known upstream failures). Phone tests run the same code.
- Impact and trade-offs: the phone depends on the fork folder (CI checks it out). Each move is a small fork commit that upstream does not have.
- Links: `docs/ISSUES.md` issues 08 and 20.

## D-003 HTTPS with a certificate pin in the QR code (2026-11-14) `done`

- Area: both
- Problem: the phone talks to the Mac over the home Wi-Fi or Tailscale. Plain HTTP would send the device token and the lessons in clear text.
- How we found it: security review of issue 01.
- Options: (a) plain HTTP inside Tailscale only; (b) HTTPS with a self-signed certificate and the SPKI pin in the pairing QR code; (c) a public certificate (needs a domain and renewals).
- Decision and why: (b) (user, 2026-11-14: "Tailscale + LAN TLS now"). The gateway serves HTTPS only, on every address. The certificate is made once with `node:crypto` and a small DER writer (user choice: no new dependency). The phone checks the pin on every request, so the token never goes to a server that fails the pin.
- Change: fork `8c1744d` (issue 01b), phone `src/lib/pairing.ts`.
- Validation: the integration test has a server with a wrong certificate that gets no request; `tests/helpers/pinned-fetch.ts` checks the pin before a byte is sent.
- Impact and trade-offs: a new certificate on the Mac removes the paired phones (pair again).
- Links: `docs/PRD.md` "Decisions", `docs/TRANSPORT-SECURITY.md`.

## D-004 Our own native pinned fetch module, not a pinning library (2026-11-14) `done`

- Area: phone
- Problem: the pin check must run before any byte leaves the phone, for Expo's `fetch` and for the streams.
- How we found it: a check of `react-native-ssl-public-key-pinning`.
- Options: (a) that library; (b) a small local Expo module in Swift.
- Decision and why: (b). The library uses TrustKit, which refuses a self-signed certificate before the pin check and needs 2 pins, and it hooks only React Native's networking, not Expo's `fetch`.
- Change: `modules/pinned-fetch` (`PinCheck.swift`, `PinnedSession.swift`, `PinnedFetchModule.swift`).
- Validation: `npm run test:native-pin` compiles the Swift files for macOS and runs them against a real HTTPS server: the right pin works, and a server with another certificate gets no request.
- Impact and trade-offs: we maintain a small native module.
- Links: `docs/PRD.md` Status.

## D-005 App Transport Security off, the pin is the trust (2026-11-16) `done`

- Area: phone
- Problem: the phone failed to connect over Tailscale and over cellular.
- How we found it: the Simulator log showed `ATS failed system trust` for the test Mac on a Tailscale address; the real iPhone on cellular failed the same way (the Mac logged `TLS handshake failed: ECONNRESET`). The same code passed on the LAN address.
- Options: (a) ATS exceptions for each address range (iOS does not treat Tailscale `100.64.0.0/10` as local); (b) ATS off, and the pin as the only trust.
- Decision and why: (b). This lowers a security floor, so it came with an audit and guards in one place (user rule).
- Change: `plugins/with-transport-security.js` (the policy in one place), ESLint guards against other network APIs, WebView island lockdown.
- Validation: `tests/transport-security.test.ts` checks the policy, the lint guard and the native network files. Pairing over Tailscale passed on the iPhone.
- Impact and trade-offs: ATS no longer catches a mistake, so the lint rules and tests must.
- Links: `docs/TRANSPORT-SECURITY.md`, issue 15.

## D-006 Native views for text, WebView islands only for math and charts (2026-11-15) `done`

- Area: phone
- Problem: lessons have Markdown, code, math (KaTeX) and Mermaid charts. The desktop draws them in a browser.
- How we found it: issue 05 design.
- Options: (a) one WebView for each message with the desktop components; (b) native views for Markdown and code, and a KaTeX or Mermaid WebView "island" only where math or a chart is; (c) MathJax SVG.
- Decision and why: (b). It uses the same engines as the desktop for math and charts, and native text for the rest (less memory, Jest can see the content). (a) needs a height sync per message and more memory; (c) is a different engine from the desktop.
- Change: issue 05 slices B and C (`src/components/web-island.tsx`, `islands.tsx`, `island-viewport.tsx`).
- Validation: island tests (27) and the runtime tests. During the Simulator check we found that `injectedJavaScriptObject` puts model text in a JavaScript template literal with no escaping: a backtick or `${` in model text could run as code. The data now goes in as an escaped JSON literal, with regression tests (`d482f50`). Rule since then: never pass model text through `injectedJavaScriptObject`.
- Impact and trade-offs: each island is a WebKit process. The walkthrough of 2026-11-18 found that they leak (D-010).
- Links: `docs/ISSUES.md` issue 05.

## D-007 Session open position: keep fix 1, revert fix 2 (2026-11-17) `done`

- Area: phone
- Problem: the user reported that a long session opened at the top, not at the last message.
- How we found it: the user's report; confirmed on the Simulator with `LH_E2E_MATH=1` (a formula in each reply). Cause: the top-to-bottom reveal holds for each formula, and a drag during it stopped the follow.
- Options: several follow rules; the user chose from animated mockups to keep the open-then-scroll motion and add a "↓ Latest" button.
- Decision and why: fix 1 (`e1b060e`): an opening phase where only a drag up of more than 80 pt stops the follow. It passed `e2e:open-long` on both Simulators but failed on the iPhone. Fix 2 (`e64c041`) was worse on the iPhone (stops at random places) and was reverted (`fec7e97`). The user kept fix 1: the "↓ Latest" button makes a stopped scroll a small problem.
- Validation: Jest (`tests/end-follow.test.ts`), Maestro `e2e:open-long`, and the user's check on the iPhone (Release build). Lesson: the Simulator cannot show a touch during the native scroll; a later fix needs a trace from the device first.
- Impact and trade-offs: a touch before the end can still stop the scroll. Accepted.
- Links: `docs/ISSUES.md` "Session open position".

## D-008 A native tab bar with Teach, Practice and Graph (2026-11-17) `done`

- Area: phone
- Problem: one list for everything did not scale; the user wanted the shape of a reference app (tabs, inset grouped lists).
- How we found it: the user's request with screenshots; mockups of each screen.
- Options: (a) the native iOS tab bar (`expo-router/native-tabs`); (b) JavaScript tabs.
- Decision and why: (a) (user choice from mockups). On iOS 26 it is the system glass bar; only the active color is ours. Teach groups sessions by the desktop folders in the desktop order (D-002); Practice groups by time.
- Change: `7543aca` (slice A), `ed99bc3` (slice B, Teach tab).
- Validation: Jest (`tests/app-tabs.test.tsx`, `tests/app-teach-tab.test.tsx`), Maestro `e2e:teach-shelf` on the Pro Max and the SE.
- Impact and trade-offs: native tabs mount all tabs at once, so tests scope their queries to a tab.
- Links: `docs/ISSUES.md` issue 20.

## D-009 Measure before we optimize: no prefetch yet, no cloud dashboards (2026-11-18) `accepted`

- Area: phone
- Problem: the user asked whether to prefetch the newest sessions so a lesson opens faster, and whether to add observability, dashboards and alerts.
- How we found it: an end-to-end walkthrough on both Simulators (`docs/reviews/2026-11-18-e2e-walkthrough.md`).
- Options: (a) prefetch the newest N records at app open; (b) fix the render first and add local timing marks; (c) a hosted monitoring service with dashboards and alerts.
- Decision and why: (b) (user, 2026-11-18). The numbers: a large session open takes 8.2 to 9.1 s on the Pro Max and about 12 s on the SE; about 83% is JS render with a frozen screen; the Mac answers in 47 to 88 ms. A prefetch saves at most about 0.5 s of 8.2 s on the test setup. (c) would send the user's data off the devices and has nobody else to alert: the app is local and single user.
- Change: issue 21 (planned): timing marks and a developer panel, the WebView leak, a UI-thread spinner, a lighter transcript mount, prefetch only if the marks show the fetch matters on the iPhone, MetricKit.
- Validation: planned. The baseline comes from issue 21 slice A in a Release build on the iPhone, then before and after numbers for each slice (Measurement rules above).
- Impact and trade-offs: we do not get the small prefetch gain now.
- Links: `docs/ISSUES.md` issue 21.

## D-010 Fix the WebView leak first (2026-11-18) `proposed`

- Area: phone
- Problem: each open of the long golden session starts about 29 WebKit processes that do not end when the session closes. After 3 to 4 opens the app held 102. iOS can stop an app for memory.
- How we found it: the walkthrough counted `com.apple.WebKit.WebContent` processes of the Simulator runtime.
- Options: end each island WebView when its slot unmounts or goes far from the screen; or share fewer WebViews.
- Decision and why: proposed as issue 21 slice B, after the slice A baseline.
- Change: not started.
- Validation: planned: an E2E check of the WebKit process count after a session closes (it must go back to the count before the open).
- Links: `docs/reviews/2026-11-18-e2e-walkthrough.md` finding 1.

## D-011 No rewrite in Rust now (2026-11-18) `accepted`

- Area: both
- Problem: the user asked whether a rewrite of the phone app, or of both apps, in Rust would help.
- How we found it: a question after the walkthrough.
- Options: (a) a full rewrite with a Rust core and native screens (SwiftUI on the iPhone, Tauri on the desktop); (b) Rust native modules for hot functions; (c) fix the design in the current stack (issue 21).
- Decision and why: (c) now. The measured time is in React mounting the whole transcript and in WebView lifecycles, which Rust does not change. The model turn (3 to 4 s) dominates a lesson, and the Mac code answers in under 0.1 s. A rewrite of the desktop ends upstream merges, and the AI layer, KaTeX and Mermaid are JavaScript. (b) stays open for one pure function that is still hot in a profile after issue 21. If the transcript screen is still slow after the fixes, a native SwiftUI or UIKit view for that one screen inside the React Native app is the middle way.
- Validation: the issue 21 numbers decide whether to look at this again.
- Impact and trade-offs: we keep upstream compatibility and the shared code (D-002).
- Links: this log, D-009.

## D-012 Keep the fork close to upstream (2026-11-13) `accepted`

- Area: desktop fork
- Problem: upstream LearnHarness gets new features often. A fork that drifts cannot take them.
- How we found it: design choice; upstream v0.6.1 merge.
- Options: (a) small, separate fork commits and manual upstream merges; (b) a large fork with its own direction.
- Decision and why: (a). Upstream auto-update is off in the fork, and upstream releases are merged manually. Fork changes stay small: the gateway, Phone Access, and pure moves into `src/core`. New upstream routes stay refused at the gateway until the user decides.
- Change: fork `5a7a216` (merge of upstream v0.6.1), `docs/UPSTREAM-SYNC.md`.
- Validation: after the merge the full fork suite passed except the 3 known upstream failures, and CI passed.
- Links: `docs/UPSTREAM-SYNC.md`.

## D-013 Local timing marks for each session open, five phases first (2026-11-18) `accepted`

- Area: phone
- Problem: the walkthrough timed a session open with a stopwatch on the Simulator (8.2 to 9.1 s for the golden session). We need numbers from a Release build on the iPhone, for each commit, to decide the fixes of issue 21 and to show that each fix made the open faster and not slower.
- How we found it: D-009 (measure before we optimize) and the walkthrough report.
- Options: (a) a hosted monitoring service (refused in D-009: the data leaves the devices); (b) profilers only (Hermes, React Profiler, Instruments): they find the slow function but slow the app, and some work only in dev builds; (c) a few local timing marks that are always on, with a developer panel and result files, plus profilers when a phase needs a cause.
- Decision and why: (c) (user, 2026-11-18, after the panel mockup). Start with five phases (Fetch, Parse, First transcript draw, Reveal to idle, Scroll to the end), the longest frozen frame and the island count. Add sub-phases of the transcript draw only after the first profile shows where to split. The panel says which phase is slow; the profiler says why.
- Change: issue 21 slice A (`src/lib/perf-marks.ts`, `src/lib/perf.ts`, `src/components/perf-panel.tsx`, `app.config.ts`, `scripts/perf-collect.ts`, `scripts/perf-chart.ts`, `e2e/perf-open.yaml`).
- Validation: unit tests of the phases, the ring buffer and the file; an app test that a row tap records all five marks in order. The marks cost a few `performance.now()` calls, and the frame watch runs only during an open. On the Pro Max Simulator (dev build) the fixed scenario recorded all five marks for 5 of 5 opens: median 10.69 s, with 4.54 s in the first transcript draw and 4.48 s in the reveal; the same run showed 291 WebKit processes with no island mounted (slice B). The iPhone Release baseline is not measured yet.
- Impact and trade-offs: a new Expo module (`expo-file-system`) for the result file. A build with changed files gets a `-dirty` commit, and its numbers do not count in a decision. "Island WebViews mounted now" counts components, not WebKit processes: slice B also counts the processes.
- Links: `docs/ISSUES.md` issue 21 slice A, D-009.
