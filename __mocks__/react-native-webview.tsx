/**
 * Jest mock of react-native-webview (issue 05 slice C). Jest cannot run a
 * WebView, so this fake keeps the props of each mounted WebView. A test
 * reads them with `webviews()` and plays the page with `sendFromPage`.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";

type Props = Record<string, unknown> & { testID?: string };

export type FakeWebView = {
	props: Props;
	posted: string[];
	mounted: boolean;
};

const live: FakeWebView[] = [];

/** The WebViews that are mounted now, oldest first. */
export function webviews(): FakeWebView[] {
	return live.filter((w) => w.mounted);
}

/** Calls the WebView's `onMessage` as the page would. */
export function sendFromPage(webview: FakeWebView, data: unknown) {
	const onMessage = webview.props.onMessage as
		((e: { nativeEvent: { data: string } }) => void) | undefined;
	onMessage?.({ nativeEvent: { data: typeof data === "string" ? data : JSON.stringify(data) } });
}

export function resetWebviews() {
	live.length = 0;
}

export const WebView = forwardRef<{ postMessage: (data: string) => void }, Props>(
	function WebView(props, ref) {
		// One record for each mount; each render updates its props.
		const ref0 = useRef<FakeWebView | null>(null);
		if (!ref0.current) ref0.current = { props, posted: [], mounted: true };
		const record = ref0.current;
		record.props = props;
		useImperativeHandle(ref, () => ({ postMessage: (data: string) => record.posted.push(data) }));
		useEffect(() => {
			live.push(record);
			return () => {
				record.mounted = false;
			};
		}, [record]);
		return <View testID="fake-webview" />;
	},
);

export default WebView;
