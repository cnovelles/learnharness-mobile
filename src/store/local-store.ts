/**
 * The local store (issue 09): one SQLite database with the four port
 * adapters and the outbox. `createLocalStore` takes an open database (tests
 * use node:sqlite); `openPhoneStore` opens the phone's database and gives
 * null when it cannot (no native module in an old dev build, a failed
 * migration, a newer schema). The app then works from the Mac as before.
 */
import type { GraphStore, SettingsStore } from "@/lib/shared";

import { createChatStore, type LocalChatStore } from "./chat-store";
import { createGraphStore } from "./graph-store";
import type { ImageFiles } from "./image-files";
import { createJobStore, type LocalJobStore } from "./job-store";
import { createOutbox, NO_OUTBOX, type Outbox } from "./outbox";
import { migrate } from "./schema";
import { createSettingsStore } from "./settings-store";
import type { SqlDatabase } from "./sql";

export interface LocalStore {
	db: SqlDatabase;
	chats: LocalChatStore;
	graph: GraphStore;
	jobs: LocalJobStore;
	settings: SettingsStore;
	outbox: Outbox;
	/** The graph store again, but its writes add no outbox rows (the golden import). */
	imports: { graph: GraphStore };
}

export interface LocalStoreDeps {
	db: SqlDatabase;
	files: ImageFiles;
	now?: () => string;
	randomHex?: () => string;
}

/** Migrates the database, then makes the stores. Throws when the migration fails. */
export function createLocalStore(deps: LocalStoreDeps): LocalStore {
	const { db, files, now, randomHex } = deps;
	migrate(db);
	const outbox = createOutbox(db, now);
	return {
		db,
		chats: createChatStore({ db, files, outbox, now, randomHex }),
		graph: createGraphStore(db, outbox),
		jobs: createJobStore({ db, outbox, now, randomHex }),
		settings: createSettingsStore(db, outbox),
		outbox,
		imports: {
			graph: createGraphStore(db, NO_OUTBOX),
		},
	};
}

export const PHONE_DATABASE = "local-store.db";

/**
 * Opens the phone's store, or null when it cannot. `log` gets the reason
 * (never the screen: issue 11 adds a message before mode 3 needs the store).
 */
export function openPhoneStore(log: (reason: unknown) => void): LocalStore | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { openPhoneDatabase } = require("./expo-sql") as typeof import("./expo-sql");
		const { phoneImageFiles } =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require("./phone-image-files") as typeof import("./phone-image-files");
		return createLocalStore({ db: openPhoneDatabase(PHONE_DATABASE), files: phoneImageFiles() });
	} catch (error) {
		log(error);
		return null;
	}
}
