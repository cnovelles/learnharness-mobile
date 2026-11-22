/**
 * The Graph tab Stack: the canvas and the Chains screen (issue 08). The
 * knowledge load is here, so both screens show the same graph.
 */
import { Stack } from "expo-router";

import { useStackOptions } from "@/components/stack-options";
import { KnowledgeProvider } from "@/lib/knowledge-context";

export default function GraphStack() {
	return (
		<KnowledgeProvider>
			<Stack screenOptions={useStackOptions()} />
		</KnowledgeProvider>
	);
}
