/**
 * Jest setup for the Graph tab canvas (issue 08 slice C). The canvas draws
 * with Skia, a native module that Jest cannot load. Every app test mounts
 * the Graph tab (native tabs mount all tabs), so all tests get this
 * stand-in: one button for each drawn proposition. The canvas math has its
 * own tests (tests/graph-scene.test.ts).
 */
jest.mock("@/components/graph-canvas", () => {
	const React = jest.requireActual<typeof import("react")>("react");
	const { Pressable, Text, View } =
		jest.requireActual<typeof import("react-native")>("react-native");
	return {
		GraphCanvas: (props: {
			model: { nodes: { id: string; label: string; implication: boolean }[] };
			visible: ReadonlySet<string> | null;
			selected: string | null;
			onSelect: (id: string) => void;
			label: string;
		}) =>
			React.createElement(
				View,
				{ testID: "graph-canvas", accessibilityLabel: props.label },
				props.model.nodes
					.filter((n) => !n.implication && (!props.visible || props.visible.has(n.id)))
					.map((n) =>
						React.createElement(
							Pressable,
							{
								key: n.id,
								testID: `canvas-node-${n.id}`,
								onPress: () => props.onSelect(n.id),
							},
							React.createElement(Text, null, n.label),
						),
					),
			),
	};
});
