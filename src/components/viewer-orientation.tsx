/**
 * Landscape only in the full-screen viewer (issue 05, wide content, slice E).
 * The app starts in portrait (`expo-screen-orientation` plugin,
 * `initialOrientation: PORTRAIT_UP`). While a viewer is open, the screen can
 * turn; when it closes, the app goes back to portrait.
 *
 * Error state W8: the lock can fail (an iPad in Split View, a future iOS that
 * refuses it). The viewer then stays in portrait and still works. The error
 * goes to the console, never to the screen.
 */
import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect } from "react";

async function setLock(open: boolean): Promise<void> {
	try {
		await ScreenOrientation.lockAsync(
			open
				? ScreenOrientation.OrientationLock.DEFAULT
				: ScreenOrientation.OrientationLock.PORTRAIT_UP,
		);
	} catch (error) {
		console.warn("The screen orientation lock failed.", error);
	}
}

/** Unlock the orientation while `open` is true. */
export function useViewerOrientation(open: boolean): void {
	useEffect(() => {
		if (!open) return;
		void setLock(true);
		return () => {
			void setLock(false);
		};
	}, [open]);
}
