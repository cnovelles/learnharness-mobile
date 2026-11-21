/**
 * The Chains screen (issue 08 slice D, user choice 3C, 2026-11-21): the
 * desktop chain table on a 375 pt screen. The header "N chains · M nodes",
 * a search field, and a sort button with a native menu (Name, Props,
 * Created). Each top folder is one inset grouped card of two-line source
 * rows. A tap on a source opens it in place and shows its chain lines; a
 * search opens the matching sources (the desktop rule). A tap on a chain
 * line opens the chain sheet. The model is in src/lib/knowledge.ts.
 */
import { Stack, router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ChainChips } from "@/components/chain-line";
import { ChainSheet } from "@/components/chain-sheet";
import { ChainSortMenu } from "@/components/chain-sort-menu";
import type { SessionTarget } from "@/components/node-sheet";
import { SPACE } from "@/components/spacing";
import { ConnectionStatus } from "@/components/tab-screen";
import {
	Body,
	Button,
	ErrorText,
	FONT,
	Field,
	Icon,
	LABEL,
	TYPE,
	Screen,
	Title,
	alpha,
	usePalette,
} from "@/components/ui";
import {
	CLOSED_CHAINS,
	KNOWLEDGE_EMPTY,
	KNOWLEDGE_EMPTY_TITLE,
	NO_MATCHING_CHAINS,
	chainLines,
	chainList,
	chainSections,
	chainSheet,
	graphTabView,
	isChainEntryOpen,
	toggleChainEntry,
	type ChainEntry,
	type ChainOpenState,
	type ChainSourceRow,
	type Knowledge,
} from "@/lib/knowledge";
import { useGraphKnowledge } from "@/lib/knowledge-context";
import { DEFAULT_CHAIN_SORT, type ChainSort } from "@/lib/shared";
import { useConnection } from "@/lib/connection-context";

/** The indent of one level in a card (an opened folder or source). */
const INDENT = SPACE.lg;

function Disclosure({ open }: { open: boolean }) {
	const c = usePalette();
	return <Icon name={open ? "chevron.down" : "chevron.right"} size={12} color={c.muted} />;
}

function SourceRow({
	row,
	depth,
	open,
	first,
	onToggle,
}: {
	row: ChainSourceRow;
	depth: number;
	open: boolean;
	first: boolean;
	onToggle: () => void;
}) {
	const c = usePalette();
	const nameColor = row.unlabeled ? alpha(c.muted, 0.6) : c.text;
	return (
		<Pressable
			onPress={onToggle}
			accessibilityRole="button"
			accessibilityState={{ expanded: open }}
			accessibilityLabel={`${row.name}${row.group.kind === "notes" ? ", notes" : ""}, ${row.detail}`}
			style={({ pressed }) => [
				styles.row,
				{ paddingLeft: SPACE.md + depth * INDENT },
				first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
				pressed ? { backgroundColor: c.hover } : null,
			]}
			testID={`chain-source-${row.group.key}`}
		>
			<View style={styles.rowText}>
				<View style={styles.nameLine}>
					<Text style={[styles.name, { color: nameColor }]} numberOfLines={2}>
						{row.name}
					</Text>
					{row.group.kind === "notes" ? (
						<Text style={[LABEL, styles.tag, { color: alpha(c.muted, 0.8) }]}>notes</Text>
					) : null}
				</View>
				<Text style={[styles.detail, { color: c.muted }]}>{row.detail}</Text>
			</View>
			<Disclosure open={open} />
		</Pressable>
	);
}

function FolderRow({
	name,
	detail,
	depth,
	open,
	first,
	onToggle,
	testID,
}: {
	name: string;
	detail: string;
	depth: number;
	open: boolean;
	first: boolean;
	onToggle: () => void;
	testID: string;
}) {
	const c = usePalette();
	return (
		<Pressable
			onPress={onToggle}
			accessibilityRole="button"
			accessibilityState={{ expanded: open }}
			accessibilityLabel={`Folder ${name}, ${detail}`}
			style={({ pressed }) => [
				styles.row,
				{ paddingLeft: SPACE.md + depth * INDENT },
				first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
				pressed ? { backgroundColor: c.hover } : null,
			]}
			testID={testID}
		>
			<Icon name={open ? "folder" : "folder.fill"} size={14} color={c.muted} />
			<View style={styles.rowText}>
				<Text style={[styles.name, { color: c.text }]} numberOfLines={2}>
					{name}
				</Text>
				<Text style={[styles.detail, { color: c.muted }]}>{detail}</Text>
			</View>
			<Disclosure open={open} />
		</Pressable>
	);
}

interface ChainPick {
	source: string;
	chain: string;
}

/** The rows of a list of entries, with the opened sources and folders. */
function Entries({
	entries,
	depth,
	firstAtTop,
	knowledge,
	openState,
	query,
	onToggle,
	onPick,
}: {
	entries: ChainEntry[];
	depth: number;
	firstAtTop: boolean;
	knowledge: Knowledge;
	openState: ChainOpenState;
	query: string;
	onToggle: (key: string) => void;
	onPick: (pick: ChainPick) => void;
}) {
	const c = usePalette();
	return entries.map((entry, i) => {
		const first = firstAtTop && i === 0;
		if (entry.kind === "folder") {
			const key = `folder:${entry.key}`;
			const open = isChainEntryOpen(openState, key, query);
			return (
				<View key={key}>
					<FolderRow
						name={entry.name}
						detail={entry.detail}
						depth={depth}
						open={open}
						first={first}
						onToggle={() => onToggle(key)}
						testID={`chain-folder-${entry.key}`}
					/>
					{open ? (
						<Entries
							entries={entry.entries}
							depth={depth + 1}
							firstAtTop={false}
							knowledge={knowledge}
							openState={openState}
							query={query}
							onToggle={onToggle}
							onPick={onPick}
						/>
					) : null}
				</View>
			);
		}
		const key = `source:${entry.key}`;
		const open = isChainEntryOpen(openState, key, query);
		return (
			<View key={key}>
				<SourceRow
					row={entry.row}
					depth={depth}
					open={open}
					first={first}
					onToggle={() => onToggle(key)}
				/>
				{open
					? chainLines(knowledge.snapshot, entry.row.group).map((line) => (
							<Pressable
								key={line.id}
								onPress={() => onPick({ source: entry.key, chain: line.id })}
								accessibilityRole="button"
								accessibilityLabel={line.text}
								accessibilityHint="Opens the chain with its statements."
								style={({ pressed }) => [
									styles.chain,
									{
										paddingLeft: SPACE.md + (depth + 1) * INDENT,
										borderTopColor: alpha(c.line, 0.5),
									},
									pressed ? { backgroundColor: c.hover } : null,
								]}
								testID={`chain-line-${line.id}`}
							>
								<ChainChips line={line} />
							</Pressable>
						))
					: null}
			</View>
		);
	});
}

function ChainsView({ knowledge, stale }: { knowledge: Knowledge; stale: string | null }) {
	const c = usePalette();
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<ChainSort>(DEFAULT_CHAIN_SORT);
	const [openState, setOpenState] = useState<ChainOpenState>(CLOSED_CHAINS);
	const [pick, setPick] = useState<ChainPick | null>(null);
	const list = useMemo(() => chainList(knowledge, query, sort), [knowledge, query, sort]);
	const sections = useMemo(() => chainSections(list), [list]);
	// The desktop shows "No matching chains." only with no folders. A search
	// that hides all folders also gets the text, not an empty screen.
	const empty = list.empty ?? (sections.length === 0 ? NO_MATCHING_CHAINS : null);
	const sheet = useMemo(() => {
		const group = pick && list.sources.find((row) => row.group.key === pick.source)?.group;
		return group ? chainSheet(knowledge.snapshot, group, pick.chain) : null;
	}, [knowledge, list, pick]);
	const toggle = useCallback(
		(key: string) => setOpenState((state) => toggleChainEntry(state, key, query)),
		[query],
	);
	const open = useCallback((target: SessionTarget) => {
		setPick(null);
		router.push({
			pathname: "/session/[id]",
			params: target.messageId
				? { id: target.chatId, message: target.messageId }
				: { id: target.chatId },
		});
	}, []);

	return (
		<View style={styles.list}>
			<View style={styles.controls}>
				<Field
					value={query}
					onChangeText={setQuery}
					label="Search chains"
					placeholder="Search chains"
					search
					testID="chains-search"
				/>
				<View style={styles.headerRow}>
					<Text style={[styles.header, { color: c.muted }]} testID="chains-header">
						{list.header}
					</Text>
					<ChainSortMenu sort={sort} onSort={setSort} />
				</View>
				{stale ? (
					<Text style={[styles.note, { color: c.muted }]} testID="chains-stale">
						{stale}
					</Text>
				) : null}
			</View>
			{empty ? (
				<Body muted testID="chains-empty">
					{empty}
				</Body>
			) : (
				sections.map((section) => (
					<View key={section.key} style={styles.group} testID={`chain-section-${section.key}`}>
						{section.label ? (
							<Text style={[LABEL, styles.label, { color: c.muted }]} accessibilityRole="header">
								{section.label}
							</Text>
						) : null}
						<View style={[styles.card, { backgroundColor: c.panel, borderColor: c.line }]}>
							{section.entries.length === 0 ? (
								<Text style={[styles.cardEmpty, { color: c.muted }]}>No sources.</Text>
							) : (
								<Entries
									entries={section.entries}
									depth={0}
									firstAtTop
									knowledge={knowledge}
									openState={openState}
									query={query}
									onToggle={toggle}
									onPick={setPick}
								/>
							)}
						</View>
					</View>
				))
			)}
			<ChainSheet sheet={sheet} onClose={() => setPick(null)} onOpen={open} />
		</View>
	);
}

export default function ChainsScreen() {
	const { state } = useConnection();
	const c = usePalette();
	const data = useGraphKnowledge();
	const view = graphTabView(data.knowledge, data.error, state.status === "connected");

	return (
		<Screen
			refreshControl={
				<RefreshControl
					refreshing={data.busy && view.kind !== "note"}
					onRefresh={data.refresh}
					tintColor={c.muted}
				/>
			}
		>
			<Stack.Screen options={{ title: "Chains" }} />
			<View style={styles.body} testID="chains-screen">
				<ConnectionStatus />
				{view.kind === "graph" ? (
					<ChainsView knowledge={view.knowledge} stale={view.stale} />
				) : view.kind === "note" ? (
					<Text style={[styles.note, styles.pad, { color: c.muted }]} testID="chains-note">
						{view.text}
					</Text>
				) : view.kind === "error" ? (
					<View style={styles.pad}>
						<ErrorText testID="chains-error">{view.text}</ErrorText>
						<Button
							title="Try again"
							kind="plain"
							size="sm"
							onPress={data.refresh}
							testID="chains-retry"
						/>
					</View>
				) : (
					<View style={[styles.pad, styles.empty]} testID="chains-graph-empty">
						<Title>{KNOWLEDGE_EMPTY_TITLE}</Title>
						<Body muted>{KNOWLEDGE_EMPTY}</Body>
					</View>
				)}
			</View>
		</Screen>
	);
}

const styles = StyleSheet.create({
	body: { gap: SPACE.lg },
	list: { gap: SPACE.lg },
	controls: { gap: SPACE.sm },
	headerRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	header: { ...TYPE.xs, fontFamily: FONT.ui, flex: 1 },
	note: { ...TYPE.xs, fontFamily: FONT.ui },
	pad: { paddingHorizontal: SPACE.sm, gap: SPACE.sm, alignItems: "flex-start" },
	empty: { alignItems: "center", paddingTop: SPACE.lg },
	group: { gap: SPACE.xs },
	label: { paddingHorizontal: SPACE.xs },
	/** The inset grouped card of the Teach tab (src/components/shelf.tsx). */
	card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
	cardEmpty: { ...TYPE.sm, fontFamily: FONT.prose, padding: SPACE.md },
	row: {
		minHeight: 44,
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.sm,
		paddingRight: SPACE.md,
		paddingVertical: SPACE.sm,
	},
	rowText: { flex: 1, gap: SPACE.xs },
	nameLine: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	name: { fontFamily: FONT.prose, fontSize: 15, lineHeight: 20, flexShrink: 1 },
	tag: { letterSpacing: 1.1 },
	detail: { ...TYPE.xs, fontFamily: FONT.ui },
	chain: {
		minHeight: 44,
		justifyContent: "center",
		paddingRight: SPACE.md,
		paddingVertical: SPACE.sm,
		borderTopWidth: StyleSheet.hairlineWidth,
	},
});
