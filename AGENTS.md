This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Decisions

- Record each big decision (architecture, security, data, performance, or a change that the user sees on many screens) in `docs/DECISIONS.md`, for the phone and the desktop fork. Use its template: the problem, how we found it, the options, the decision and why, the change, and the validation with numbers before and after.
- Write the entry when the decision is made. Add the numbers when the result is measured. Never delete an entry; a new decision replaces an old one with a new entry.

## Commits

- Write each commit subject as a Conventional Commit, the same as upstream LearnHarness: `type(scope): summary`. Example: `fix(session): open a long session at its last message`.
- Use the GitHub noreply email `278555343+cnovelles@users.noreply.github.com`. Add no AI attribution lines.
- Run `npm run format:check`, `npx expo lint`, `npx tsc --noEmit` and `npx jest` before each commit.

## The user's real data

The Mac app runs on the user's real courses in `~/Library/Application Support/LearnHarness/data`. Never lose this data.

- Never point a test, a test Mac or a script at the real folder. Use a temp `LH_DATA_DIR` with a copy of the golden data.
- Before a step that can touch the real data (a fork build install, an upstream sync install, a folder migration, a store schema change), make a dated backup: copy `~/Library/Application Support/LearnHarness/` (without the Chromium cache folders) to `~/Development/learnharness-app-backups/<date>-<reason>/`. Compare the `data/` folders with `diff -rq` and parse each `.json` and `.jsonl` file.
- Copy, never move or delete, the real folder.

## Error states

Every feature handles its error states, not only the happy path.

- Before you write the code, list the error states of the feature in its issue. Examples are server refusals, network loss, auth, conflicts, invalid input, and a retry of something that never started.
- Give each error state a clear message for the user and a test.
- Never show raw server or exception text on screen. This includes JSON bodies, HTTP status lines and internal error strings.
- `ErrorText` takes only a `UserMessage`. Make one with `describeError(error)` for errors, or with `userMessage("…")` for literal text that you write for the user (`src/lib/user-error.ts`).
- When the Mac sends a new refusal envelope or a new error text, add it to `describeError`, with a test in `tests/user-error.test.ts`.
- Throw `UserFacingError` (or a subclass, such as `PairingError`) only with text written for the user.
- ESLint (`no-restricted-syntax` in `eslint.config.js`) blocks `.message` in JSX, casts to `UserMessage`, and non-literal text in `userMessage()`. Do not turn these rules off.
