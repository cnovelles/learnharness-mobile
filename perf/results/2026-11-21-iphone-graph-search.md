# Graph tab: the scene rebuild on each search key on the iPhone (2026-11-21)

Issue 08 slice C, D-016. iPhone 13 Pro Max (iOS 26.5.2), Release build of master `d8c0fba`, the user's real graph (read only from the user's Mac).

## How to measure (no password)

The steps are the same as in `2026-11-21-iphone-graph-pinch.md`, with `--template "Time Profiler" --time-limit 60s`. The user typed a word in the search field at about one key each second, deleted it one key at a time, and typed it again.

Each key starts a React render of the Graph tab: `canvasSearch`, `buildScene` (with `regionSplat`), the region bitmap (`regionImage`: a CPU Skia surface, `readPixels`, `blurRegionPixels`, `MakeImage`), the mark picture, the label picture and the region lines. All of this runs on the JS thread. The JS thread sample count of one key is the time that one key keeps the JS thread busy (1 ms for each sample).

## Results

| Measure                                        | Value                                  |
| ---------------------------------------------- | -------------------------------------- |
| Keys found (JS thread bursts of 10 ms or more) | 43                                     |
| JS thread time for each key                    | median 183 ms, range 135 to 219 ms     |
| Main thread samples during a key               | 6 to 27 (the UI thread is not blocked) |

The JS time does not change much with the number of visible nodes. The region bitmap has a fixed size (the longest side is 256 px), so the blur work is almost the same for each key.

## Causes found

Hermes runs the JS as bytecode, so the profile does not name the JS functions. The interpreter frames show the type of work:

- `casePutByVal` (indexed writes): 1,590 of 7,239 samples (22%). Typed-array writes of `float`: 430 samples. `Math.min` and `Math.max`: 443 samples. This is the inner loop of `boxBlurRound` (three rounds, two passes each, on Float32 arrays) and of the premultiply and unpremultiply loops in `blurRegionPixels`.
- Skia font calls (`JsiSkFont`, the label wrap): 169 samples (about 4 ms for each key).
- `Array.prototype.forEach` and `filter`: about 180 samples (the scene loops).

The frame types point to the blur in JS. A second test gives the exact part (below).

## Test: the region tints off

A test build with `CANVAS_SETTINGS.regions.enabled` set to `false` (not committed; the same steps and the same word). With no region tints, the scene has no region splat and no region bitmap. The region labels and all other layers stay the same.

| Build                    | JS thread time for each key        | Keys |
| ------------------------ | ---------------------------------- | ---- |
| Master (region tints on) | median 183 ms, range 135 to 219 ms | 43   |
| Region tints off (test)  | median 14 ms, range 12 to 46 ms    | 47   |

Thus the region bitmap (`regionSplat`, the CPU Skia surface, `readPixels`, `blurRegionPixels` and `MakeImage`) is about 170 ms of the 183 ms (about 92%). The rest of the rebuild (`canvasSearch`, `buildScene`, the pictures and the React render) is about 14 ms.

## Fix: the region blur in Skia

The phone now blurs the region bitmap in Skia (C++): the splat draws into a layer with a Gaussian blur filter and the opacity `edgeAlpha`. The sigma is `regionBlurSigma(blurPx)` = sqrt(r(r + 1)), the variance of the desktop's three box blurs of radius r. The JS loops of `blurRegionPixels` and `readPixels` do not run on the phone. The desktop stays the same.

| Build                   | JS thread time for each key        | Keys |
| ----------------------- | ---------------------------------- | ---- |
| Master (blur in JS)     | median 183 ms, range 135 to 219 ms | 43   |
| Region tints off (test) | median 14 ms, range 12 to 46 ms    | 47   |
| Fix (blur in Skia)      | median 24 ms, range 12 to 50 ms    | 49   |

The JS time for each key is 87% less. The keys of 38 to 50 ms come in groups of three, in all three builds. They are probably the short search words with more visible nodes.

The look: SE Simulator, dark, the golden data, the Graph tab at fit zoom. In the canvas area, no pixel changed by more than 3 of 255 from the screenshot before the fix (`2026-11-21-region-labels-se-dark.png`).

## What is left

- No debounce: at about 24 ms for each key, a debounce makes each result later and saves almost nothing.

Raw trace: in the session scratchpad only (not in git).
