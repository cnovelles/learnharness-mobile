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
- `tests/transport-security.test.ts` checks the policy, the `app.json` entry and the lint guard.

## Guards (ATS no longer catches mistakes)

- ESLint (`eslint.config.js`, files in `src/`): no global `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource`; no `globalThis.fetch` and the like; no import of `expo/fetch`, `expo-web-browser`, `expo-image`, or `Image` and `ImageBackground` from `react-native`.
- WebView islands: a CSP with `default-src 'none'` and no network source, only `about:blank` loads (`allowIslandLoad`), no new windows.
- Markdown: remote images are blocked. Links open in Safari (outside the app), only `http`, `https` and `mailto`.
- The pairing parser accepts only `https` addresses and needs the pin.

## Other policies

| Policy                               | ATS                        | Reach                                 | Notes                                                                                                                                                                 |
| ------------------------------------ | -------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pinned` (now)                       | off                        | LAN and Tailscale                     | App Store review asks for a reason for `NSAllowsArbitraryLoads`.                                                                                                      |
| `local-only`                         | on, local networking       | LAN only                              | The policy before issue 15.                                                                                                                                           |
| Tailscale name exception (not built) | on, exception for `ts.net` | LAN by IP, Tailscale by MagicDNS name | The Mac must add its MagicDNS name to the QR code. Test first that the exception accepts a self-signed certificate.                                                   |
| Real certificate (not built)         | on                         | Tailscale by name                     | `tailscale cert` (Let's Encrypt). HTTPS certificates must be on in the tailnet. Renewal every 90 days, so the pin must survive renewal (keep the key, or pin the CA). |

To add a policy: add it to `POLICIES` in the plugin, add a test, change the option in `app.json`, run `npx expo prebuild --platform ios --no-install`, and build again (a native change).
