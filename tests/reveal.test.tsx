/**
 * The top-to-bottom reveal in the transcript (user decision 2026-11-15):
 * a block shows only when it and every block above it are drawn, with a
 * limit of 1.5 s for the block at the front. Jest has no layout, so the
 * tests play the formula's WebView page (`sendFromPage`).
 */
import { act, render, screen } from "@testing-library/react-native";

import { Markdown } from "@/components/markdown";
import { RevealProvider, RevealScope, RevealSlot, useReportReady } from "@/components/reveal";
import { REVEAL_LIMIT_MS } from "@/lib/reveal-gate";
import { resetWebviews, sendFromPage, webviews } from "./helpers/fake-webview";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

const BASE = { fontSize: 16, lineHeight: 24, color: "#111" };
const TEXT = "Intro.\n\n$$E = mc^2$$\n\nAfter the formula.";

function Reply({ text }: { text: string }) {
	return (
		<RevealProvider>
			<RevealScope prefix={[0]} space={0}>
				<Markdown text={text} style={BASE} />
			</RevealScope>
		</RevealProvider>
	);
}

function Probe({ ready, label }: { ready: boolean; label: string }) {
	useReportReady(ready);
	return <Markdown text={label} style={BASE} />;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
	resetWebviews();
	jest.useRealTimers();
});

describe("the top-to-bottom reveal", () => {
	it("shows the blocks over a formula at once; the blocks under it wait, with a spinner at the front", async () => {
		await render(<Reply text={TEXT} />);
		expect(screen.getByText("Intro.")).toBeTruthy();
		expect(screen.queryByText("After the formula.")).toBeNull();
		expect(screen.getByTestId("reveal-wait")).toBeTruthy();
		// The formula loads while it is hidden.
		expect(webviews()).toHaveLength(1);
	});

	it("the formula's first height shows it and the blocks under it", async () => {
		await render(<Reply text={TEXT} />);
		await act(async () => {
			sendFromPage(webviews()[0]!, { type: "height", height: 40 });
		});
		expect(screen.getByText("After the formula.")).toBeTruthy();
		expect(screen.queryByTestId("reveal-wait")).toBeNull();
		expect(screen.queryByTestId("md-math-loading")).toBeNull();
	});

	it("after 1.5 s the formula shows its loading box, and the blocks under it go on", async () => {
		await render(<Reply text={TEXT} />);
		await act(async () => {
			jest.advanceTimersByTime(REVEAL_LIMIT_MS - 1);
		});
		expect(screen.queryByText("After the formula.")).toBeNull();
		await act(async () => {
			jest.advanceTimersByTime(1);
		});
		expect(screen.getByText("After the formula.")).toBeTruthy();
		expect(screen.getByTestId("md-math-loading")).toBeTruthy();
		// Never the TeX source.
		expect(screen.queryByText(/mc\^2/)).toBeNull();
	});

	it("orders rows by their place, and a shown row stays shown", async () => {
		const tree = (firstReady: boolean) => (
			<RevealProvider>
				<RevealSlot order={[0]} space={0}>
					<Probe ready={firstReady} label="First row." />
				</RevealSlot>
				<RevealSlot order={[1]} space={12}>
					<Probe ready label="Second row." />
				</RevealSlot>
			</RevealProvider>
		);
		const view = await render(tree(false));
		expect(screen.queryByText("First row.")).toBeNull();
		expect(screen.queryByText("Second row.")).toBeNull();
		await view.rerender(tree(true));
		expect(screen.getByText("First row.")).toBeTruthy();
		expect(screen.getByText("Second row.")).toBeTruthy();
		// A change that is "not ready" again does not hide a shown row.
		await view.rerender(tree(false));
		expect(screen.getByText("First row.")).toBeTruthy();
		expect(screen.getByText("Second row.")).toBeTruthy();
	});

	it("with no provider, every block shows at once (the question dock, a card)", async () => {
		await render(<Markdown text={TEXT} style={BASE} />);
		expect(screen.getByText("After the formula.")).toBeTruthy();
		expect(screen.queryByTestId("reveal-wait")).toBeNull();
	});
});
