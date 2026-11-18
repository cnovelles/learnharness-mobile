/**
 * The before and after chart of the session open timings (issue 21 slice A,
 * measurement rule 5 in docs/DECISIONS.md).
 *
 *   npm run perf:chart                         # all builds, the scenario session
 *   npm run perf:chart -- --title "<start>"    # the sessions whose title starts so
 *
 * It reads perf/results/*.json (npm run perf:collect writes them) and writes
 * perf/chart.html: one stacked bar of the median phases for each build, in
 * the order of the first open, with the p95 total, the longest frozen frame
 * and the islands. Only opens that reached the end count. The page has no
 * scripts and no outside files, so it can be published as an artifact page.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	PHASES,
	formatMs,
	parseOpens,
	phaseTimes,
	quantile,
	type OpenRecord,
	type PhaseId,
} from "../src/lib/perf-marks";

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "perf", "results");
const OUT = path.join(ROOT, "perf", "chart.html");

/** The start of the golden teach session title: the fixed scenario of e2e/perf-open.yaml. */
const SCENARIO = "test session, no probing";

const COLORS: Record<PhaseId, string> = {
	fetch: "var(--fetch)",
	parse: "var(--parse)",
	draw: "var(--draw)",
	reveal: "var(--reveal)",
	end: "var(--end)",
};

interface Row {
	name: string;
	first: string;
	n: number;
	phases: Record<PhaseId, number>;
	medianTotal: number;
	p95Total: number;
	frozen: number;
	islands: number;
}

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const esc = (s: string) =>
	s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

const median = (values: number[]) => quantile(values, 0.5) ?? 0;

function row(name: string, opens: OpenRecord[]): Row | null {
	const done = opens.filter((o) => o.outcome === "end" && o.marks.atEnd !== undefined);
	if (done.length === 0) return null;
	const phases = {} as Record<PhaseId, number>;
	for (const p of PHASES) phases[p.id] = median(done.map((o) => phaseTimes(o)[p.id] ?? 0));
	const totals = done.map((o) => o.marks.atEnd!);
	return {
		name,
		first: done.map((o) => o.at).sort()[0]!,
		n: done.length,
		phases,
		medianTotal: median(totals),
		p95Total: quantile(totals, 0.95) ?? 0,
		frozen: median(done.map((o) => o.longestFrameMs)),
		islands: median(done.map((o) => o.islands)),
	};
}

function main() {
	const title = arg("--title") ?? SCENARIO;
	const rows = readdirSync(DIR)
		.filter((f) => f.endsWith(".json"))
		.flatMap((f) => {
			const opens = parseOpens(readFileSync(path.join(DIR, f), "utf8")).filter((o) =>
				o.title.startsWith(title),
			);
			const r = row(f.replace(/\.json$/, ""), opens);
			return r ? [r] : [];
		})
		.sort((a, b) => a.first.localeCompare(b.first));
	if (rows.length === 0) throw new Error(`No complete opens of "${title}" in ${DIR}.`);

	const scale = Math.max(...rows.map((r) => r.p95Total));
	const bars = rows
		.map((r) => {
			const segments = PHASES.map(
				(p) =>
					`<span style="width:${((r.phases[p.id] / scale) * 100).toFixed(2)}%;background:${COLORS[p.id]}" title="${esc(p.label)} ${formatMs(r.phases[p.id])}"></span>`,
			).join("");
			const p95 = ((r.p95Total / scale) * 100).toFixed(2);
			return `<li><div class="name">${esc(r.name)}</div><div class="track"><div class="bar">${segments}</div><i class="p95" style="left:${p95}%" title="p95 ${formatMs(r.p95Total)}"></i></div><div class="num">${formatMs(r.medianTotal)}</div></li>`;
		})
		.join("\n");
	const legend = PHASES.map(
		(p) => `<span><b style="background:${COLORS[p.id]}"></b>${esc(p.label)}</span>`,
	).join("");
	const table = rows
		.map(
			(r) =>
				`<tr><td>${esc(r.name)}</td><td>${r.n}</td>${PHASES.map((p) => `<td>${formatMs(r.phases[p.id])}</td>`).join("")}<td>${formatMs(r.medianTotal)}</td><td>${formatMs(r.p95Total)}</td><td>${formatMs(r.frozen)}</td><td>${r.islands}</td></tr>`,
		)
		.join("\n");

	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session open timings</title>
<style>
:root{--bg:#faf9f5;--panel:#f0eee6;--text:#3d3d3a;--muted:#83827d;--line:#e0ddd2;--fetch:#83827d;--parse:#b8b6af;--draw:#d97757;--reveal:#eaa98f;--end:#d3d1c7}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#141414;--panel:#1c1c1c;--text:#e6e6e6;--muted:#8d8d8d;--line:#434343;--fetch:#8d8d8d;--parse:#5f5e5a;--draw:#d97757;--reveal:#993c1d;--end:#444441}}
:root[data-theme="dark"]{--bg:#141414;--panel:#1c1c1c;--text:#e6e6e6;--muted:#8d8d8d;--line:#434343;--fetch:#8d8d8d;--parse:#5f5e5a;--draw:#d97757;--reveal:#993c1d;--end:#444441}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;font-weight:600;margin:0 0 4px}
p{color:var(--muted);margin:0 0 16px}
ul{list-style:none;padding:0;margin:0 0 12px}
li{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr) 64px;gap:12px;align-items:center;margin:8px 0}
.name{font:12px ui-monospace,monospace;overflow-wrap:anywhere}
.track{position:relative;height:18px}
.bar{display:flex;height:18px;border-radius:4px;overflow:hidden}
.bar span{display:block;height:100%}
.p95{position:absolute;top:-3px;width:2px;height:24px;background:var(--text)}
.num{font:12px ui-monospace,monospace;text-align:right}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--muted);margin-bottom:20px}
.legend b{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.wrap{overflow-x:auto}
table{border-collapse:collapse;font:12px ui-monospace,monospace;width:100%}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{color:var(--muted);font-weight:400}
@media (max-width:600px){li{grid-template-columns:minmax(0,1fr) 56px}.name{grid-column:1/-1}}
</style></head>
<body><main>
<h1>Session open timings</h1>
<p>Session “${esc(title)}”. Median of each phase for each build; the line is the p95 of the total. Only opens that reached the end count.</p>
<div class="legend">${legend}<span><b style="background:var(--text);width:2px"></b>p95 total</span></div>
<ul>
${bars}
</ul>
<div class="wrap"><table>
<thead><tr><th>Build</th><th>Opens</th>${PHASES.map((p) => `<th>${esc(p.label)}</th>`).join("")}<th>Median</th><th>p95</th><th>Frozen</th><th>Islands</th></tr></thead>
<tbody>
${table}
</tbody></table></div>
</main></body></html>
`;
	writeFileSync(OUT, html);
	console.log(`${path.relative(ROOT, OUT)}: ${rows.length} builds`);
}

try {
	main();
} catch (e) {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
}
