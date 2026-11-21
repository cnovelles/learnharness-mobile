/**
 * A new session: the learner writes what to learn or to practice; the Mac
 * creates the session. `?kind=practice` (the home "New practice" button,
 * user decision 2026-11-15) makes a practice session. The screen has no
 * switch between the two.
 */
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { Button, ErrorBanner, Field, Screen, Section } from "@/components/ui";
import { useMacFetch } from "@/lib/connection-context";
import { openingPrompts, startSession, type SessionKind } from "@/lib/sessions";
import { describeError, type UserMessage } from "@/lib/user-error";

const COPY: Record<SessionKind, { title: string; ask: string; example: string; start: string }> = {
	teach: {
		title: "New session",
		ask: "What do you want to learn?",
		example: "For example: how the tides work",
		start: "Start",
	},
	practice: {
		title: "New practice",
		ask: "What do you want to practice?",
		example: "For example: solve linear recurrences",
		start: "Start practice",
	},
};

export default function NewSessionScreen() {
	const macFetch = useMacFetch();
	const params = useLocalSearchParams<{ kind?: string }>();
	const kind: SessionKind = params.kind === "practice" ? "practice" : "teach";
	const copy = COPY[kind];
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<UserMessage | null>(null);

	async function start() {
		setBusy(true);
		setError(null);
		try {
			const id = await startSession(macFetch, text, openingPrompts, kind);
			router.replace({ pathname: "/session/[id]", params: { id } });
		} catch (e) {
			setError(describeError(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Screen>
			<Stack.Screen options={{ title: copy.title }} />
			<Section title={copy.ask} first testID="new-session-prompt">
				<Field
					value={text}
					onChangeText={setText}
					label={copy.ask}
					placeholder={copy.example}
					multiline
					testID="opening-text"
				/>
				{error ? <ErrorBanner testID="new-session-error" text={error} /> : null}
				<Button
					title={copy.start}
					onPress={() => void start()}
					disabled={!text.trim()}
					busy={busy}
					testID="start-session"
				/>
			</Section>
		</Screen>
	);
}
