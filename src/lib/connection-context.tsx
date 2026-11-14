/**
 * React access to the connection monitor. One monitor for the app: it reads
 * the Keychain on start, pings the Mac and follows the app's foreground state.
 */
import { createContext, use, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { createConnectionMonitor, type ConnectionMonitor, type ConnectionState } from "./connection-monitor";
import { secureConnectionStore } from "./connection-store";

const MonitorContext = createContext<ConnectionMonitor | null>(null);

export function ConnectionProvider({ children, monitor: injected }: { children: ReactNode; monitor?: ConnectionMonitor }) {
	const [monitor] = useState(() => injected ?? createConnectionMonitor({ store: secureConnectionStore, fetchImpl: (url, init) => fetch(url, init) }));
	// The monitor lives as long as the app. Start it once, even when React
	// runs the effect twice in development.
	const started = useRef(false);
	useEffect(() => {
		if (!started.current) {
			started.current = true;
			void monitor.start();
		}
		const sub = AppState.addEventListener("change", (s) => monitor.setForeground(s === "active"));
		return () => sub.remove();
	}, [monitor]);
	return <MonitorContext value={monitor}>{children}</MonitorContext>;
}

export function useConnection(): { state: ConnectionState; monitor: ConnectionMonitor } {
	const monitor = use(MonitorContext);
	if (!monitor) throw new Error("useConnection must be used inside ConnectionProvider");
	const state = useSyncExternalStore(monitor.subscribe, monitor.state, monitor.state);
	return { state, monitor };
}
