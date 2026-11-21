/**
 * One WebView island (issue 05 slice C): a page from lh-island-pages, its
 * page script and its JSON data. This component locks the WebView down,
 * reads the page's messages and sets the height.
 *
 * Error states (docs/ISSUES.md, issue 05):
 * - 10: the WebView process stops. The island loads again one time. A second
 *   stop, a load error or a page that reports bad data calls `onFail`.
 * - 11: no valid height in HEIGHT_WAIT_MS. The island takes its minimum
 *   height, and the content scrolls inside it. A height over `maxHeight`
 *   shows `maxHeight`, and the content scrolls inside it too.
 * - 12: the page loads nothing after its own HTML (`allowIslandLoad`), opens
 *   no window, and finds no data detectors or link previews. The page CSP
 *   has no `script-src` and no network source (scripts/island-pages).
 */
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { parseIslandMessage, type IslandMessage } from "@/lib/island-messages";
import { perf } from "@/lib/perf";

/** How long the island waits for its first valid height. */
export const HEIGHT_WAIT_MS = 3000;

/** How many times a stopped WebView process loads again. */
export const MAX_RELOADS = 1;

/**
 * The script that gives the page its data, for
 * `injectedJavaScriptBeforeContentLoaded` (iOS adds it as the raw script
 * source). The data is a JSON literal, with the characters that could end a
 * script or a line written as `\uXXXX`.
 *
 * Not `injectedJavaScriptObject`: react-native-webview 14.0.1 on iOS puts its
 * JSON inside a JavaScript template literal with no escaping, so a backslash
 * or a newline breaks the JSON, and a backtick or `${` in model text runs as
 * code in the page (found on the Simulator, 2026-11-15).
 */
export function islandDataScript(data: object): string {
	const json = JSON.stringify(data).replace(
		/[<>&\u2028\u2029]/g,
		(ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
	return `window.__lhIslandData = ${json};\ntrue;`;
}

/** The page's own HTML loads as `about:blank`. Every other load is refused. */
export function allowIslandLoad(url: string): boolean {
	return url === "about:blank";
}

export type WebIslandProps = {
	html: string;
	script: string;
	/** The page data. A change after the load goes to the page as a message
	 *  when `live` is true, and loads the page again when it is false. */
	data: object;
	live?: boolean;
	minHeight: number;
	maxHeight: number;
	/** The height to show before the page reports one (a cached height). */
	initialHeight?: number | null;
	onHeight?: (height: number) => void;
	/** Link taps, long presses, "rendered" and parse errors. */
	onMessage?: (message: IslandMessage) => void;
	/** The island cannot load: show the fallback. */
	onFail: () => void;
	/** The full-screen viewer: fill the space, scroll and zoom in the page,
	 *  and wait for no height. */
	fill?: boolean;
	testID?: string;
};

export function WebIsland({
	html,
	script,
	data,
	live = false,
	minHeight,
	maxHeight,
	initialHeight = null,
	onHeight,
	onMessage,
	onFail,
	fill = false,
	testID,
}: WebIslandProps) {
	const [height, setHeight] = useState<number | null>(initialHeight);
	const [noHeight, setNoHeight] = useState(false);
	const [reloads, setReloads] = useState(0);
	const webview = useRef<ComponentRef<typeof WebView>>(null);
	const loaded = useRef(false);
	const sent = useRef<object | null>(null);
	const gotHeight = useRef(false);
	// The island count of the perf panel (issue 21 slice A).
	useEffect(() => {
		perf.islandStarted();
		return () => perf.islandEnded();
	}, []);
	// One load of the page: the WebView gets `load.data` through
	// `islandDataScript`. A stopped process, or new data when the
	// island is not live, makes a new load.
	const [load, setLoad] = useState({ n: 0, data, reloads });
	if (load.reloads !== reloads || (!live && load.data !== data)) {
		setLoad({ n: load.n + 1, data, reloads });
	}

	useEffect(() => {
		loaded.current = false;
		sent.current = load.data;
		gotHeight.current = false;
		const timer = setTimeout(() => {
			if (!gotHeight.current && !fill) setNoHeight(true);
		}, HEIGHT_WAIT_MS);
		return () => clearTimeout(timer);
	}, [load, fill]);

	const post = () => {
		if (live && loaded.current && sent.current !== data) {
			sent.current = data;
			webview.current?.postMessage(JSON.stringify(data));
		}
	};
	// A new text while a reply streams goes to the loaded page.
	useEffect(post);

	const handleMessage = (event: WebViewMessageEvent) => {
		const message = parseIslandMessage(event.nativeEvent.data);
		if (!message) return;
		if (message.type === "height") {
			gotHeight.current = true;
			setNoHeight(false);
			setHeight(message.height);
			onHeight?.(message.height);
			return;
		}
		if (message.type === "error" && message.kind !== "parse") {
			onFail();
			return;
		}
		onMessage?.(message);
	};

	const handleStop = () => {
		if (reloads < MAX_RELOADS) setReloads(reloads + 1);
		else onFail();
	};

	const valid = height !== null && !noHeight;
	const shown = valid ? Math.min(Math.max(height, 1), maxHeight) : Math.max(minHeight, height ?? 0);
	const scroll = fill || !valid || height > maxHeight;

	return (
		<View style={fill ? styles.fill : { height: shown }} testID={testID}>
			<WebView
				key={load.n}
				ref={webview}
				source={{ html }}
				originWhitelist={["*"]}
				injectedJavaScript={script}
				injectedJavaScriptBeforeContentLoaded={islandDataScript(load.data)}
				onMessage={handleMessage}
				onLoadEnd={() => {
					loaded.current = true;
					post();
				}}
				onError={onFail}
				onContentProcessDidTerminate={handleStop}
				onRenderProcessGone={handleStop}
				onShouldStartLoadWithRequest={(request) => allowIslandLoad(request.url)}
				onOpenWindow={() => {}}
				javaScriptCanOpenWindowsAutomatically={false}
				dataDetectorTypes="none"
				allowsLinkPreview={false}
				textInteractionEnabled={false}
				incognito
				cacheEnabled={false}
				scrollEnabled={scroll}
				bounces={fill}
				overScrollMode="never"
				showsVerticalScrollIndicator={scroll && !fill}
				showsHorizontalScrollIndicator={false}
				automaticallyAdjustContentInsets={false}
				contentInsetAdjustmentBehavior="never"
				webviewDebuggingEnabled={__DEV__}
				style={styles.webview}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	webview: { flex: 1, backgroundColor: "transparent" },
	fill: { flex: 1 },
});
