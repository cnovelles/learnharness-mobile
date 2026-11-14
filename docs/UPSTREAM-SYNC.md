# Upstream sync and GitHub fork (handoff)

Last update: 2026-11-14. Read with `docs/PRD.md` (Status) and `docs/ISSUES.md`.

## GitHub fork

- Account: `cnovelles`. Fork: https://github.com/cnovelles/learnharness (public). Git remote `fork` in `~/Development/learnharness`. `origin` stays the upstream author's repository: never push there.
- Commit email for both repos: `278555343+cnovelles@users.noreply.github.com` (set in each repo's local git config). Never commit with the personal Gmail address: the fork is public.
- Pushed: `mobile/phone-access` at `4800177`. PR: https://github.com/cnovelles/learnharness/pull/1 into the fork's `main` (still upstream main).
- CI has not run yet:
  1. GitHub keeps workflows off on a new fork. The user must open the fork's Actions tab and turn them on.
  2. PR #1 conflicts with upstream v0.6.1 until the sync below is merged into `mobile/phone-access` and pushed.

## Upstream v0.6.1 sync (done, not merged into the working branch yet)

- Worktree `~/Development/learnharness-upstream-sync`, branch `mobile/sync-upstream-0.6.1`, merge commit `48339e9` (upstream `cb25c8e` + `4800177`). Own `node_modules` (v0.6.1).
- Conflicts resolved and fork fixes described in the merge commit message.
- `npm test` there: 5343 pass, 3 fail. The same 3 fail on clean upstream v0.6.1. Typecheck: the same 176 errors as clean upstream. Lint: 0 errors.

## Next steps (in this order)

1. Wait until the issue 01 session commits its current slice on `mobile/phone-access` (it was asked to send "committed" with the hash and pause).
2. In `~/Development/learnharness`: `git merge mobile/sync-upstream-0.6.1`, resolve any conflicts with the session's new files (it changed `electron/main.cjs`, `electron/phone-access*.{cjs,html,js}`), then `npm ci`.
3. Run `npm test`, `npm run typecheck`, `npm run lint`. Expect only the 3 upstream failures and the 176 upstream type errors.
4. Push `mobile/phone-access` to `fork`. Check that PR #1 is mergeable and that CI runs (after the user turns on workflows).
5. Remove the sync worktree: `git worktree remove ~/Development/learnharness-upstream-sync`.

## Open work in the issue 01 session (sent as messages)

- Gateway security fixes: pairing lockout (counter per pairing code, cancel the code after 10 bad attempts) and revocation closes the device's open streams.
- User decision: Tailscale + LAN with HTTPS and SPKI pinning now (new issue between 01 and 02). The app stays React Native; use a pinning library if it covers the SDK 58 streaming fetch, else a small Swift Expo module.
- CI: `npm run test:phone-integration` (tests outside the `npm test` glob) and a separate `phone-integration` job in `.github/workflows/ci.yml`.
