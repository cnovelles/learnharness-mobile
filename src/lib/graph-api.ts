/**
 * The graph reads of the Teach tab (issue 20) and the Graph tab (issue 08):
 * the desktop folders (`GET /api/graph/sources`), the graph snapshot
 * (`GET /api/graph`), the pipeline costs (`GET /api/graph/costs`) and the
 * runs in progress (`GET /api/graph/status`). The gateway allows these reads
 * and one checked folder write (`changeFolders`, D-015). Each read checks the
 * body shape, so a bad body is an error and never a crash. A bad item in a
 * list is dropped; a bad body throws a SessionApiError with no status.
 */
import { failure, SessionApiError } from "./sessions";
import type {
	GraphChain,
	GraphCostSummary,
	GraphEdge,
	GraphNode,
	GraphSnapshot,
	OrganizationAction,
	ProvenancePoint,
	RecentRun,
	SourceDirectory,
	StageCost,
} from "./shared";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The desktop folders and the source placements. */
export async function readSourceDirectory(fetchImpl: typeof fetch): Promise<SourceDirectory> {
	const res = await fetchImpl("/api/graph/sources");
	if (!res.ok) throw await failure(res);
	return parseSourceDirectory(await res.json());
}

/**
 * One folder change (issue 20, slice D): `POST /api/graph/sources` with one
 * action. The Mac answers with the new folders, and with `createdFolderId`
 * after a new folder. A refusal throws a SessionApiError with the status
 * and the body (see `describeFolderError`).
 */
export async function changeFolders(
	fetchImpl: typeof fetch,
	action: OrganizationAction,
): Promise<{ directory: SourceDirectory; createdFolderId: string | null }> {
	const res = await fetchImpl("/api/graph/sources", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(action),
	});
	if (!res.ok) throw await failure(res);
	const body: unknown = await res.json();
	const created = isRecord(body) ? body.createdFolderId : undefined;
	return {
		directory: parseSourceDirectory(body),
		createdFolderId: typeof created === "string" && created ? created : null,
	};
}

function parseSourceDirectory(body: unknown): SourceDirectory {
	const organization = isRecord(body) ? body.organization : undefined;
	if (
		!isRecord(body) ||
		!isRecord(organization) ||
		!Array.isArray(organization.folders) ||
		!isRecord(organization.placements) ||
		!Array.isArray(body.sources)
	)
		throw new SessionApiError("The Mac sent folders that are not valid.");
	const folders = organization.folders.filter(
		(f): f is SourceDirectory["organization"]["folders"][number] =>
			isRecord(f) &&
			typeof f.id === "string" &&
			typeof f.name === "string" &&
			(f.parentId === null || typeof f.parentId === "string") &&
			typeof f.createdAt === "string",
	);
	const placements: SourceDirectory["organization"]["placements"] = {};
	for (const [id, p] of Object.entries(organization.placements))
		if (isRecord(p) && (p.folderId === null || typeof p.folderId === "string"))
			placements[id] = { folderId: p.folderId };
	return {
		organization: { version: 1, folders, placements },
		sources: (body.sources as unknown[]).filter(isSourceEntry),
	};
}

const SOURCE_KINDS = new Set(["chat", "notes", "missing"]);

/** A source row: the chain rows read its kind, label, date and session kind. */
function isSourceEntry(s: unknown): s is SourceDirectory["sources"][number] {
	return (
		isRecord(s) &&
		typeof s.id === "string" &&
		typeof s.kind === "string" &&
		SOURCE_KINDS.has(s.kind) &&
		(s.label === null || typeof s.label === "string") &&
		(s.createdAt === null || typeof s.createdAt === "string") &&
		(s.chatKind === undefined || typeof s.chatKind === "string") &&
		(s.filePath === undefined || typeof s.filePath === "string")
	);
}

/** The stored propositions of the graph (only the fields the phone reads are checked). */
export async function readPropositions(fetchImpl: typeof fetch): Promise<GraphNode[]> {
	const res = await fetchImpl("/api/graph");
	if (!res.ok) throw await failure(res);
	const body: unknown = await res.json();
	if (!isRecord(body) || !Array.isArray(body.propositions))
		throw new SessionApiError("The Mac sent a graph that is not valid.");
	return body.propositions.filter(
		(p): p is GraphNode => isRecord(p) && typeof p.id === "string" && Array.isArray(p.provenance),
	);
}

// ─── The graph snapshot (issue 08) ──────────────────────────────────────────

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : []);

function provenanceOf(v: unknown): ProvenancePoint[] {
	if (!Array.isArray(v)) return [];
	return v.filter(
		(p): p is ProvenancePoint => isRecord(p) && isString(p.chatId) && isString(p.messageId),
	);
}

function nodeOf(v: unknown): GraphNode | null {
	if (!isRecord(v) || !isString(v.id) || !isString(v.name) || !isString(v.statement)) return null;
	if (!isString(v.createdAt) || !Array.isArray(v.provenance)) return null;
	return {
		id: v.id,
		name: v.name,
		statement: v.statement,
		aliases: strings(v.aliases),
		createdAt: v.createdAt,
		provenance: provenanceOf(v.provenance),
	};
}

function edgeOf(v: unknown): GraphEdge | null {
	return isRecord(v) && isString(v.from) && isString(v.to) ? { from: v.from, to: v.to } : null;
}

function chainOf(v: unknown): GraphChain | null {
	if (!isRecord(v) || !isString(v.id) || !isString(v.conclusion) || !isString(v.createdAt))
		return null;
	const premises = strings(v.premises);
	if (premises.length === 0) return null;
	return {
		id: v.id,
		premises,
		conclusion: v.conclusion,
		provenance: provenanceOf(v.provenance),
		createdAt: v.createdAt,
	};
}

function listOf<T>(v: unknown, item: (v: unknown) => T | null): T[] {
	return (v as unknown[]).flatMap((x) => {
		const out = item(x);
		return out === null ? [] : [out];
	});
}

function stringMap(v: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, x] of Object.entries(v)) if (isString(x)) out[k] = x;
	return out;
}

/** Check a `GET /api/graph` body. Exported for the golden test. */
export function parseGraphSnapshot(body: unknown): GraphSnapshot {
	if (
		!isRecord(body) ||
		!Array.isArray(body.nodes) ||
		!Array.isArray(body.propositions) ||
		!Array.isArray(body.edges) ||
		!Array.isArray(body.chains) ||
		!Array.isArray(body.clusters) ||
		!isRecord(body.sessions) ||
		!isRecord(body.fileSources) ||
		!isRecord(body.nodeSessions) ||
		(body.positions !== undefined && !isRecord(body.positions))
	)
		throw new SessionApiError("The Mac sent a graph that is not valid.");
	const nodeSessions: Record<string, string[]> = {};
	for (const [id, chats] of Object.entries(body.nodeSessions)) {
		const list = strings(chats);
		if (list.length > 0) nodeSessions[id] = list;
	}
	const snapshot: GraphSnapshot = {
		nodes: listOf(body.nodes, nodeOf),
		propositions: listOf(body.propositions, nodeOf),
		edges: listOf(body.edges, edgeOf),
		logicalEdges: Array.isArray(body.logicalEdges) ? listOf(body.logicalEdges, edgeOf) : [],
		impLinks: Array.isArray(body.impLinks)
			? listOf(body.impLinks, (v) =>
					isRecord(v) && isString(v.id) && isString(v.conclusion)
						? { id: v.id, premises: strings(v.premises), conclusion: v.conclusion }
						: null,
				)
			: [],
		chains: listOf(body.chains, chainOf),
		sessions: stringMap(body.sessions),
		fileSources: stringMap(body.fileSources),
		nodeSessions,
		clusters: listOf(body.clusters, (v) =>
			isRecord(v) && isString(v.id) && (v.label === null || isString(v.label))
				? { id: v.id, label: v.label, members: strings(v.members) }
				: null,
		),
	};
	if (isRecord(body.positions)) {
		const positions: NonNullable<GraphSnapshot["positions"]> = {};
		for (const [id, p] of Object.entries(body.positions))
			if (isRecord(p) && isNumber(p.x) && isNumber(p.y)) positions[id] = { x: p.x, y: p.y };
		snapshot.positions = positions;
	}
	return snapshot;
}

/** The whole graph snapshot (the canvas, the node sheet and the chain rows). */
export async function readGraphSnapshot(fetchImpl: typeof fetch): Promise<GraphSnapshot> {
	const res = await fetchImpl("/api/graph");
	if (!res.ok) throw await failure(res);
	return parseGraphSnapshot(await res.json());
}

// ─── The pipeline costs and the runs in progress (issue 08) ─────────────────

type Tokens = StageCost["tokens"];

function tokensOf(v: unknown): Tokens {
	const t = isRecord(v) ? v : {};
	const n = (x: unknown) => (isNumber(x) ? x : undefined);
	return {
		inputTokens: n(t.inputTokens),
		outputTokens: n(t.outputTokens),
		cacheReadTokens: n(t.cacheReadTokens),
		cacheWriteTokens: n(t.cacheWriteTokens),
		reasoningTokens: n(t.reasoningTokens),
	};
}

/** The plan fields (subscription runs) are optional on every cost level. */
function planOf(
	v: Record<string, unknown>,
): Pick<StageCost, "subscriptionRuns" | "subscriptionProviders"> {
	return {
		...(isNumber(v.subscriptionRuns) ? { subscriptionRuns: v.subscriptionRuns } : {}),
		...(Array.isArray(v.subscriptionProviders)
			? { subscriptionProviders: strings(v.subscriptionProviders) }
			: {}),
	};
}

function stageOf(v: unknown): StageCost | null {
	if (!isRecord(v) || !isNumber(v.dollars) || !isNumber(v.unpricedRuns) || !isNumber(v.runs))
		return null;
	return {
		...planOf(v),
		dollars: v.dollars,
		unpricedRuns: v.unpricedRuns,
		runs: v.runs,
		tokens: tokensOf(v.tokens),
	};
}

function runOf(v: unknown): RecentRun | null {
	if (!isRecord(v) || !isNumber(v.startedAt) || !isString(v.at) || !isString(v.title)) return null;
	if (v.dollars !== null && !isNumber(v.dollars)) return null;
	const merged = isRecord(v.merged) && isNumber(v.merged.nodes) ? v.merged : undefined;
	return {
		...planOf(v),
		startedAt: v.startedAt,
		at: v.at,
		durationMs: isNumber(v.durationMs) ? v.durationMs : 0,
		kind: "extraction",
		title: v.title,
		dollars: v.dollars,
		tokens: tokensOf(v.tokens),
		...(merged
			? {
					merged: {
						nodes: merged.nodes as number,
						...(isNumber(merged.chains) ? { chains: merged.chains } : {}),
					},
				}
			: {}),
	};
}

/** Check a `GET /api/graph/costs` body. Exported for the golden test. */
export function parseGraphCosts(body: unknown): GraphCostSummary {
	const stages = isRecord(body) ? body.stages : undefined;
	const extraction = isRecord(stages) ? stageOf(stages.extraction) : null;
	const audit = isRecord(stages) ? stageOf(stages.audit) : null;
	if (!isRecord(body) || !extraction || !audit || !Array.isArray(body.runs))
		throw new SessionApiError("The Mac sent graph costs that are not valid.");
	return {
		...planOf(body),
		totalDollars: isNumber(body.totalDollars) ? body.totalDollars : 0,
		unpricedRuns: isNumber(body.unpricedRuns) ? body.unpricedRuns : 0,
		stages: { extraction, audit },
		runs: listOf(body.runs, runOf),
	};
}

/** The graph pipeline costs (the cost number and the cost sheet). */
export async function readGraphCosts(fetchImpl: typeof fetch): Promise<GraphCostSummary> {
	const res = await fetchImpl("/api/graph/costs");
	if (!res.ok) throw await failure(res);
	return parseGraphCosts(await res.json());
}

/** One pipeline run in progress (one row for each chunk of a notes import). */
export interface PipelineRun {
	/** The row id: the source id, or "src#i" for a chunk. */
	id: string;
	chatId: string;
	title: string;
	/** queued, extracting, waiting, auditing or merging. */
	phase: string;
	/** Epoch milliseconds. */
	startedAt: number;
}

/** Check a `GET /api/graph/status` body. */
export function parseGraphStatus(body: unknown): PipelineRun[] {
	if (!isRecord(body) || !Array.isArray(body.runs))
		throw new SessionApiError("The Mac sent a pipeline status that is not valid.");
	return listOf(body.runs, (v) =>
		isRecord(v) &&
		isString(v.id) &&
		isString(v.chatId) &&
		isString(v.title) &&
		isString(v.phase) &&
		isNumber(v.startedAt)
			? { id: v.id, chatId: v.chatId, title: v.title, phase: v.phase, startedAt: v.startedAt }
			: null,
	);
}

/** The pipeline runs in progress (the run pills). */
export async function readGraphStatus(fetchImpl: typeof fetch): Promise<PipelineRun[]> {
	const res = await fetchImpl("/api/graph/status");
	if (!res.ok) throw await failure(res);
	return parseGraphStatus(await res.json());
}
