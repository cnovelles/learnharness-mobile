/**
 * One events channel for the app (src/lib/events-channel.ts), open while
 * the Mac is connected and the app is in the foreground. iOS stops network
 * work in the background, so the channel closes there and opens again on
 * return; each new connection tells the listeners to read the truth again.
 */
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { useConnection, useMacFetch } from "./connection-context";
import { openEventsChannel } from "./events-channel";
import { createEventHub, type EventHub, type EventListener } from "./server-events";

const HubContext = createContext<EventHub | null>(null);

export function ServerEventsProvider({ children }: { children: ReactNode }) {
	const { state, monitor } = useConnection();
	const macFetch = useMacFetch();
	const [hub] = useState(createEventHub);
	const [foreground, setForeground] = useState(AppState.currentState !== "background");
	const connected = state.status === "connected";

	useEffect(() => {
		const sub = AppState.addEventListener("change", (s) => setForeground(s === "active"));
		return () => sub.remove();
	}, []);

	useEffect(() => {
		if (!connected || !foreground) return;
		const channel = openEventsChannel({
			fetch: macFetch,
			onEvent: hub.dispatch,
			onOpen: hub.resync,
			// The Mac refused the token: let the monitor confirm and ask for a new pairing.
			onStop: () => void monitor.check(),
		});
		return () => channel.close();
	}, [connected, foreground, macFetch, hub, monitor]);

	return <HubContext value={hub}>{children}</HubContext>;
}

export function useEventHub(): EventHub {
	const hub = use(HubContext);
	if (!hub) throw new Error("useEventHub must be used inside ServerEventsProvider");
	return hub;
}

/** Listen to one event type while the component is on screen. */
export function useServerEvent(type: string, listener: EventListener) {
	const hub = useEventHub();
	const latest = useRef(listener);
	useEffect(() => {
		latest.current = listener;
	});
	useEffect(() => hub.subscribe(type, (p) => latest.current(p)), [hub, type]);
}
