/**
 * Image snapshots as files (issue 09: "images as files"). The database keeps
 * the size and type; the bytes are a file named by the snapshot id (the
 * SHA-256 of the bytes), so the same picture is stored once.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

export interface ImageFiles {
	/** Writes the base64 bytes under `name`. Throws when the write fails. */
	write(name: string, base64: string): void;
	/** The base64 bytes, or null when the file is not there. */
	read(name: string): string | null;
	remove(name: string): void;
}

const EXTENSION = { "image/png": "png", "image/jpeg": "jpg" } as const;

export function imageFileName(snapshotId: string, mimeType: keyof typeof EXTENSION): string {
	return `${snapshotId}.${EXTENSION[mimeType]}`;
}

/** The SHA-256 (hex) of base64 bytes, the same as the desktop's snapshot id. */
export function sha256OfBase64(base64: string): string {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytesToHex(sha256(bytes));
}

/** In memory: for tests, and for a store that has no file folder. */
export function memoryImageFiles(): ImageFiles & { names(): string[] } {
	const files = new Map<string, string>();
	return {
		write: (name, base64) => void files.set(name, base64),
		read: (name) => files.get(name) ?? null,
		remove: (name) => void files.delete(name),
		names: () => [...files.keys()].sort(),
	};
}
