/** A new session: the learner writes what to learn; the Mac creates the session. */
import { router } from "expo-router";
import { useState } from "react";

import { Button, ErrorBanner, Field, Screen, Section } from "@/components/ui";
import { useMacFetch } from "@/lib/connection-context";
import { startSession } from "@/lib/sessions";
import { describeError, type UserMessage } from "@/lib/user-error";

export default function NewSessionScreen() {
	const macFetch = useMacFetch();
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<UserMessage | null>(null);

	async function start() {
		setBusy(true);
		setError(null);
		try {
			const id = await startSession(macFetch, text);
			router.replace({ pathname: "/session/[id]", params: { id } });
		} catch (e) {
			setError(describeError(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Screen>
			<Section title="What do you want to learn?" first testID="new-session-prompt">
				<Field
					value={text}
					onChangeText={setText}
					label="What do you want to learn?"
					placeholder="For example: how the tides work"
					multiline
					testID="opening-text"
				/>
				{error ? <ErrorBanner testID="new-session-error" text={error} /> : null}
				<Button
					title="Start"
					onPress={() => void start()}
					disabled={!text.trim()}
					busy={busy}
					testID="start-session"
				/>
			</Section>
		</Screen>
	);
}
