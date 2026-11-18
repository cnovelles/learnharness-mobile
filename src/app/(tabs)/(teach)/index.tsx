/** The Teach tab (issue 20): the teach sessions. "/" opens this tab. */
import { RefreshControl } from "react-native";

import { SessionList, useSessionList } from "@/components/session-list";
import { TabScreen } from "@/components/tab-screen";
import { usePalette } from "@/components/ui";
import { useConnection } from "@/lib/connection-context";

export default function TeachTab() {
	const { state } = useConnection();
	const c = usePalette();
	const connected = state.status === "connected";
	const list = useSessionList(connected);
	return (
		<TabScreen
			title="Teach"
			kind="teach"
			refreshControl={
				<RefreshControl
					refreshing={list.busy && list.chats !== null}
					onRefresh={list.refresh}
					tintColor={c.muted}
				/>
			}
		>
			<SessionList enabled={connected} list={list} kind="teach" />
		</TabScreen>
	);
}
