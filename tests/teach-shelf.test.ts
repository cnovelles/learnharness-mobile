/**
 * The Teach tab shelf (issue 20, slice B): sections in the desktop folder
 * order, concept counts, and the continue card text.
 */
import type { PlanStep } from "@/lib/plan";
import type { ChatListItem, GraphNode, SourceDirectory } from "@/lib/shared";
import {
	NO_FOLDER,
	conceptLabel,
	conceptsBySession,
	continueBadge,
	continueLine,
	continueSession,
	rowNote,
	stepText,
	teachSections,
} from "@/lib/teach-shelf";

function chat(id: string, title: string, extra: Partial<ChatListItem> = {}): ChatListItem {
	return {
		id,
		title,
		createdAt: "2026-11-10T10:00:00.000Z",
		updatedAt: "2026-11-10T10:00:00.000Z",
		kind: "teach",
		messageCount: 4,
		phase: "teach",
		pendingQuestion: false,
		pendingProblem: false,
		busy: false,
		compacting: false,
		...extra,
	};
}

const directory: SourceDirectory = {
	organization: {
		version: 1,
		folders: [
			{ id: "db", name: "Databases", parentId: null, createdAt: "2026-10-01" },
			{ id: "pg", name: "Postgres", parentId: "db", createdAt: "2026-10-01" },
			{ id: "alg", name: "Algebra", parentId: null, createdAt: "2026-10-01" },
			{ id: "read", name: "Reading list", parentId: null, createdAt: "2026-10-01" },
			{ id: "ml", name: "ML", parentId: null, createdAt: "2026-10-01" },
			{ id: "nets", name: "Networks", parentId: "ml", createdAt: "2026-10-01" },
		],
		placements: {
			idx: { folderId: "db" },
			mvcc: { folderId: "pg" },
			vac: { folderId: "pg" },
			lin: { folderId: "alg" },
			eig: { folderId: "alg" },
			cnn: { folderId: "nets" },
			gone: { folderId: "alg" },
		},
	},
	sources: [],
};

const chats = [
	chat("vac", "Vacuum"),
	chat("mvcc", "MVCC"),
	chat("idx", "Indexes"),
	chat("lin", "Linear maps"),
	chat("eig", "Eigenvalues"),
	chat("cnn", "Convolutions"),
	chat("bayes", "Bayes rule"),
	chat("untitled", "Untitled session"),
];

const shape = (input: Parameters<typeof teachSections>[0]) =>
	teachSections(input).map((s) => [s.label, s.sessions.map((c) => c.title)]);

describe("teachSections", () => {
	it("gives the desktop folder order, path labels for subfolders, and the loose sessions last", () => {
		expect(shape({ chats, directory })).toEqual([
			["Algebra", ["Eigenvalues", "Linear maps"]],
			["Databases", ["Indexes"]],
			["Databases › Postgres", ["MVCC", "Vacuum"]],
			["ML › Networks", ["Convolutions"]],
			["Reading list", []],
			[NO_FOLDER, ["Bayes rule", "Untitled session"]],
		]);
	});

	it("a folder with only subfolders has no section of its own; an empty folder keeps one", () => {
		const sections = teachSections({ chats, directory });
		expect(sections.find((s) => s.label === "ML")).toBeUndefined();
		expect(sections.find((s) => s.folderId === "read")?.sessions).toEqual([]);
	});

	it("puts all sessions in one sorted group when the folders are not loaded (error state 1)", () => {
		expect(shape({ chats: chats.slice(0, 3), directory: null })).toEqual([
			[NO_FOLDER, ["Indexes", "MVCC", "Vacuum"]],
		]);
	});

	it("gives no sections for no sessions and no folders", () => {
		expect(teachSections({ chats: [], directory: null })).toEqual([]);
	});

	it("sorts numbers in titles as numbers, as the desktop", () => {
		expect(
			shape({ chats: [chat("a", "Week 10"), chat("b", "Week 9")], directory: null })[0]![1],
		).toEqual(["Week 9", "Week 10"]);
	});

	it("does not hang on a folder cycle", () => {
		const loop: SourceDirectory = {
			organization: {
				version: 1,
				folders: [
					{ id: "x", name: "X", parentId: "y", createdAt: "" },
					{ id: "y", name: "Y", parentId: "x", createdAt: "" },
				],
				placements: { a: { folderId: "x" } },
			},
			sources: [],
		};
		expect(shape({ chats: [chat("a", "A")], directory: loop })).toEqual([[NO_FOLDER, ["A"]]]);
	});

	it("puts a session whose folder is missing in the loose group", () => {
		const missing: SourceDirectory = {
			organization: { version: 1, folders: [], placements: { b: { folderId: "gone" } } },
			sources: [],
		};
		expect(shape({ chats: [chat("b", "B"), chat("a", "A")], directory: missing })).toEqual([
			[NO_FOLDER, ["A", "B"]],
		]);
	});
});

describe("concepts", () => {
	const node = (id: string, chatId?: string): GraphNode => ({
		id,
		name: id,
		statement: id,
		aliases: [],
		createdAt: "2026-11-10",
		provenance: chatId
			? [
					{ chatId, messageId: "m1" },
					{ chatId: "other", messageId: "m2" },
				]
			: [],
	});

	it("counts the propositions by their birth session only", () => {
		const counts = conceptsBySession([
			node("a", "s1"),
			node("b", "s1"),
			node("c", "s2"),
			node("d"),
		]);
		expect(counts.get("s1")).toBe(2);
		expect(counts.get("s2")).toBe(1);
		expect(counts.get("other")).toBeUndefined();
	});

	it("writes the count with the right noun", () => {
		expect(conceptLabel(0)).toBe("0 concepts");
		expect(conceptLabel(1)).toBe("1 concept");
		expect(conceptLabel(12)).toBe("12 concepts");
	});
});

describe("continue card", () => {
	const step = (status: PlanStep["status"], i: number): PlanStep => ({
		id: `s${i}`,
		title: `Step ${i}`,
		depth: 0,
		status,
	});

	it("is the newest teach session", () => {
		const list = [
			chat("a", "A", { updatedAt: "2026-11-10T10:00:00.000Z" }),
			chat("b", "B", { updatedAt: "2026-11-12T10:00:00.000Z" }),
			chat("c", "C", { updatedAt: "2026-11-11T10:00:00.000Z" }),
		];
		expect(continueSession(list)?.id).toBe("b");
		expect(continueSession([])).toBeNull();
	});

	it("shows the current plan step, or the last done step", () => {
		expect(
			stepText([step("done", 1), step("done", 2), step("current", 3), step("upcoming", 4)]),
		).toBe("step 3 of 4");
		expect(stepText([step("done", 1), step("done", 2)])).toBe("step 2 of 2");
		expect(stepText([step("upcoming", 1)])).toBeNull();
		expect(stepText(null)).toBeNull();
	});

	it("writes the phase, and the step after the probe", () => {
		const steps = [step("current", 1), step("upcoming", 2)];
		expect(continueLine(chat("a", "A"), steps)).toBe("Teaching · step 1 of 2");
		expect(continueLine(chat("a", "A", { phase: "plan" }), null)).toBe("Planning");
		expect(continueLine(chat("a", "A", { phase: "probe" }), steps)).toBe("Probing");
	});

	it("says whose turn it is", () => {
		expect(continueBadge(chat("a", "A"))).toBe("Your turn");
		expect(continueBadge(chat("a", "A", { busy: true }))).toBe("Working…");
		expect(continueBadge(chat("a", "A", { compacting: true }))).toBe("Making the history shorter");
	});
});

describe("rowNote", () => {
	it("shows a line only when something waits or runs", () => {
		expect(rowNote(chat("a", "A"))).toBeNull();
		expect(rowNote(chat("a", "A", { pendingQuestion: true }))).toBe("A question waits");
		expect(rowNote(chat("a", "A", { pendingProblem: true }))).toBe("A problem waits");
		expect(rowNote(chat("a", "A", { busy: true, pendingQuestion: true }))).toBe("Working…");
		expect(rowNote(chat("a", "A", { compacting: true }))).toBe("Making the history shorter");
	});
});
