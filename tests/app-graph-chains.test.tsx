/**
 * Issue 08 slice D: the Chains screen (user choice 3C). These tests cover
 * the entry from the Graph tab, the header and the folder sections, open
 * and close a source, the search, the sort menu, the chain sheet and its
 * "Open <session>", and the error states 1 to 7 and 11 on this screen.
 * The native sort menu is a stand-in (tests/setup/native-menu.ts).
 */
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import path from "node:path";

import type { GraphSnapshot, SourceDirectory } from "@/lib/shared";
import { FakeMac, pairedConnection } from "./helpers/fake-mac";
import { node, snapshot } from "./helpers/graph-snapshot";
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

type Answer = { status: number; body: unknown } | "network";
const ok = (body: unknown): Answer => ({ status: 200, body });

let mac: FakeMac;
let graph: Answer;
let costs: Answer;
let status: Answer;
let sources: Answer;

beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	graph = ok(snapshot());
	costs = ok({ extraction: { runs: 0, usd: 0 }, audit: { runs: 0, usd: 0 }, recent: [] });
	status = ok({ runs: [] });
	sources = ok({ organization: { version: 1, folders: [], placements: {} }, sources: [] });
	const routes: Record<string, () => Answer> = {
		"/api/graph": () => graph,
		"/api/graph/costs": () => costs,
		"/api/graph/status": () => status,
		"/api/graph/sources": () => sources,
	};
	globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
		const route = routes[new URL(url).pathname];
		if (!route || (init?.method ?? "GET") !== "GET") return mac.handle(url, init);
		const answer = route();
		if (answer === "network") throw new TypeError("Network request failed");
		return new Response(JSON.stringify(answer.body), {
			status: answer.status,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
});

/** The test graph with one more node, Epsilon, born in the notes file. */
function graphWithNotes(): GraphSnapshot {
	const body = snapshot();
	const e = node("n_e", "Epsilon", { provenance: [{ chatId: "src_notes", messageId: "" }] });
	body.nodes.push(e);
	body.propositions.push(e);
	body.positions = { ...body.positions, n_e: { x: 300, y: 0 } };
	return body;
}

const FOLDERS: SourceDirectory = {
	organization: {
		version: 1,
		folders: [{ id: "f1", name: "Math", parentId: null, createdAt: "2026-11-01T00:00:00.000Z" }],
		placements: { chat_a: { folderId: "f1" } },
	},
	sources: [
		{
			id: "chat_a",
			kind: "chat",
			chatKind: "teach",
			label: "Eigenvalues",
			createdAt: "2026-11-10T00:00:00.000Z",
		},
		{
			id: "src_notes",
			kind: "notes",
			label: "linear algebra",
			createdAt: "2026-11-05T00:00:00.000Z",
		},
	],
};

async function openChains() {
	await renderRouter(APP, { initialUrl: "/graph/chains" });
	return within(await screen.findByTestId("chains-screen"));
}

/** The source rows in screen order. */
const sourceOrder = (view: Awaited<ReturnType<typeof openChains>>) =>
	view.queryAllByTestId(/^chain-source-/).map((row) => row.props.testID as string);

it("the Chains button in the Graph tab opens the Chains screen", async () => {
	await renderRouter(APP, { initialUrl: "/graph" });
	const tab = await inTab("graph");
	await tab.findByTestId("graph-canvas");
	await fireEvent.press(tab.getByTestId("open-chains"));
	expect(screen).toHavePathname("/graph/chains");
	expect(await screen.findByTestId("chains-header")).toHaveTextContent("2 chains · 4 nodes");
});

it("shows the header, the folder sections and two-line source rows", async () => {
	graph = ok(graphWithNotes());
	sources = ok(FOLDERS);
	const view = await openChains();
	expect(await view.findByTestId("chains-header")).toHaveTextContent("3 chains · 5 nodes");
	const math = view.getByTestId("chain-section-f1");
	expect(math).toHaveTextContent(/Math/);
	expect(within(math).getByTestId("chain-source-chat_a")).toHaveTextContent(
		/Eigenvalues.*3 props · 2026-11-12/,
	);
	// The unfiled sources go last: the notes file (with its tag), then the unlabeled source.
	const unfiled = view.getByTestId("chain-section-\0unfiled");
	expect(unfiled).toHaveTextContent(/Unfiled/);
	expect(within(unfiled).getByTestId("chain-source-src_notes")).toHaveTextContent(
		/linear algebra.*notes.*1 prop · 2026-11-10/,
	);
	expect(sourceOrder(view)).toEqual([
		"chain-source-chat_a",
		"chain-source-src_notes",
		"chain-source-chat_gone",
	]);
	// No source is open: no chain line shows.
	expect(view.queryAllByTestId(/^chain-line-/)).toEqual([]);
});

it("a tap on a source opens its chain lines in place; a second tap closes it", async () => {
	const view = await openChains();
	const row = await view.findByTestId("chain-source-chat_a");
	await fireEvent.press(row);
	expect(row.props.accessibilityState).toMatchObject({ expanded: true });
	const line = view.getByTestId("chain-line-arg_1");
	expect(line).toHaveTextContent(/Alpha.*∧.*Beta.*⟹.*Gamma/);
	expect(line.props.accessibilityLabel).toBe("Alpha, Beta → Gamma");
	await fireEvent.press(row);
	expect(view.queryByTestId("chain-line-arg_1")).toBeNull();
});

it("a search opens the matching sources; a closed source stays closed in this search", async () => {
	const view = await openChains();
	await fireEvent.changeText(await view.findByTestId("chains-search"), "gamma");
	expect(sourceOrder(view)).toEqual(["chain-source-chat_a"]);
	expect(view.getByTestId("chain-line-arg_1")).toBeTruthy();
	await fireEvent.press(view.getByTestId("chain-source-chat_a"));
	expect(view.queryByTestId("chain-line-arg_1")).toBeNull();
	// With no search, the sources are closed again.
	await fireEvent.changeText(view.getByTestId("chains-search"), "");
	expect(sourceOrder(view)).toEqual(["chain-source-chat_a", "chain-source-chat_gone"]);
	expect(view.queryAllByTestId(/^chain-line-/)).toEqual([]);
});

it("a search that finds nothing says so (state 5)", async () => {
	const view = await openChains();
	await fireEvent.changeText(await view.findByTestId("chains-search"), "zz-no-match-zz");
	expect(view.getByTestId("chains-empty")).toHaveTextContent("No matching chains.");
	expect(sourceOrder(view)).toEqual([]);
});

it("a search that hides all the folders also says so (state 5)", async () => {
	sources = ok(FOLDERS);
	const view = await openChains();
	await fireEvent.changeText(await view.findByTestId("chains-search"), "zz-no-match-zz");
	expect(view.getByTestId("chains-empty")).toHaveTextContent("No matching chains.");
	expect(view.queryByText(/Math/)).toBeNull();
});

it("the sort menu sorts by a column; a second tap turns the order", async () => {
	graph = ok(graphWithNotes());
	const view = await openChains();
	expect(await view.findByTestId("chains-sort-label")).toHaveTextContent("Name ↑");
	// Name A to Z, unlabeled last.
	expect(sourceOrder(view)).toEqual([
		"chain-source-chat_a",
		"chain-source-src_notes",
		"chain-source-chat_gone",
	]);
	// A new column starts with the largest first.
	await fireEvent.press(view.getByTestId("chains-sort-props"));
	expect(view.getByTestId("chains-sort-label")).toHaveTextContent("Props ↓");
	expect(sourceOrder(view)[0]).toBe("chain-source-chat_a");
	// Created, newest first, then oldest first.
	await fireEvent.press(view.getByTestId("chains-sort-created"));
	expect(view.getByTestId("chains-sort-label")).toHaveTextContent("Created ↓");
	expect(sourceOrder(view)[0]).toBe("chain-source-chat_a");
	await fireEvent.press(view.getByTestId("chains-sort-created"));
	expect(view.getByTestId("chains-sort-label")).toHaveTextContent("Created ↑");
	expect(sourceOrder(view)[2]).toBe("chain-source-chat_a");
	// Name again: A to Z.
	await fireEvent.press(view.getByTestId("chains-sort-name"));
	expect(view.getByTestId("chains-sort-label")).toHaveTextContent("Name ↑");
});

it("a tap on a chain line opens its sheet; Open goes to the session at the conclusion's message", async () => {
	const body = snapshot();
	body.propositions[2]!.provenance = [{ chatId: "chat_a", messageId: "m3" }];
	graph = ok(body);
	const view = await openChains();
	await fireEvent.press(await view.findByTestId("chain-source-chat_a"));
	await fireEvent.press(view.getByTestId("chain-line-arg_1"));
	const sheet = await screen.findByTestId("chain-sheet");
	expect(within(sheet).getByTestId("chain-statement-n_a")).toHaveTextContent(
		/Alpha.*Alpha is true\./,
	);
	expect(within(sheet).getByTestId("chain-statement-n_c")).toHaveTextContent(/Gamma is true\./);
	const open = within(sheet).getByTestId("chain-sheet-open");
	expect(open).toHaveTextContent("Open Eigenvalues");
	await fireEvent.press(open);
	expect(screen).toHavePathname("/session/chat_a");
	expect(screen).toHaveSearchParams({ id: "chat_a", message: "m3" });
});

it("the sheet closes; a notes source and an unlabeled source have no Open button", async () => {
	graph = ok(graphWithNotes());
	const view = await openChains();
	await fireEvent.press(await view.findByTestId("chain-source-src_notes"));
	await fireEvent.press(view.getByTestId("chain-line-n_e"));
	expect(await screen.findByTestId("chain-sheet")).toHaveTextContent(/Epsilon is true\./);
	expect(screen.queryByTestId("chain-sheet-open")).toBeNull();
	await fireEvent.press(screen.getByTestId("chain-sheet-close"));
	await waitFor(() => expect(screen.queryByTestId("chain-sheet")).toBeNull());
	// State 7: the source of a gone session is unlabeled, muted, and has no session.
	const gone = view.getByTestId("chain-source-chat_gone");
	expect(gone).toHaveTextContent(/unlabeled/);
	await fireEvent.press(gone);
	await fireEvent.press(view.getByTestId("chain-line-n_d"));
	expect(await screen.findByTestId("chain-sheet")).toHaveTextContent(/Delta is true\./);
	expect(screen.queryByTestId("chain-sheet-open")).toBeNull();
	await fireEvent.press(screen.getByTestId("chain-sheet-backdrop"));
	await waitFor(() => expect(screen.queryByTestId("chain-sheet")).toBeNull());
	expect(screen).toHavePathname("/graph/chains");
});

it("an older Mac refuses the graph (state 2)", async () => {
	graph = { status: 403, body: { error: "Route not allowed for phone access" } };
	const view = await openChains();
	expect(await view.findByTestId("chains-error")).toHaveTextContent(
		"Update LearnHarness on your Mac to see your knowledge.",
	);
	expect(view.queryByText(/Route not allowed/)).toBeNull();
});

it("a body that is not valid shows a clear message, no raw text, and Try again loads it (state 3)", async () => {
	graph = ok({ nodes: "not a list", secret: "raw server text" });
	const view = await openChains();
	expect(await view.findByTestId("chains-error")).toHaveTextContent(
		"Your knowledge could not be loaded. Pull to try again.",
	);
	expect(view.queryByText(/raw server text/)).toBeNull();
	graph = ok(snapshot());
	await fireEvent.press(view.getByTestId("chains-retry"));
	expect(await view.findByTestId("chains-header")).toHaveTextContent("2 chains · 4 nodes");
});

it("an empty graph asks the learner to start a session (state 4)", async () => {
	const body = snapshot();
	body.nodes = [];
	body.propositions = [];
	body.edges = [];
	body.chains = [];
	body.clusters = [];
	graph = ok(body);
	const view = await openChains();
	expect(await view.findByTestId("chains-graph-empty")).toHaveTextContent(
		/Start a session to begin learning\./,
	);
	expect(view.queryByTestId("chains-header")).toBeNull();
});

it("the folders, costs and runs can fail; the list still shows with no folders (states 6 and 11)", async () => {
	sources = { status: 500, body: { error: "x" } };
	costs = "network";
	status = { status: 500, body: { error: "y" } };
	const view = await openChains();
	expect(await view.findByTestId("chains-header")).toHaveTextContent("2 chains · 4 nodes");
	expect(view.queryByTestId("chains-error")).toBeNull();
	expect(view.queryByText(/Unfiled/)).toBeNull();
	expect(sourceOrder(view)).toEqual(["chain-source-chat_a", "chain-source-chat_gone"]);
});

it("a failed read after a good one keeps the list, marked not up to date (state 1)", async () => {
	const view = await openChains();
	await view.findByTestId("chains-header");
	await fireEvent.press(view.getByTestId("chain-source-chat_a"));
	graph = "network";
	await act(async () => mac.emit("activity-changed", {}));
	expect(await view.findByTestId("chains-stale")).toHaveTextContent("Not up to date");
	// The list and the open source stay.
	expect(view.getByTestId("chain-line-arg_1")).toBeTruthy();
	graph = ok(snapshot());
	await act(async () => mac.emit("activity-changed", {}));
	await waitFor(() => expect(view.queryByTestId("chains-stale")).toBeNull());
});
