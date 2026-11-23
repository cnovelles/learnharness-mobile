# Security review: visual and demo artifacts (issue 19)

Date: 2026-11-23. Status: approved by the user (2026-11-23) with the decisions in section 9.

Scope: the phone shows the two artifact kinds that the desktop shows in a lesson: a visual (an SVG figure) and a demo (a single-file HTML and JavaScript page). Both are written by a sub-agent (a model). The phone must treat both as hostile content.

Each claim has a source tag:

- **[code]**: checked in the code (file and line given).
- **[test]**: proved by a test that exists now.
- **[memory]**: from memory. It can be wrong. The plan names the test that will prove it.

## 1. Where the artifact comes from

- The artifact is not a tool part. It is a steer message: a record marker `subagent-steer` that the fork's `src/core/view.ts:430-450` turns into a `role: "user"` view message with two parts: a text part (`marker.content`, the text for the teacher model) and a `data-subagent-artifact` part with `{ kind, result, ui }`. **[code]**
- `kind: "visual"`: `result` is a `VisualResult` (`svg`, optional `notes`, optional `image: { path, snapshotId }`). `kind: "demo"`: `result` is a `DemoResult` (`title`, `html`, `tested`, optional `notes`). Fork `src/core/contracts/jobs.ts:231-257`. **[code]**
- An empty `svg` or `html` means that the sub-agent failed; `notes` holds the model's reason. **[code]** (`components/artifacts/visual-card.tsx`, `demo-card.tsx`)
- The phone gets these messages in `GET /api/chats/:id` and on the stream, through the pinned session. The transport is trusted. The content is not.
- Found in the review: the phone does not know `data-subagent-artifact` now. `src/lib/transcript.ts` shows the steer's text part as a learner bubble, so the learner sees the text for the teacher model as their own message. **[code]** (`transcriptRows` pushes `{ kind: "user" }` for every text part of a `role: "user"` message.) Issue 19 fixes this for visual and demo steers. The other steer kinds (research, pdf, plugin, abort) have the same fault. See section 10.

## 2. `POST /api/chats/:id/artifact-ui`

This route does not send the artifact. It saves only the learner's invert switch. Fork `app/api/chats/[id]/artifact-ui/route.ts`. **[code]**

| Item         | Value                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request body | `{ "input": { "messageId": string, "inverted": boolean } }`                                                                                                                                           |
| 200          | `{ "ok": true }`. The server writes `details.ui.inverted` on the steer record (`setSteerUiInverted`, then `chatStore.saveMessages`). No wake, no agent, no tokens, no SSE.                            |
| 404          | `{ "error": "Unknown chat" }`                                                                                                                                                                         |
| 400          | `{ "error": "input must be { messageId: string, inverted: boolean }" }`, or `{ "error": "No demo/figure steer with that message id" }`                                                                |
| Gateway      | `POST` is in `ROUTES` (fork `electron/phone-access.cjs:48`). It is not in the checked writes (`PHONE_WRITES`), so the body goes to the server as a stream, limit 26 MB (`MAX_BODY_BYTES`). **[code]** |
| Tests        | Fork `tests/artifact-ui.test.ts` (404, 4 bad bodies, round trip). Fork `tests/phone-access.test.ts:37` (`POST` allowed) and `:64` (`GET` refused). **[test]**                                         |

What a stolen device token can do with this route: flip the invert switch of any figure or demo. The token can already send chat turns, so the new risk is close to zero.

The desktop sends the write and ignores every error (`.catch(() => {})`). The phone must not hide a failed write (error state 7).

Note: the route reads the chat, changes one message and writes all messages. A write while a turn streams can race with the turn's own write. The desktop has the same race. **[code]**, not tested. The phone does not make it worse, because the learner taps the switch.

## 3. The threat

The artifact HTML or SVG is model output. A prompt injection (for example a web page that the research sub-agent read) can reach it. The page can try to:

1. Read the device token or the pin, or send a request with the token.
2. Send lesson data to the internet, or load a tracker.
3. Leave the WebView: open Safari, open a new window, or navigate to a phishing page in the lesson.
4. Show native UI over the app: a fake password prompt.
5. Use the microphone or the camera (the app has both permissions: `app.json`, `NSMicrophoneUsageDescription` and the `expo-camera` plugin). **[code]**
6. Hang or crash the app (an endless loop, a memory bomb).
7. Put false text on screen that looks like the app (for example an error from the Mac).

## 4. The token and the pinned fetch stay out of reach

- The token lives in the Keychain (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) and in the React Native JavaScript memory. `src/lib/connection-store.ts:3-12`. **[code]**
- Requests to the Mac go through the native `URLSession` in `modules/pinned-fetch` (`docs/TRANSPORT-SECURITY.md`). **[code]**
- A `WKWebView` page runs in a separate WebContent process. It has no access to the React Native JavaScript context, to the Keychain, or to the app's `URLSession`. **[memory]**: this is how WebKit works on iOS; no test proves it here. The only path out of the page is `window.ReactNativeWebView.postMessage(string)`, which the library adds for the main frame only (`forMainFrameOnly:YES`, `node_modules/react-native-webview/apple/RNCWebViewImpl.m:1752` and `:1803`). **[code]**
- So the page can only send strings to our `onMessage`. The handler must accept only the fixed message shapes (height, error) and must never start a request from page data. The only request that page data can start is "Send to teacher" (error state 4), and only after a tap by the learner.
- `incognito` gives a non-persistent website data store (`RNCWebViewImpl.m:463`): no cookies or storage from other WebViews. **[code]** The page has no cookie for the Mac in any case: the pinned session does not share cookies with WebKit. **[memory]**
- The page loads with `baseURL` `about:blank` when the source has no `baseUrl` (`RNCWebViewImpl.m:855-859`). **[code]** So the page origin is not the Mac's origin.

## 5. No network

ATS is off ("pinned" policy). `NSAllowsArbitraryLoads` also covers web content. **[memory]** So ATS does not stop a page request. The guards are:

1. **CSP** as the first element of the document (with the 3 CDN hosts of decision D1 as `$CDN`):
   `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' $CDN; style-src 'unsafe-inline' $CDN; font-src data: $CDN; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`.
   - The visual page has no `script-src` at all (the same as the islands, `scripts/island-pages/build.cjs:29`). **[code]**
   - A second CSP in the demo's own HTML can only add limits, because the browser enforces every policy. **[memory]**
   - The phone writes `<!doctype html><meta http-equiv="Content-Security-Policy" …>` before the first byte of the model HTML. The HTML parser puts this meta in the head, and ignores the model's later doctype and `<head>` tag. **[memory]**: HTML parser rules; the canary test (section 8) proves it.
2. **No loads after the page**: `onShouldStartLoadWithRequest` allows the first top-frame load of `about:blank` and, in a frame, only `about:srcdoc` (the demo's own sandboxed frame; it fetches nothing). It refuses every other load. The native code asks this function for every navigation action (`RNCWebViewImpl.m:1379-1412`), also for subframes (`isTopFrame` in the event). **[code]**
3. **WebRTC**: CSP does not cover `RTCPeerConnection`. A peer connection with a STUN server can send data to any host. **[memory]** The lock script removes `RTCPeerConnection` and its parts before the demo's scripts run. This is not a full guard: a script can make an `about:blank` child frame (it is not a fetch, so `frame-src 'none'` does not stop it **[memory]**) and take a fresh `RTCPeerConnection` from that frame. iOS has no public switch to turn WebRTC off in a `WKWebView` **[memory]**. **Residual risk (found by the automated review of the first commit, 2026-11-23):** a hostile demo can send lesson text to a host of its choice over WebRTC. It cannot reach the token, the pin or the Mac (section 4). The desktop demo can send the same text with a plain `fetch`, so this risk is not new to the user. The canary test records whether the frame path works on iOS 26.
4. **CDN imports**: the fork's demo builder allows CDN script imports (fork `src/agent/subagents/demo-builder.ts:54-55`, "CDN imports … are allowed"). **[code]** Decision D1 (section 9) allows 3 CDN hosts for scripts, style sheets and fonts only. A demo that loads from another host gets error state 9.

Compare the desktop: its demo iframe has `sandbox="allow-scripts"` and no CSP (`demo-card.tsx`). **[code]** A sandboxed iframe can still use `fetch`, so a desktop demo can send data to the internet. **[memory]** The phone is stricter than the desktop.

## 6. No navigation out of the WebView

- **The `originWhitelist` trap.** When a URL does not match `originWhitelist`, react-native-webview opens it with `Linking.openURL` (Safari or another app) before our function runs (`node_modules/react-native-webview/src/WebViewShared.tsx:38-66`). **[code]** So the artifact WebView keeps `originWhitelist={["*"]}` (as `src/components/web-island.tsx` does) and refuses in `onShouldStartLoadWithRequest`. A test pins `originWhitelist`.
- **Links, `location`, `<meta http-equiv="refresh">`, form posts**: navigation actions, so `onShouldStartLoadWithRequest` refuses them. **[code]** Form posts also meet `form-action 'none'`.
- **New windows** (`window.open`, `target="_blank"`): with `onOpenWindow` set, the native code cancels a navigation that has no target frame and calls `onOpenWindow` (`RNCWebViewImpl.m:1365-1377`). Our `onOpenWindow` does nothing. `createWebViewWithConfiguration` returns `nil`, so no second WebView opens (`RNCWebViewImpl.m:390-404`). **[code]**
- **Back and forward swipe**: off by default (`allowsBackForwardNavigationGestures`). **[memory]**
- **Link previews and data detectors**: `allowsLinkPreview={false}`, `dataDetectorTypes="none"` (as the islands). **[code]**

## 7. No native UI and no devices

- **Alerts**: react-native-webview shows `alert`, `confirm` and `prompt` as native `UIAlertController`s over the app. `prompt` adds a text field (`RNCWebViewImpl.m:1216-1290`). **[code]** A demo could show "Enter your Mac password" over the app. The guard is the platform sandbox: the demo runs in `<iframe sandbox="allow-scripts" srcdoc=…>` (as the desktop). With no `allow-modals`, WebKit does not show these panels for the frame or for any frame under it, because sandbox flags pass down to child frames. **[memory]**; the canary test proves it. The first commit had only a JS lock (the script replaced the three functions); the automated review found that a child frame gives fresh copies, so the JS lock stays only as a second layer. The frame also has no `allow-same-origin`, so its origin is opaque, and its document has its own CSP meta (the fix does not depend on CSP inheritance).
- **Microphone and camera**: the default is `mediaCapturePermissionGrantType` `prompt` (`RNCWebViewImpl.m:199`). **[code]** The artifact WebView sets `"deny"` (`RNCWebViewImpl.m:1318`). **[code]**
- **Location**: the app has no location text in `app.json`, so iOS gives no location. **[memory]**
- **Text selection and copy**: off (`textInteractionEnabled={false}`), as the islands. **[code]**
- **Debugging**: `webviewDebuggingEnabled={__DEV__}` only. **[code]**

## 8. Size, hangs and crashes

- An endless loop blocks the WebContent process, not the app's JavaScript thread. **[memory]**
- A crash of the WebContent process calls `onContentProcessDidTerminate`. The islands load again one time, then fail (`web-island.tsx`, `MAX_RELOADS = 1`). **[code]**, **[test]** (`tests/islands.test.tsx`). The artifact uses the same rule.
- The demo HTML has no size limit on the Mac. The phone refuses a demo over 2 MB and an SVG over 1 MB before it makes a WebView (error state 3). These limits are a proposal.
- Height: the page reports its height. The phone keeps it between 80 and 2400 pt, as the desktop (`demo-card.tsx`, `MIN_HEIGHT`, `MAX_HEIGHT`). **[code]**
- Each demo is one WebView, as each island. No limit on the count is proposed: a lesson has few demos. The perf panel counts islands (`perf.islandStarted`), so a test can count them.

### The canary test (before the merge)

A test demo (a fixture of the scripted Mac) tries each escape. A local HTTPS server on the Mac logs each request it gets. Pass: the server logs nothing, the app stays on the lesson, and no native alert shows.

- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `<img src>`, `<script src>`, `<link rel=stylesheet>`, `@import`, CSS `url()`, `<link rel=prefetch>`, a `Worker`.
- `RTCPeerConnection` with a STUN server on the canary host.
- `location.href`, `top.location`, `<a href>` tap, `target="_blank"`, `window.open`, `<meta http-equiv=refresh>`, a form post, an `<iframe src>`, a script-made `about:blank` frame (and `contentWindow.RTCPeerConnection` and `contentWindow.prompt` from it).
- `alert`, `confirm`, `prompt`, `getUserMedia`.
- A second CSP in the demo's head that allows everything, and a demo with its own doctype, `<html>` and `<head>`.

## 9. Decisions (user, 2026-11-23, after the mockups)

- **Layout B: tap to run.** The figure shows in the lesson. The demo shows as a still card with "Run demo", and runs in a sheet only after a tap. So at most one demo WebView runs, and the lesson scroll never fights the demo.
- **D1: allow 3 CDN hosts (option b).** The demo CSP allows scripts, style sheets and fonts from `https://cdn.jsdelivr.net`, `https://unpkg.com` and `https://cdnjs.cloudflare.com`. Every other source stays `'none'`: `connect-src`, `img-src` (only `data:` and `blob:`), frames, workers, forms. The user asked why no network: a demo that needs a CDN library cannot run without it.
  - What can leave the phone: the request for the library file, with the phone's IP address, to one of the 3 CDN operators. A script can put data in the path of a second CDN request. Only the CDN operator sees that path; jsDelivr and unpkg also serve any npm package or GitHub repository, so an attacker can publish a script there, but cannot read the request logs. **[memory]**
  - A script from a CDN runs in the same sandbox as model-written script. It cannot do anything that the model's own inline script cannot do.
  - No network (offline, or a CDN that is down): the library does not load. The demo shows the error state 4 or 9 (a page error or "This demo needs the internet").
  - The visual page keeps no network at all (no CSP source).
- **D2: WebView image, near the screen only (option a).** The user asked about the WebView leak (issue 21 slice B). The facts: the old leak (about 29 WebKit processes that never ended for each open) is gone; the iPhone count of 2026-11-18 showed that processes end when islands unmount. Open point: peaks of about 50 to 60 processes during a fast scroll. So a figure mounts its WebView only near the screen (the island viewport of issue 21 slice D) and a test counts the figure WebViews.
- **D3: open the image route now (option b).** Fork `electron/phone-access.cjs`: `GET /api/chats/:id/images/:snapshotId`. The route (fork `app/api/chats/[id]/images/[snapshotId]/route.ts`) **[code]**: only `GET`; the snapshot id must be 64 hex characters; it reads only the session's own `imageSnapshots` (it never opens a file path); 404 `{ "error": "Not found" }` for an unknown chat or id; `Cache-Control: private, no-store`. The answer is `{ mimeType, data, width, height }` with PNG or JPEG base64 data. What a stolen token gets: the learner's photos of a session. The token can already read every session's text. The phone checks the answer as the desktop does (`use-image-snapshot.ts`): `image/png` or `image/jpeg`, a string, whole positive width and height. The figure page gets the image as a `data:` URL inside the SVG (`embedLearnerImage`, fork `src/core`), so the page CSP does not change. The photo figure has no invert switch, as on the desktop.
- **D4: "Send to teacher"** as proposed: the learner sees "This demo has an error." The button sends a fixed sentence and the error text (at most 500 characters, control characters removed).

## 10. Follow-ups (not in issue 19)

- The other steer kinds (research, pdf, plugin, abort, delivery failure) also show as learner bubbles. They need the desktop's badges and cards.
- Download of an SVG or HTML file (the desktop has it): a share sheet on the phone. Not in issue 19.
