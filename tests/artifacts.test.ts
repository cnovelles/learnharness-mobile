/**
 * Issue 19: the artifact model (src/lib/artifacts.ts). Error states 1, 2,
 * 3, 4, 9, 10, 11 and 12 of docs/ISSUES.md issue 19.
 */
import {
	MAX_DEMO_CHARS,
	MAX_SVG_CHARS,
	artifactOf,
	blockedSources,
	demoErrorText,
	parseDemoMessage,
	parseImageSnapshot,
	svgAspect,
	svgNaturalWidth,
} from "@/lib/artifacts";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 170"><circle r="4"/></svg>';
const DEMO = { title: "Moon distance", html: "<p>demo</p>", tested: true };
const part = (data: unknown) => ({ type: "data-subagent-artifact", id: "sa_m1", data });

describe("artifactOf", () => {
	it("reads a figure and its invert switch", () => {
		expect(
			artifactOf(part({ kind: "visual", result: { svg: SVG }, ui: { inverted: true } })),
		).toEqual({
			kind: "figure",
			svg: SVG,
			inverted: true,
			snapshotId: null,
		});
		expect(artifactOf(part({ kind: "visual", result: { svg: SVG } }))).toMatchObject({
			inverted: false,
		});
	});

	it("reads a photo figure: no switch, and the snapshot id", () => {
		const id = "ab12".repeat(16);
		expect(
			artifactOf(
				part({
					kind: "visual",
					result: { svg: SVG, image: { path: "/x.png", snapshotId: id } },
					ui: { inverted: true },
				}),
			),
		).toEqual({ kind: "figure", svg: SVG, inverted: false, snapshotId: id });
	});

	it("reads a demo", () => {
		expect(artifactOf(part({ kind: "demo", result: DEMO, ui: { inverted: true } }))).toEqual({
			kind: "demo",
			title: "Moon distance",
			html: "<p>demo</p>",
			inverted: true,
		});
	});

	it("error state 1: a bad shape is unreadable", () => {
		for (const result of [undefined, null, "x", { svg: 3 }, {}])
			expect(artifactOf(part({ kind: "visual", result }))).toEqual({
				kind: "unreadable",
				what: "figure",
			});
		for (const result of [{ html: "<p/>" }, { title: "T" }, { title: 3, html: "x" }, null])
			expect(artifactOf(part({ kind: "demo", result }))).toEqual({
				kind: "unreadable",
				what: "demo",
			});
		// A photo figure with a bad snapshot id cannot load its photo.
		expect(
			artifactOf(part({ kind: "visual", result: { svg: SVG, image: { snapshotId: "../keys" } } })),
		).toEqual({ kind: "unreadable", what: "figure" });
	});

	it("error state 2: an empty result is a failed artifact, and the notes are dropped", () => {
		expect(
			artifactOf(part({ kind: "visual", result: { svg: "", notes: "raw model text" } })),
		).toEqual({
			kind: "failed",
			what: "figure",
		});
		expect(
			artifactOf(part({ kind: "demo", result: { title: "T", html: "", notes: "raw" } })),
		).toEqual({ kind: "failed", what: "demo" });
	});

	it("error state 3: too large at one character over the limit", () => {
		const big = (n: number) => `<svg>${"x".repeat(n - 11)}</svg>`;
		expect(big(MAX_SVG_CHARS)).toHaveLength(MAX_SVG_CHARS);
		expect(artifactOf(part({ kind: "visual", result: { svg: big(MAX_SVG_CHARS) } })).kind).toBe(
			"figure",
		);
		expect(artifactOf(part({ kind: "visual", result: { svg: big(MAX_SVG_CHARS + 1) } }))).toEqual({
			kind: "too-large",
			what: "figure",
		});
		const html = (n: number) => "x".repeat(n);
		expect(
			artifactOf(part({ kind: "demo", result: { title: "T", html: html(MAX_DEMO_CHARS) } })).kind,
		).toBe("demo");
		expect(
			artifactOf(part({ kind: "demo", result: { title: "T", html: html(MAX_DEMO_CHARS + 1) } })),
		).toEqual({
			kind: "too-large",
			what: "demo",
		});
	});

	it("error state 9: a demo that loads from a blocked host", () => {
		const html = '<script src="https://evil.example/x.js"></script>';
		expect(artifactOf(part({ kind: "demo", result: { title: "T", html } }))).toEqual({
			kind: "blocked-source",
		});
		const ok = '<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>';
		expect(artifactOf(part({ kind: "demo", result: { title: "T", html: ok } })).kind).toBe("demo");
	});

	it("error state 11: another kind is a Mac-only result", () => {
		for (const kind of ["research", "pdf", "plugin", "future"])
			expect(artifactOf(part({ kind, result: {} }))).toEqual({ kind: "mac-only" });
		expect(artifactOf(part(null))).toEqual({ kind: "mac-only" });
	});
});

describe("blockedSources (error state 9)", () => {
	it("allows the 3 CDN hosts over https", () => {
		expect(
			blockedSources(`
			<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
			<script src='https://unpkg.com/three@0.160.0/build/three.module.js' type=module></script>
			<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/katex/0.16.9/katex.min.css">
			<script type="module">import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";</script>
			`),
		).toEqual([]);
	});

	it("finds scripts, module imports, style sheets and @import on other hosts", () => {
		expect(blockedSources('<script src="https://evil.example/a.js"></script>')).toEqual([
			"evil.example",
		]);
		expect(blockedSources("<script src=//evil.example/a.js></script>")).toEqual(["evil.example"]);
		expect(blockedSources('<script src="http://cdn.jsdelivr.net/a.js"></script>')).toEqual([
			"cdn.jsdelivr.net",
		]);
		expect(
			blockedSources('<script type=module>import x from "https://esm.sh/x";</script>'),
		).toEqual(["esm.sh"]);
		expect(blockedSources('<script>import("https://esm.sh/y")</script>')).toEqual(["esm.sh"]);
		expect(blockedSources('<link rel=stylesheet href="https://fonts.googleapis.com/css">')).toEqual(
			["fonts.googleapis.com"],
		);
		expect(
			blockedSources('<style>@import url("https://fonts.googleapis.com/css");</style>'),
		).toEqual(["fonts.googleapis.com"]);
		expect(
			blockedSources('<script src="https://cdn.jsdelivr.net.evil.example/a.js"></script>'),
		).toEqual(["cdn.jsdelivr.net.evil.example"]);
	});

	it("does not flag a URL in text, a link or a local script", () => {
		expect(
			blockedSources(`
			<p>See https://example.com for more.</p>
			<a href="https://example.com">site</a>
			<script>const url = "https://example.com"; draw();</script>
			<script src="data:text/javascript,1"></script>
			`),
		).toEqual([]);
	});
});

describe("demo page messages (error states 4 and 12)", () => {
	it("reads a page error", () => {
		expect(
			parseDemoMessage(JSON.stringify({ type: "page-error", text: "x is not defined" })),
		).toEqual({
			type: "page-error",
			text: "x is not defined",
		});
	});

	it("ignores bad shapes, extra keys and long text", () => {
		for (const raw of [
			"not json",
			JSON.stringify({ type: "page-error" }),
			JSON.stringify({ type: "page-error", text: 3 }),
			JSON.stringify({ type: "page-error", text: "x", extra: 1 }),
			JSON.stringify({ type: "height", height: 5 }),
			JSON.stringify({ type: "page-error", text: "x".repeat(2001) }),
			42,
		])
			expect(parseDemoMessage(raw)).toBeNull();
	});

	it("builds the text for the teacher: a fixed sentence, cleaned and cut", () => {
		expect(demoErrorText("Moon", "x is not defined")).toBe(
			'The demo "Moon" threw an error: x is not defined',
		);
		const text = demoErrorText("Mo\u0000on\n", `a\u0007b\u2028c${"z".repeat(900)}`);
		expect(text.startsWith('The demo "Mo on" threw an error: a b c')).toBe(true);
		expect(text).not.toMatch(/[\u0000-\u001f\u2028]/);
		expect(text.length).toBeLessThanOrEqual('The demo "Mo on" threw an error: '.length + 500);
	});
});

describe("parseImageSnapshot (error state 10)", () => {
	const good = { mimeType: "image/png", data: "iVBORw0KGgo=", width: 4, height: 3 };
	it("accepts a PNG or a JPEG", () => {
		expect(parseImageSnapshot(good)).toEqual(good);
		expect(parseImageSnapshot({ ...good, mimeType: "image/jpeg", extra: 1 })).toEqual({
			...good,
			mimeType: "image/jpeg",
		});
	});
	it("refuses anything else", () => {
		for (const bad of [
			null,
			"x",
			{ ...good, mimeType: "image/svg+xml" },
			{ ...good, data: 3 },
			{ ...good, data: 'x" onload="y' },
			{ ...good, width: 0 },
			{ ...good, height: 2.5 },
			{ ...good, width: "4" },
		])
			expect(parseImageSnapshot(bad)).toBeNull();
	});
});

describe("svg size", () => {
	it("reads the aspect from the viewBox, then from width and height", () => {
		expect(svgAspect(SVG)).toBeCloseTo(170 / 320);
		expect(svgAspect('<svg width="200" height="100"></svg>')).toBe(0.5);
		expect(svgAspect('<svg width="200px" height="50px"></svg>')).toBe(0.25);
		expect(svgAspect("<svg></svg>")).toBeNull();
		expect(svgAspect('<svg viewBox="0 0 0 10"></svg>')).toBeNull();
	});
	it("reads the declared width in px, as the desktop", () => {
		expect(svgNaturalWidth('<svg width="240" height="100">')).toBe(240);
		expect(svgNaturalWidth('<svg width="100%">')).toBeNull();
		expect(svgNaturalWidth(SVG)).toBeNull();
	});
});

describe("transcriptRows with a steer artifact", () => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { transcriptRows } = require("@/lib/transcript") as typeof import("@/lib/transcript");
	const steer = (data: unknown) =>
		({
			id: "m9",
			role: "user",
			metadata: { subagentResult: { kind: "demo" } },
			parts: [
				{ type: "text", text: "[Sub-agent result] the text for the teacher model" },
				{ type: "data-subagent-artifact", id: "sa_m9", data },
			],
		}) as never;

	it("gives one artifact row and no learner bubble", () => {
		const rows = transcriptRows([steer({ kind: "demo", result: DEMO })]);
		expect(rows).toEqual([
			{
				kind: "artifact",
				id: "sa_m9",
				messageId: "m9",
				artifact: { kind: "demo", title: "Moon distance", html: "<p>demo</p>", inverted: false },
			},
		]);
	});

	it("error state 11: another steer kind gives a Mac-only row, not the steer text", () => {
		const rows = transcriptRows([steer({ kind: "research", result: { brief: "x" } })]);
		expect(rows).toEqual([
			{ kind: "artifact", id: "sa_m9", messageId: "m9", artifact: { kind: "mac-only" } },
		]);
	});

	it("keeps a normal learner message", () => {
		const rows = transcriptRows([
			{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] } as never,
		]);
		expect(rows).toEqual([{ kind: "user", id: "u1-0", text: "hi" }]);
	});
});
