/**
 * The app's one session mirror (issue 09). The store opens on the first
 * mirror write, once for each app run. When it cannot open (an old dev
 * build with no ExpoSQLite module), the mirror stays off and logs it once.
 */
import { openPhoneStore } from "./local-store";
import { createSessionMirror, type SessionMirror } from "./mirror";

let mirror: SessionMirror | undefined;

export function phoneSessionMirror(): SessionMirror {
	mirror ??= createSessionMirror({
		open: () =>
			openPhoneStore((reason) =>
				// console.log, not console.warn: see the toast note in mirror.ts.
				console.log("[local store] cannot open; the session mirror is off", reason),
			),
	});
	return mirror;
}
