/**
 * Native tabs mount all three tabs at once (issue 20), so a query on the
 * whole screen finds the status line three times. `inTab` scopes the
 * queries to one tab's content.
 */
import { screen, within } from "expo-router/testing-library";

export type TabName = "teach" | "practice" | "graph";

export async function inTab(name: TabName) {
	return within(await screen.findByTestId(`tab-${name}`));
}

/**
 * A header button. Each tab has its own header, and the tabs mount in the
 * order of the triggers (Teach, Practice, Graph): index 0 is the Teach tab.
 */
export async function headerButton(testID: string, tab: TabName = "teach") {
	const all = await screen.findAllByTestId(testID);
	if (testID !== "open-settings") return all[0]!;
	return all[["teach", "practice", "graph"].indexOf(tab)]!;
}
