/**
 * Read a code block in a screen test: one row for each source line (issue 05,
 * wide content, slice A). Pass `screen` or `within(element)`.
 */
type Node = { children: readonly (Node | string)[] } | string;
type Queries = { queryAllByTestId: (id: string) => readonly Node[] };

/** The text inside a node, with no separator between its parts. */
export function textOf(node: Node): string {
	if (typeof node === "string") return node;
	return node.children.map(textOf).join("");
}

/** The lines of the code blocks, joined with newlines. */
export function codeText(queries: Queries): string {
	return queries.queryAllByTestId("md-code-line").map(textOf).join("\n");
}

/** The line numbers of the code blocks, joined with newlines. */
export function codeNumbers(queries: Queries): string {
	return queries.queryAllByTestId("md-code-number").map(textOf).join("\n");
}

type TreeNode = { type: unknown; children: readonly (TreeNode | string)[] };

/** The number of native scroll views under `root` (pass `screen.root`). */
export function scrollViewCount(root: TreeNode | null): number {
	if (!root) return 0;
	let n = root.type === "RCTScrollView" ? 1 : 0;
	for (const child of root.children) if (typeof child !== "string") n += scrollViewCount(child);
	return n;
}
