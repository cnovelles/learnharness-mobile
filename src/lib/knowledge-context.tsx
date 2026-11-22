/**
 * One knowledge load for the Graph tab and the screens that it pushes (the
 * Chains screen, issue 08 slice D). The Graph tab layout holds the load, so
 * the Chains screen shows the same graph at once, and a change on the Mac
 * reads the graph only one time.
 */
import { createContext, useContext, type ReactNode } from "react";

import { useConnection } from "./connection-context";
import { useKnowledge, type KnowledgeState } from "./use-knowledge";

const KnowledgeContext = createContext<KnowledgeState | null>(null);

export function KnowledgeProvider({ children }: { children: ReactNode }) {
	const { state } = useConnection();
	const data = useKnowledge(state.status === "connected");
	return <KnowledgeContext.Provider value={data}>{children}</KnowledgeContext.Provider>;
}

/** The Graph tab knowledge. Use it only below `KnowledgeProvider`. */
export function useGraphKnowledge(): KnowledgeState {
	const data = useContext(KnowledgeContext);
	if (!data) throw new Error("useGraphKnowledge needs a KnowledgeProvider");
	return data;
}
