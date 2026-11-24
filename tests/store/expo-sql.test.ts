/**
 * Issue 09 fix: an app build with no ExpoSQLite native module (an old dev
 * build) must not load `expo-sqlite`. In the app, Metro sends an error that
 * a lazy `require` throws to `ErrorUtils.reportFatalError` (a red screen in
 * a dev build, a stop in a Release build), so a `try` around the `require`
 * does not help. The store must check for the native module first.
 */
import { openPhoneDatabase } from "@/store/expo-sql";
import { openPhoneStore } from "@/store/local-store";

let mockNativeModule: object | null = null;
let mockSqliteLoads = 0;

jest.mock("expo", () => ({
	requireOptionalNativeModule: (name: string) => (name === "ExpoSQLite" ? mockNativeModule : null),
}));
jest.mock("expo-sqlite", () => {
	mockSqliteLoads++;
	return {
		openDatabaseSync: () => ({
			execSync: () => {},
			runSync: () => ({ changes: 0 }),
			getAllSync: () => [],
		}),
	};
});

beforeEach(() => {
	mockNativeModule = null;
	mockSqliteLoads = 0;
	jest.resetModules();
});

describe("openPhoneDatabase", () => {
	it("does not load expo-sqlite when the native module is missing", () => {
		expect(() => openPhoneDatabase("store.db")).toThrow(
			"This app build has no ExpoSQLite native module.",
		);
		expect(mockSqliteLoads).toBe(0);
	});

	it("loads expo-sqlite when the native module is in the build", () => {
		mockNativeModule = {};
		expect(openPhoneDatabase("store.db")).toBeDefined();
		expect(mockSqliteLoads).toBe(1);
	});
});

describe("openPhoneStore", () => {
	it("gives no store and logs once when the native module is missing", () => {
		const log = jest.fn();
		expect(openPhoneStore(log)).toBeNull();
		expect(log).toHaveBeenCalledTimes(1);
		expect(mockSqliteLoads).toBe(0);
	});
});
