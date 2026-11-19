/**
 * The graph reads of the Teach tab (issue 20): the desktop folders
 * (`GET /api/graph/sources`) and the propositions (`GET /api/graph`). The
 * gateway allows both, and one checked folder write (`changeFolders`, D-015).
 * Each read checks the body shape, so a bad
 * body is an error and never a crash.
 */
import { failure, SessionApiError } from "./sessions";
import type { GraphNode, OrganizationAction, SourceDirectory } from "./shared";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The desktop folders and the source placements. */
export async function readSourceDirectory(fetchImpl: typeof fetch): Promise<SourceDirectory> {
	const res = await fetchImpl("/api/graph/sources");
	if (!res.ok) throw await failure(res);
	return parseSourceDirectory(await res.json());
}

/**
 * One folder change (issue 20, slice D): `POST /api/graph/sources` with one
 * action. The Mac answers with the new folders, and with `createdFolderId`
 * after a new folder. A refusal throws a SessionApiError with the status
 * and the body (see `describeFolderError`).
 */
export async function changeFolders(
	fetchImpl: typeof fetch,
	action: OrganizationAction,
): Promise<{ directory: SourceDirectory; createdFolderId: string | null }> {
	const res = await fetchImpl("/api/graph/sources", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(action),
	});
	if (!res.ok) throw await failure(res);
	const body: unknown = await res.json();
	const created = isRecord(body) ? body.createdFolderId : undefined;
	return {
		directory: parseSourceDirectory(body),
		createdFolderId: typeof created === "string" && created ? created : null,
	};
}

function parseSourceDirectory(body: unknown): SourceDirectory {
	const organization = isRecord(body) ? body.organization : undefined;
	if (
		!isRecord(body) ||
		!isRecord(organization) ||
		!Array.isArray(organization.folders) ||
		!isRecord(organization.placements) ||
		!Array.isArray(body.sources)
	)
		throw new SessionApiError("The Mac sent folders that are not valid.");
	const folders = organization.folders.filter(
		(f): f is SourceDirectory["organization"]["folders"][number] =>
			isRecord(f) &&
			typeof f.id === "string" &&
			typeof f.name === "string" &&
			(f.parentId === null || typeof f.parentId === "string") &&
			typeof f.createdAt === "string",
	);
	const placements: SourceDirectory["organization"]["placements"] = {};
	for (const [id, p] of Object.entries(organization.placements))
		if (isRecord(p) && (p.folderId === null || typeof p.folderId === "string"))
			placements[id] = { folderId: p.folderId };
	return {
		organization: { version: 1, folders, placements },
		sources: (body.sources as unknown[]).filter(
			(s): s is SourceDirectory["sources"][number] => isRecord(s) && typeof s.id === "string",
		),
	};
}

/** The stored propositions of the graph (only the fields the phone reads are checked). */
export async function readPropositions(fetchImpl: typeof fetch): Promise<GraphNode[]> {
	const res = await fetchImpl("/api/graph");
	if (!res.ok) throw await failure(res);
	const body: unknown = await res.json();
	if (!isRecord(body) || !Array.isArray(body.propositions))
		throw new SessionApiError("The Mac sent a graph that is not valid.");
	return body.propositions.filter(
		(p): p is GraphNode => isRecord(p) && typeof p.id === "string" && Array.isArray(p.provenance),
	);
}
