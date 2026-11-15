/**
 * Issue 05 slice A: the teacher's Markdown as native views, and its error
 * states (docs/ISSUES.md, issue 05).
 */
import fs from "node:fs";
import path from "node:path";
import { render, screen, fireEvent } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { Alert, Linking, StyleSheet } from "react-native";

import { Markdown } from "@/components/markdown";
import { Transcript } from "@/components/transcript";
import * as highlight from "@/lib/code-highlight";
import * as md from "@/lib/markdown";

const BASE = { fontSize: 16, lineHeight: 23, color: "#111" };
const show = (text: string) => render(<Markdown text={text} style={BASE} testID="md" />);

afterEach(() => {
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

	it("shows math as its TeX source until slice C, with no dollar signs", async () => {
		await show("Area $A = \\pi r^2$ here.\n\n$$\n\\sum_k k\n$$");
		expect(screen.getByTestId("md-inline-math")).toHaveTextContent("A = \\pi r^2");
		expect(screen.getByTestId("md-math")).toHaveTextContent("\\sum_k k");
	});

	it("reads the old \\( \\) math delimiters, as the desktop does", async () => {
		await show("Area \\(x^2\\) here.");
		expect(screen.getByTestId("md-inline-math")).toHaveTextContent("x^2");
	});

	it("draws a table with a header row, inside a sideways scroll", async () => {
		await show("| Name | Value |\n| --- | ---: |\n| a | 1 |\n| b | 2 |");
		expect(screen.getByTestId("md-table")).toBeTruthy();
		expect(screen.getByText("Name")).toBeTruthy();
		expect(screen.getByText("2")).toBeTruthy();
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
