# PRD: LearnHarness Mobile

Labels: `needs-triage`
Local tracker: this file and `docs/issues/`. Do not publish to GitHub: the fork's git remote is the upstream author's repository (amosblomqvist/learnharness).

## Status (read this first when you resume)

Last update: 2026-11-14.

**Done**
- Investigation and approved plan: `~/.claude/plans/there-is-this-open-source-ethereal-pearl.md`.
- Desktop fork: branch `mobile/phone-access` in `~/Development/learnharness`. Commits `3b5307d` (gateway) and `2657a55` (issue 01).
  - `electron/phone-access.cjs`: phone gateway (pairing, token gate, route allowlist, streaming proxy, `onPaired` callback). The allowlist matches the real routes (chat settings is `PUT` only, `artifact-ui` is `POST`).
  - `electron/phone-access-window.cjs`, `phone-access-preload.cjs`, `phone-access.html`, `phone-access.js`: "Phone Access…" menu window (on/off, QR, "Copy pairing text", device list). Checked in the real Electron window (issue 01).
  - `electron/main.cjs`: gateway wiring, menu item, upstream auto-update off (`LH_FORK_UPSTREAM_UPDATES=1` turns it on for the upstream updater tests).
  - `electron-builder.yml`: ships `qrcode` + `dijkstrajs`.
  - `src/core/question-core.ts`: shared `questionDataForCall` (moved from `components/question-dock.tsx`, behavior unchanged).
  - Test base: `tests/helpers/fake-openai-provider.ts` (scripted OpenAI-compatible model; the role comes from the tool names), `tests/helpers/next-dev-server.ts` (starts `next dev` in a temporary HOME and data folder).
  - Tests: `tests/phone-access.test.ts` (15), `tests/phone-access-window.test.ts` (6), `tests/fake-openai-provider.test.ts` (4), `tests/question-data-for-call.test.ts`, `tests/automatic-updates.test.ts` (fork flag).
  - Integration: `npm run test:phone-integration` (8 tests, about 1 minute). Not part of `npm test`. Stop `npm run desktop:dev` first: both use the `.next/dev` lock.
  - Full upstream suite: 3216 of 3217 pass. The 1 failure also fails on unchanged upstream (`tests/subscription-auth.test.ts`, pi-ai "No exports main").
- Phone app: Expo SDK 58 project at `~/Development/learnharness-mobile`, branch `phase-1/pairing`. Commit `740dfa4` (issue 02 code).
  - `metro.config.js`: watches `../learnharness`, maps `node:crypto` to `src/shims/node-crypto.ts`.
  - `src/shims/node-crypto.ts` (SHA-256 via `@noble/hashes`), `src/shims/polyfills.ts` (crypto, DOMException).
  - `src/lib/pairing.ts`: parse QR payload, pair, find reachable address, `remoteFetch`.
  - `src/lib/connection-store.ts` (Keychain, this device only), `src/lib/connection-monitor.ts` (ping on open, on foreground, every 30 s; 401 deletes the token), `src/lib/connection-context.tsx`.
  - Screens: `src/app/_layout.tsx` (polyfills first, `Stack.Protected` guards), `index.tsx` (status), `pair.tsx` (QR scan + paste), `settings.tsx` (Mac, address in use, "Forget this Mac"). `src/components/ui.tsx`.
  - `app.json`: bundle identifier `dev.local.learnharnessmobile`, camera text, local network text, ATS local networking.
  - Tests: Jest via jest-expo, `npm test`, 52 pass (pairing, crypto shim against the fork's real fingerprints, store, monitor, app shell with `expo-router/testing-library`). `npx tsc --noEmit` and `npx expo lint` are clean.
  - **Blocked:** `npx expo run:ios` fails with Xcode 26.3 (Swift 6.2): `expo-modules-jsi` 58.0.23 (also 58.0.22) does not compile (`JavaScriptObject.swift:946`, "sending 'slot' risks causing data races"). Expo's current SDK 58 packages probably need Xcode 26.4 or later. Run CocoaPods with `LANG=en_US.UTF-8`, or `pod install` fails with an encoding error.

**Next step:** finish issue 02: build the development app on the Simulator (needs a newer Xcode, see "Blocked" above), then do the Simulator pairing check (paste field, "connected", removal on the Mac asks to pair again). Then issue 03. See `docs/ISSUES.md`.

**Facts found during the work**
- Expo SDK 58: global `fetch` streams (WinterCG), `TextDecoder` and web streams are built in.
- `components/session-core.ts` (`SessionModel`) is pure TypeScript with an injectable fetch. The phone uses it unchanged with `remoteFetch`.
- The only Node import reachable from `SessionModel` is `node:crypto` in `src/core/coverage.ts` (via the barrel).
- Route methods: rename is `PUT /api/chats/:id`, session settings `PUT`, dictation token `GET /api/stt/token`.
- Tailscale is not installed on the Mac. The user must install it and sign in (account creation is the user's action).
- The user's real data: `~/Library/Application Support/LearnHarness/data`. Never use it in tests. Use a temporary `LH_DATA_DIR`.
- `proxy.ts` refuses every `/api` request without the desktop secret when `LH_DESKTOP_SERVER=1` (the packaged app). The gateway adds the secret, so the phone works there.
- The turn stream (`/api/chats/:id/stream`) sends each `message_update` as the whole message so far, not as a delta. A reattach replays the event log from `agent_start`.
- In dev (`npm run desktop:dev`), the server uses the repo `data/` folder unless `LH_DATA_DIR` is set, and Electron uses `~/Library/Application Support/LearnHarness-dev`. For manual checks, set `LH_DATA_DIR` and `LH_AUTH_FILE` to a temporary folder.
- Next's telemetry flush runs detached at shutdown and writes `Library/Preferences/nextjs-nodejs` under HOME. The test helper removes the temporary HOME again after it.

## Problem Statement

LearnHarness is a desktop app. It teaches with AI agents (probe, plan, teach, practice) and keeps a knowledge graph of what the learner was taught. The user can learn only when at the Mac. The user wants to continue lessons on an iPhone when away from home, with the same sessions and the same knowledge graph, and with dictation. The user does not want an always-on background program on the Mac, and must never lose a long phone session before it reaches the Mac. Other LearnHarness users must not be affected.

## Solution

One iPhone app with three engine modes, selectable in Settings:

1. **Mac remote:** the phone uses the LearnHarness desktop app on the Mac (over Tailscale or the home Wi-Fi) while the app is open. The Mac runs the agents, so the Claude Code CLI keeps working at no extra cost.
2. **Cloud:** the same, but the engine runs on a small cloud server behind Tailscale. It is always on and uses API keys.
3. **On phone:** the agents run on the iPhone with API keys from the Keychain. It works without the Mac.

The phone keeps a full local copy of the user's data. It syncs with the desktop app each time the desktop app is open and reachable. Sync is opt-in and only between a user's own paired devices. A modified desktop app (the fork) adds "Phone Access" and the sync service inside its own server process.

## User Stories

Pairing and connection
1. As a learner, I want to turn on Phone Access in the desktop app, so that my phone can connect only when I allow it.
2. As a learner, I want to pair my phone by scanning a QR code, so that I do not type addresses or secrets.
3. As a learner, I want to paste the pairing text when the camera is not available, so that I can pair from the Simulator or with a broken camera.
4. As a learner, I want the pairing code to work once and expire after 5 minutes, so that a photo of the screen cannot pair another phone later.
5. As a learner, I want to see and remove paired phones on the Mac, so that a lost phone loses access.
6. As a learner, I want the phone to try each Mac address (Tailscale first), so that it connects at home and away.
7. As a learner, I want a clear message when the Mac is off, asleep, or the app is closed, so that I know why I cannot connect.
8. As a learner, I want the phone to know when its pairing was removed, so that it asks me to pair again.
9. As a learner, I want credentials, keys, subscriptions and prompts to stay desktop-only, so that a stolen phone token cannot read my API keys.

Sessions (mode 1 and 2)
10. As a learner, I want to see my session list with phase and "waiting for your answer" marks, so that I can continue where I stopped.
11. As a learner, I want to start a new teaching session with a goal, so that I can learn something new on the phone.
12. As a learner, I want to start a practice session, so that I can practice on the phone.
13. As a learner, I want the teacher's text to stream in as it is written, so that the phone feels as fast as the desktop.
14. As a learner, I want to answer probe and quiz questions with options, confidence and a thinking field, so that the agent gets the same picture as on the desktop.
15. As a learner, I want to answer recall and explain questions in my own words, so that free recall works on the phone.
16. As a learner, I want to read the teaching prose before a check question appears, with a reading-thinking field, so that the teach cycle is the same as on the desktop.
17. As a learner, I want to see the lesson map, so that I know where I am in the plan.
18. As a learner, I want to see answered cards with the correct answer and explanation, so that I learn from mistakes.
19. As a learner, I want to work on practice problems with the thinking dock and see the solution at the end, so that practice works on the phone.
20. As a learner, I want to steer the agent with a message while it works, so that I can redirect it.
21. As a learner, I want to stop a running turn, so that I can correct a wrong direction.
22. As a learner, I want to retry a failed answer, so that a provider error does not end my lesson.
23. As a learner, I want the phone to reattach to a running turn after the app was in the background, so that I see the result.
24. As a learner, I want math (KaTeX), Markdown and Mermaid diagrams to render, so that technical lessons are readable.
25. As a learner, I want to see visuals and demos that the agent made, so that I get the full lesson.
26. As a learner, I want to see the session cost and context use, so that I control my spending.
27. As a learner, I want to rename a session, so that I can find it later.
28. As a learner, I want to see my knowledge graph as a list of propositions and chains, so that I can review what I was taught.

Dictation
29. As a learner, I want to dictate into the thinking and answer fields, so that I can think out loud while walking.
30. As a learner, I want free on-device speech recognition by default, so that I do not need a Deepgram key.
31. As a learner, I want Deepgram as an option, so that I can use multilingual dictation.

Modes and sync
32. As a learner, I want to choose the engine mode in Settings, so that I decide where the agents run.
33. As a learner, I want mode 3 to work without the Mac, so that I can learn on a train.
34. As a learner, I want my API key stored in the Keychain, so that it is safe.
35. As a learner, I want the phone to sync with the Mac each time the desktop app is open and reachable, so that I do not think about sync.
36. As a learner, I want a "Sync now" button, last sync time and the number of waiting changes, so that I can see the state.
37. As a learner, I want a session that I continued on both devices to become two conflict copies, so that no work is overwritten.
38. As a learner, I want deletes to sync, so that removed sessions do not come back.
39. As a learner, I want a session with a running turn to be locked on the other device, so that two engines do not write the same session.
40. As a learner, I want every message saved on the phone before it is shown as sent, so that a crash loses nothing.
41. As a learner, I want unsynced changes to stay until the Mac confirms each one, so that a long session is never lost.
42. As a learner, I want "Export all data" as a desktop-format folder, so that I have a backup.
43. As a learner, I want my graph extraction to run in mode 3 too, so that phone lessons grow the same graph.
44. As a learner, I want the cloud host as a Docker image with a deploy guide, so that I can run mode 2 for about $5 per month.

Other users and maintenance
45. As another LearnHarness user, I want sync to be off by default and limited to my own paired devices, so that my data goes nowhere.
46. As another user without a desktop, I want to start fresh on the phone, so that I need no Mac.
47. As the maintainer, I want the fork changes kept in few new files plus small hooks, so that upstream releases merge easily.
48. As the maintainer, I want the upstream test suite to keep passing in the fork, so that the fork does not break the desktop app.

## Implementation Decisions

Modules (deep modules first)
- **Phone gateway (desktop fork, main process).** Interface: start, stop, start pairing, revoke, pairing payload. Pairing: one-use code, 5-minute expiry, rate limit of 10 failed attempts per minute. Device tokens: 32 random bytes, stored only as SHA-256 hashes, owner-only file. Route allowlist (method + path). Allowed requests stream to the loopback server with the per-launch desktop secret added. Phone headers (authorization, cookie, origin, forged desktop header) are removed. Phone disconnect closes the upstream request. Protocol version 1.
- **Phone access window.** Local page with its own minimal preload. It never receives device tokens.
- **Shared question data.** `questionDataForCall(tool, toolCallId, input)` in the shared core, used by the desktop dock and the phone dock.
- **Pairing client (phone).** Parse payload, pair (first answering address decides), find reachable address (401 means unpaired), remote fetch adapter that adds base URL and token to the relative paths of the shared code.
- **Connection store (phone).** Paired connection in the secure store.
- **Remote session (phone).** The upstream `SessionModel`, unchanged, with the remote fetch.
- **Phone UI.** Session list, session screen (transcript, question dock, practice dock, composer, lesson map), pairing screen, settings.
- **Local store (phone, mode 3 and sync).** SQLite (WAL) behind the shared storage ports. One row per message. Images as files. Outbox table.
- **Sync service (desktop fork, server process) and sync client (phone).** Pull and push by record id. Graph ledgers: union by id. Chats: merge by message id; divergent continuation makes conflict copies. Tombstones for deletes. Confirmation by id + content hash; the phone removes an outbox entry only after confirmation. Idempotent.
- **Local engine (phone, mode 3).** Upstream agents, tools, prompts and turn runner on the phone, with SQLite ports.
- **Cloud host.** The fork in browser mode in Docker, with the same gateway and sync service, behind `tailscale serve`.

Decisions
- Expo (React Native) + TypeScript, iOS first. Shared code is imported from the fork folder through Metro (later a git submodule).
- The phone uses the same HTTP protocol as the desktop browser UI. No new server API for mode 1, except the gateway's pairing and ping routes and, later, sync routes.
- Only one process owns the desktop data folder: the desktop app. No always-on agent.
- Upstream auto-update is off in the fork. Upstream releases are merged manually.
- Plain HTTP on the LAN is allowed for convenience; Tailscale (WireGuard) is the recommended path outside the home.

## Testing Decisions

- A good test checks external behavior through the module interface: HTTP status, forwarded headers, stored state, rendered result. It does not check private helpers.
- All automatic tests use a fake LLM provider that plays back recorded model responses. No real model, account or network.
- Unit: gateway allowlist, store, addresses; pairing client; shared question data; sync merge; outbox; SQLite adapters; mode switch and session lock; crypto shim (hash equality with Node).
- Integration: gateway over real HTTP (done, prior art `tests/phone-access.test.ts`); gateway in front of the real upstream server; sync service against golden fixtures; phone turn runner with upstream flow tests; export readable by the desktop stores.
- End-to-end: Maestro on the iOS Simulator, fork running on the Mac with a temporary data folder. Each mode, dictation, offline sync, mode switch, conflict, cloud host.
- Data-loss: kill the app during a reply, an answer submit and a sync; cut the network at each sync stage; close the desktop app during sync; a 500+ message session across restarts.
- Prior art: `tests/desktop-api.test.ts`, `tests/automatic-updates.test.ts` (fake Electron harness), `tests/session-core.test.ts`, `tests/chat-flow.test.ts`, `tests/golden-fixtures.test.ts`.
- Manual smoke test with a real model in each mode, on the Simulator and then on the user's iPhone.

## Out of Scope

- Android build (later).
- ChatGPT subscription sign-in on the phone (needs a check that OpenAI accepts a mobile redirect).
- Local file tools and the Claude Code CLI in mode 3.
- Headless demo verification on the phone.
- Graph canvas on the phone (list and chain table first).
- Multi-user hosting and public-internet exposure.
- App Store distribution and the LearnHarness name or logo in public (needs the author's permission; AGPL source obligations apply if distributed).

## Further Notes

- Measured data: largest session 2.1 MB (407 messages), all sessions 2.8 MB, graph 160 KB. Storage on the phone is not a problem.
- Measured cost of the user's 3 sessions at API prices: about $22 (Claude Sonnet 5.5), about $1.30 (Claude Haiku 5.5). Cache writes are 75% of it.
- The upstream `AGENTS.md` says: never guess a design decision; ask the user.
