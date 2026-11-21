# Upstream sync and GitHub fork (handoff)

Last update: 2026-11-14. Read with `docs/PRD.md` (Status) and `docs/ISSUES.md`.

## GitHub fork

- Account: `cnovelles`. Fork: https://github.com/cnovelles/learnharness (public). Git remote `fork` in `~/Development/learnharness`. `origin` stays the upstream author's repository: never push there.
- Commit email for both repos: `278555343+cnovelles@users.noreply.github.com` (set in each repo's local git config). Never commit with a personal Gmail address. Do not add Co-Authored-By or "Generated with Claude Code" lines (global CLAUDE.md rule).
- Pushed: `mobile/phone-access` at `c6e79ca` (issue 05 slice 0). PR: https://github.com/cnovelles/learnharness/pull/1 into the fork's `main` (upstream v0.6.1, `cb25c8e`). Mergeable.
- Actions are on. All 5 checks passed for `82fdb3e` (typecheck, tests, lint; phone gateway integration; standalone builds for mac-arm64, linux-x64, windows-x64).
- The release workflows ("Desktop release" on `v*` tags, "Notify website" on releases) stay on (user decision). Never push a `v*` tag or publish a release on the fork.

## Upstream v0.6.1 sync (done)

- Merge commit `48339e9`, merged into `mobile/phone-access` as `5a7a216`. The sync worktree and branch are removed.
- The fork keeps the gateway stop inside `killServer()` (upstream tests expect 1 `before-quit` listener) and reads the app version lazily.

## Next upstream update

1. `git fetch origin --tags`, then a trial merge in a temporary worktree (git 2.21 has no `merge-tree --write-tree`).
2. Merge into `mobile/phone-access`, then `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:phone-integration`.
3. Push to `fork` and check the CI on PR #1.
