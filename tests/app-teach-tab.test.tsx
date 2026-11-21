/**
 * The Teach tab (issue 20, slice B): the continue card, the sessions in the
 * desktop folders with the concept counts, and error states 1 and 2.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

import { FakeMac, PROBE, type Rec, pairedConnection } from "./helpers/fake-mac";
import { inTab } from "./helpers/tabs";

const mockKeychain = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
	AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
	WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
	getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
	setItemAsync: async (key: string, value: string) => void mockKeychain.set(key, value),
	deleteItemAsync: async (key: string) => void mockKeychain.delete(key),
}));
jest.mock("expo-device", () => ({ deviceName: "Test iPhone" }));
jest.mock("@/lib/native-pinned-fetch", () => ({
	nativePinnedFetch: () => {
		const f = globalThis.fetch as typeof fetch;
		return (url: string, init: RequestInit) => f(url, init);
	},
}));
jest.mock("expo-camera", () => ({
	CameraView: () => null,
	useCameraPermissions: () => [{ granted: false }, async () => ({ granted: false })],
}));

const APP = path.resolve(__dirname, "../src/app");
jest.setTimeout(20_000);

let mac: FakeMac;
beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	globalThis.fetch = jest.fn(mac.handle) as unknown as typeof fetch;
});

const folder = (id: string, name: string, parentId: string | null = null) => ({
	id,
	name,
	parentId,
	createdAt: "2026-10-01T00:00:00.000Z",
});

function proposition(id: string, chatId: string): Rec {
	return {
		id,
		name: id,
		statement: id,
		aliases: [],
		createdAt: "2026-11-10",
		provenance: [{ chatId, messageId: "m" }],
	};
}

/** Three sessions: two in folders, one loose, and an empty folder. */
function shelf() {
	const idx = mac.add("Indexes");
	const mvcc = mac.add("MVCC");
	const bayes = mac.add("Bayes rule");
	mac.add("Linear recurrences", [], "practice");
	mac.directory = {
		organization: {
			version: 1,
			folders: [
				folder("db", "Databases"),
				folder("pg", "Postgres", "db"),
				folder("read", "Reading list"),
			],
			placements: { [idx]: { folderId: "db" }, [mvcc]: { folderId: "pg" } },
		},
		sources: [],
	};
	mac.propositions = [
		proposition("a", idx),
		proposition("b", idx),
		proposition("c", mvcc),
		proposition("d", "chat_gone"),
	];
	return { idx, mvcc, bayes };
}

it("shows the sessions in the desktop folders, with path labels and concept counts", async () => {
	const { idx, mvcc, bayes } = shelf();
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	expect(await teach.findByText("Databases › Postgres")).toBeTruthy();
	const labels = teach
		.getAllByRole("header")
		.map((h) => h.props.children as string)
		.filter((t) => t !== "Continue learning");
	expect(labels).toEqual(["Databases", "Databases › Postgres", "Reading list", "Not in a folder"]);
	expect(await teach.findByTestId(`concepts-${idx}`)).toHaveTextContent("2 concepts");
	expect(teach.getByTestId(`concepts-${mvcc}`)).toHaveTextContent("1 concept");
	expect(teach.getByTestId(`concepts-${bayes}`)).toHaveTextContent("0 concepts");
	expect(teach.getByText("No sessions in this folder.")).toBeTruthy();
	// The practice session is not in the Teach tab.
	expect(teach.queryByText("Linear recurrences")).toBeNull();
});

it("the continue card shows the newest teach session, its step, and opens it", async () => {
	mac.add("Older");
	const id = mac.add("Tides", [
		{ role: "user", id: "u_1", content: "Tides", timestamp: 1 },
		mac.assistant([{ type: "toolCall", id: "p1", name: "plan_init", arguments: {} }]),
		{
			role: "toolResult",
			id: "r_p1",
			toolCallId: "p1",
			toolName: "plan_init",
			content: [{ type: "text", text: "ok" }],
			details: {
				ok: true,
				tree: {
					nodes: [
						{ id: "pull", title: "Uneven pull" },
						{ id: "bulges", title: "Two bulges" },
					],
					edges: [{ from: "pull", to: "bulges" }],
					version: 1,
				},
			},
			isError: false,
			timestamp: 2,
		},
		mac.assistant([
			{
				type: "toolCall",
				id: "q1",
				name: "quiz",
				arguments: { ...PROBE, type: "predict", nodeId: "pull" },
			},
		]),
	]);
	mac.listFields.set(id, {
		updatedAt: "2026-11-15T10:00:00.000Z",
		phase: "teach",
		pendingQuestion: true,
	});
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	const card = await teach.findByTestId("continue-card");
	expect(card).toHaveTextContent(/Tides/);
	expect(await teach.findByText("Teaching · step 1 of 2")).toBeTruthy();
	expect(teach.getByTestId("continue-badge")).toHaveTextContent("Your turn");
	// The waiting question shows on the row, not on the card.
	expect(teach.getByText("A question waits")).toBeTruthy();
	await fireEvent.press(teach.getByTestId("continue-session"));
	expect(screen).toHavePathname(`/session/${id}`);
});

it("puts all sessions under Not in a folder when the folders fail (error state 1)", async () => {
	shelf();
	mac.directory = null;
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	expect(await teach.findByTestId("folders-note")).toHaveTextContent(
		"Folders could not be loaded.",
	);
	expect(teach.getByTestId("folder-none")).toHaveTextContent(/Bayes rule.*Indexes.*MVCC/);
	expect(teach.queryByText("Databases")).toBeNull();
});

it("shows no numbers when the graph fails (error state 2)", async () => {
	const { idx } = shelf();
	mac.propositions = null;
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	expect(await teach.findByText("Databases › Postgres")).toBeTruthy();
	await waitFor(() => expect(mac.reads).toContain("/api/graph"));
	expect(teach.queryByTestId(`concepts-${idx}`)).toBeNull();
	expect(teach.queryByText(/concept/)).toBeNull();
});

it("reads the folders again when they change on the Mac", async () => {
	const { bayes } = shelf();
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	expect(await teach.findByText("No sessions in this folder.")).toBeTruthy();
	await waitFor(() => expect(mac.eventListeners).toBeGreaterThan(0));
	const organization = (mac.directory as { organization: { placements: Rec } }).organization;
	organization.placements[bayes] = { folderId: "read" };
	await act(async () => mac.emit("sources-changed", {}));
	await waitFor(() => expect(teach.queryByText("No sessions in this folder.")).toBeNull());
	expect(teach.getByTestId("folder-read")).toHaveTextContent(/Bayes rule/);
	expect(teach.queryByText("Not in a folder")).toBeNull();
});
