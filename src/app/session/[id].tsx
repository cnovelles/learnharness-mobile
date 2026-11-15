/**
 * One session on the Mac (mode 1): the transcript, the question dock when a
 * question waits, and a text field when the teacher waits for text. The
 * shared SessionModel streams the turn (src/lib/use-session.ts).
 *
 * The header shows the phase, "Plan" when a lesson map exists, and Stop
 * while a turn runs (user decision 2026-11-14). While a turn runs, the
 * composer sends steers. One banner shows the session's errors.
 */
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { useHeaderHeight } from "expo-router/react-navigation";
import {
	Alert,
	Keyboard,
	KeyboardAvoidingView,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
	createEndFollow,
	createIslandViewport,
	IslandViewportContext,
	type ScrollMetrics,
} from "@/components/island-viewport";
import { PlanSheet } from "@/components/plan-sheet";
import { QuestionDock } from "@/components/question-dock";
import { Transcript } from "@/components/transcript";
import {
	Body,
	Button,
	ErrorText,
	Field,
	Loading,
	Panel,
	Screen,
	usePalette,
} from "@/components/ui";
import { useMacFetch } from "@/lib/connection-context";
import { PHASE_LABEL, latestPlanTree, planSteps } from "@/lib/plan";
import type { SessionRecord } from "@/lib/sessions";
import { phaseAt3Lh, type Phase3 } from "@/lib/shared";
import { revealPlan } from "@/lib/reveal";
import { transcriptRows } from "@/lib/transcript";
import { COMPACTING, useSessionModel, useSessionRecord } from "@/lib/use-session";
import { SPACE } from "@/components/spacing";

function Composer({
	onSend,
	initialText,
	steer,
	waiting,
}: {
	onSend: (text: string) => Promise<boolean>;
	/** A text that the Mac did not accept, shown again so the user can send it. */
	initialText: string;
	/** A turn runs: the text goes to that turn (a steer). */
	steer: boolean;
	/** The Mac compacts: sends wait. */
	waiting: boolean;
}) {
	const [text, setText] = useState(initialText);
	const [sending, setSending] = useState(false);
	async function send() {
		const value = text.trim();
		if (!value || sending || waiting) return;
		setSending(true);
		try {
			// Clear the field only when the Mac accepted the text.
			if (await onSend(value)) setText("");
		} finally {
			setSending(false);
		}
	}
	return (
		<Panel>
			<Field
				value={text}
				onChangeText={setText}
				label="Message"
				placeholder={steer ? "Add to the teacher's turn" : "Write to the teacher"}
				multiline
				testID="composer"
			/>
			<Button
				title="Send"
				onPress={() => void send()}
				disabled={!text.trim() || waiting}
				busy={sending}
				testID="send"
			/>
		</Panel>
	);
}

/** The header title: the session title and the phase under it (the desktop PhaseChip). */
function HeaderTitle({ title, phase }: { title: string; phase: Phase3 }) {
	const c = usePalette();
	return (
		<View style={styles.headerTitle}>
			<Text style={[styles.headerName, { color: c.text }]} numberOfLines={1}>
				{title}
			</Text>
			<Text style={[styles.headerPhase, { color: c.muted }]} testID="session-phase">
				{PHASE_LABEL[phase].toUpperCase()}
			</Text>
		</View>
	);
}

function HeaderButton({
	title,
	label,
	onPress,
	danger,
	testID,
}: {
	title: string;
	label: string;
	onPress: () => void;
	danger?: boolean;
	testID: string;
}) {
	const c = usePalette();
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={label}
			hitSlop={8}
			testID={testID}
		>
			<Text style={{ color: danger ? c.danger : c.accent, fontSize: 17 }}>{title}</Text>
		</Pressable>
	);
}

function confirmStop(onStop: () => void) {
	Alert.alert("Stop this turn?", "The partial answer stays.", [
		{ text: "Cancel", style: "cancel" },
		{ text: "Stop", style: "destructive", onPress: onStop },
	]);
}

function SessionBody({ record }: { record: SessionRecord }) {
	const macFetch = useMacFetch();
	const c = usePalette();
	const session = useSessionModel(record, macFetch);
	const { state, pending, malformed, running, compacting, banner } = session;
	const rows = useMemo(
		() =>
			transcriptRows(state.messages, {
				malformedCallIds: new Set(malformed ? [malformed.toolCallId] : []),
				dockCallId: !running && pending ? pending.toolCallId : undefined,
			}),
		[state.messages, malformed, pending, running],
	);
	const phase = useMemo(() => phaseAt3Lh(state.nativeMessages), [state.nativeMessages]);
	const tree = useMemo(() => latestPlanTree(state.messages), [state.messages]);
	const [planOpen, setPlanOpen] = useState(false);
	const steps = useMemo(
		() => (planOpen && tree ? planSteps(tree, state.nativeMessages) : null),
		[planOpen, tree, state.nativeMessages],
	);
	const openPlan = useCallback(() => setPlanOpen(true), []);
	const stopTurn = session.stopTurn;
	const hasPlan = tree !== null;
	// Stable options: new header functions on each render make the
	// navigator set the options again and again.
	const headerOptions = useMemo(
		() => ({
			title: record.title,
			headerTitle: () => <HeaderTitle title={record.title} phase={phase} />,
			headerRight:
				hasPlan || running
					? () => (
							<View style={styles.headerButtons}>
								{running ? (
									<HeaderButton
										title="Stop"
										label="Stop this turn"
										danger
										onPress={() => confirmStop(() => void stopTurn())}
										testID="stop-turn"
									/>
								) : null}
								{hasPlan ? (
									<HeaderButton
										title="Plan"
										label="Open the lesson plan"
										onPress={openPlan}
										testID="open-plan"
									/>
								) : null}
							</View>
						)
					: undefined,
		}),
		[record.title, phase, hasPlan, running, stopTurn, openPlan],
	);
	const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
	// Math and Mermaid islands start their WebView only near the screen.
	const [viewport] = useState(createIslandViewport);
	// New content scrolls the transcript to the end only when the reader is
	// at the end. An island that starts near the screen changes its height:
	// that must not pull a reader who scrolled up back to the end.
	const [follow] = useState(createEndFollow);
	const metrics = (event: NativeSyntheticEvent<NativeScrollEvent>): ScrollMetrics => {
		const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
		return {
			offset: contentOffset.y,
			visible: layoutMeasurement.height,
			content: contentSize.height,
		};
	};
	const onTranscriptScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		follow.scrolled(metrics(event));
		viewport.notify();
	};
	const onDragEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const v = event.nativeEvent.velocity;
		follow.dragEnd(metrics(event), Math.abs(v?.y ?? 0) > 0.01);
	};
	const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
		follow.momentumEnd(metrics(event));
	// The keyboard covers the screen on iOS: pad the view by its height
	// (Expo keyboard guide). The offset is the header height.
	const headerHeight = useHeaderHeight();
	// A field in the dock is near the end of the transcript: show it when
	// the keyboard opens.
	useEffect(() => {
		const sub = Keyboard.addListener("keyboardDidShow", () =>
			scroll.current?.scrollToEnd({ animated: true }),
		);
		return () => sub.remove();
	}, []);
	// The check that the learner opened. It stays open while a refused answer is sent again.
	const [openedKey, setOpenedKey] = useState<string | null>(null);

	return (
		<SafeAreaView
			style={[styles.screen, { backgroundColor: c.bg }]}
			edges={["bottom", "left", "right"]}
		>
			<Stack.Screen options={headerOptions} />
			<PlanSheet visible={planOpen} steps={steps} tree={tree} onClose={() => setPlanOpen(false)} />
			<KeyboardAvoidingView
				behavior="padding"
				keyboardVerticalOffset={headerHeight}
				style={styles.screen}
			>
				<ScrollView
					ref={scroll}
					contentContainerStyle={styles.content}
					keyboardShouldPersistTaps="handled"
					onContentSizeChange={() => {
						if (follow.follows()) scroll.current?.scrollToEnd({ animated: true });
						viewport.notify();
					}}
					onScroll={onTranscriptScroll}
					onScrollBeginDrag={follow.dragStart}
					onScrollEndDrag={onDragEnd}
					onMomentumScrollEnd={onMomentumEnd}
					onScrollToTop={follow.toTop}
					onLayout={viewport.notify}
					scrollEventThrottle={100}
				>
					<IslandViewportContext.Provider value={viewport}>
						<Transcript rows={rows} onOpenPlan={openPlan} />
					</IslandViewportContext.Provider>
					{running ? (
						<Body muted testID="turn-running">
							{state.status === "submitted" ? "Sending…" : "The teacher is writing…"}
						</Body>
					) : null}
					{compacting ? (
						<Body muted testID="compacting">
							{COMPACTING}
						</Body>
					) : null}
					{banner ? (
						<Panel>
							<ErrorText testID="session-error">{banner.text}</ErrorText>
							<View style={styles.row}>
								{banner.retry ? (
									<Button
										title="Try again"
										onPress={() => void session.retryBanner()}
										disabled={compacting && banner.retry !== "sync"}
										testID="retry-turn"
									/>
								) : null}
								<Button
									title="Close"
									kind="plain"
									onPress={session.closeBanner}
									testID="clear-error"
								/>
							</View>
						</Panel>
					) : null}
					{!running && pending ? (
						<QuestionDock
							key={pending.key}
							call={pending}
							reveal={revealPlan(state.nativeMessages, pending)}
							opened={openedKey === pending.key}
							onOpen={() => setOpenedKey(pending.key)}
							draft={session.draft(pending.key)}
							onDraft={(draft) => session.saveDraft(pending.key, draft)}
							onSubmit={(answer) => session.answer(pending.toolCallId, answer, pending.key)}
							waiting={compacting}
						/>
					) : null}
					{!running && malformed ? (
						<Panel>
							<Body>
								The teacher&apos;s question was not complete. Ask the teacher to write it again.
							</Body>
							<Button
								title="Ask again"
								onPress={() => void session.retryQuestion()}
								testID="retry-question"
							/>
						</Panel>
					) : null}
				</ScrollView>
				{/* The composer stays under the transcript, above the keyboard. */}
				<View style={styles.bottom}>
					{session.queuedSteers.length > 0 ? (
						<View testID="queued-steers" style={{ gap: SPACE.xs }}>
							{session.queuedSteers.map((q) => (
								<Body key={q.id} muted>
									Waiting for the teacher: {q.text}
								</Body>
							))}
						</View>
					) : null}
					{running || (!pending && (state.status === "ready" || session.unsentText !== null)) ? (
						<Composer
							key={session.unsentText ?? ""}
							onSend={session.sendText}
							initialText={session.unsentText ?? ""}
							steer={running}
							waiting={compacting}
						/>
					) : null}
				</View>
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}

export default function SessionScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const macFetch = useMacFetch();
	const { load, reload } = useSessionRecord(String(id), macFetch);
	return (
		<>
			{load.status !== "ready" ? <Stack.Screen options={{ title: "Session" }} /> : null}
			{load.status === "loading" ? (
				<Loading />
			) : load.status === "error" ? (
				<Screen>
					<Panel>
						<ErrorText testID="session-load-error">{load.userText}</ErrorText>
						<Button title="Try again" onPress={reload} testID="reload-session" />
					</Panel>
				</Screen>
			) : (
				<SessionBody key={load.record.id} record={load.record} />
			)}
		</>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	content: { padding: SPACE.lg, gap: SPACE.lg, flexGrow: 1 },
	row: { flexDirection: "row", gap: SPACE.md },
	bottom: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm, gap: SPACE.sm },
	headerTitle: { alignItems: "center", maxWidth: 200 },
	headerButtons: { flexDirection: "row", gap: SPACE.lg },
	headerName: { fontSize: 17, fontWeight: "600" },
	headerPhase: { fontSize: 11, fontWeight: "600", letterSpacing: 0.6 },
});
