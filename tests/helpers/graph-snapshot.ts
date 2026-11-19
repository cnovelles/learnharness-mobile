/**
 * A small test graph for the Graph tab tests: a ⟹ c from a and b (an
 * implication node), and d whose session is gone on the Mac.
 */
import type { GraphNode, GraphSnapshot } from "@/lib/shared";

export const node = (id: string, name: string, extra: Partial<GraphNode> = {}): GraphNode => ({
	id,
	name,
	statement: `${name} is true.`,
	aliases: [],
	createdAt: "2026-11-10T10:00:00.000Z",
	provenance: [{ chatId: "chat_a", messageId: "" }],
	...extra,
});

/** A small graph: a ⟹ c from a and b (an implication node), and d with no source. */
export function snapshot(): GraphSnapshot {
	const a = node("n_a", "Alpha", { provenance: [{ chatId: "chat_a", messageId: "m1" }] });
	const b = node("n_b", "Beta", {
		provenance: [
			{ chatId: "chat_a", messageId: "" },
			{ chatId: "src_notes", messageId: "" },
		],
	});
	const c = node("n_c", "Gamma", { createdAt: "2026-11-12T10:00:00.000Z" });
	const d = node("n_d", "Delta", { provenance: [{ chatId: "chat_gone", messageId: "m9" }] });
	const imp = node("arg_1", "⟹", { statement: "Alpha, Beta → Gamma" });
	return {
		nodes: [a, b, c, d, imp],
		propositions: [a, b, c, d],
		edges: [
			{ from: "n_a", to: "arg_1" },
			{ from: "n_b", to: "arg_1" },
			{ from: "arg_1", to: "n_c" },
		],
		logicalEdges: [
			{ from: "n_a", to: "n_c" },
			{ from: "n_b", to: "n_c" },
		],
		impLinks: [{ id: "arg_1", premises: ["n_a", "n_b"], conclusion: "n_c" }],
		chains: [
			{
				id: "arg_1",
				premises: ["n_a", "n_b"],
				conclusion: "n_c",
				provenance: [{ chatId: "chat_a", messageId: "" }],
				createdAt: "2026-11-12T10:00:00.000Z",
			},
		],
		sessions: { chat_a: "Eigenvalues" },
		fileSources: { src_notes: "notes/linear algebra.md" },
		nodeSessions: {
			n_a: ["chat_a"],
			n_b: ["chat_a", "src_notes"],
			n_c: ["chat_a"],
			n_d: ["chat_gone"],
		},
		clusters: [{ id: "chat_a", label: "Eigenvalues", members: ["n_a", "n_b", "n_c"] }],
		positions: {
			n_a: { x: 0, y: 0 },
			n_b: { x: 100, y: 0 },
			n_c: { x: 50, y: 100 },
			n_d: { x: 200, y: 50 },
			arg_1: { x: 50, y: 40 },
		},
	};
}
