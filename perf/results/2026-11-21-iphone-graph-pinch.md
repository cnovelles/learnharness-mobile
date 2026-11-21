# Graph tab: frame rate during a pinch on the iPhone (2026-11-21)

Issue 08 slice C, D-016. iPhone 13 Pro Max (iOS 26.5.2, 120 Hz), Release build, the user's real graph (read only from the user's Mac). Thermal state: nominal in all recordings.

## How to measure (no password)

1. Connect the iPhone with the cable and unlock it.
2. Open the Graph tab in the app.
3. Record the frames: `xcrun xctrace record --template "Animation Hitches" --device <hardware UDID> --attach LearnHarness --time-limit 45s --output frames.trace`.
4. Record the CPU: the same command with `--template "Time Profiler"`.
5. Zoom and pan on the phone during the recording.

The first `xctrace` call after a pause can stop with "Timed out waiting for device to boot". Run `xcrun devicectl device info lockState --device <id>` once, then run `xctrace` again. The recording starts about 20 s after the command.

The numbers below count the frames that the render server showed (table `hitches-renders`). "While the graph moves" uses only the frame gaps under 200 ms. The Time Profiler numbers are main thread samples (1 ms each).

## Results

| Build                                                                    | Frames while the graph moves     | Frames at 120 Hz (8.3 ms) | Frames of 50 ms or more | Skia draw, main thread | Skia CPU path fill |
| ------------------------------------------------------------------------ | -------------------------------- | ------------------------- | ----------------------- | ---------------------- | ------------------ |
| Before (master `10fd43b`)                                                | about 62 fps (39 s of movement)  | 505 of 2,434 (21%)        | 19                      | 6,496 samples in 40 s  | 3,817 samples      |
| Fix 1 (discs and heads in one picture, labels drawn only when they show) | about 105 fps (7 s of movement)  | 690 of 770 (90%)          | 3                       | 6,756 samples in 40 s  | 4,132 samples      |
| Fix 2 (edges as separate lines with flat ends, as well)                  | about 107 fps (17 s of movement) | 1,769 of 1,861 (95%)      | 10                      | 1,342 samples in 30 s  | 0 samples          |

The Skia draw time on the main thread went down by about 72% for each second of recording (from 162 to 45 samples per second).

## Causes found

- **The edge shafts (the main cost).** All the shafts were one stroked path with round ends. Ganesh cannot draw that path on the GPU, so `SoftwarePathRenderer` filled it on the CPU at screen size on each frame. The cost grows with the zoom. A single straight line with flat ends goes to `SurfaceDrawContext::drawStrokedLine` (GPU). The canvas now draws the shafts with `Points` in `lines` mode and `strokeCap="butt"`.
- **The node discs and the arrow heads.** These were also one path each. They now come from one picture, recorded once for each scene, with one `drawCircle` for each disc and one small path for each head.
- **The node labels (a bug).** Skia draws a picture with no paint (`PictureCmd::draw`), so the group opacity did not reach the labels. They were drawn at full strength at all zoom levels. Now they draw only when they show, and they go through a layer paint only while they fade.
- **The jump to the side (user report).** When one finger of a pinch lifted, the pinch center jumped to the other finger, and the camera moved with it. `pinchStep` now starts the center again when the number of fingers changes.
- **The fit by pinch fingers (user report).** Two pinch fingers could count as a double tap, and the graph then went back to fit zoom. `tapAllowed` now ignores taps during a pinch and for 400 ms after it. The two taps of a double tap must also be no more than 30 pt apart.

## What is left

- The node labels are now the largest draw cost when zoomed in. They use about 512 of the 1,342 Skia samples (`TextBlobRedrawCoordinator::findOrCreateBlob`), because each new zoom scale needs new glyphs.
- Some frames take 58 to 67 ms. They are probably at the start or end of a gesture, or when the label layers change (a React render). This is not checked.
- The JS thread was almost idle during the zoom. The scene rebuild on each search key is not measured yet.

Raw traces: in the session scratchpad only (not in git).
