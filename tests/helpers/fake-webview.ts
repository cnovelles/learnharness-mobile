/**
 * The test side of the react-native-webview mock (__mocks__/). Jest uses the
 * mock for every test, so this import is the mocked module: the same one
 * that the app code imports.
 */
import { runInNewContext } from "node:vm";

import * as mocked from "react-native-webview";

type FakeModule = typeof import("../../__mocks__/react-native-webview");

const fake = mocked as unknown as FakeModule;

export const webviews = fake.webviews;
export const sendFromPage = fake.sendFromPage;
export const resetWebviews = fake.resetWebviews;
export type { FakeWebView } from "../../__mocks__/react-native-webview";

/** The island data of a WebView, read the way the page reads it. */
export function islandData(webview: { props: Record<string, unknown> }): Record<string, unknown> {
	const page: { __lhIslandData?: Record<string, unknown> } = {};
	runInNewContext(webview.props.injectedJavaScriptBeforeContentLoaded as string, { window: page });
	return page.__lhIslandData!;
}
