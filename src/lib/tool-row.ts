/**
 * The folded tool row (issue 18), as the desktop's tool-call card (fork
 * components/artifacts/tool-call-card.tsx): the tool name, its headline
 * argument, and when opened the input and the output.
 *
 * Error states:
 * - A failed call never shows the raw error text (`AGENTS.md`, "Error
 *   states"): the row says that the tool failed.
 * - Input that cannot be written as JSON, and very long text, are cut or
 *   replaced; the row never throws.
 */

/** The longest input and output text that the row shows. */
export const TOOL_INPUT_MAX = 2_000;
export const TOOL_OUTPUT_MAX = 8_000;

export interface ToolRowData {
	kind: "tool";
	id: string;
	name: string;
	failed: boolean;
	/** The headline argument: the path, the pattern or the session. */
	arg: string;
	/** The input as JSON, or null when the call has none. */
	input: string | null;
	/** The output text, or null when there is none yet (or the call failed). */
	output: string | null;
}

/** The desktop's headline argument (tool-call-card.tsx `headlineArg`). */
export function headlineArg(tool: string, input: unknown): string {
	const inp = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
	if (tool === "read" || tool === "ls" || tool === "show_image") {
		return typeof inp.path === "string" && inp.path.length > 0 ? inp.path : "~";
	}
	if (typeof inp.pattern === "string") return inp.pattern;
	if (tool === "list_propositions" && typeof inp.session === "string" && inp.session.length > 0) {
		return inp.session;
	}
	return "";
}

function cut(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

/** The desktop's output text (tool-call-card.tsx `outputText`). */
export function outputText(output: unknown): string | null {
	if (output == null) return null;
	if (typeof output === "string") return cut(output, TOOL_OUTPUT_MAX);
	if (typeof output === "object" && "text" in (output as Record<string, unknown>)) {
		const o = output as { text?: unknown; images?: unknown[] };
		const text = typeof o.text === "string" ? o.text : null;
		const n = Array.isArray(o.images) ? o.images.length : 0;
		const all =
			n > 0 ? `${text ?? ""}\n[${n} image${n > 1 ? "s" : ""} attached to the model]`.trim() : text;
		return all === null ? null : cut(all, TOOL_OUTPUT_MAX);
	}
	return cut(json(output), TOOL_OUTPUT_MAX);
}

function json(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return "The phone cannot show this value.";
	}
}

export function toolRow(
	part: { input?: unknown; output?: unknown },
	id: string,
	name: string,
	failed: boolean,
): ToolRowData {
	const hasInput =
		part.input !== undefined &&
		part.input !== null &&
		!(typeof part.input === "object" && Object.keys(part.input as object).length === 0);
	return {
		kind: "tool",
		id,
		name,
		failed,
		arg: headlineArg(name, part.input),
		input: hasInput ? cut(json(part.input), TOOL_INPUT_MAX) : null,
		output: failed ? null : outputText(part.output),
	};
}
