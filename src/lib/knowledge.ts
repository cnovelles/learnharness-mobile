/**
 * The Graph tab data (issue 08, slice B). It loads the Mac's knowledge and
 * makes the models that the Graph tab screens draw. The models are pure code
 * on top of the desktop code from the fork (`src/core/chain-rows.ts`,
 * `src/core/folder-order.ts`, `src/core/graph-view-model.ts`), so the phone
 * shows the same groups, order, labels, positions and search as the desktop.
 *
 * The rules (user decisions 2026-11-19, docs/ISSUES.md issue 08, D-016):
 * - The phone is read only. It draws the positions that the Mac saves
 *   (`snapshot.positions`) and computes no layout. A node with no saved
 *   position gets the desktop seed (`seedMissingNodePositions`).
 * - The graph is required. The folders, the costs and the runs are not: if
 *   one of them fails, the model shows the rest (error states 6 and 11).
 * - Search on the canvas is the desktop match on name and statement
 *   (`isNodeVisible`). The chain rows use the desktop fuzzy search.
 * - A session row in the node sheet opens the session at the node's message
 *   (the desktop `propositionSessionHref`).
 */
import {
	readGraphCosts,
	readGraphSnapshot,
	readGraphStatus,
	readSourceDirectory,
	type PipelineRun,
} from "./graph-api";
import {
	DEFAULT_CHAIN_SORT,
	UNLABELED_SOURCE,
	buildChainRows,
	clusterHue,
	folderTree,
	formatChainLine,
	isImpNodeId,
	isSourceOpen,
	isNodeVisible,
	messageIdFromHash,
	propositionSessionHref,
	seedMissingNodePositions,
	sourceDisplayName,
	type ChainSort,
	type ChainSortCol,
	type ChainSourceGroup,
	type FolderTree,
	type FolderLevelItem,
	type GraphCostSummary,
	type GraphNode,
	type GraphSnapshot,
	type ReasoningChain,
	type SourceDirectory,
	type SourceOrganization,
} from "./shared";
import { describeError, userMessage, type UserMessage } from "./user-error";

// ─── Texts (docs/ISSUES.md issue 08, error states) ──────────────────────────

/** State 2: an older fork build refuses the graph routes (403). */
export const KNOWLEDGE_OLD_MAC = userMessage(
	"Update LearnHarness on your Mac to see your knowledge.",
);
/** State 3: the Mac sent a body that is not valid, or another server failure. */
export const KNOWLEDGE_NOT_LOADED = userMessage(
	"Your knowledge could not be loaded. Pull to try again.",
);
/** State 4: the graph is empty (the desktop text). */
export const KNOWLEDGE_EMPTY_TITLE = userMessage("Knowledge graph");
export const KNOWLEDGE_EMPTY = userMessage("Start a session to begin learning.");
/** State 5: the chain search finds nothing (the desktop text). */
export const NO_MATCHING_CHAINS = userMessage("No matching chains.");
/** State 13: the canvas search finds nothing (the desktop text). */
export const NO_MATCHING_NODES = userMessage("No matching nodes.");
/** State 14: a node has no session. */
export const NO_SESSIONS_RECORDED = userMessage("No sessions recorded.");

/**
 * The message for a failed graph read. The network and pairing errors keep
 * their usual text (state 1 is the connection banner). Never raw server text.
 */
export function describeKnowledgeError(error: unknown): UserMessage {
	if (error instanceof TypeError) return describeError(error);
	const status =
		typeof error === "object" && error !== null ? (error as { status?: unknown }).status : null;
	if (status === 403) return KNOWLEDGE_OLD_MAC;
	if (status === 401) return describeError(error);
	return KNOWLEDGE_NOT_LOADED;
}

// ─── Load ───────────────────────────────────────────────────────────────────

/** What the Graph tab shows. Only the snapshot is required. */
export interface Knowledge {
	snapshot: GraphSnapshot;
	/** The desktop folders; null when the sources call fails (state 6). */
	directory: SourceDirectory | null;
	/** The pipeline costs; null when the costs call fails (state 11). */
	costs: GraphCostSummary | null;
	/** The runs in progress; null when the status call fails (state 11). */
	runs: PipelineRun[] | null;
}

/**
 * Load the Graph tab data with four reads at the same time. A failed graph
 * read throws (see `describeKnowledgeError`); the other reads give null.
 */
export async function loadKnowledge(fetchImpl: typeof fetch): Promise<Knowledge> {
	const [snapshot, directory, costs, runs] = await Promise.allSettled([
		readGraphSnapshot(fetchImpl),
		readSourceDirectory(fetchImpl),
		readGraphCosts(fetchImpl),
		readGraphStatus(fetchImpl),
	]);
	if (snapshot.status === "rejected") throw snapshot.reason;
	const value = <T>(r: PromiseSettledResult<T>): T | null =>
		r.status === "fulfilled" ? r.value : null;
	return {
		snapshot: snapshot.value,
		directory: value(directory),
		costs: value(costs),
		runs: value(runs),
	};
}

/** True when the graph has no proposition (state 4). */
export function isEmptyKnowledge(snapshot: Pick<GraphSnapshot, "propositions">): boolean {
	return snapshot.propositions.length === 0;
}

// ─── The canvas model ───────────────────────────────────────────────────────

export interface CanvasNodeModel {
	id: string;
	x: number;
	y: number;
	/** The node name (the desktop canvas label). */
	label: string;
	/** An implication node (`arg_` id): pure geometry, no disc, no label, no tap. */
	implication: boolean;
}

export interface CanvasEdgeModel {
	from: string;
	to: string;
	/** False for a line into an implication node (the desktop headless shaft). */
	head: boolean;
}

export interface CanvasRegionModel {
	id: string;
	/** The session title or file name; null for an unlabeled region. */
	label: string | null;
	/** The desktop `clusterHue` of the region id. */
	hue: number;
	members: string[];
}

export interface CanvasModel {
	nodes: CanvasNodeModel[];
	edges: CanvasEdgeModel[];
	regions: CanvasRegionModel[];
	/** The box of all node positions; null for an empty graph. */
	bounds: { minX: number; maxX: number; minY: number; maxY: number } | null;
}

/**
 * The world positions of all nodes: the Mac's saved positions, then the
 * desktop seed for the nodes with no saved position (state 12). With no
 * saved position at all (a graph that never ran the pipeline, state 17), the
 * first node goes to the origin and the seed puts the other nodes on a ring
 * around it. The phone never runs a layout (D-016).
 */
export function canvasPositions(
	snapshot: Pick<GraphSnapshot, "nodes" | "positions">,
): Map<string, { x: number; y: number }> {
	const positions = new Map<string, { x: number; y: number }>();
	const ledger = snapshot.positions ?? {};
	for (const node of snapshot.nodes) {
		const p = ledger[node.id];
		if (p) positions.set(node.id, { x: p.x, y: p.y });
	}
	const first = snapshot.nodes[0];
	if (positions.size === 0 && first) positions.set(first.id, { x: 0, y: 0 });
	return seedMissingNodePositions(snapshot.nodes, positions);
}

/** The canvas data: the desktop `setData` input, with the head rule of the desktop draw. */
export function canvasModel(snapshot: GraphSnapshot): CanvasModel {
	const positions = canvasPositions(snapshot);
	const nodes = snapshot.nodes.map((n) => {
		const p = positions.get(n.id) ?? { x: 0, y: 0 };
		return { id: n.id, x: p.x, y: p.y, label: n.name, implication: isImpNodeId(n.id) };
	});
	const known = new Set(nodes.map((n) => n.id));
	const edges = snapshot.edges
		.filter((e) => known.has(e.from) && known.has(e.to))
		.map((e) => ({ from: e.from, to: e.to, head: !isImpNodeId(e.to) }));
	const regions = snapshot.clusters.map((c) => ({
		id: c.id,
		label: c.label || null,
		hue: clusterHue(c.id),
		members: c.members.filter((id) => known.has(id)),
	}));
	let bounds: CanvasModel["bounds"] = null;
	for (const n of nodes) {
		if (!bounds) bounds = { minX: n.x, maxX: n.x, minY: n.y, maxY: n.y };
		else {
			bounds.minX = Math.min(bounds.minX, n.x);
			bounds.maxX = Math.max(bounds.maxX, n.x);
			bounds.minY = Math.min(bounds.minY, n.y);
			bounds.maxY = Math.max(bounds.maxY, n.y);
		}
	}
	return { nodes, edges, regions, bounds };
}

// ─── Canvas search ──────────────────────────────────────────────────────────

export interface CanvasSearch {
	/** The ids that stay visible (all nodes, also implication nodes, as the desktop). */
	visibleIds: Set<string>;
	/** "12 of 278 nodes" (propositions only); null with no query. */
	countText: string | null;
	/** "No matching nodes." when no proposition matches (state 13). */
	empty: UserMessage | null;
}

/** The desktop search filter on the canvas (`isNodeVisible` on name and statement). */
export function canvasSearch(snapshot: Pick<GraphSnapshot, "nodes">, query: string): CanvasSearch {
	const visibleIds = new Set(
		snapshot.nodes.filter((n) => isNodeVisible(n, query)).map((n) => n.id),
	);
	if (!query.trim()) return { visibleIds, countText: null, empty: null };
	const propositions = snapshot.nodes.filter((n) => !isImpNodeId(n.id));
	const shown = propositions.filter((n) => visibleIds.has(n.id)).length;
	return {
		visibleIds,
		countText: `${shown} of ${propositions.length} ${propositions.length === 1 ? "node" : "nodes"}`,
		empty: shown === 0 ? NO_MATCHING_NODES : null,
	};
}

// ─── The node sheet ─────────────────────────────────────────────────────────

export type NodeSourceRow =
	/** A session: a tap opens it at `messageId` (null: at its normal position, state 15). */
	| { kind: "session"; chatId: string; title: string; messageId: string | null }
	/** An imported notes file: plain text, opens nothing. */
	| { kind: "file"; sourceId: string; path: string }
	/** A session that is gone on the Mac: "unlabeled", opens nothing (state 16). */
	| { kind: "missing"; sourceId: string; label: string };

export interface NodeSheet {
	id: string;
	name: string;
	statement: string;
	rows: NodeSourceRow[];
	/** "No sessions recorded." when the node has no source (state 14). */
	empty: UserMessage | null;
}

/** The message of a node in a session, from the desktop link (`propositionSessionHref`). */
export function nodeMessageId(
	node: Parameters<typeof propositionSessionHref>[0],
	chatId: string,
): string | null {
	const href = propositionSessionHref(node, chatId);
	const hash = href.indexOf("#");
	return hash < 0 ? null : messageIdFromHash(href.slice(hash));
}

/** The node sheet of a proposition; null for an unknown id or an implication node. */
export function nodeSheet(snapshot: GraphSnapshot, nodeId: string): NodeSheet | null {
	if (isImpNodeId(nodeId)) return null;
	const node = snapshot.nodes.find((n) => n.id === nodeId);
	if (!node) return null;
	const rows = (snapshot.nodeSessions[nodeId] ?? []).map((sourceId): NodeSourceRow => {
		const path = snapshot.fileSources[sourceId];
		if (path !== undefined) return { kind: "file", sourceId, path };
		const title = snapshot.sessions[sourceId];
		if (title !== undefined)
			return { kind: "session", chatId: sourceId, title, messageId: nodeMessageId(node, sourceId) };
		return { kind: "missing", sourceId, label: UNLABELED_SOURCE };
	});
	return {
		id: node.id,
		name: node.name,
		statement: node.statement,
		rows,
		empty: rows.length === 0 ? NO_SESSIONS_RECORDED : null,
	};
}

// ─── The chain list ─────────────────────────────────────────────────────────

export interface ChainSourceRow {
	group: ChainSourceGroup;
	/** The label, or "unlabeled" (state 7). */
	name: string;
	/** True for an unlabeled source (the desktop muted row). */
	unlabeled: boolean;
	/** The second line: "41 props · 2026-11-10". */
	detail: string;
}

export interface ChainList {
	/** "173 chains · 278 nodes" (the desktop header). */
	header: string;
	searching: boolean;
	/** The source rows, in the desktop order. */
	sources: ChainSourceRow[];
	/** The desktop folder order over the source rows (no folders when the sources call failed). */
	folders: FolderTree<ChainSourceGroup>;
	/** "No matching chains." (state 5). */
	empty: UserMessage | null;
	/** Every chain of the graph (the opened source lists its chains from the group). */
	chains: ReasoningChain[];
}

const NO_ORGANIZATION: SourceOrganization = { version: 1, folders: [], placements: {} };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The second line of a source row: the node count and the newest date. */
export function sourceRowDetail(
	group: Pick<ChainSourceGroup, "nodeIds" | "newestCreatedAt">,
): string {
	return countDetail(group.nodeIds.length, group.newestCreatedAt);
}

/** "41 props · 2026-11-10": the node count and the day of a date. */
function countDetail(count: number, createdAt: string): string {
	const props = plural(count, "prop", "props");
	const date = createdAt.slice(0, 10);
	return date ? `${props} · ${date}` : props;
}

/**
 * The Chains screen model: the desktop chain rows (`buildChainRows`) and the
 * desktop folder order (`folderTree`). With no folders (state 6), the groups
 * use the session titles and the file names, as the desktop.
 */
export function chainList(
	knowledge: Pick<Knowledge, "snapshot" | "directory">,
	query: string,
	sort: ChainSort = DEFAULT_CHAIN_SORT,
): ChainList {
	const { snapshot, directory } = knowledge;
	const rows = buildChainRows({
		nodes: snapshot.propositions,
		chains: snapshot.chains,
		sessions: snapshot.sessions,
		fileSources: snapshot.fileSources,
		directory: directory ?? undefined,
		query,
		sort,
	});
	const organization = rows.directory?.organization ?? NO_ORGANIZATION;
	const folders = folderTree({
		groups: rows.groups,
		organization,
		query,
		sort,
		allSourceNodes: rows.sourceNodes,
	});
	const nodes = snapshot.propositions.length;
	return {
		header: `${plural(rows.chains.length, "chain", "chains")} · ${plural(nodes, "node", "nodes")}`,
		searching: rows.searching,
		sources: rows.groups.map((group) => ({
			group,
			name: sourceDisplayName(group.label),
			unlabeled: group.label === null,
			detail: sourceRowDetail(group),
		})),
		folders,
		// The desktop rule: no source and no folder.
		empty:
			rows.groups.length === 0 && organization.folders.length === 0 ? NO_MATCHING_CHAINS : null,
		chains: rows.chains,
	};
}

// ─── The Chains screen (slice D, user choice 3C) ────────────────────────────

/** The names of the sort columns, as the desktop column heads. */
export const CHAIN_SORT_NAMES: Record<ChainSortCol, string> = {
	name: "Name",
	props: "Props",
	created: "Created",
};

/** The sort button text: the column and the order ("Name ↑"). */
export function chainSortLabel(sort: ChainSort): string {
	return `${CHAIN_SORT_NAMES[sort.col]} ${sort.dir === 1 ? "↑" : "↓"}`;
}

/** One entry of a section: a source row, or a folder with its own entries. */
export type ChainEntry =
	| { kind: "source"; key: string; row: ChainSourceRow }
	| { kind: "folder"; key: string; name: string; detail: string; entries: ChainEntry[] };

/** One inset grouped card: a top folder, or the sources that are in no folder. */
export interface ChainSection {
	key: string;
	/** The folder name, "Unfiled", or null when there are no folders. */
	label: string | null;
	entries: ChainEntry[];
}

/** The label of the sources that are in no folder (when folders exist). */
export const UNFILED_SECTION = "Unfiled";

/**
 * The sections of the Chains screen. Each top folder is one section, in the
 * desktop order. A folder in a folder is a row that opens in place. The
 * sources that are in no folder go last, in the "Unfiled" section. With no
 * folders (also state 6), one section with no label holds all sources.
 */
export function chainSections(list: Pick<ChainList, "sources" | "folders">): ChainSection[] {
	const rows = new Map(list.sources.map((row) => [row.group.key, row]));
	const entry = (item: FolderLevelItem<ChainSourceGroup>): ChainEntry =>
		item.kind === "source"
			? { kind: "source", key: item.id, row: rows.get(item.id)! }
			: {
					kind: "folder",
					key: item.id,
					name: item.name,
					detail: countDetail(item.count, item.date),
					entries: list.folders.level(item.id).map(entry),
				};
	const top = list.folders.level(null);
	const folders = top.filter((item) => item.kind === "folder");
	const loose = top.filter((item) => item.kind === "source").map(entry);
	if (folders.length === 0)
		return loose.length ? [{ key: "\0all", label: null, entries: loose }] : [];
	const sections: ChainSection[] = folders.map((item) => ({
		key: item.id,
		label: item.name,
		entries: list.folders.level(item.id).map(entry),
	}));
	if (loose.length) sections.push({ key: "\0unfiled", label: UNFILED_SECTION, entries: loose });
	return sections;
}

/**
 * Which sources and folders are open. Without a search, only the entries
 * that the user opened are open. During a search, all are open except the
 * ones that the user closed during this search (the desktop rule).
 */
export interface ChainOpenState {
	expanded: ReadonlySet<string>;
	/** The entries closed during the search `query`. */
	folded: { query: string; keys: ReadonlySet<string> };
}

export const CLOSED_CHAINS: ChainOpenState = {
	expanded: new Set(),
	folded: { query: "", keys: new Set() },
};

const foldedFor = (state: ChainOpenState, query: string): ReadonlySet<string> =>
	state.folded.query === query ? state.folded.keys : new Set();

export function isChainEntryOpen(state: ChainOpenState, key: string, query: string): boolean {
	return isSourceOpen(key, {
		searching: query.trim() !== "",
		expanded: state.expanded,
		foldedForSearch: foldedFor(state, query),
	});
}

/** A tap on a source or a folder row: open it, or close it. */
export function toggleChainEntry(
	state: ChainOpenState,
	key: string,
	query: string,
): ChainOpenState {
	const flip = (set: ReadonlySet<string>) => {
		const next = new Set(set);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		return next;
	};
	if (query.trim() === "") return { ...state, expanded: flip(state.expanded) };
	return { ...state, folded: { query, keys: flip(foldedFor(state, query)) } };
}

/** One member of a chain line: a proposition chip. */
export interface ChainMember {
	id: string;
	name: string;
}

/** A chain line: the premises, then the conclusion (`A ∧ B ⟹ C`). */
export interface ChainLine {
	id: string;
	/** The premises, then the conclusion (the desktop chip order). */
	members: ChainMember[];
	/** The plain text for VoiceOver (the desktop `aria-label`). */
	text: string;
}

const nodeIndex = (snapshot: Pick<GraphSnapshot, "propositions">) =>
	new Map(snapshot.propositions.map((n) => [n.id, n]));

function lineOf(chain: ReasoningChain, byId: ReadonlyMap<string, GraphNode>): ChainLine {
	const names = Object.fromEntries([...byId].map(([id, n]) => [id, { name: n.name }]));
	return {
		id: chain.id,
		members: [...chain.premises, chain.conclusion].map((id) => ({
			id,
			name: byId.get(id)?.name ?? id,
		})),
		text: formatChainLine(chain, names),
	};
}

/** The chain lines of an opened source, in the group order. */
export function chainLines(
	snapshot: Pick<GraphSnapshot, "propositions">,
	group: Pick<ChainSourceGroup, "chains">,
): ChainLine[] {
	const byId = nodeIndex(snapshot);
	return group.chains.map((chain) => lineOf(chain, byId));
}

/** The chain sheet: the chain line, the statements, and the birth session. */
export interface ChainSheet {
	line: ChainLine;
	statements: { id: string; name: string; statement: string }[];
	/** The birth session, at the conclusion's message; null for a notes or unlabeled source. */
	open: { chatId: string; messageId: string | null; title: string } | null;
}

/** The sheet of one chain of a source group; null when the chain is not in the group. */
export function chainSheet(
	snapshot: Pick<GraphSnapshot, "propositions">,
	group: Pick<ChainSourceGroup, "chains" | "birth" | "kind" | "label">,
	chainId: string,
): ChainSheet | null {
	const chain = group.chains.find((c) => c.id === chainId);
	if (!chain) return null;
	const byId = nodeIndex(snapshot);
	const line = lineOf(chain, byId);
	const statements = line.members.flatMap(({ id }) => {
		const node = byId.get(id);
		return node ? [{ id, name: node.name, statement: node.statement }] : [];
	});
	const conclusion = byId.get(chain.conclusion);
	const open =
		group.kind === "chat" && group.birth !== null
			? {
					chatId: group.birth,
					messageId: conclusion ? nodeMessageId(conclusion, group.birth) : null,
					title: sourceDisplayName(group.label),
				}
			: null;
	return { line, statements, open };
}

// ─── The Graph tab view ─────────────────────────────────────────────────────

/** State 1: the Mac is not reachable, or a new read failed; the last graph stays. */
export const KNOWLEDGE_STALE = userMessage("Not up to date");
/** No graph yet, and the phone is not connected. */
export const KNOWLEDGE_OFFLINE = userMessage("Connect to the Mac to see your knowledge.");
export const KNOWLEDGE_LOADING = userMessage("Loading…");

/** What the Graph tab shows now. */
export type GraphTabView =
	| { kind: "note"; text: UserMessage }
	| { kind: "error"; text: UserMessage }
	| { kind: "empty" }
	| { kind: "graph"; knowledge: Knowledge; stale: UserMessage | null };

/**
 * The Graph tab view from the last loaded knowledge, the last read error,
 * and the connection. A loaded graph stays on screen when a later read
 * fails or the Mac goes away (state 1, "Not up to date").
 */
export function graphTabView(
	knowledge: Knowledge | null,
	error: UserMessage | null,
	connected: boolean,
): GraphTabView {
	if (knowledge) {
		if (isEmptyKnowledge(knowledge.snapshot)) return { kind: "empty" };
		return { kind: "graph", knowledge, stale: error || !connected ? KNOWLEDGE_STALE : null };
	}
	if (error) return { kind: "error", text: error };
	return { kind: "note", text: connected ? KNOWLEDGE_LOADING : KNOWLEDGE_OFFLINE };
}
