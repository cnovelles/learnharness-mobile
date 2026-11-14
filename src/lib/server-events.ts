/**
 * The event hub: one events channel for the app, many listeners (the
 * session screen, the session list). Plain functions, so tests drive it
 * without React or a network.
 */
import type { ServerEventMessage } from "./events-channel";

export type EventListener = (payload: Record<string, unknown>) => void;

export interface EventHub {
	/** Listen to one event type. Returns the function that stops it. */
	subscribe(type: string, listener: EventListener): () => void;
	/** Called on each new channel connection: read the truth again. */
	onResync(listener: () => void): () => void;
}

export function createEventHub(): EventHub & {
	dispatch(event: ServerEventMessage): void;
	resync(): void;
} {
	const byType = new Map<string, Set<EventListener>>();
	const resyncs = new Set<() => void>();
	const run = (fn: () => void) => {
		try {
			fn();
		} catch (e) {
			console.warn("server events: a listener failed", e);
		}
	};
	return {
		subscribe(type, listener) {
			const set = byType.get(type) ?? new Set<EventListener>();
			byType.set(type, set);
			set.add(listener);
			return () => void set.delete(listener);
		},
		onResync(listener) {
			resyncs.add(listener);
			return () => void resyncs.delete(listener);
		},
		dispatch(event) {
			for (const l of [...(byType.get(event.type) ?? [])]) run(() => l(event.payload));
		},
		resync() {
			for (const l of [...resyncs]) run(l);
		},
	};
}
