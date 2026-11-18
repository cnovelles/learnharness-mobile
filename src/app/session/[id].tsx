/**
 * One session on the Mac (mode 1): the transcript, the question dock when a
 * question waits, and a text field when the teacher waits for text. The
 * shared SessionModel streams the turn (src/lib/use-session.ts).
 *
 * The header shows the title, the phase and the Plan chip when a lesson map
 * exists (header A, user decision 2026-11-15). While a turn runs, the
 * composer sends steers, and with an empty field its button is Stop, as on
 * the desktop (user decision 2026-11-15). One banner shows the session's errors.
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
	TextInput,
	View,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
	createEndFollow,
	showsLatest,
	createIslandViewport,
	IslandViewportContext,
	type ScrollMetrics,
} from "@/components/island-viewport";
import {
	DictationProblemLine,
	DictationRow,
	MicButton,
	useDictationInput,
	useOrphanText,
} from "@/components/dictation";
import { PlanSheet } from "@/components/plan-sheet";
import { QuestionDock } from "@/components/question-dock";
import { PracticeDock } from "@/components/practice-dock";
import { RevealProvider } from "@/components/reveal";
import { Transcript } from "@/components/transcript";
import {
	alpha,
	Body,
	Button,
	ErrorBanner,
	FONT,
	Icon,
	LABEL,
	Loading,
	Panel,
	Screen,
	Spinner,
	StatusLine,
	usePalette,
} from "@/components/ui";
import { useMacFetch } from "@/lib/connection-context";
import { appendDictation } from "@/lib/dictation";
import { PHASE_LABEL, latestPlanTree, planSteps } from "@/lib/plan";
import type { SessionRecord } from "@/lib/sessions";
import { phaseAt3Lh, type Phase3 } from "@/lib/shared";
import { revealPlan } from "@/lib/reveal";
import { transcriptRows } from "@/lib/transcript";
import { COMPACTING, useSessionModel, useSessionRecord } from "@/lib/use-session";
import { SPACE } from "@/components/spacing";

function Composer({
	onSend,
	onStop,
	initialText,
	steer,
	waiting,
}: {
	onSend: (text: string) => Promise<boolean>;
	/** A turn runs: an empty field turns the send button into Stop (as the desktop). */
	onStop?: () => void;
	/** A text that the Mac did not accept, shown again so the user can send it. */
	initialText: string;
	/** A turn runs: the text goes to that turn (a steer). */
	steer: boolean;
	/** The Mac compacts: sends wait. */
	waiting: boolean;
}) {
	const c = usePalette();
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
	const addText = (dictated: string) => setText((current) => appendDictation(current, dictated));
	const dictation = useDictationInput(addText);
	// Text from a run whose dock closed comes here (issue 07).
	useOrphanText(addText);
	const stop = steer && onStop && !text.trim() && !sending;
	const canSend = !!text.trim() && !waiting && !sending;
	if (dictation.active) {
		return (
			<View style={[styles.composer, { backgroundColor: c.panel, borderColor: c.line }]}>
				<DictationRow input={dictation} />
			</View>
		);
	}
	return (
		<>
			<DictationProblemLine input={dictation} />
			<View style={[styles.composer, { backgroundColor: c.panel, borderColor: c.line }]}>
				<TextInput
					testID="composer"
					accessibilityLabel="Message"
					value={text}
					onChangeText={setText}
					placeholder="Ask, answer, or steer the lesson…"
					placeholderTextColor={c.muted}
					multiline
					style={[styles.composerInput, { color: c.text }]}
				/>
				<MicButton input={dictation} />
				{stop ? (
					<Pressable
						testID="stop-turn"
						accessibilityRole="button"
						accessibilityLabel="Stop this turn"
						onPress={() => confirmStop(onStop)}
						style={({ pressed }) => [
							styles.composerButton,
							{ backgroundColor: pressed ? c.hover : c.panel },
						]}
					>
						<Icon name="square.fill" size={14} color={c.text} />
					</Pressable>
				) : (
					<Pressable
						testID="send"
						accessibilityRole="button"
						accessibilityLabel="Send"
						accessibilityState={{ disabled: !canSend, busy: sending }}
						disabled={!canSend}
						onPress={() => void send()}
						style={({ pressed }) => [
							styles.composerButton,
							{
								backgroundColor: c.primary,
								opacity: !canSend && !sending ? 0.4 : pressed ? 0.9 : 1,
							},
						]}
					>
						{sending ? (
							<Spinner color={c.onPrimary} />
						) : (
							<Icon name="arrow.turn.down.left" size={18} color={c.onPrimary} />
						)}
					</Pressable>
				)}
			</View>
		</>
	);
}

/**
 * The practice pause (issue 06 slice D, user decision 2026-11-15, option
 * B): a wide green button over the composer. The desktop morphs its send
 * button; on the phone both stay, so a question about the last problem
 * and the next problem are each one tap. The green is the app's
 * correct-answer color, with the page color for the text (the desktop's
 * `bg-success text-background`). It waits while the Mac compacts (the
 * screen's compacting line says why) and while a dismissal is on its way.
 */
function NextProblemButton({
	onPress,
	waiting,
}: {
	onPress: () => Promise<boolean>;
	waiting: boolean;
}) {
	const c = usePalette();
	const [sending, setSending] = useState(false);
	async function press() {
		if (sending || waiting) return;
		setSending(true);
		try {
			await onPress();
		} finally {
			setSending(false);
		}
	}
	return (
		<Pressable
			testID="next-problem"
			accessibilityRole="button"
			accessibilityLabel="Next problem"
			accessibilityState={{ disabled: waiting || sending, busy: sending }}
			disabled={waiting || sending}
			onPress={() => void press()}
			style={({ pressed }) => [
				styles.nextProblem,
				{ backgroundColor: c.ok, opacity: waiting ? 0.4 : pressed ? 0.85 : 1 },
			]}
		>
			{sending ? (
				<Spinner color={c.bg} />
			) : (
				<>
					<Text style={[LABEL, { color: c.bg }]}>NEXT PROBLEM</Text>
					<Icon name="arrow.right" size={14} color={c.bg} />
				</>
			)}
		</Pressable>
	);
}

/**
 * The header title: the session title and the phase under it (the desktop
 * PhaseChip). A practice session has no phases: the desktop shows a quiet
 * "Practice" tag with a dumbbell instead.
 */
function HeaderTitle({
	title,
	phase,
	practice,
}: {
	title: string;
	phase: Phase3;
	practice: boolean;
}) {
	const c = usePalette();
	return (
		<View style={styles.headerTitle}>
			<Text style={[styles.headerName, { color: c.text }]} numberOfLines={1}>
				{title}
			</Text>
			{practice ? (
				<View style={styles.practiceTag}>
					<Icon name="dumbbell" size={11} color={c.muted} />
					<Text style={[LABEL, { color: c.muted }]} testID="session-phase">
						PRACTICE
					</Text>
				</View>
			) : (
				<Text style={[LABEL, { color: c.muted }]} testID="session-phase">
					{PHASE_LABEL[phase].toUpperCase()}
				</Text>
			)}
		</View>
	);
}

/** The desktop's Plan chip: a pill with the waypoints mark and PLAN. */
function PlanChip({ onPress }: { onPress: () => void }) {
	const c = usePalette();
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel="Open the lesson plan"
			hitSlop={SPACE.sm}
			testID="open-plan"
			style={({ pressed }) => [
				styles.planChip,
				{ borderColor: alpha(c.line, 0.8), backgroundColor: pressed ? c.hover : "transparent" },
			]}
		>
			<Icon name="point.topleft.down.to.point.bottomright.curvepath" size={13} color={c.text} />
			<Text style={[LABEL, { color: c.muted }]}>Plan</Text>
		</Pressable>
	);
}

/** "↓ Latest": over the transcript, above the composer (bug 2026-11-17). */
function LatestButton({ onPress }: { onPress: () => void }) {
	const c = usePalette();
	return (
		<View pointerEvents="box-none" style={styles.latestRow}>
			<Pressable
				onPress={onPress}
				accessibilityRole="button"
				accessibilityLabel="Go to the latest message"
				hitSlop={SPACE.sm}
				testID="go-latest"
				style={({ pressed }) => [
					styles.latest,
					{ borderColor: c.line, backgroundColor: pressed ? c.hover : c.panel },
				]}
			>
				<Icon name="arrow.down" size={13} color={c.text} />
				<Text style={[LABEL, { color: c.text }]}>Latest</Text>
			</Pressable>
		</View>
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
			headerTitle: () => (
				<HeaderTitle title={record.title} phase={phase} practice={record.kind === "practice"} />
			),
			headerRight: hasPlan ? () => <PlanChip onPress={openPlan} /> : undefined,
		}),
		[record.title, record.kind, phase, hasPlan, openPlan],
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
	// "↓ Latest" (bug 2026-11-17): more than one screen up, and no follow.
	const [latest, setLatest] = useState(false);
	const checkLatest = (m: ScrollMetrics) => setLatest(!follow.follows() && showsLatest(m));
	const onTranscriptScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const m = metrics(event);
		follow.scrolled(m);
		checkLatest(m);
		viewport.notify();
	};
	const onDragStart = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
		follow.dragStart(metrics(event));
	const onDragEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const v = event.nativeEvent.velocity;
		const m = metrics(event);
		follow.dragEnd(m, Math.abs(v?.y ?? 0) > 0.01);
		checkLatest(m);
	};
	const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const m = metrics(event);
		follow.momentumEnd(m);
		checkLatest(m);
	};
	const goToLatest = () => {
		follow.toEnd();
		setLatest(false);
		scroll.current?.scrollToEnd({ animated: true });
	};
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
				<View style={styles.screen}>
					<ScrollView
						ref={scroll}
						testID="transcript-scroll"
						contentContainerStyle={styles.content}
						keyboardShouldPersistTaps="handled"
						onContentSizeChange={() => {
							if (follow.follows()) scroll.current?.scrollToEnd({ animated: true });
							viewport.notify();
						}}
						onScroll={onTranscriptScroll}
						onScrollBeginDrag={onDragStart}
						onScrollEndDrag={onDragEnd}
						onMomentumScrollEnd={onMomentumEnd}
						onScrollToTop={follow.toTop}
						onLayout={viewport.notify}
						scrollEventThrottle={100}
					>
						<IslandViewportContext.Provider value={viewport}>
							<RevealProvider onIdle={follow.revealIdle}>
								<Transcript rows={rows} onOpenPlan={openPlan} />
							</RevealProvider>
						</IslandViewportContext.Provider>
						{running ? (
							<StatusLine testID="turn-running">
								{state.status === "submitted" ? "Sending…" : "Thinking…"}
							</StatusLine>
						) : null}
						{compacting ? <StatusLine testID="compacting">{COMPACTING}</StatusLine> : null}
						{banner ? (
							<ErrorBanner
								text={banner.text}
								testID="session-error"
								actions={
									<>
										{banner.retry ? (
											<Button
												title="Try again"
												kind="plain"
												size="sm"
												onPress={() => void session.retryBanner()}
												disabled={compacting && banner.retry !== "sync"}
												testID="retry-turn"
											/>
										) : null}
										<Button
											title="Close"
											kind="plain"
											size="sm"
											onPress={session.closeBanner}
											testID="clear-error"
										/>
									</>
								}
							/>
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
					{latest ? <LatestButton onPress={goToLatest} /> : null}
				</View>
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
					{session.problem ? (
						<PracticeDock
							key={`${session.problem.toolCallId}-${session.unsentThinking ?? ""}`}
							problemCallId={session.problem.toolCallId}
							input={session.problem.input}
							plugin={!!session.problem.pluginProblem}
							initialText={session.unsentThinking ?? ""}
							waiting={compacting}
							onSubmit={(text) => session.submitThinking(session.problem!.toolCallId, text)}
							onDismiss={() => void session.dismissProblem()}
						/>
					) : null}
					{session.nextReady && !session.problem ? (
						<NextProblemButton
							onPress={session.sendNext}
							waiting={compacting || session.dismissing}
						/>
					) : null}
					{session.problem ? null : running ||
					  (!pending && (state.status === "ready" || session.unsentText !== null)) ? (
						<Composer
							key={session.unsentText ?? ""}
							onSend={session.sendText}
							onStop={() => void stopTurn()}
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
					<ErrorBanner
						text={load.userText}
						testID="session-load-error"
						actions={
							<Button
								title="Try again"
								kind="plain"
								size="sm"
								onPress={reload}
								testID="reload-session"
							/>
						}
					/>
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
	practiceTag: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
	/** Header A (user decision 2026-11-15): the title font at 17 pt in the bar. */
	headerName: { fontSize: 17, lineHeight: 22, fontFamily: FONT.title, fontWeight: "700" },
	latestRow: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: SPACE.sm,
		alignItems: "center",
	},
	latest: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.xs,
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: SPACE.md,
		minHeight: 32,
	},
	planChip: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.xs,
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: SPACE.sm,
		minHeight: 24,
	},
	/** The desktop composer: rounded-2xl, the card fill, and the app's only shadow. */
	composer: {
		flexDirection: "row",
		alignItems: "flex-end",
		gap: SPACE.sm,
		padding: SPACE.sm,
		borderWidth: 1,
		borderRadius: 16,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 10 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
	},
	composerInput: {
		flex: 1,
		minHeight: 40,
		maxHeight: 192,
		paddingHorizontal: SPACE.sm,
		paddingTop: SPACE.sm,
		paddingBottom: SPACE.sm,
		fontFamily: FONT.prose,
		fontSize: 16,
		lineHeight: 20,
	},
	/** The composer button's height and radius, the full width. */
	nextProblem: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: SPACE.xs,
		minHeight: 44,
		borderRadius: 8,
	},
	/** 40 x 40; the radius is the shell's 16 minus its 8 padding. */
	composerButton: {
		width: 40,
		height: 40,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
	},
});
