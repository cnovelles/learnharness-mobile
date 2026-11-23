/**
 * A local store on a real SQLite (node:sqlite) for the store tests, with a
 * clock that moves 1 s for each call and images in memory.
 */
import { createLocalStore, type LocalStore } from "@/store/local-store";
import { memoryImageFiles } from "@/store/image-files";

import { openNodeDatabase } from "./node-sql";

export function testClock(start = "2026-11-23T10:00:00.000Z"): () => string {
	let t = Date.parse(start);
	return () => {
		const stamp = new Date(t).toISOString();
		t += 1000;
		return stamp;
	};
}

export function makeTestStore(file?: string): LocalStore & {
	files: ReturnType<typeof memoryImageFiles>;
	close(): void;
} {
	const db = openNodeDatabase(file);
	const files = memoryImageFiles();
	let n = 0;
	const store = createLocalStore({
		db,
		files,
		now: testClock(),
		randomHex: () => (n++).toString(16).padStart(8, "0"),
	});
	return { ...store, files, close: () => db.close() };
}
