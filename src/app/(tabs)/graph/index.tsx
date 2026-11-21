/**
 * The Graph tab (issue 08, user decisions 2026-11-19, D-016): the desktop
 * connectivity graph on a Skia canvas, read only. Over the canvas: the
 * search field ("N of M nodes", "No matching nodes."). A tap on a node opens
 * the node sheet; a session row opens the session at the node's message.
 * "Chains" next to the search field pushes the Chains screen (slice D).
 * The cost number (slice F) comes later.
 */
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";

import { GraphCanvas } from "@/components/graph-canvas";
import { NodeSheet, type SessionTarget } from "@/components/node-sheet";
import { SPACE } from "@/components/spacing";
import { TabScreen } from "@/components/tab-screen";
import { Body, Button, ErrorText, FONT, Field, TYPE, Title, usePalette } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";
import {
	KNOWLEDGE_EMPTY,
	KNOWLEDGE_EMPTY_TITLE,
	canvasModel,
	canvasSearch,
	graphTabView,
	nodeSheet,
	type Knowledge,
} from "@/lib/knowledge";
import { useGraphKnowledge } from "@/lib/knowledge-context";

function GraphView({ knowledge, stale }: { knowledge: Knowledge; stale: string | null }) {
	const c = usePalette();
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const { snapshot } = knowledge;
	const model = useMemo(() => canvasModel(snapshot), [snapshot]);
	const search = useMemo(() => canvasSearch(snapshot, query), [snapshot, query]);
	const visible = query.trim() ? search.visibleIds : null;
	const sheet = useMemo(
		() => (selected ? nodeSheet(snapshot, selected) : null),
		[snapshot, selected],
	);
	const propositions = snapshot.propositions.length;

	const open = useCallback((target: SessionTarget) => {
		setSelected(null);
		router.push({
			pathname: "/session/[id]",
			params: target.messageId
				? { id: target.chatId, message: target.messageId }
				: { id: target.chatId },
		});
	}, []);

	return (
		<View style={styles.graph}>
			<View style={styles.controls}>
				<View style={styles.searchRow}>
					<View style={styles.searchField}>
						<Field
							value={query}
							onChangeText={setQuery}
							label="Search nodes"
							placeholder="Search nodes"
							search
							testID="graph-search"
						/>
					</View>
					<Button
						title="Chains"
						kind="plain"
						onPress={() => router.push("/graph/chains")}
						testID="open-chains"
					/>
				</View>
				{search.empty ? (
					<Text style={[styles.note, { color: c.muted }]} testID="graph-search-empty">
						{search.empty}
					</Text>
				) : search.countText ? (
					<Text style={[styles.note, { color: c.muted }]} testID="graph-search-count">
						{search.countText}
					</Text>
				) : null}
				{stale ? (
					<Text style={[styles.note, { color: c.muted }]} testID="graph-stale">
						{stale}
					</Text>
				) : null}
			</View>
			<View style={[styles.canvas, { borderColor: c.line }]}>
				<GraphCanvas
					model={model}
					visible={visible}
					selected={selected}
					onSelect={setSelected}
					label={`Knowledge graph, ${propositions} ${propositions === 1 ? "node" : "nodes"}. Pinch to zoom, tap a node to open it.`}
				/>
			</View>
			<NodeSheet sheet={sheet} onClose={() => setSelected(null)} onOpen={open} />
		</View>
	);
}

export default function GraphTab() {
	const { state } = useConnection();
	const c = usePalette();
	const connected = state.status === "connected";
	const data = useGraphKnowledge();
	const view = graphTabView(data.knowledge, data.error, connected);

	if (view.kind === "graph")
		return (
			<TabScreen title="Graph" scroll={false}>
				<GraphView knowledge={view.knowledge} stale={view.stale} />
			</TabScreen>
		);

	return (
		<TabScreen
			title="Graph"
			refreshControl={
				<RefreshControl
					refreshing={data.busy && view.kind !== "note"}
					onRefresh={data.refresh}
					tintColor={c.muted}
				/>
			}
		>
			{view.kind === "note" ? (
				<Text style={[styles.note, styles.pad, { color: c.muted }]} testID="graph-note">
					{view.text}
				</Text>
			) : view.kind === "error" ? (
				<View style={styles.pad}>
					<ErrorText testID="graph-error">{view.text}</ErrorText>
					<Button
						title="Try again"
						kind="plain"
						size="sm"
						onPress={data.refresh}
						testID="graph-retry"
					/>
				</View>
			) : (
				<View style={[styles.pad, styles.empty]} testID="graph-empty">
					<Title>{KNOWLEDGE_EMPTY_TITLE}</Title>
					<Body muted>{KNOWLEDGE_EMPTY}</Body>
				</View>
			)}
		</TabScreen>
	);
}

const styles = StyleSheet.create({
	graph: { flex: 1, gap: SPACE.sm },
	controls: { gap: SPACE.xs },
	searchRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
	searchField: { flex: 1 },
	canvas: {
		flex: 1,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 12,
		overflow: "hidden",
	},
	note: { ...TYPE.xs, fontFamily: FONT.ui },
	pad: { paddingHorizontal: SPACE.sm, gap: SPACE.sm, alignItems: "flex-start" },
	empty: { alignItems: "center", paddingTop: SPACE.lg },
});
