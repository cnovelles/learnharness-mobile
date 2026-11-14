/** A new session: the learner writes what to learn; the Mac creates the session. */
import { router } from "expo-router";
import { useState } from "react";

import { Body, Button, ErrorText, Field, Panel, Screen } from "@/components/ui";
import { useMacFetch } from "@/lib/connection-context";
import { startSession } from "@/lib/sessions";

export default function NewSessionScreen() {
	const macFetch = useMacFetch();
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function start() {
		setBusy(true);
		setError(null);
		try {
			const id = await startSession(macFetch, text);
			router.replace({ pathname: "/session/[id]", params: { id } });
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Screen>
			<Panel>
				<Body testID="new-session-prompt">What do you want to learn?</Body>
				<Field
					value={text}
					onChangeText={setText}
					label="What do you want to learn?"
					placeholder="For example: how the tides work"
					multiline
					testID="opening-text"
				/>
				{error ? <ErrorText testID="new-session-error">{error}</ErrorText> : null}
				<Button
					title="Start"
					onPress={() => void start()}
					disabled={!text.trim()}
					busy={busy}
					testID="start-session"
				/>
			</Panel>
		</Screen>
	);
}
