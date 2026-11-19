/**
 * Folder changes from the Teach tab (issue 20, slice D): the long press
 * menu, the Move sheet, the folder menu, and error states 5 to 7.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert } from "react-native";
import path from "node:path";

import { FakeMac, type Rec, pairedConnection } from "./helpers/fake-mac";
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

// iOS calls `onDismiss` after a modal closes; the folder menus run the
// chosen item then. The Jest modal has no native side, so this mock calls it.
jest.mock("react-native/Libraries/Modal/Modal", () => {
	const React = jest.requireActual<typeof import("react")>("react");
	function MockModal(props: { visible?: boolean; onDismiss?: () => void; children?: unknown }) {
		const was = React.useRef(props.visible);
		React.useEffect(() => {
			if (was.current && !props.visible) props.onDismiss?.();
			was.current = props.visible;
		});
		return props.visible ? (props.children as React.ReactNode) : null;
	}
	return { __esModule: true, default: MockModal };
});

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

/** Two sessions in folders, one loose, and an empty folder. */
function shelf() {
	const idx = mac.add("Indexes");
	const mvcc = mac.add("MVCC");
	const bayes = mac.add("Bayes rule");
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
	return { idx, mvcc, bayes };
}

/** No native side in Jest: the closed modal is gone at once, so nothing to do. */
async function dismissClosedModals() {
	await act(async () => {});
}

/** The next iOS name prompt answers Save with `text` (or Cancel with null). */
function answerPrompt(text: string | null) {
	return jest.spyOn(Alert, "prompt").mockImplementationOnce((_title, _message, buttons) => {
		const list = buttons as { text: string; onPress?: (v?: string) => void }[];
		const button = list.find((b) => b.text === (text === null ? "Cancel" : "Save"));
		button?.onPress?.(text ?? undefined);
	});
}

async function openTeach() {
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	expect(await teach.findByText("Databases › Postgres")).toBeTruthy();
	return teach;
}

async function longPress(teach: Awaited<ReturnType<typeof inTab>>, id: string) {
	await act(async () => fireEvent(teach.getByTestId(`session-${id}`), "longPress"));
	expect(await screen.findByTestId("session-menu")).toBeTruthy();
}

afterEach(() => jest.restoreAllMocks());

it("moves a session to another folder from the long press menu", async () => {
	const { mvcc } = shelf();
	const teach = await openTeach();
	await longPress(teach, mvcc);
	await fireEvent.press(screen.getByTestId("menu-move"));
	await dismissClosedModals();
	const sheet = await screen.findByTestId("move-sheet");
	expect(sheet).toHaveTextContent(/Move “MVCC”/);
	// Depth first, by name; the current folder has the check.
	const rows = ["move-to-db", "move-to-pg", "move-to-read", "move-to-none"].map((id) =>
		screen.getByTestId(id),
	);
	expect(rows.map((r) => r.props.accessibilityState?.selected)).toEqual([
		false,
		true,
		false,
		false,
	]);
	await fireEvent.press(screen.getByTestId("move-to-read"));
	expect(mac.folderChanges).toEqual([
		{ action: "move", kind: "source", id: mvcc, parentId: "read" },
	]);
	await waitFor(() => expect(teach.getByTestId("folder-read")).toHaveTextContent(/MVCC/));
	// The emptied folder keeps its section, with the empty-folder line.
	expect(teach.getByTestId("folder-pg")).toHaveTextContent(/No sessions in this folder/);
	expect(screen.queryByTestId("folder-error")).toBeNull();
});

it("makes a new folder from the Move sheet and moves the session into it", async () => {
	const { bayes } = shelf();
	const teach = await openTeach();
	await longPress(teach, bayes);
	await fireEvent.press(screen.getByTestId("menu-move"));
	await dismissClosedModals();
	answerPrompt("  Oceans ");
	await fireEvent.press(await screen.findByTestId("move-new-folder"));
	await dismissClosedModals();
	await waitFor(() => expect(mac.folderChanges).toHaveLength(2));
	const created = mac.folderChanges[0]!;
	expect(created).toEqual({ action: "create-folder", name: "Oceans", parentId: null });
	expect(mac.folderChanges[1]).toMatchObject({ action: "move", kind: "source", id: bayes });
	await waitFor(() => expect(teach.getByText("Oceans")).toBeTruthy());
	expect(teach.queryByText("Not in a folder")).toBeNull();
});

it("renames a session from the long press menu", async () => {
	const { idx } = shelf();
	const teach = await openTeach();
	await longPress(teach, idx);
	const prompt = answerPrompt("B-tree indexes");
	await fireEvent.press(screen.getByTestId("menu-rename"));
	await dismissClosedModals();
	expect(prompt.mock.calls[0]?.[4]).toBe("Indexes");
	expect(mac.folderChanges).toEqual([{ action: "rename-source", id: idx, name: "B-tree indexes" }]);
});

it("the folder menu renames a folder and adds a subfolder", async () => {
	shelf();
	const teach = await openTeach();
	answerPrompt("Data");
	await fireEvent.press(teach.getByTestId("folder-db-menu"));
	expect(await screen.findByTestId("folder-menu")).toHaveTextContent(/Databases/);
	await fireEvent.press(screen.getByTestId("folder-menu-rename"));
	await dismissClosedModals();
	await waitFor(() => expect(teach.getByText("Data")).toBeTruthy());
	answerPrompt("Joins");
	await fireEvent.press(teach.getByTestId("folder-db-menu"));
	await fireEvent.press(await screen.findByTestId("folder-menu-subfolder"));
	await dismissClosedModals();
	expect(mac.folderChanges).toEqual([
		{ action: "rename-folder", id: "db", name: "Data" },
		{ action: "create-folder", name: "Joins", parentId: "db" },
	]);
	await waitFor(() => expect(teach.getByText("Data › Joins")).toBeTruthy());
});

it("deletes an empty folder after a confirm; a folder with sessions is grey and says why", async () => {
	shelf();
	const teach = await openTeach();
	const alert = jest.spyOn(Alert, "alert");
	// A folder with a session (and a subfolder): grey, no request.
	await fireEvent.press(teach.getByTestId("folder-pg-menu"));
	expect(await screen.findByTestId("folder-menu-delete")).toBeTruthy();
	await fireEvent.press(screen.getByTestId("folder-menu-delete"));
	await dismissClosedModals();
	expect(alert).toHaveBeenLastCalledWith("Move the sessions out first.");
	expect(mac.folderChanges).toEqual([]);
	// The empty folder: asks first, then deletes.
	alert.mockImplementationOnce((_title, _message, buttons) => {
		buttons?.find((b) => b.style === "destructive")?.onPress?.();
	});
	await fireEvent.press(teach.getByTestId("folder-read-menu"));
	await fireEvent.press(await screen.findByTestId("folder-menu-delete"));
	await dismissClosedModals();
	expect(alert.mock.calls.at(-1)?.[0]).toBe("Delete “Reading list”?");
	expect(mac.folderChanges).toEqual([{ action: "delete-folder", id: "read" }]);
	await waitFor(() => expect(teach.queryByText("Reading list")).toBeNull());
});

it("a lost network keeps the list and shows the banner (error state 7)", async () => {
	const { mvcc } = shelf();
	const teach = await openTeach();
	mac.networkFailNextFolderChange = true;
	await longPress(teach, mvcc);
	await fireEvent.press(screen.getByTestId("menu-move"));
	await dismissClosedModals();
	await fireEvent.press(await screen.findByTestId("move-to-none"));
	expect(await screen.findByTestId("folder-error")).toHaveTextContent(
		"Not saved. Check the connection to your Mac.",
	);
	expect(teach.getByTestId("folder-pg")).toHaveTextContent(/MVCC/);
});

it("an older Mac refuses the route (error state 5); a Mac refusal shows its case (state 6)", async () => {
	const { mvcc } = shelf();
	const teach = await openTeach();
	mac.folderAnswer = {
		status: 403,
		body: { error: "This action is available only on the desktop." },
	};
	answerPrompt("Data");
	await fireEvent.press(teach.getByTestId("folder-db-menu"));
	await fireEvent.press(await screen.findByTestId("folder-menu-rename"));
	await dismissClosedModals();
	expect(await screen.findByTestId("folder-error")).toHaveTextContent(
		"Update LearnHarness on your Mac to change folders.",
	);
	expect(teach.getByText("Databases")).toBeTruthy();
	mac.folderAnswer = { status: 400, body: { error: "Source no longer exists." } };
	await longPress(teach, mvcc);
	await fireEvent.press(screen.getByTestId("menu-move"));
	await dismissClosedModals();
	await fireEvent.press(await screen.findByTestId("move-to-read"));
	await waitFor(() =>
		expect(screen.getByTestId("folder-error")).toHaveTextContent(
			"This folder or session is not on the Mac anymore. Refresh the list.",
		),
	);
	expect(screen.getByTestId("folder-error")).not.toHaveTextContent(/Source no longer/);
});

it("a bad name sends nothing and says why", async () => {
	shelf();
	const teach = await openTeach();
	answerPrompt("   ");
	await fireEvent.press(teach.getByTestId("folder-db-menu"));
	await fireEvent.press(await screen.findByTestId("folder-menu-rename"));
	await dismissClosedModals();
	expect(await screen.findByTestId("folder-error")).toHaveTextContent("Enter a name.");
	expect(mac.folderChanges).toEqual([]);
});

it("offers no folder changes when the folders could not be loaded", async () => {
	const { idx } = shelf();
	mac.directory = null;
	await renderRouter(APP, { initialUrl: "/" });
	const teach = await inTab("teach");
	expect(await teach.findByTestId("folders-note")).toBeTruthy();
	await act(async () => fireEvent(teach.getByTestId(`session-${idx}`), "longPress"));
	expect(screen.queryByTestId("session-menu")).toBeNull();
	expect(teach.queryByTestId("folder-none-menu")).toBeNull();
});
