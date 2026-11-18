/**
 * The Teach tab shelf (issue 20, slice B). Pure code: the screen gives it
 * the session list, the desktop folders and the concepts, and it gives the
 * continue card and the sections.
 *
 * The rules (user decisions 2026-11-17, docs/ISSUES.md issue 20):
 * - The folders are the desktop Chains folders (`GET /api/graph/sources`),
 *   in the desktop order (the fork's `folderTree`, sorted by name).
 * - Each folder with sessions is a section. A subfolder is its own section
 *   with the path in the label ("Databases › Postgres"), depth first.
 * - A folder with no sessions and no subfolders shows its section with an
 *   empty-folder line. A folder with only subfolders has no section of its
 *   own: the path labels of its subfolders show it.
 * - Sessions with no folder go in "Not in a folder", after all folders.
 *   A session in a folder that the walk cannot reach (a missing folder or
 *   a folder cycle in a bad file) also goes there, so no session is lost.
 * - The row number is the concepts learned: the propositions whose birth
 *   session (`provenance[0].chatId`) is that session.
 * - The continue card is the newest teach session.
 */
import { PHASE_LABEL, type PlanStep } from "./plan";
import {
	folderTree,
	type ChatListItem,
	type FolderTreeSource,
	type GraphNode,
	type SourceDirectory,
	type SourceOrganization,
} from "./shared";

/** The label of the group of sessions with no folder. */
export const NO_FOLDER = "Not in a folder";
/** The text of a folder with no sessions. */
export const EMPTY_FOLDER = "No sessions in this folder.";
/** The separator of a subfolder path in a section label. */
export const PATH_SEPARATOR = " › ";

export interface ShelfSection {
	/** The folder id, or null for "Not in a folder". */
	folderId: string | null;
	label: string;
	sessions: ChatListItem[];
}

export interface TeachShelfInput {
	/** The teach sessions (the screen removes the practice sessions). */
	chats: readonly ChatListItem[];
	/** The desktop folders; null when they are not loaded (all sessions go in "Not in a folder"). */
	directory: SourceDirectory | null;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const byTitle = (a: ChatListItem, b: ChatListItem) =>
	collator.compare(a.title, b.title) || a.id.localeCompare(b.id);

const NO_ORGANIZATION: SourceOrganization = { version: 1, folders: [], placements: {} };

/** The sections of the Teach tab, in the desktop order. */
export function teachSections({ chats, directory }: TeachShelfInput): ShelfSection[] {
	const byId = new Map(chats.map((c) => [c.id, c]));
	const groups: FolderTreeSource[] = chats.map((c) => ({
		key: c.id,
		birth: c.id,
		label: c.title,
		nodeIds: [],
		newestCreatedAt: c.createdAt,
	}));
	const tree = folderTree({
		groups,
		organization: directory?.organization ?? NO_ORGANIZATION,
		query: "",
		sort: { col: "name", dir: 1 },
	});
	const sections: ShelfSection[] = [];
	const walk = (parentId: string, path: string, seen: ReadonlySet<string>) => {
		const items = tree.level(parentId);
		const sessions = items.flatMap((i) => (i.kind === "source" ? [byId.get(i.id)!] : []));
		const folders = items.flatMap((i) => (i.kind === "folder" ? [i.folder] : []));
		if (sessions.length > 0 || folders.length === 0)
			sections.push({ folderId: parentId, label: path, sessions });
		for (const f of folders)
			if (!seen.has(f.id)) walk(f.id, path + PATH_SEPARATOR + f.name, new Set([...seen, f.id]));
	};
	for (const item of tree.level(null))
		if (item.kind === "folder") walk(item.id, item.folder.name, new Set([item.id]));
	// A placement in a missing folder (or a cycle) must not hide a session.
	const shown = new Set(sections.flatMap((sec) => sec.sessions.map((c) => c.id)));
	const loose = chats.filter((c) => !shown.has(c.id)).sort(byTitle);
	if (loose.length > 0) sections.push({ folderId: null, label: NO_FOLDER, sessions: loose });
	return sections;
}

/** The concepts learned in each session: the count of propositions by birth session. */
export function conceptsBySession(propositions: readonly GraphNode[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const p of propositions) {
		const birth = p.provenance[0]?.chatId;
		if (birth) counts.set(birth, (counts.get(birth) ?? 0) + 1);
	}
	return counts;
}

/** "1 concept", "12 concepts". */
export function conceptLabel(count: number): string {
	return count === 1 ? "1 concept" : `${count} concepts`;
}

/** The newest teach session (the continue card), or null. */
export function continueSession(chats: readonly ChatListItem[]): ChatListItem | null {
	let newest: ChatListItem | null = null;
	for (const c of chats) if (!newest || c.updatedAt > newest.updatedAt) newest = c;
	return newest;
}

/** "step 3 of 7" from the plan steps: the current step, or the last when all are done. */
export function stepText(steps: readonly PlanStep[] | null): string | null {
	if (!steps || steps.length === 0) return null;
	const current = steps.findIndex((s) => s.status === "current");
	if (current >= 0) return `step ${current + 1} of ${steps.length}`;
	const done = steps.filter((s) => s.status === "done").length;
	return done > 0 ? `step ${done} of ${steps.length}` : null;
}

/** The mono line of the continue card: "Teaching · step 3 of 7", or the phase alone. */
export function continueLine(chat: ChatListItem, steps: readonly PlanStep[] | null): string {
	const phase = PHASE_LABEL[chat.phase] ?? PHASE_LABEL.teach;
	const step = chat.phase === "probe" ? null : stepText(steps);
	return step ? `${phase} · ${step}` : phase;
}

/** The badge of the continue card. */
export function continueBadge(chat: ChatListItem): string {
	if (chat.busy) return "Working…";
	if (chat.compacting) return "Making the history shorter";
	return "Your turn";
}

/** The small second line of a row, only when something waits or runs. */
export function rowNote(chat: ChatListItem): string | null {
	if (chat.busy) return "Working…";
	if (chat.compacting) return "Making the history shorter";
	if (chat.pendingQuestion) return "A question waits";
	if (chat.pendingProblem) return "A problem waits";
	return null;
}
