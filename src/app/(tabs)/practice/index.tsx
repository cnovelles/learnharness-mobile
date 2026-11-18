/** The Practice tab (issue 20): the practice sessions. */
import { RefreshControl } from "react-native";

import { SessionList, useSessionList } from "@/components/session-list";
import { TabScreen } from "@/components/tab-screen";
import { usePalette } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";

export default function PracticeTab() {
	const { state } = useConnection();
	const c = usePalette();
	const connected = state.status === "connected";
	const list = useSessionList(connected);
	return (
		<TabScreen
			title="Practice"
			kind="practice"
			refreshControl={
				<RefreshControl
					refreshing={list.busy && list.chats !== null}
					onRefresh={list.refresh}
					tintColor={c.muted}
				/>
			}
		>
			<SessionList enabled={connected} list={list} kind="practice" />
		</TabScreen>
	);
}
