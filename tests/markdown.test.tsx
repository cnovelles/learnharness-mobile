/**
 * Issue 05 slice A: the teacher's Markdown as native views, and its error
 * states (docs/ISSUES.md, issue 05).
 */
import fs from "node:fs";
import path from "node:path";
import { act, render, screen, fireEvent } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import * as ReactNative from "react-native";
import { Alert, Linking, StyleSheet } from "react-native";

import { COPY_LABEL_MS, Markdown } from "@/components/markdown";
import { Transcript } from "@/components/transcript";
import * as highlight from "@/lib/code-highlight";
import { tableMarkdown } from "@/lib/copy-source";
import * as md from "@/lib/markdown";
import { islandData, resetWebviews, sendFromPage, webviews } from "./helpers/fake-webview";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
const setString = Clipboard.setStringAsync as jest.MockedFunction<typeof Clipboard.setStringAsync>;

const BASE = { fontSize: 16, lineHeight: 23, color: "#111" };
const show = (text: string) => render(<Markdown text={text} style={BASE} testID="md" />);

afterEach(() => {
	resetWebviews();
	jest.restoreAllMocks();
	highlight.resetCodeHighlighter();
});

/** The color of the first code token with this text. */
const tokenColor = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style)?.color;
const blockColor = (testID: string) =>
	StyleSheet.flatten(screen.getByTestId(testID).props.style)?.backgroundColor;

describe("Markdown blocks and inline text", () => {
	it("draws headings, bold, italic and lists with no Markdown signs", async () => {
		await show("## Step 1\n\nThe **loop** runs *once*.\n\n- first\n- second\n\n1. one\n2. two");
		expect(screen.getByRole("header")).toHaveTextContent("Step 1");
		expect(screen.getByText("The loop runs once.")).toBeTruthy();
		expect(screen.getByText("first")).toBeTruthy();
		expect(screen.getAllByText("•")).toHaveLength(2);
		expect(screen.getByText("2.")).toBeTruthy();
		expect(screen.queryByText(/\*\*|##/)).toBeNull();
	});

	it("draws inline code in a mono band, also inside a list", async () => {
		await show("Set `done` to `true`.\n\n- use `count`");
		const codes = screen.getAllByTestId("md-inline-code");
		expect(codes).toHaveLength(3);
		expect(codes[0]).toHaveTextContent("done", { exact: false });
		expect(screen.queryByText(/`/)).toBeNull();
	});

	it("keeps a single line break as a line break (remark-breaks on the desktop)", async () => {
		await show("first line\nsecond line");
		expect(screen.getByText("first line\nsecond line")).toBeTruthy();
	});

	it("draws a task list with check boxes and a strikethrough", async () => {
		await show("- [x] done\n- [ ] open\n\n~~old~~ new");
		expect(screen.getByText("☑")).toBeTruthy();
		expect(screen.getByText("☐")).toBeTruthy();
		expect(screen.getByText("old new")).toBeTruthy();
	});

	it("draws an alert quote as a callout with no marker, and a plain quote", async () => {
		await show("> [!IMPORTANT]\n> The key idea.\n\n> A plain quote.");
		expect(screen.getByTestId("md-callout")).toHaveTextContent("The key idea.");
		expect(screen.getByTestId("md-quote")).toHaveTextContent("A plain quote.");
		expect(screen.queryByText(/\[!IMPORTANT\]/)).toBeNull();
	});

	it("draws a code fence with line numbers, from startLine, or without numbers", async () => {
		await show("```js startLine=5\nlet a = 1;\nlet b = 2;\n```");
		expect(screen.getByTestId("md-code-lines")).toHaveTextContent("5\n6");
		expect(screen.getByTestId("md-code-text")).toHaveTextContent("let a = 1;\nlet b = 2;");
		await show("```js noLineNumbers\nx\n```");
		expect(screen.queryByTestId("md-code-lines")).toBeNull();
	});

	it("draws math with KaTeX in islands (slice C), with no dollar signs", async () => {
		await show("Area $A = \\pi r^2$ here.\n\n$$\n\\sum_k k\n$$");
		const [paragraph, block] = webviews().map((w) => islandData(w) as { html: string });
		expect(paragraph!.html).toMatch(/^<p>Area <span class="katex">/);
		expect(paragraph!.html).not.toContain("$");
		expect(block!.html).toContain('class="katex-display"');
		expect(screen.queryByTestId("md-math-error")).toBeNull();
	});

	it("reads the old \\( \\) math delimiters, as the desktop does", async () => {
		await show("Area \\(x^2\\) here.");
		const data = islandData(webviews()[0]!) as { html: string };
		expect(data.html).toContain('<annotation encoding="application/x-tex">x^2</annotation>');
	});

	it("draws a table with a header row, inside a sideways scroll", async () => {
		await show("| Name | Value |\n| --- | ---: |\n| a | 1 |\n| b | 2 |");
		expect(screen.getByTestId("md-table")).toBeTruthy();
		expect(screen.getByText("Name")).toBeTruthy();
		expect(screen.getByText("2")).toBeTruthy();
	});

	it("15. sizes each column to its widest cell, measured on one line, up to a limit", async () => {
		await show(
			"| Side | Pull |\n| :--- | :---: |\n| Near | **strong** |\n| Far | weak ![moon](https://example.test/m.png) |",
		);
		const width = (r: number, i: number) =>
			StyleSheet.flatten(screen.getByTestId(`md-table-cell-${r}-${i}`).props.style)?.width;
		// Before the measure: a guess that counts a blocked image as its shown label,
		// so the Pull column is not as narrow as "weak" (found on the Simulator).
		expect(width(2, 1)).toBeGreaterThan(200);
		// The measure layer is hidden from VoiceOver and from touches.
		const layer = screen.getByTestId("md-table-measure-0-0", { includeHiddenElements: true }).parent
			?.parent;
		expect(layer?.props.accessibilityElementsHidden).toBe(true);
		expect(layer?.props.pointerEvents).toBe("none");
		const measured: Record<string, number> = {
			"0-0": 40,
			"0-1": 30,
			"1-0": 44,
			"1-1": 55,
			"2-0": 25,
			"2-1": 600,
		};
		await act(async () => {
			for (const [at, w] of Object.entries(measured))
				fireEvent(
					screen.getByTestId(`md-table-measure-${at}`, { includeHiddenElements: true }),
					"layout",
					{
						nativeEvent: { layout: { x: 0, y: 0, width: w, height: 20 } },
					},
				);
		});
		// The widest cell plus the cell padding; a very long cell wraps at the limit.
		expect(width(0, 0)).toBe(44 + 12);
		expect(width(1, 0)).toBe(44 + 12);
		expect(width(2, 1)).toBe(240);
		// A narrow table sits in the center; a wide one scrolls from the left edge.
		expect(
			StyleSheet.flatten(screen.getByTestId("md-table").props.contentContainerStyle),
		).toMatchObject({ flexGrow: 1, justifyContent: "center" });
	});

	it("draws a footnote reference and its text", async () => {
		await show("A claim.[^1]\n\n[^1]: The source.");
		expect(screen.getAllByText("[1]").length).toBeGreaterThan(0);
		expect(screen.getByText("The source.")).toBeTruthy();
	});
});

describe("Markdown error states", () => {
	it("1. closes partial Markdown while a reply streams", async () => {
		await show("The **bol");
		expect(screen.getByText("The bol")).toBeTruthy();
		expect(screen.queryByText(/\*\*/)).toBeNull();
		await show("```python\nprint(1)");
		expect(screen.getByTestId("md-code-text")).toHaveTextContent("print(1)");
		expect(screen.queryByText(/```/)).toBeNull();
	});

	it("2. shows the message as plain text when the drawing throws", async () => {
		jest.spyOn(md, "parseMarkdown").mockImplementation(() => {
			throw new Error("internal parser detail");
		});
		jest.spyOn(console, "error").mockImplementation(() => {});
		await show("**bold** text");
		expect(screen.getByTestId("md-plain")).toHaveTextContent("**bold** text");
		expect(screen.queryByText(/internal parser detail/)).toBeNull();
	});

	it("2. tries the Markdown again with the next text", async () => {
		const real = md.parseMarkdown;
		let fail = true;
		const spy = jest.spyOn(md, "parseMarkdown").mockImplementation((text) => {
			if (fail) throw new Error("x");
			return real(text);
		});
		jest.spyOn(console, "error").mockImplementation(() => {});
		await show("first");
		expect(screen.getByTestId("md-plain")).toBeTruthy();
		fail = false;
		await screen.rerender(<Markdown text="**second**" style={BASE} testID="md" />);
		expect(screen.queryByTestId("md-plain")).toBeNull();
		expect(screen.getByText("second")).toBeTruthy();
	});

	it("5. blocks images and shows their alt text", async () => {
		await show("![a chart](https://example.com/c.png?d=secret) and ![](https://x.test/y.png)");
		const blocked = screen.getAllByTestId("md-image-blocked");
		expect(blocked[0]).toHaveTextContent("[Image blocked: a chart]");
		expect(blocked[1]).toHaveTextContent("[Image blocked]");
		expect(screen.queryByText(/example\.com/)).toBeNull();
	});

	it("6. opens http, https and mailto links, and shows other links as text", async () => {
		const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
		await show(
			"[site](https://example.com) [mail](mailto:a@example.com) [bad](javascript:alert(1)) [file](file:///etc/passwd)",
		);
		const links = screen.getAllByTestId("md-link");
		expect(links).toHaveLength(2);
		fireEvent.press(links[0]!);
		expect(open).toHaveBeenCalledWith("https://example.com");
		expect(screen.getByText(/bad/)).toBeTruthy();
	});

	it("6. reads a link reference, and keeps the definition off screen", async () => {
		jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
		await show("See [the docs][d].\n\n[d]: https://example.com/docs");
		expect(screen.getByTestId("md-link")).toHaveTextContent("the docs");
		expect(screen.queryByText(/example\.com\/docs/)).toBeNull();
	});

	it("6. tells the learner when a link does not open", async () => {
		jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"));
		const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
		await show("[site](https://example.com)");
		fireEvent.press(screen.getByTestId("md-link"));
		await new Promise((r) => setImmediate(r));
		expect(alert).toHaveBeenCalledWith("Could not open the link.");
	});

	it("7. shows raw HTML as text and never runs it", async () => {
		await show('<script>alert("x")</script>\n\nA <b>bold</b> word.');
		expect(screen.getByText('<script>alert("x")</script>')).toBeTruthy();
		expect(screen.getByText("A <b>bold</b> word.")).toBeTruthy();
	});

	it("15. puts long code lines in a sideways scroll, not the page", async () => {
		await show(`\`\`\`\n${"x".repeat(400)}\n\`\`\``);
		const text = screen.getByTestId("md-code-text");
		let node = text.parent;
		while (node && node.type !== "RCTScrollView") node = node.parent;
		expect(node?.props.horizontal).toBe(true);
	});
});

describe("code blocks (slice B)", () => {
	it("colors a fence in the desktop's light theme, with line numbers", async () => {
		await show("```ts\nconst total = 1;\n// done\n```");
		expect(screen.getByTestId("md-code-colored")).toBeTruthy();
		expect(tokenColor("const")).toBe("#D73A49");
		expect(tokenColor("// done")).toBe("#6A737D");
		expect(blockColor("md-code-colored")).toBe("#fff");
		expect(screen.getByTestId("md-code-lines")).toHaveTextContent("1\n2");
		expect(screen.getByTestId("md-code-text")).toHaveTextContent("const total = 1;\n// done");
	});

	it("16. draws the colors again when the mode changes to dark", async () => {
		const scheme = jest.spyOn(ReactNative, "useColorScheme").mockReturnValue("light");
		const view = await show("```js\nconst a = 1;\n```");
		expect(tokenColor("const")).toBe("#D73A49");
		scheme.mockReturnValue("dark");
		await view.rerender(<Markdown text={"```js\nconst a = 1;\n```"} style={BASE} testID="md" />);
		expect(tokenColor("const")).toBe("#F97583");
		expect(blockColor("md-code-colored")).toBe("#24292e");
	});

	it("1. keeps an open fence plain while it streams, and colors it when it closes", async () => {
		const spy = jest.spyOn(highlight, "highlightCode");
		const view = await show("Look:\n\n```js\nconst a = 1;");
		expect(screen.getByTestId("md-code")).toBeTruthy();
		expect(screen.getByTestId("md-code-text")).toHaveTextContent("const a = 1;");
		expect(screen.queryByText(/```/)).toBeNull();
		expect(spy).not.toHaveBeenCalled();
		await view.rerender(<Markdown text={"Look:\n\n```js\nconst a = 1;\n```"} style={BASE} />);
		expect(screen.getByTestId("md-code-colored")).toBeTruthy();
	});

	it("3. shows an unknown language as a plain block with line numbers", async () => {
		await show("```klingon\nqapla'\nbatlh\n```");
		expect(screen.getByTestId("md-code")).toBeTruthy();
		expect(screen.getByTestId("md-code-lines")).toHaveTextContent("1\n2");
		expect(screen.getByTestId("md-code-text")).toHaveTextContent("qapla'\nbatlh");
	});

	it("4. shows a plain block when the highlighter fails or the block is too large", async () => {
		await show(`\`\`\`js\n${"let a = 1;\n".repeat(highlight.MAX_LINES + 1)}\`\`\``);
		expect(screen.getByTestId("md-code")).toBeTruthy();
		jest.spyOn(highlight, "highlightCode").mockReturnValue(null);
		await show("```js\nlet a = 1;\n```");
		expect(screen.getByTestId("md-code")).toBeTruthy();
		expect(screen.getByTestId("md-code-text")).toHaveTextContent("let a = 1;");
	});
});

describe("long press to copy (slice B)", () => {
	beforeEach(() => {
		setString.mockReset();
		setString.mockResolvedValue(true);
	});

	const longPress = async (index = 0) => {
		await act(async () => {
			fireEvent(screen.getAllByTestId("md-copy")[index]!, "longPress");
		});
	};

	it("copies a code block as text and shows Copied for a short time", async () => {
		jest.useFakeTimers();
		try {
			await show("```js\nlet a = 1;\nlet b = 2;\n```");
			await longPress();
			expect(setString).toHaveBeenCalledWith("let a = 1;\nlet b = 2;");
			expect(screen.getByTestId("md-copy-label")).toHaveTextContent("Copied");
			await act(async () => {
				await jest.advanceTimersByTimeAsync(COPY_LABEL_MS);
			});
			expect(screen.queryByTestId("md-copy-label")).toBeNull();
		} finally {
			jest.useRealTimers();
		}
	});

	it("copies a table as Markdown and a math block as TeX", async () => {
		await show("| Name | Size |\n| :--- | ---: |\n| **a** | 1 |\n\n$$\n\\sum_k k\n$$");
		await longPress(0);
		expect(setString).toHaveBeenLastCalledWith("| Name | Size |\n| :--- | ---: |\n| **a** | 1 |");
		// The math island: the page reports a long press.
		await act(async () => {
			sendFromPage(webviews()[0]!, { type: "longpress" });
		});
		expect(setString).toHaveBeenLastCalledWith("\\sum_k k");
	});

	it("keeps each copy target inside its sideways scroll (a target around it stops the scroll on iOS)", async () => {
		await show("```js\nlet a = 1;\n```\n\n| A |\n| - |\n| 1 |\n\n$$\n\\frac{1}{\n$$");
		const targets = screen.getAllByTestId("md-copy");
		// Code, table, and the source of a formula that KaTeX cannot draw.
		expect(targets).toHaveLength(3);
		for (const target of targets) {
			let node = target.parent;
			while (node && node.type !== "RCTScrollView") node = node.parent;
			expect(node?.props.horizontal).toBe(true);
		}
	});

	it("gives VoiceOver the same Copy action", async () => {
		await show("```\nx\n```");
		await act(async () => {
			fireEvent(screen.getByTestId("md-copy"), "accessibilityAction", {
				nativeEvent: { actionName: "longpress" },
			});
		});
		expect(setString).toHaveBeenCalledWith("x");
	});

	it("17. says Could not copy. when the clipboard refuses or throws", async () => {
		setString.mockResolvedValueOnce(false);
		await show("```\nx\n```");
		await longPress();
		expect(screen.getByTestId("md-copy-label")).toHaveTextContent("Could not copy.");
		setString.mockRejectedValueOnce(new Error("pasteboard locked"));
		await longPress();
		expect(screen.getByTestId("md-copy-label")).toHaveTextContent("Could not copy.");
		expect(screen.queryByText(/pasteboard/)).toBeNull();
	});

	it("17. never copies a blocked image URL, and keeps only safe links", async () => {
		const table = md.parseMarkdown(
			"| A | B |\n| --- | --- |\n| ![cat](https://x.test/cat.png) | [bad](javascript:alert(1)) |\n| a\\|b | [ok](https://x.test) |",
		).children[0];
		expect(table?.type).toBe("table");
		const text = tableMarkdown(table as never);
		expect(text).toBe("| A | B |\n| --- | --- |\n| cat | bad |\n| a\\|b | [ok](https://x.test) |");
		expect(text).not.toContain("cat.png");
	});
});

describe("in the transcript", () => {
	it("draws the teacher's text as Markdown and keeps the learner's text plain", async () => {
		await render(
			<Transcript
				rows={[
					{ kind: "user", id: "u1", text: "Is **this** bold?" },
					{ kind: "text", id: "t1", text: "## Step 1\n\nUse `count`.", streaming: false },
				]}
				onOpenPlan={() => {}}
			/>,
		);
		expect(screen.getByText("Is **this** bold?")).toBeTruthy();
		expect(screen.getByRole("header")).toHaveTextContent("Step 1");
		expect(screen.getByTestId("md-inline-code")).toHaveTextContent("count", { exact: false });
	});
});

describe("parser helpers", () => {
	it("markdownPreview gives one plain line and cuts it at 90 characters", () => {
		expect(md.markdownPreview("## Check\n\nIs `x` **true**?")).toBe("Check Is x true?");
		const long = md.markdownPreview(`**${"word ".repeat(40)}**`);
		expect(long.length).toBe(91);
		expect(long.endsWith("…")).toBe(true);
	});

	it("safeLinkUrl allows only http, https and mailto with a valid address", () => {
		expect(md.safeLinkUrl("https://example.com/a")).toBe("https://example.com/a");
		expect(md.safeLinkUrl("MAILTO:a@example.com")).toBe("MAILTO:a@example.com");
		expect(md.safeLinkUrl("javascript:alert(1)")).toBeNull();
		expect(md.safeLinkUrl("tel:123")).toBeNull();
		expect(md.safeLinkUrl("https://")).toBeNull();
		expect(md.safeLinkUrl("")).toBeNull();
		expect(md.safeLinkUrl(undefined)).toBeNull();
	});
});

describe("golden fixtures", () => {
	// The fork's recorded sessions: every teacher text must draw as Markdown,
	// never fall back to plain text.
	const dir = path.resolve(__dirname, "../../learnharness/tests/fixtures/golden-data/chats");
	const texts: string[] = [];
	for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
		const record = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
			messages?: { role?: string; content?: unknown }[];
		};
		for (const m of record.messages ?? []) {
			if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
			for (const part of m.content as { type?: string; text?: unknown }[]) {
				if (part.type === "text" && typeof part.text === "string") texts.push(part.text);
			}
		}
	}

	it("finds teacher text in the fixtures", () => {
		expect(texts.length).toBeGreaterThan(0);
	});

	it("draws every teacher text with no fallback", async () => {
		const error = jest.spyOn(console, "error");
		for (const text of texts) {
			await show(text);
			expect(screen.queryByTestId("md-plain")).toBeNull();
		}
		expect(error).not.toHaveBeenCalled();
	});
});
