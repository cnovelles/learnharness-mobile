/**
 * Folder changes from the phone (issue 20, slice D). Pure code: the Move
 * sheet choices, the empty-folder rule, the name check and the error texts.
 * The Mac checks every change again (fork src/core/source-organization.ts),
 * and the gateway checks the shape and the sizes first (fork
 * electron/phone-access.cjs `PHONE_WRITES`, D-015).
 */
import {
	folderIsEmpty,
	folderTree,
	type SourceDirectory,
	type SourceFolder,
	type SourceOrganization,
} from "./shared";
import { describeError, userMessage, type UserMessage } from "./user-error";

/** The longest folder or session name that the gateway accepts. */
export const MAX_NAME = 200;
/** The most folders that the gateway lets the Mac keep. */
export const MAX_FOLDERS = 500;

export interface FolderChoice {
	folder: SourceFolder;
	/** 0 for a top-level folder. */
	depth: number;
}

/** All folders, depth first, in the desktop order (by name), for the Move sheet. */
export function folderChoices(organization: SourceOrganization): FolderChoice[] {
	const tree = folderTree({ groups: [], organization, query: "", sort: { col: "name", dir: 1 } });
	const out: FolderChoice[] = [];
	const walk = (parentId: string | null, depth: number, seen: ReadonlySet<string>) => {
		for (const item of tree.level(parentId)) {
			if (item.kind !== "folder" || seen.has(item.id)) continue;
			out.push({ folder: item.folder, depth });
			walk(item.id, depth + 1, new Set([...seen, item.id]));
		}
	};
	walk(null, 0, new Set());
	return out;
}

/** The folder of a session, or null (no folder, or a folder that is gone). */
export function folderOfSession(directory: SourceDirectory, sessionId: string): string | null {
	const placed = Object.hasOwn(directory.organization.placements, sessionId)
		? directory.organization.placements[sessionId]!.folderId
		: null;
	return placed !== null && directory.organization.folders.some((f) => f.id === placed)
		? placed
		: null;
}

/** True when the Mac lets the folder go: no subfolder and no source in it (notes files too). */
export function canDeleteFolder(directory: SourceDirectory, folderId: string): boolean {
	return folderIsEmpty(
		directory.organization,
		folderId,
		new Set(directory.sources.map((s) => s.id)),
	);
}

export type NameCheck = { ok: true; name: string } | { ok: false; message: UserMessage };

/** The same rule as the gateway: 1 to 200 characters after the trim, on one line. */
export function checkName(raw: string): NameCheck {
	const name = raw.trim();
	if (!name) return { ok: false, message: userMessage("Enter a name.") };
	if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(raw) || name.length > MAX_NAME)
		return {
			ok: false,
			message: userMessage(`Use a name of at most ${MAX_NAME} characters, on one line.`),
		};
	return { ok: true, name };
}

export const NOT_EMPTY = userMessage("Move the sessions out first.");
export const OLD_MAC = userMessage("Update LearnHarness on your Mac to change folders.");
export const NOT_SAVED = userMessage("Not saved. Check the connection to your Mac.");
const GONE = userMessage("This folder or session is not on the Mac anymore. Refresh the list.");

/** The Mac's folder refusals (fork src/core/source-organization.ts and the gateway). */
const MAC_FOLDER_ERRORS: Record<string, UserMessage> = {
	"Only empty folders can be removed. Move their entries out first.": NOT_EMPTY,
	"A folder cannot be moved into itself or its descendants.": userMessage(
		"A folder cannot go inside itself or its subfolders.",
	),
	"Parent folder no longer exists.": GONE,
	"Folder no longer exists.": GONE,
	"Source no longer exists.": GONE,
	"Enter a name.": userMessage("Enter a name."),
	[`Use a name of at most ${MAX_NAME} characters, on one line.`]: userMessage(
		`Use a name of at most ${MAX_NAME} characters, on one line.`,
	),
};

/**
 * The text for a failed folder change (error states 5 to 7). Never raw
 * server text: unknown refusals get a plain text.
 */
export function describeFolderError(error: unknown): UserMessage {
	if (error instanceof TypeError) return NOT_SAVED;
	if (typeof error === "object" && error !== null) {
		const e = error as { status?: unknown; body?: unknown };
		const body = (typeof e.body === "object" && e.body !== null ? e.body : {}) as {
			error?: unknown;
			code?: unknown;
		};
		// 403: an older fork build refuses the route (state 5).
		if (e.status === 403) return OLD_MAC;
		if (e.status === 409 && body.code === "folder-limit")
			return userMessage(
				`This Mac has the most folders it can keep (${MAX_FOLDERS}). Delete a folder first.`,
			);
		if (e.status === 400) {
			const known = typeof body.error === "string" ? MAC_FOLDER_ERRORS[body.error] : undefined;
			return known ?? userMessage("The Mac did not accept this folder change.");
		}
	}
	return describeError(error);
}
