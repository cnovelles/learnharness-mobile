/** The Stack of one tab: it gives the tab its header (native tabs have none). */
import { Stack } from "expo-router";

import { useStackOptions } from "@/components/stack-options";

export default function TabStack() {
	return <Stack screenOptions={useStackOptions()} />;
}
