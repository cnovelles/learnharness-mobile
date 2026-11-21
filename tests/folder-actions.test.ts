/**
 * Folder changes from the phone (issue 20, slice D): the Move sheet choices,
 * the empty-folder rule, the name check, the error texts and the request.
 */
import {
	MAX_NAME,
	NOT_EMPTY,
	NOT_SAVED,
	OLD_MAC,
	canDeleteFolder,
	checkName,
	describeFolderError,
	folderChoices,
	folderOfSession,
} from "@/lib/folder-actions";
import { changeFolders } from "@/lib/graph-api";
import { SessionApiError } from "@/lib/sessions";
import type { SourceDirectory } from "@/lib/shared";

const folder = (id: string, name: string, parentId: string | null = null) => ({
	id,
	name,
	parentId,
	createdAt: "2026-10-01T00:00:00.000Z",
});

function directory(): SourceDirectory {
	return {
		organization: {
			version: 1,
			folders: [
				folder("read", "Reading list"),
				folder("db", "Databases"),
				folder("pg", "Postgres", "db"),
				folder("idx", "Indexes", "pg"),
				folder("alg", "algebra"),
			],
			placements: {
				chat_1: { folderId: "pg" },
				chat_2: { folderId: "gone" },
				src_notes: { folderId: "alg" },
			},
		},
		sources: [
			{ id: "chat_1", kind: "chat", label: "MVCC", createdAt: null },
			{ id: "chat_2", kind: "chat", label: "Lost", createdAt: null },
			{ id: "src_notes", kind: "notes", label: "notes.md", createdAt: null },
		],
	} as SourceDirectory;
}

describe("folderChoices", () => {
	it("lists all folders depth first, by name, with the depth", () => {
		expect(
			folderChoices(directory().organization).map(({ folder: f, depth }) => [f.name, depth]),
		).toEqual([
			["algebra", 0],
			["Databases", 0],
			["Postgres", 1],
			["Indexes", 2],
			["Reading list", 0],
		]);
	});

	it("lists each folder once also with a cycle in a bad file", () => {
		const org = {
			version: 1 as const,
			folders: [folder("a", "A", "b"), folder("b", "B", "a"), folder("c", "C")],
			placements: {},
		};
		const names = folderChoices(org).map((c) => c.folder.name);
		expect(names).toContain("C");
		expect(new Set(names).size).toBe(names.length);
	});
});

describe("folderOfSession", () => {
	it("gives the folder, or null for no folder and for a folder that is gone", () => {
		expect(folderOfSession(directory(), "chat_1")).toBe("pg");
		expect(folderOfSession(directory(), "chat_2")).toBeNull();
		expect(folderOfSession(directory(), "chat_9")).toBeNull();
		expect(folderOfSession(directory(), "__proto__")).toBeNull();
	});
});

describe("canDeleteFolder", () => {
	it("is true only with no subfolder and no source, notes files too", () => {
		const d = directory();
		expect(canDeleteFolder(d, "read")).toBe(true);
		expect(canDeleteFolder(d, "idx")).toBe(true);
		expect(canDeleteFolder(d, "db")).toBe(false); // a subfolder
		expect(canDeleteFolder(d, "pg")).toBe(false); // a session
		expect(canDeleteFolder(d, "alg")).toBe(false); // a notes file
	});
});

describe("checkName", () => {
	it("trims a good name", () => {
		expect(checkName("  Databases ")).toEqual({ ok: true, name: "Databases" });
		expect(checkName("x".repeat(MAX_NAME))).toEqual({ ok: true, name: "x".repeat(MAX_NAME) });
	});

	it("refuses an empty, a long or a multi-line name, with text for the user", () => {
		expect(checkName("   ")).toEqual({ ok: false, message: "Enter a name." });
		const long = checkName("x".repeat(MAX_NAME + 1));
		expect(long.ok).toBe(false);
		for (const bad of ["two\nlines", "tab\there", "sep\u2028here"])
			expect(checkName(bad)).toEqual(long);
	});
});

describe("describeFolderError", () => {
	const refused = (status: number, body: unknown) => new SessionApiError("raw", status, body);

	it("maps the error states of slice D", () => {
		expect(describeFolderError(new TypeError("Network request failed"))).toBe(NOT_SAVED);
		expect(
			describeFolderError(refused(403, { error: "This action is available only on the desktop." })),
		).toBe(OLD_MAC);
		expect(
			describeFolderError(
				refused(400, { error: "Only empty folders can be removed. Move their entries out first." }),
			),
		).toBe(NOT_EMPTY);
		expect(describeFolderError(refused(400, { error: "Folder no longer exists." }))).toBe(
			"This folder or session is not on the Mac anymore. Refresh the list.",
		);
		expect(describeFolderError(refused(409, { error: "x", code: "folder-limit" }))).toBe(
			"This Mac has the most folders it can keep (500). Delete a folder first.",
		);
	});

	it("never shows raw server text", () => {
		expect(describeFolderError(refused(400, { error: "SyntaxError at position 3" }))).toBe(
			"The Mac did not accept this folder change.",
		);
		expect(describeFolderError(refused(400, null))).toBe(
			"The Mac did not accept this folder change.",
		);
		const log = jest.spyOn(console, "warn").mockImplementation(() => {});
		expect(
			describeFolderError(refused(500, { error: "Could not save source organization." })),
		).toBe("Something went wrong. Try again.");
		log.mockRestore();
		expect(describeFolderError(refused(401, {}))).toBe(
			"This phone is not paired with the Mac anymore. Pair again.",
		);
	});
});

describe("changeFolders", () => {
	const answer = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

	it("posts one action as JSON and gives the new folders and the new folder id", async () => {
		const fetchImpl = jest.fn(async () =>
			answer(200, { ...directory(), createdFolderId: "folder_9" }),
		) as unknown as typeof fetch;
		const result = await changeFolders(fetchImpl, {
			action: "create-folder",
			name: "Oceans",
			parentId: null,
		});
		expect(fetchImpl).toHaveBeenCalledWith("/api/graph/sources", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "create-folder", name: "Oceans", parentId: null }),
		});
		expect(result.createdFolderId).toBe("folder_9");
		expect(result.directory.organization.folders).toHaveLength(5);
	});

	it("gives no folder id for other actions, and throws the status and body on a refusal", async () => {
		const ok = jest.fn(async () => answer(200, directory())) as unknown as typeof fetch;
		expect(
			(await changeFolders(ok, { action: "delete-folder", id: "read" })).createdFolderId,
		).toBeNull();
		const no = jest.fn(async () =>
			answer(400, { error: "Folder no longer exists." }),
		) as unknown as typeof fetch;
		await expect(changeFolders(no, { action: "delete-folder", id: "x" })).rejects.toMatchObject({
			status: 400,
			body: { error: "Folder no longer exists." },
		});
	});

	it("refuses a body that is not a folder list", async () => {
		const bad = jest.fn(async () => answer(200, { ok: true })) as unknown as typeof fetch;
		await expect(changeFolders(bad, { action: "delete-folder", id: "x" })).rejects.toThrow(
			"The Mac sent folders that are not valid.",
		);
	});
});
