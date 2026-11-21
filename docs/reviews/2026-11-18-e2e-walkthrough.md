# End-to-end walkthrough: bugs, rough edges and latency (2026-11-18)

Commit under test: `ed99bc3` (issue 20 slice B). Branch `phase-1/pairing`.

## 1. Scope and method

- Phase 1: a read of the load paths in the code (no device). See section 2.
- Phase 2: a walkthrough on the iOS Simulator, as a user, against a test Mac (`LH_E2E_GOLDEN=1 LH_E2E_SHELF=1 npm run e2e:mac`). Devices: iPhone 17 Pro Max (iOS 26.3, light, then dark) and iPhone SE 3rd generation (iOS 26.5, dark, then light).
- Walk: forget the old Mac, pair with the paste field, the 3 tabs, pull to refresh, the "Continue learning" card, each session, scroll of the long golden session, the plan, a probe answer, a new session, a new practice session, Settings, "Forget this Mac", the Mac stopped (offline banner), a new test Mac.
- Timing: `xcrun simctl io <udid> recordVideo`, then the frame times of each screen change (ffmpeg scene detection). The first frame change after a tap is the pressed state of the control. Time "from tap" starts there. Accuracy is about ±0.1 s.
- The Mac side: `curl` to the test Mac's server with the test desktop header, 5 calls for each route.
- Thread use: `sample` on the app process during a session open.
- This review does not report the known bug "Choppy load of a large session" (`docs/ISSUES.md`) again. Section 4.3 gives measurements for it.

### 1.1 Limits of the test rig (read before you use the numbers)

- **Dev build.** The app ran the dev build with Metro (JS in development mode). A Release build is faster. Use the numbers to compare steps, not as Release numbers.
- **Intel Mac.** The host is an x86_64 Mac. Both Simulators share its CPU.
- **A Simulator daemon used 4–7 CPU cores.** `mediaanalysisd` in the iOS 26.5 runtime (the SE) ran at 450–750% CPU for more than 25 minutes. `launchd_sim` starts it again after a kill. I shut down the SE during the Pro Max timings. During the SE timings it ran. On the Pro Max the golden open took 9.1 s with the daemon and 8.2 s without it, so the effect on the single JS thread is small.
- **Loopback network.** The test Mac is on `127.0.0.1`. On a real iPhone over Wi-Fi or Tailscale, the fetch times are longer (see section 5).
- **New test Mac.** `next dev` compiles each route at its first use. The first request to a route after a new test Mac start is slower (for example, the first teach turn and the SE first list).
- **Test artifact, not a bug:** one typed "r" reached the app while no text field had focus, and the dev build reloaded the JS (same process, no crash).

## 2. Load paths (phase 1, from the code)

### 2.1 App start

| Step                 | Code                                   | What it fetches                                                              | What it renders                        | Where time likely goes                                               |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| Polyfills, providers | `src/app/_layout.tsx`                  | Nothing                                                                      | `Loading` while the state is `loading` | JS bundle load (dev build: Metro)                                    |
| Pairing check        | `connection-monitor.ts` `start()`      | Keychain read (`store.load()`)                                               | Tabs (state `checking`) or `pair`      | Keychain read, small                                                 |
| Connection ping      | `findReachableUrl()` in `pairing.ts`   | `GET /phone/v1/ping` for each address, one after the other, 3 s timeout each | Status line "Connecting"               | One round trip. Each dead address before the live one adds up to 3 s |
| Events channel       | `server-events-context.tsx`            | SSE stream, opens only when `connected`                                      | Nothing                                | One request; `onOpen` calls `hub.resync`                             |
| Session list         | `useSessionList` in `session-list.tsx` | `GET /api/chats`                                                             | Rows                                   | Waits for the ping first, then one round trip                        |

Facts:

- The tabs do not fetch until the ping succeeds. `macFetch` can already use the stored address, so the list could start at the same time as the ping.
- `useSessionList` is a hook of each tab. The Teach tab and the Practice tab each read `GET /api/chats`. Each `turn-started`, `turn-settled` and `chats-changed` event makes each mounted tab read the full list again.

### 2.2 Teach tab

On each focus and each pull to refresh, the Teach tab sends 4 requests:

1. `GET /api/chats` (the list, 2 KB with the test data).
2. `GET /api/graph/sources` (the desktop folders, 3 KB).
3. `GET /api/graph` (all propositions of the graph, 429 KB with the golden graph). The tab uses it only to count the concepts of each session.
4. `GET /api/chats/<newest teach session>` (the full record, for the "Continue learning" line). Then `projectView()` and `planSteps()` on the phone.

Facts:

- Request 4 reads the same record that a tap on "Continue" reads again. Nothing keeps it.
- `useContinueSteps` reads the record again each time `updatedAt` of the newest session changes, for example at each `turn-started` and `turn-settled`.
- The sections show only after the folders load. So the tab paints in 2 steps.

### 2.3 Session open (`src/app/session/[id].tsx`)

| Step       | Code                                             | Work                                                                                                        | Where time likely goes                                            |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Fetch   | `useSessionRecord` → `readSession`               | `GET /api/chats/<id>`: the full record (golden teach session: 95 messages, 360 KB)                          | One round trip and `JSON.parse`                                   |
| 2. Model   | `useSessionModel`                                | `new SessionModel(...)`, `projectView` of all messages                                                      | JS, once                                                          |
| 3. Rows    | `transcriptRows`                                 | All rows                                                                                                    | JS, at each message change                                        |
| 4. Mount   | `ScrollView` + `Transcript`                      | All rows mount at once (no list virtualization)                                                             | React mount of every Markdown block, code block, table and island |
| 5. Reveal  | `RevealProvider`, `RevealSlot`, `reveal-gate.ts` | One slot for each top-level block. Each `gate.set()` sorts all slots and calls every slot listener          | n blocks: n sorts of n slots and n × n listener calls             |
| 6. Islands | `useNearScreenState`, `web-island.tsx`           | Each island calls `measureInWindow` on mount, on each scroll event (100 ms) and on each content size change | Bridge calls; WebViews that start together                        |
| 7. Follow  | `onContentSizeChange`                            | `scrollToEnd({ animated: true })` at each size change while the follow is on                                | Many animated scrolls while the reveal grows the content          |

Facts:

- The screen shows `Loading` until the full record is in and React has mounted the whole transcript. Nothing from the list (for example the title) shows during that time.
- On return to the foreground, the events channel opens again, and `hub.resync` makes an open session read its full record again.
- The reveal gate cost grows with the square of the block count. In Node (JIT): 100 blocks 4.6 ms, 300 blocks 18.5 ms, 600 blocks 69 ms, 1000 blocks 170 ms. Hermes has no JIT, so it is slower.

## 3. Findings

Severity: High (a user loses data, memory or a lot of time), Medium (a user is confused or blocked for some time), Low (a rough edge).

| #   | Severity | Screen                                                           | Steps                                                                                                                                                     | What happens                                                                                                                                                                                                                                                                                   | What is expected                                                                                                                                                                             |
| --- | -------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | Session (islands)                                                | Open the golden teach session. Go back. Do this 3–4 times. Stay on the Teach tab. Count `com.apple.WebKit.WebContent` processes of the Simulator runtime. | Each open of the golden session starts about 29 WebKit processes. They do not end when the session closes. After the walk, the app held 102 WebKit processes while it showed only the Teach tab. They were 14–20 minutes old. All 102 ended only when the app quit (`simctl terminate`).       | The island WebViews end when their session closes. The WebKit process count goes back to the count before the open. On an iPhone, 100 WebKit processes can make iOS stop the app for memory. |
| 2   | Medium   | All loading states (session `Loading`, "Sending…", reveal front) | Open the golden teach session or the golden practice session. Look at the spinner.                                                                        | The spinner does not move. It stays on one frame for up to 7 s. (The user also reported this.) Cause: `Spinner` in `src/components/ui.tsx:377` changes its frame with a JS `setInterval` every 80 ms. When the JS thread is busy (section 4.3), the interval does not run.                     | The spinner moves while the app works, so the user knows that the app did not stop. Use an animation that runs on the UI thread.                                                             |
| 3   | Medium   | Session                                                          | Open a session. Stop the Mac. Type "ready" and tap Send.                                                                                                  | After about 0.5 s the banner says "Something went wrong. Try again." Metro logs `[user-error] unmapped error: {"message": "Network request failed: Could not connect to the server."}`. The native pinned fetch rejects with this text, not with a `TypeError`, so `describeError` falls back. | The banner says that the phone cannot reach the Mac (the `NETWORK` text). Add the text to `describeError` with a test.                                                                       |
| 4   | Medium   | Session, connection status                                       | Same as 3.                                                                                                                                                | The failed send does not start a connection check. The session screen has no connection line. The "Not connected" banner shows on the tabs only after the next 30 s ping.                                                                                                                      | A network failure in a session calls `monitor.check()`, and the session screen shows that the Mac is not reachable.                                                                          |
| 5   | Low      | Teach tab                                                        | Open a session. Go back to the Teach tab.                                                                                                                 | The pull-to-refresh spinner shows at the top and the whole list moves down about 30 pt, then back up, at each return to the tab. Cause: `refreshing={list.busy && list.chats !== null}` is also true for the refresh on focus.                                                                 | Only a pull shows the refresh spinner. A refresh on focus is quiet.                                                                                                                          |
| 6   | Low      | Teach tab                                                        | Open the Teach tab or return to it.                                                                                                                       | Each focus reads the whole graph (`GET /api/graph`, 429 KB with the golden graph) only to count the concepts, and the full record of the newest session (360 KB if the golden session is the newest). On cellular data or Tailscale this costs data and time at each tab change.               | Read the counts and the continue line with less data (a small route, or a cache that a server event makes stale).                                                                            |
| 7   | Low      | Session with no messages                                         | Open "Bayes rule" (shelf test data, 0 messages).                                                                                                          | The transcript is empty with no text. The continue card says "Your turn". A real user gets this state when the opening text of a new session was not accepted.                                                                                                                                 | An empty session shows a short hint, for example "Write your first question to start."                                                                                                       |
| 8   | Low      | Plan sheet                                                       | Open the plan of the golden session. Tap the X once.                                                                                                      | The first tap on the X did nothing; the second tap closed the sheet. Not checked further; possibly a small hit area. In the plan graph, one edge goes out of the frame on the right.                                                                                                           | One tap closes the sheet. All edges stay inside the frame.                                                                                                                                   |
| 9   | Low      | Session, SE (375 pt)                                             | Open any session on the SE.                                                                                                                               | The composer placeholder "Ask, answer, or steer the lesson…" wraps to 2 lines.                                                                                                                                                                                                                 | One line at 375 pt, for example a shorter text.                                                                                                                                              |
| 10  | Low      | Settings → "Forget this Mac"                                     | Tap "Forget this Mac", then Forget.                                                                                                                       | The Settings screen is blank for about 1 s, then the pair screen shows. The alert says "you must scan a new QR code", but the paste field also works.                                                                                                                                          | Go to the pair screen at once. The alert names both ways.                                                                                                                                    |
| 11  | Low      | New session, New practice                                        | Tap "+".                                                                                                                                                  | The text field has no focus. The user must tap it before typing.                                                                                                                                                                                                                               | The field has focus and the keyboard opens.                                                                                                                                                  |
| 12  | Info     | Teach tab                                                        | Look at the rows.                                                                                                                                         | Every row says "0 concepts". This comes from the test data: the golden graph names other sessions. Not a bug.                                                                                                                                                                                  | Possibly hide the count when it is 0.                                                                                                                                                        |
| 13  | Info     | New session                                                      | Start a session on a new test Mac.                                                                                                                        | "Sending…" for 7–10 s before the probe. The Mac compiles the route at its first use (`next dev`). Later turns took 3–4 s. Not a phone problem.                                                                                                                                                 | None.                                                                                                                                                                                        |

## 4. Timings

### 4.1 Measured steps

All times are from the tap to the content. "End" means the last message is on screen and the view stops.

| Step                                                            | Pro Max                                                       | SE                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Pair tap → Teach tab with "Loading…"                            | 0.7 s                                                         | 0.7 s                                             |
| Pair tap → Teach tab with folders and sessions                  | 1.9 s                                                         | 3.8 s (new test Mac: first route compile)         |
| Teach → Practice tab (list shows)                               | under 0.2 s                                                   | not timed                                         |
| Pull to refresh on Teach (spinner to new list)                  | 1.5 s                                                         | not timed                                         |
| Open "Bayes rule" (0 messages) → session screen                 | 0.4 s                                                         | not timed                                         |
| Open golden teach session (360 KB, 95 messages) → first content | 0.8 s to 4 s (varies between runs)                            | 0.8 s                                             |
| Open golden teach session → end                                 | 8.2 s (no daemon), 9.1 s (with daemon)                        | 12.3 s (first open), more than 12 s (second open) |
| Of that: time with no screen change at all (JS thread busy)     | 6.7–6.9 s                                                     | about 8 s                                         |
| Open golden practice session (64 KB) → first content            | 1.7 s                                                         | 0.6 s                                             |
| Open golden practice session → end                              | 4.4 s                                                         | 5.3 s                                             |
| Scroll the golden session (3 fast swipes)                       | about 50 frames/s; hitches of 110–180 ms when a scroll starts | not timed                                         |
| Plan chip → plan sheet                                          | under 1 s                                                     | not timed                                         |
| New session: Start → session screen with "Sending…"             | 0.8 s                                                         | not timed                                         |
| Probe answer: Send → full teacher reply with plan chart         | 3.3 s                                                         | 3.9 s                                             |
| New practice: Start → first problem                             | 3.1 s                                                         | not timed                                         |
| Send with the Mac stopped → error banner                        | 0.5 s                                                         | not timed                                         |
| Mac stopped → "Not connected" banner on the tabs                | up to 30 s (next ping)                                        | not timed                                         |
| Cold start of the app (dev build, bundle from Metro)            | more than 12 s (dev only, not useful)                         | not timed                                         |

### 4.2 The Mac side (curl to the test Mac, 5 calls each)

| Route                              | Body size | Time for each call         |
| ---------------------------------- | --------- | -------------------------- |
| `GET /api/chats`                   | 2 KB      | 20–42 ms                   |
| `GET /api/graph/sources`           | 3 KB      | 21–36 ms (one call 269 ms) |
| `GET /api/graph`                   | 429 KB    | 28–81 ms                   |
| `GET /api/chats/<golden teach>`    | 360 KB    | 47–88 ms                   |
| `GET /api/chats/<golden practice>` | 64 KB     | 16–28 ms                   |

### 4.3 Where the time of a large session open goes (the known bug "Choppy load of a large session")

Measured on the Pro Max with the golden teach session (no `LH_E2E_MATH`):

1. Tap → `Loading` screen: 0.4 s (navigation).
2. Fetch: the Mac sends the record in 47–88 ms. On loopback the transfer is small.
3. Then the screen does not change for 6.7–6.9 s. The `Loading` spinner (or the top of the transcript) stays still. A CPU sample of 5 s in this time shows:
   - The JS thread (`com.facebook.react.runtime.JavaScript`) is busy in almost all samples (Hermes interpreter, prop parsing, GC).
   - The main thread waits in its run loop in 2549 of 3204 samples (80% idle).
   - So the JS work of the open (the mount of the whole transcript, the reveal slots, `projectView`) is the cost. The native side is not the cost.
4. The WebKit processes start only after this freeze (count 28 → 47 in the 5 s after it). So the WebViews are not the cause of the freeze. They add the later crawl and the jumps.
5. Then the view moves down to the end in about 1 s, and islands still load (empty boxes with a spinner) for 2 s more.
6. On the SE the view went to the middle, then to a plan section, then to the end, with no touch.
7. The native Back button works during the freeze (it is native). A tap in the transcript waits for the JS thread.

## 5. Does prefetch of the top N recent records make a session open faster?

Short answer: **no, not much.** The time is in the JS render, not in the fetch.

The numbers (golden teach session, Pro Max):

| Part                                                   | Time                                | Share of 8.2 s |
| ------------------------------------------------------ | ----------------------------------- | -------------- |
| Navigation to the `Loading` screen                     | about 0.4 s                         | 5%             |
| Mac route (server time)                                | 47–88 ms                            | about 1%       |
| Transfer and `JSON.parse` on loopback                  | under 0.4 s (in the `Loading` time) | under 5%       |
| JS render (mount, reveal, model) with no screen change | 6.7–6.9 s                           | about 83%      |
| Scroll to the end, islands                             | about 1 s                           | about 12%      |

- A prefetch removes only the fetch part: at most about 0.5 s of 8.2 s on loopback.
- On a real iPhone over Wi-Fi, 360 KB can take 100–300 ms more, and over Tailscale or a weak network more than that. So a prefetch helps more there, but the render still takes most of the time. This estimate is not measured on a device.
- A prefetch of N records also costs data and Mac work at each app open, and the records can be stale when the user opens them.
- One cheap version is free: the Teach tab already fetches the record of the "Continue learning" session. Keep that record for a short time and give it to the session screen. Then a tap on "Continue" skips one fetch.
- Check this in a Release build on the iPhone before a decision: the JS render is faster in Release, so the share of the fetch goes up. Measure with the Hermes profiler and with the marks in idea 9 below.

## 6. Improvement ideas

1. **Fix the WebView leak (finding 1) first.** Make sure each island WebView ends when its slot unmounts or goes far. Add a check to an E2E flow: the WebKit process count after a session closes.
2. **Use a spinner that runs on the UI thread (finding 2).** For example `Animated` with `useNativeDriver: true`, or the native `ActivityIndicator`. Then the user sees that the app works during a long render.
3. **Do not mount the whole transcript at once.** Use a virtualized list (for example `FlatList` or FlashList) that starts at the end, or mount the last rows first and the older rows later in small idle chunks. This removes most of the 6.7 s freeze, and it also helps the open position bug, because the first frame already shows the end.
4. **Make the reveal gate cheaper.** Keep the slots in order (insert in place) instead of a sort at each `set()`, and notify only the slots whose view changed. Batch the registrations of one render.
5. **Show the session at once.** Put the title and the phase from the list item in the header before the record comes in.
6. **Map the native network error (finding 3)** and call `monitor.check()` after a network failure in a session (finding 4).
7. **Make the Teach tab lighter (findings 5 and 6).** No refresh spinner on focus. Read the concept counts with less data, or cache them until `activity-changed`.
8. **Keep the record that the Continue card read** (section 5) and give it to the session screen.
9. **Observability for the next issue.** Add timing marks to the app: tap, record fetched, record parsed, first commit of the transcript, reveal idle, follow at end. Keep them in a small ring buffer, and show them in the developer section of Settings. Also log the WebKit process count (or the island count) for each session. Then measure on the iPhone in a Release build.

## 7. Summary

1. The largest problem is a WebView leak: each open of the long session leaves about 29 WebKit processes alive. The app held 102 of them on the Teach tab.
2. A large session open takes 8–9 s (Pro Max) and about 12 s (SE) in the dev build. About 83% of it is JS render with a frozen screen, not the fetch.
3. A prefetch of recent records saves at most about 0.5 s of 8 s on the test rig. Fix the render first (virtualized transcript, cheaper reveal gate).
4. The spinner does not move because it runs on the JS thread. A send with the Mac off shows a generic error, because the native network error text is not mapped.
5. Small rough edges: the refresh spinner at each tab return, the 429 KB graph read at each Teach focus, an empty session with no hint, the 2-line placeholder on the SE.
