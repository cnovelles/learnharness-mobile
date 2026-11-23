# Transport security

Last update: 2026-11-16 (issue 15). Read this before you change how the phone reaches the network.

## Policy now: "pinned"

- iOS App Transport Security (ATS) is off: `NSAllowsArbitraryLoads` is `true`.
- The trust comes from the pin, not from ATS. Every request to the Mac goes through the native pinned session (`modules/pinned-fetch`, used by `src/lib/native-pinned-fetch.ts`):
  - HTTPS only. An `http` URL is refused before a request starts.
  - The leaf certificate must have the SPKI SHA-256 pin from the QR code. A wrong pin cancels the TLS handshake, so no byte of the request leaves the phone.
  - Redirects are refused.
  - `remoteFetch` takes only relative paths and adds the token only for the pinned origin.

## Why ATS is off

The Mac's gateway certificate is self-signed. ATS checks a certificate against the system trust store before our pin check, and refuses a self-signed certificate on every address that it does not treat as local. Tailscale addresses (`100.64.0.0/10`) are not local for ATS.

Evidence (2026-11-16): the Simulator log showed `ATS failed system trust` for the test Mac on `100.102.253.62`. The real iPhone on cellular failed the same way (the Mac logged `TLS handshake failed: ECONNRESET`). The same code passed on the LAN address and from macOS.

## Where the policy lives

- `plugins/with-transport-security.js` writes the whole `NSAppTransportSecurity` dictionary. `app.json` picks the policy: `["./plugins/with-transport-security", { "policy": "pinned" }]`.
- Do not add `NSAppTransportSecurity` to `ios.infoPlist` in `app.json`. iOS ignores `NSAllowsArbitraryLoads` when `NSAllowsLocalNetworking`, `NSAllowsArbitraryLoadsInWebContent`, `NSAllowsArbitraryLoadsForMedia` or `NSExceptionDomains` is also present.
- `tests/transport-security.test.ts` checks the policy, the `app.json` entry, the lint guard, and the native network files.

## Guards (ATS no longer catches mistakes)

- ESLint (`eslint.config.js`, files in `src/`): no global `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource`; no `globalThis.fetch` and the like; no import of `expo/fetch`, `expo-web-browser`, `expo-image`, or `Image` and `ImageBackground` from `react-native`.
- WebView islands: a CSP with `default-src 'none'` and no network source, only `about:blank` loads in the top frame (`allowIslandLoad`), no new windows, no microphone or camera (`mediaCapturePermissionGrantType="deny"`).
- Artifacts (issue 19, D-017, review `docs/reviews/2026-11-23-artifact-sandbox.md`): the figure page has no network source. The demo page allows scripts, style sheets and fonts only from `cdn.jsdelivr.net`, `unpkg.com` and `cdnjs.cloudflare.com` (`DEMO_CSP` in `src/lib/artifact-html.ts`); `connect-src`, frames and workers stay `'none'`. A lock script removes WebRTC and the native alert, confirm and prompt panels before the demo's scripts run. Keep `originWhitelist={["*"]}`: a URL that fails `originWhitelist` goes to `Linking.openURL`.
- Markdown: remote images are blocked. Links open in Safari (outside the app), only `http`, `https` and `mailto`.
- The pairing parser accepts only `https` addresses and needs the pin.

## Deepgram (issue 07, 2026-11-16)

Dictation with Deepgram adds one network path that does not go to the Mac.

- Path: the phone asks the Mac for a token (`GET /api/stt/token`, through the pinned session). The Mac keeps the Deepgram key and makes a grant with a 300 s TTL. The key never reaches the phone.
- The socket: `modules/dictation/ios/DeepgramRun.swift` opens `wss://api.deepgram.com/v1/listen` with the desktop's parameters (the same URL as the fork's `deepgramListenUrl`; `npm run test:native-deepgram` compares them). Only the language comes from JS, and it must look like a language code. The token goes in the WebSocket subprotocol (`bearer`), as on the desktop.
- Trust: the system's certificate check (`performDefaultHandling`). ATS is off ("pinned" policy), but ATS off does not turn off the system's certificate check for a URLSession task. Checked 2026-11-16 on macOS with `NSAllowsArbitraryLoads` in the Info.plist: `performDefaultHandling` refused `self-signed.badssl.com` (error -1202) and accepted `badssl.com`. A challenge for any other host is refused.
- What leaves the phone: the microphone audio while a Deepgram run is on, and the token. Nothing else. The run starts only when the user taps the mic with Deepgram chosen in Settings.
- Guards: `tests/transport-security.test.ts` allows native network code only in `PinnedSession.swift` and `DeepgramRun.swift`, and checks the fixed host, the `wss` scheme and the certificate handling. `modules/dictation/tests/run-deepgram-test.sh` tests the run against a local server (audio before the socket opens, a refused token, a lost connection).
- The on-device engine sends nothing. iOS itself downloads the speech model (AssetInventory); the app does not open that connection.

## Other policies

| Policy                               | ATS                        | Reach                                 | Notes                                                                                                                                                                 |
| ------------------------------------ | -------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pinned` (now)                       | off                        | LAN and Tailscale                     | App Store review asks for a reason for `NSAllowsArbitraryLoads`.                                                                                                      |
| `local-only`                         | on, local networking       | LAN only                              | The policy before issue 15.                                                                                                                                           |
| Tailscale name exception (not built) | on, exception for `ts.net` | LAN by IP, Tailscale by MagicDNS name | The Mac must add its MagicDNS name to the QR code. Test first that the exception accepts a self-signed certificate.                                                   |
| Real certificate (not built)         | on                         | Tailscale by name                     | `tailscale cert` (Let's Encrypt). HTTPS certificates must be on in the tailnet. Renewal every 90 days, so the pin must survive renewal (keep the key, or pin the CA). |

To add a policy: add it to `POLICIES` in the plugin, add a test, change the option in `app.json`, run `npx expo prebuild --platform ios --no-install`, and build again (a native change).

## Gateway writes: folder changes (issue 20 slice D, audit 2026-11-18)

Status: approved by the user (2026-11-18), with the 500-folder limit (D-015).

### What opens

One route: `POST /api/graph/sources` (fork `app/api/graph/sources/route.ts`, `sourceDirectory.change`). `DELETE /api/graph/sources` (it deletes sources and their graph data) stays refused. `GET` is already open.

The route takes one action for each request (operation-based, never the whole state):

| Action          | Effect                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| `create-folder` | Adds a folder (name, parent).                                                              |
| `rename-folder` | Changes a folder name.                                                                     |
| `rename-source` | For a chat: the same rename as `PUT /api/chats/[id]` (already open). For notes: the label. |
| `move`          | Puts a source or a folder in another folder, or at the top.                                |
| `delete-folder` | Removes an empty folder only.                                                              |

### What the server checks now

- `parseOrganizationAction`: only the 5 actions, an id and a non-empty name where needed, `parentId` a string or `null`, `kind` `source` or `folder`.
- `applyOrganizationAction`: the parent must exist, the source must exist, no folder into itself or its children (`canMoveFolder`), delete only an empty folder.
- `sourceOrganizationStore.write`: parses the full state again before the atomic write, then emits `sources-changed` (the desktop and the phone read the folders again).
- `readOrganizationAction`: at most 64 KB, also when `content-length` is wrong.

### What a stolen device token can do with it

- Rename, move, add and remove empty folders, and move sessions between folders. No session, message, graph node or file is deleted or changed. The worst result is a disordered folder list that the user must put back by hand (there is no undo).
- Compare: the token can already send chat turns, rename and steer sessions and stop jobs. The new risk is small.

### Gaps found

1. No limit on the name length (a 60 KB folder name is accepted).
2. No limit on the number of folders (many requests can grow the file and slow every folder read).
3. The proxy streams the body without a parse, so the gateway cannot check it.

### Guards (proposal)

All in one place: a `PHONE_WRITES` table in fork `electron/phone-access.cjs`. Each entry has the method, the path, a byte limit and a `check(body)` function. To change or remove a write, change only this table.

- The gateway reads the body (at most 4 KB, also when `content-length` is wrong), parses it as JSON, and calls `check`. A refusal gives 400 or 413 and the request never reaches the server.
- `check` for the folder route: an object with only the keys of its action; `action` is one of the 5; ids at most 200 characters; names, after trim, 1 to 200 characters, with no control characters.
- The gateway sends the parsed and checked body again (the same bytes for the server's own checks), not the phone's raw stream.
- A limit of 500 folders: the gateway reads `GET /api/graph/sources` before a `create-folder` and refuses with 409 at the limit.
- `DELETE /api/graph/sources` stays out of the allowlist; a test checks this.

### Tests (fork `tests/phone-access.test.ts`)

- Each of the 5 actions reaches the server with the desktop secret.
- Refused before the server: an unknown action, an extra key, a long name, a control character, a body over 4 KB (declared and real), not JSON, the `DELETE` route.
- The 500-folder limit (if chosen).
