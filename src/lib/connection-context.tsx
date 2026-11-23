/**
 * React access to the connection monitor. One monitor for the app: it reads
 * the Keychain on start, pings the Mac and follows the app's foreground state.
 */
import {
	createContext,
	use,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import { AppState } from "react-native";
import {
	createConnectionMonitor,
	type ConnectionMonitor,
	type ConnectionState,
} from "./connection-monitor";
import { secureConnectionStore } from "./connection-store";
import { createMacFetch } from "./mac-fetch";
import { nativePinnedFetch } from "./native-pinned-fetch";
import type { PinnedFetch } from "./pairing";
import type { SessionMirror } from "@/store/mirror";
import { phoneSessionMirror } from "@/store/phone-mirror";

const MonitorContext = createContext<ConnectionMonitor | null>(null);
export const MacFetchContext = createContext<typeof globalThis.fetch | null>(null);

export function ConnectionProvider({
	children,
	monitor: injected,
	pinnedFetch,
	mirror,
}: {
	children: ReactNode;
	monitor?: ConnectionMonitor;
	/** The pinned fetch for the Mac fetch. Default: the native module. */
	pinnedFetch?: PinnedFetch;
	/** The session mirror (issue 09). Default: the app's mirror; null: none. */
	mirror?: SessionMirror | null;
}) {
	const [monitor] = useState(
		() =>
			injected ??
			createConnectionMonitor({ store: secureConnectionStore, fetchImpl: nativePinnedFetch() }),
	);
	const [macFetch] = useState(() =>
		createMacFetch(
			monitor,
			pinnedFetch ?? nativePinnedFetch(),
			mirror === undefined ? phoneSessionMirror() : mirror,
		),
	);
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
	return (
		<MonitorContext value={monitor}>
			<MacFetchContext value={macFetch}>{children}</MacFetchContext>
		</MonitorContext>
	);
}

/** The fetch to the paired Mac (relative paths, for example "/api/chats"). Stable. */
export function useMacFetch(): typeof globalThis.fetch {
	const macFetch = use(MacFetchContext);
	if (!macFetch) throw new Error("useMacFetch must be used inside ConnectionProvider");
	return macFetch;
}

/** The Mac fetch, or null outside ConnectionProvider (for parts that also draw without a Mac). */
export function useOptionalMacFetch(): typeof globalThis.fetch | null {
	return use(MacFetchContext) ?? null;
}

export function useConnection(): { state: ConnectionState; monitor: ConnectionMonitor } {
	const monitor = use(MonitorContext);
	if (!monitor) throw new Error("useConnection must be used inside ConnectionProvider");
	const state = useSyncExternalStore(monitor.subscribe, monitor.state, monitor.state);
	return { state, monitor };
}
