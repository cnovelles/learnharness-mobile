# Rebrand proof: LearnHarness to OrbiTutor (issue 22, phase A)

**Name decision (user, 2026-11-23): OrbiTutor.** "LearnLoop" is a registered US trademark for educational software, so the user chose a new name after the name check. Forms: `OrbiTutor` (display), `orbitutor` (code, package names, bundle id), `ORBITUTOR` (constants). The sections below first tested "LearnLoop". The codemod now uses OrbiTutor, and a new run gave the same conflict counts. See "Part 3: the new name".

Date: 2026-11-23. Work done only in a throwaway clone. Nothing changed in `~/Development/learnharness` or `~/Development/learnharness-mobile`. Nothing was pushed.

## Result

- **Does the script remove the name conflicts? Yes, but only with a "renamed upstream line" (method b2 below).**
- The method in the plan (method b: run the codemod on the new upstream, commit with the upstream tag as the only parent, merge) does **not** remove them. It gives 12 conflicting files, one more than a plain merge.
- **Name check: "LearnLoop" is not free.** A registered, live US trademark "LEARNLOOP" exists for educational software (class 42). Three iOS apps already use the name, two of them in Education. See part 2. This is not legal advice.

## Setup

- Clone: `/private/tmp/claude-501/-Users-Christian-Development/2fd7e3ec-4b5e-4759-aa74-7167569f72bc/scratchpad/lh` (local clone, push URLs set to `DISABLED`).
- Old upstream: `v0.6.1` (the fork's merge base). New upstream: `upstream/main` = `v0.7.0-1-g069a6a11` (117 commits after v0.6.1).
- Old fork: `mobile/phone-access` (17 commits on v0.6.1) plus the codemod, as one commit.
- Git: Apple git 2.50.1 (`merge-ort`). Caution: `/usr/local/bin/git` is first on the PATH and is git 2.21 (no `merge-ort`). Use a modern git for each sync.
- `docs/UPSTREAM-SYNC.md` does not exist in the fork now. Phase E must write it.

## The codemod prototype

- Script: `orbitutor-brand/rebrand/rebrand.mjs` (in the side-session notes folder; a copy of the scratchpad prototype)
- Allowlist: `orbitutor-brand/rebrand/rebrand.allow.json`
- Simulation: `orbitutor-brand/rebrand/simulate.sh` and the conflict classifier `orbitutor-brand/rebrand/classify.mjs` (the simulation expects the throwaway clone in the scratchpad; make a new clone to run it again)
- Options: `--root <dir>`, `--dry-run`, `--check` (exit 1 when an old-name string is outside the allowlist), `--allow <file>`.

What it does:

- The name table: `LEARNHARNESS`, `LearnHarness`, `Learnharness`, `learnharness`, `LEARN_HARNESS`, `learn_harness`, `Learn-Harness`, `learn-harness`, `Learn Harness` to `ORBITUTOR`, `OrbiTutor` or `orbitutor`. In the code today, only `LearnHarness` (244 lines) and `learnharness` (243 lines) occur.
- File and folder renames with `git mv` (8 paths: `skills/learnharness/**`, `skills/learnharness-plugins/**`).
- It skips binary files and the allowlist paths: `LICENSE`, `**/LICENSE*`, `docs/UPSTREAM-SYNC.md`, the script and the allowlist.
- It keeps a full line that has `copyright`, `©`, `(c) <year>` or the marker `rebrand-keep`. Phase E can use the marker for the data-migration code, which must name the old folder.
- It keeps protected spans in a line: `github.com/amosblomqvist/learnharness*`, `amosblomqvist/learnharness-web`, `hrdkj/learnharness` (drawing-pad credit), `learnharness.ai`.
- On the fork: 171 files, 432 lines, 8 paths. After the run, 21 old-name strings stay, all upstream URLs.

Idempotency: **yes.** A second run on the renamed fork and on the renamed upstream reports "0 files changed, 0 paths renamed", `git status` is clean, and `--check` reports 0.

## Part 1: conflict counts

| Method                                                             | Conflicting files | Name blocks | Code blocks |
| ------------------------------------------------------------------ | ----------------- | ----------- | ----------- |
| (c) Baseline: no rename on either side                             | 6                 | 0           | 9           |
| (a) Plain merge of new upstream into the renamed fork              | 11                | 7           | 9           |
| (b) Codemod on new upstream (parent: upstream only), commit, merge | 12                | 8           | 9           |
| (b2) Renamed upstream line (see below)                             | 6                 | 0           | 9           |

A "name block" is a conflict block where one side only renamed the base, or where both sides are equal after the codemod (diff3 check).

The 6 code conflicts (the same files in (a), (b), (b2) and (c)): `components/graph-canvas.ts`, `components/graph-view.tsx`, `components/plan-block.tsx`, `components/plan-layout.ts` (add/add), `components/question-dock.tsx`, `components/source-folder-tree.tsx`. These come from the fork's `src/core` refactors and upstream's changes, not from the name.

The name-only conflicts in (b): `electron/main.cjs`, `package.json`, `package-lock.json`, `plugins/drawing-pad/tests/frontend.test.ts`, `tests/claude-code-stream.test.ts`, `tests/model-catalog.test.ts`. Also one name block in `components/source-folder-tree.tsx`. (a) has the same list without `electron/main.cjs`.

### Why (b) fails

The merge base of (b) is still the old v0.6.1 with the old name. Both sides change each name line, so git must merge two changes at the same place. When the fork or upstream also changed a line next to a renamed line, git reports a conflict. Example in `electron/main.cjs`: both sides changed `PRODUCT_NAME = "LearnHarness"` to `"LearnLoop"`, and the fork added lines below it.

### Method (b2): a renamed upstream line

The merge base must also have the new name. Thus each renamed upstream commit has the previous renamed upstream commit as a parent.

1. One time: make R1 = the codemod on `v0.6.1` (parent `v0.6.1`). In the fork, run `git merge -s ours R1`. The fork tree already has the rename, so this only records R1 as an ancestor.
2. Each sync: check out the new tag, run the codemod, and make R(n) with `git commit-tree <tree> -p R(n-1) -p <tag>`. Keep R(n) on a branch, for example `upstream-loop`.
3. Merge R(n) into the fork. The merge base is R(n-1), so both sides have the same names, and only code changes can conflict.

Proof of a second sync: the fork merged R2 (v0.7.0 line). Then R3 (a synthetic upstream commit on top) merged with 0 conflicts. The merge base was R2, and `--check` reported 0 after the merge.

## Rename detection on both sides

Upstream changed no file under `skills/` from v0.6.1 to main, so I added a synthetic upstream commit: one edit to `skills/learnharness/SKILL.md` and one new file `skills/learnharness/references/new-upstream.md`.

- (a) Plain merge: git follows the renamed `SKILL.md` and applies the edit to `skills/learnloop/SKILL.md`. The new file causes a `CONFLICT (file location)`: git puts it in `skills/learnloop/references/`, but a person must confirm the place. Both texts keep the old name, so the codemod must run again after the merge.
- (b): no file-location conflict, because both sides renamed the same paths. The texts have the new name.
- (b2): no rename in the merge at all, because the base already has the new paths. The edit and the new file arrive with the new name. 0 extra conflicts.

## Part 2: name check for "LearnLoop"

Caution: this is a search report, not legal advice. Ask a trademark lawyer before you decide.

What I found:

- **USPTO:** a registered, live mark. "LEARNLOOP", serial 87285838, registration 5250733, registered 2017-07-25. Status on TSDR (checked 2026-11-23): "LIVE/REGISTRATION/Issued and Active", Sections 8 and 15 accepted 2023-02-16. Class 042: "Software as a service, namely, software for managing educational and training materials for individuals and companies". Owner (per Justia): LearnLoop, Inc., Taylor Mill, KY. Links: [TSDR](https://tsdr.uspto.gov/#caseNumber=87285838&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch), [Justia](https://trademarks.justia.com/872/85/learnloop-87285838.html), [owner page](https://trademarks.justia.com/owners/learnloop-inc-3460248).
- **App Store (US, iTunes search API):**
  - [LearnLoop: Learn Anything](https://apps.apple.com/us/app/learnloop-learn-anything/id6783046675), GliPpiN Toys, LLC, Education (AI study packs; also on Android as `com.glippin.learnloop`).
  - [LearnLoop](https://apps.apple.com/us/app/learnloop/id6758052496), Ricardo Hurla, Education (flashcards).
  - [LearnLoop: Sosyal Ağ & Kampüs](https://apps.apple.com/us/app/learnloop-sosyal-a%C4%9F-kamp%C3%BCs/id6808781032), Social Networking.
  - No Mac App Store app with the name.
- **GitHub:** 547 repositories have "learnloop" in the name. Most are student or hackathon projects. Examples: [amdadislam01/LearnLoop-platform](https://github.com/amdadislam01/LearnLoop-platform) (e-learning), [Bogzx/LearnLoop](https://github.com/Bogzx/LearnLoop) (a prompt coach for Claude Code).
- **Web:** hackathon projects ([Devpost](https://devpost.com/software/learnloop-z9h7lb), [DigiEduHack 2025](https://digieduhack.com/solutions/learnloop-ai-enhanced-interactive-learning-platform)) and a [remio add-on](https://www.remio.ai/aapp-market/learnloop).
- **npm:** the package `learnloop` exists (created 2026-07-27); `learn-loop` is free. The plugin package names in phase E must not depend on `learnloop` on npm.
- **Domains (DNS only):** `learnloop.com` and `learnloop.io` resolve (in use or parked). `learnloop.ai`, `learnloop.app` and `learnloop.dev` have no A record. This does not prove that they are free to register.

What I could not check:

- A full USPTO search for similar marks (for example "LEARN LOOP" or "LEARNING LOOP"). I checked only the one exact record.
- Trademarks outside the US (EUIPO, WIPO, Sweden, other countries).
- App Stores in other countries, Google Play in full, and the Microsoft Store.
- Whether `learnloop.ai` and the other domains are free to register.
- Common-law use (unregistered marks).

## Part 3: the new name

The user asked for other names after the LEARNLOOP mark. About 110 names were screened (App Store, npm, GitHub repo count, DNS or registry whois). The best were then searched at the USPTO (`tmsearch.uspto.gov`; a control search for "learnloop" and "harness" showed that the search box works).

Names that were rejected, with the reason:

- Habena (Latin "rein"): no US mark, but an AI-agent tool uses the name on npm and GitHub, and `habena.com` and `habena.app` are in use.
- LearnTrellis: free `.ai`, `.app` and `.dev`, but live TRELLIS marks exist in education (class 041, Learn-It Systems; Trellis Group) and software. `learntrellis.com` was registered 2026-03-04.
- LearnCairn: all domains free, but live CAIRN marks exist in software (009, 042) and education (Cairn University, 041).
- Tutorion: a Russian online-tutoring company with the same name owns `tutorion.com` (since 2007) and `tutorion.ru`.
- LearnAtom: close to "Atom Learning", a large UK learning platform. ATOM has 712 USPTO results, including GitHub's registered ATOM (009).
- One-word names (Tendril, Kenning, Scholia, Folium and others): `.com` taken for all, `.ai` taken for all except Phylla, and many are App Store names.

OrbiTutor (checked 2026-11-23):

- USPTO: no result for "orbitutor".
- App Store (US) and Google Play: no app with the name.
- npm: `orbitutor` is free. GitHub: 1 repo with the name.
- Web search: no product with the name (only "Orbitoor", a game, and "orbitutils", a docs page).
- Domains: `orbitutor.com` (Verisign whois), `orbitutor.ai` (whois.nic.ai), `orbitutor.io` (whois.nic.io), `orbitutor.app` and `orbitutor.dev` (RDAP 404) were all not registered.
- Not checked: trademarks outside the US (EUIPO, WIPO), similar US spellings, the Microsoft Store. This is a search report, not legal advice.

The user also likes a logo idea: a leaf with a curved stem inside orbit loops, green glow on a dark tile. The orbits match the name. Phase B must make our own vector version and check it at 29 pt, at 16 px and on light backgrounds.

## Open points for the main session

1. Name: OrbiTutor is chosen. Register the domains soon (they are free now, but anyone can take them). Update issue 22, the plan and the memory (`LearnLoop` to `OrbiTutor`; bundle id `dev.local.orbitutormobile`).
2. Sync method: update the plan and issue 22 to method (b2), the renamed upstream line with `commit-tree` and a fork `merge -s ours` of R1 once.
3. Upstream links: the allowlist keeps the upstream download site, issues and security links in `README.md`, `SECURITY.md`, `CONTRIBUTING.md` and the docs. For a LearnLoop fork, these can send users to the wrong project. Decide in phase E: keep them as credit, or point them to the fork.
4. The codemod also renames the data-folder strings (for example `Support/LearnHarness/data` in docs and tests). The phase E migration code must use the `rebrand-keep` marker to keep the old name.
5. Domains and website (user, 2026-11-23): the user registers all OrbiTutor domains together, near the launch. A website is not needed to register them. Add a website phase to issue 22 after phase B: a static one-page site (logo, short description, downloads, GitHub repo, AGPL source notice) in the new palette, on a static host with HTTPS (`.app` and `.dev` work only over HTTPS).
