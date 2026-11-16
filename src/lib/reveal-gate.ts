/**
 * The top-to-bottom reveal of the transcript (user decision 2026-11-15).
 * Formulas, charts, tables and the plan graph finish their drawing after
 * the first render. So nothing pops in or pushes the text, a block shows
 * only when it and every block above it are ready. The transcript then
 * grows only at the bottom, as a streamed reply does.
 *
 * - Each block has a key: its place in the transcript ([row] or
 *   [row, block]). Keys order the blocks, not the order of registration.
 * - The first block that is not ready is the "front". The screen shows a
 *   small spinner there. The blocks under it wait, hidden.
 * - A block at the front shows after REVEAL_LIMIT_MS, ready or not (it
 *   then shows its own loading box), so a slow or failed chart never
 *   holds the blocks under it for long.
 * - A shown block stays shown. A streaming change that makes it "not
 *   ready" again (a paragraph that gets a formula) does not hide it.
 */

/** The longest wait for one block at the front (user decision: 1.5 s). */
export const REVEAL_LIMIT_MS = 1500;

export type RevealKey = readonly number[];
export type RevealView = "shown" | "front" | "hidden";

/** Orders keys part by part. A shorter key that is a prefix comes first. */
export function compareKeys(a: RevealKey, b: RevealKey): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
	return a.length - b.length;
}

interface Slot {
	key: RevealKey;
	ready: boolean;
	/** Shown once: it stays shown. */
	shown: boolean;
	/** At the front for longer than the limit. */
	expired: boolean;
}

export interface RevealGate {
	/** Add a block, or change its key or its readiness. */
	set(id: string, key: RevealKey, ready: boolean): void;
	remove(id: string): void;
	view(id: string): RevealView;
	subscribe(listener: () => void): () => void;
	/** Stop the timer (the transcript leaves the screen). */
	dispose(): void;
}

export function createRevealGate(limitMs: number = REVEAL_LIMIT_MS): RevealGate {
	const slots = new Map<string, Slot>();
	const views = new Map<string, RevealView>();
	const listeners = new Set<() => void>();
	let front: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	const stopTimer = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};

	const recompute = () => {
		if (disposed) return;
		const order = [...slots.entries()].sort((x, y) => compareKeys(x[1].key, y[1].key));
		let blocked = false;
		let nextFront: string | null = null;
		views.clear();
		for (const [id, slot] of order) {
			if (!blocked && (slot.ready || slot.shown || slot.expired)) {
				slot.shown = true;
				views.set(id, "shown");
			} else if (!blocked) {
				blocked = true;
				nextFront = id;
				views.set(id, "front");
			} else views.set(id, "hidden");
		}
		if (nextFront !== front) {
			stopTimer();
			front = nextFront;
			if (front) {
				const id = front;
				timer = setTimeout(() => {
					timer = null;
					const slot = slots.get(id);
					if (!slot) return;
					slot.expired = true;
					recompute();
				}, limitMs);
			}
		}
		for (const listener of listeners) listener();
	};

	return {
		set(id, key, ready) {
			const old = slots.get(id);
			if (old && old.ready === ready && compareKeys(old.key, key) === 0) return;
			slots.set(id, {
				key,
				ready,
				shown: old?.shown ?? false,
				expired: old?.expired ?? false,
			});
			recompute();
		},
		remove(id) {
			if (!slots.delete(id)) return;
			recompute();
		},
		view: (id) => views.get(id) ?? "hidden",
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			disposed = true;
			stopTimer();
			listeners.clear();
		},
	};
}
