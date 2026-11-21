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
 *   ready" again (a paragraph that gets a formula) does not hide it. *
 * With `hold: false` (the session screen, issue 21 slice D, D-014) every
 * block shows at once. The gate then only says when the blocks are drawn:
 * it is busy while a block is not ready. Each block has its own time limit
 * from when it comes, and the limits run at the same time (not one after
 * the other, as at the front of a held reveal). A hidden block has no height, so a held reveal of a
 * long transcript put all its islands near the screen at once.
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
	/** True while a block waits at the front. */
	busy(): boolean;
	subscribe(listener: () => void): () => void;
	/** Stop the timer (the transcript leaves the screen). */
	dispose(): void;
}

export interface RevealOptions {
	/** False: show every block at once, and only track which blocks are drawn. */
	hold?: boolean;
}

export function createRevealGate(
	limitMs: number = REVEAL_LIMIT_MS,
	{ hold = true }: RevealOptions = {},
): RevealGate {
	const slots = new Map<string, Slot>();
	const views = new Map<string, RevealView>();
	const listeners = new Set<() => void>();
	let front: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;
	/** Hold off: the time limit of each block. */
	const limits = new Map<string, ReturnType<typeof setTimeout>>();
	const stopLimit = (id: string) => {
		const t = limits.get(id);
		if (t) clearTimeout(t);
		limits.delete(id);
	};
	const startLimit = (id: string) => {
		if (limits.has(id)) return;
		limits.set(
			id,
			setTimeout(() => {
				limits.delete(id);
				const slot = slots.get(id);
				if (!slot) return;
				slot.expired = true;
				recompute();
			}, limitMs),
		);
	};

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
			if (!hold) {
				slot.shown = true;
				views.set(id, "shown");
				if (!nextFront && !slot.ready && !slot.expired) nextFront = id;
			} else if (!blocked && (slot.ready || slot.shown || slot.expired)) {
				slot.shown = true;
				views.set(id, "shown");
			} else if (!blocked) {
				blocked = true;
				nextFront = id;
				views.set(id, "front");
			} else views.set(id, "hidden");
		}
		if (!hold) {
			front = nextFront;
			for (const listener of listeners) listener();
			return;
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
			if (!hold) {
				if (ready) stopLimit(id);
				else if (!old?.expired) startLimit(id);
			}
			recompute();
		},
		remove(id) {
			if (!slots.delete(id)) return;
			stopLimit(id);
			recompute();
		},
		view: (id) => views.get(id) ?? "hidden",
		busy: () => front !== null,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			disposed = true;
			stopTimer();
			for (const id of [...limits.keys()]) stopLimit(id);
			listeners.clear();
		},
	};
}
