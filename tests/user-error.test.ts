/**
 * describeError: the one place that turns an error into text for the
 * screen. No raw server or exception text may reach the user.
 */
import { NotPairedError } from "@/lib/mac-fetch";
import { PairingError } from "@/lib/pairing";
import { SessionApiError } from "@/lib/sessions";
import { UserFacingError, describeError, userMessage } from "@/lib/user-error";

const envelope = (body: unknown) => ({ message: JSON.stringify(body) });

describe("describeError", () => {
	let log: jest.Mock;
	beforeEach(() => {
		log = jest.fn();
	});

	it("names the missing model slot for models_not_configured", () => {
		const text = describeError(
			envelope({
				error: "No model configured — set up your models first",
				code: "models_not_configured",
				missing: ["strong"],
			}),
			log,
		);
		expect(text).toBe(
			"Your Mac has no Strong model set. In LearnHarness on the Mac, open Settings, select a model, and then send your message again.",
		);
	});

	it("names more than one missing slot", () => {
		const text = describeError(
			envelope({ error: "x", code: "models_not_configured", missing: ["strong", "cheap"] }),
			log,
		);
		expect(text).toContain("no Strong and Cheap model set");
	});

	it("reads models_not_configured from a SessionApiError body too", () => {
		const err = new SessionApiError("raw", 503, {
			error: "x",
			code: "models_not_configured",
			missing: ["vision"],
		});
		expect(describeError(err, log)).toContain("no Vision model set");
	});

	it("tells the user which provider key is missing", () => {
		const text = describeError(
			envelope({
				error: "No Anthropic key is set — add one in Settings → Keys",
				code: "provider_key_missing",
				provider: "anthropic",
				slots: ["strong"],
			}),
			log,
		);
		expect(text).toBe(
			"The Anthropic API key is missing on your Mac. In LearnHarness on the Mac, open Settings → Keys and add it.",
		);
	});

	it("tells the user to set up Claude Code when it is the missing provider", () => {
		const text = describeError(
			envelope({
				error: "Claude Code is unavailable. Enable and set it up in Settings → Providers.",
				code: "provider_key_missing",
				provider: "claude-code",
				slots: ["strong"],
			}),
			log,
		);
		expect(text).toBe(
			"Claude Code is not set up on your Mac. In LearnHarness on the Mac, open Settings → Providers and set it up.",
		);
	});

	it.each([
		[401, "This phone is not paired with the Mac anymore. Pair again."],
		[403, "The phone cannot do this yet. Use LearnHarness on the Mac for it."],
		[404, "The Mac does not have this anymore. Go back and refresh the list."],
		[409, "The teacher is still busy with a turn. Wait a moment, and then try again."],
		[413, "This is too long to send. Make it shorter, and then try again."],
		[502, "LearnHarness on the Mac is not ready. Wait a moment, and then try again."],
	])("maps HTTP status %i", (status, expected) => {
		const err = new SessionApiError("raw text from the server", status, { error: "raw" });
		expect(describeError(err, log)).toBe(expected);
	});

	it.each([
		[
			"This phone is not paired, or its pairing was removed.",
			"This phone is not paired with the Mac anymore. Pair again.",
		],
		[
			"This action is available only on the desktop.",
			"The phone cannot do this yet. Use LearnHarness on the Mac for it.",
		],
		[
			"The LearnHarness server is not reachable.",
			"LearnHarness on the Mac is not ready. Wait a moment, and then try again.",
		],
	])("maps the gateway body %s (SessionModel keeps no status)", (error, expected) => {
		expect(describeError(envelope({ error }), log)).toBe(expected);
	});

	it("maps a dropped stream", () => {
		expect(
			describeError({ message: "The connection dropped before the turn completed." }, log),
		).toBe("The connection to the Mac dropped before the turn ended. Try again.");
	});

	it("maps a network failure", () => {
		expect(describeError(new TypeError("Network request failed"), log)).toBe(
			"The phone lost the connection to the Mac. Check that the Mac is on and that LearnHarness is open, and then try again.",
		);
	});

	it("uses the text of errors that the phone wrote for the user", () => {
		expect(describeError(new UserFacingError(userMessage("Written for you.")), log)).toBe(
			"Written for you.",
		);
		expect(
			describeError(new PairingError(userMessage("The pairing code is incomplete.")), log),
		).toBe("The pairing code is incomplete.");
		expect(describeError(new NotPairedError(), log)).toBe(
			"This phone is not paired with a Mac. Pair it first.",
		);
		expect(log).not.toHaveBeenCalled();
	});

	it.each([
		[envelope({ error: "retry input requires a failed turn to retry" })],
		[{ message: "retry input requires a failed turn to retry" }],
		[new Error("remoteFetch: expected a relative path, got https://x")],
		[new SessionApiError("Internal error.", 500, { error: "Internal error." })],
		["a thrown string"],
		[undefined],
		[{ message: "" }],
	])("never shows unknown text, and logs it (%p)", (err) => {
		const text = describeError(err, log);
		expect(text).toBe("Something went wrong. Try again.");
		expect(log).toHaveBeenCalledTimes(1);
	});

	describe("SessionModel texts for slices C and D (issue 04)", () => {
		it.each([
			[
				"Could not sync the saved session.",
				"The phone could not read this session from the Mac. Try again.",
			],
			["The steer failed (500).", "The teacher did not get your message. Try again."],
			["The steer failed (401).", "This phone is not paired with the Mac anymore. Pair again."],
			[
				"The steer failed (403).",
				"The phone cannot do this yet. Use LearnHarness on the Mac for it.",
			],
		])("maps %j", (raw, text) => {
			expect(describeError({ message: raw }, log)).toBe(text);
			expect(log).not.toHaveBeenCalled();
		});

		it("maps a failed problem dismissal (issue 06; the phone has no question Skip)", () => {
			expect(describeError({ message: "The dismissal failed (500)." }, log)).toBe(
				"The phone could not dismiss the problem. Try again.",
			);
			expect(log).not.toHaveBeenCalled();
		});

		it.each([
			[
				"thinking input targets no active problem",
				"This problem is not active anymore. Read the session again to see where it stands.",
			],
			[
				"dismiss-problem input targets no active problem",
				"This problem is not active anymore. Read the session again to see where it stands.",
			],
			[
				"next input requires no active problem",
				"A problem is still active. Read the session again to see it.",
			],
			[
				"This problem requires its registered submission editor",
				"This problem uses a plugin. Work on it in LearnHarness on the Mac.",
			],
		])("maps the Mac's practice refusal %j (issue 06)", (raw, text) => {
			expect(describeError({ message: JSON.stringify({ error: raw }) }, log)).toBe(text);
			expect(log).not.toHaveBeenCalled();
		});

		it("does not take a text that only looks like the pattern", () => {
			expect(describeError({ message: "The steer failed (500). Stack: x" }, log)).toBe(
				"Something went wrong. Try again.",
			);
			expect(log).toHaveBeenCalled();
		});
	});
});
