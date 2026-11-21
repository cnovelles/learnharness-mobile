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
	isAtEnd,
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
import { perf } from "@/lib/perf";
import { PHASE_LABEL, latestPlanTree, planSteps } from "@/lib/plan";
import type { SessionRecord } from "@/lib/sessions";
import { phaseAt3Lh, type Phase3 } from "@/lib/shared";
import { revealPlan } from "@/lib/reveal";
import { transcriptRows } from "@/lib/transcript";
import {
	earlierStart,
	keepWindow,
	laterEnd,
	messageRow,
	openWindow,
	wantsEarlier,
	wantsLater,
	type PageWindow,
} from "@/lib/transcript-window";
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

/** Keep the visible row in place when older rows come in above it (index 0 is EarlierLine). */
const MVCP = { minIndexForVisible: 1 };

/**
 * The top of the page window: older rows are in the record but not drawn
 * yet. The next page comes in when the reader scrolls near it (D-014).
 */
function EarlierLine({ shown }: { shown: boolean }) {
	const c = usePalette();
	// Always mounted, so the rows keep their child index for maintainVisibleContentPosition.
	if (!shown) return <View />;
	return (
		<View style={styles.earlier} testID="earlier-rows">
			<Spinner />
			<Text style={[LABEL, { color: c.muted }]}>Loading earlier messages</Text>
		</View>
	);
}

/**
 * The bottom of a window that a graph link opened (issue 08 slice C2):
 * later rows are in the record but not drawn yet. The next page comes in
 * when the reader scrolls near it.
 */
function LaterLine() {
	const c = usePalette();
	return (
		<View style={styles.later} testID="later-rows">
			<Spinner />
			<Text style={[LABEL, { color: c.muted }]}>Loading later messages</Text>
		</View>
	);
}

function confirmStop(onStop: () => void) {
	Alert.alert("Stop this turn?", "The partial answer stays.", [
		{ text: "Cancel", style: "cancel" },
		{ text: "Stop", style: "destructive", onPress: onStop },
	]);
}

function SessionBody({
	record,
	messageId,
}: {
	record: SessionRecord;
	/** A graph link: open at this message (issue 08 slice C2). */
	messageId: string | null;
}) {
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
	// The page window (issue 21 slice D, D-014): draw the last page first,
	// and one more page of older rows near the top. The record keeps all rows.
	// A graph link (issue 08 slice C2) opens one page from its message's row,
	// and later pages come in near the bottom. A message that is not in the
	// record gives the normal open (state 15).
	const [openRow] = useState(() => messageRow(rows, state.messages, messageId));
	const [pageWindow, setPageWindow] = useState<PageWindow>(() => openWindow(rows.length, openRow));
	const { start, end } = keepWindow(pageWindow, rows.length);
	// One page at a time: the next page waits for the content to grow.
	const pageAsked = useRef(false);
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
	// They wait until the open has jumped to the end (D-014).
	const [viewport] = useState(() => createIslandViewport({ waiting: true }));
	// New content scrolls the transcript to the end only when the reader is
	// at the end. An island that starts near the screen changes its height:
	// that must not pull a reader who scrolled up back to the end.
	// At a graph link's message, the transcript does not follow the end.
	const [follow] = useState(() => createEndFollow({ atEnd: openRow === null }));
	// The perf marks of the open (issue 21 slice A): the first commit of the
	// transcript, the reveal idle, and then the first moment at the end.
	const shape = useRef<ScrollMetrics>({ offset: 0, visible: 0, content: 0 });
	const idleSeen = useRef(false);
	const checkEnd = () => {
		const m = shape.current;
		if (idleSeen.current && isAtEnd(m.offset, m.visible, m.content)) perf.mark(record.id, "atEnd");
	};
	useEffect(() => perf.mark(record.id, "drawn"), [record.id]);
	const onRevealIdle = () => {
		follow.revealIdle();
		idleSeen.current = true;
		perf.mark(record.id, "idle");
		checkEnd();
	};
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
	const checkEarlier = () => {
		if (pageAsked.current || !wantsEarlier(shape.current, start)) return;
		pageAsked.current = true;
		setPageWindow({ start: earlierStart(start), end });
	};
	const checkLater = () => {
		if (pageAsked.current || end === null || !wantsLater(shape.current, end)) return;
		pageAsked.current = true;
		setPageWindow({ start, end: laterEnd(end, rows.length) });
	};
	const onTranscriptScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const m = metrics(event);
		shape.current = m;
		follow.scrolled(m);
		checkLatest(m);
		viewport.notify();
		checkEnd();
		checkEarlier();
		checkLater();
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
		// From a graph link's window: draw the last page again.
		if (end !== null) setPageWindow(openWindow(rows.length, null));
		scroll.current?.scrollToEnd({ animated: true });
	};
	// A send from a graph link's window goes to the last page, so the new turn shows.
	const sendText = (text: string) => {
		if (end !== null) goToLatest();
		return session.sendText(text);
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
	// The lines and the dock under the transcript.
	const tail = running || compacting || !!banner || (!running && (!!pending || !!malformed));
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
						// Older rows come in above the reader: keep the visible row in
						// place. Index 0 is the "earlier messages" line.
						maintainVisibleContentPosition={MVCP}
						onContentSizeChange={(_w, h) => {
							shape.current = { ...shape.current, content: h };
							pageAsked.current = false;
							// The opening jumps to the end with no motion (D-014).
							if (follow.follows()) scroll.current?.scrollToEnd({ animated: !follow.opening() });
							// The islands measure after the frame of the jump.
							if (viewport.waiting()) requestAnimationFrame(viewport.start);
							viewport.notify();
							checkEnd();
							checkEarlier();
							checkLater();
						}}
						onScroll={onTranscriptScroll}
						onScrollBeginDrag={onDragStart}
						onScrollEndDrag={onDragEnd}
						onMomentumScrollEnd={onMomentumEnd}
						onScrollToTop={follow.toTop}
						onLayout={(event) => {
							shape.current = { ...shape.current, visible: event.nativeEvent.layout.height };
							viewport.notify();
							checkEnd();
						}}
						scrollEventThrottle={100}
					>
						<EarlierLine shown={start > 0} />
						<IslandViewportContext.Provider value={viewport}>
							<RevealProvider onIdle={onRevealIdle} hold={false}>
								<Transcript rows={rows} start={start} end={end} onOpenPlan={openPlan} />
							</RevealProvider>
						</IslandViewportContext.Provider>
						{end !== null ? <LaterLine /> : null}
						{tail ? (
							<View style={styles.tail}>
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
											The teacher&apos;s question was not complete. Ask the teacher to write it
											again.
										</Body>
										<Button
											title="Ask again"
											onPress={() => void session.retryQuestion()}
											testID="retry-question"
										/>
									</Panel>
								) : null}
							</View>
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
							onSend={sendText}
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
	const { id, message } = useLocalSearchParams<{ id: string; message?: string }>();
	const macFetch = useMacFetch();
	// Before the record read starts (the effects run in order): an open that
	// no tap started (a new session, a link) starts here.
	useEffect(() => {
		const chatId = String(id);
		perf.ensureOpen(chatId);
		return () => perf.leave(chatId);
	}, [id]);
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
				<SessionBody
					key={load.record.id}
					record={load.record}
					messageId={typeof message === "string" && message ? message : null}
				/>
			)}
		</>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	// No gap: the rows are direct children and set their own space (D-014).
	content: { padding: SPACE.lg, flexGrow: 1 },
	earlier: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: SPACE.sm,
		paddingBottom: SPACE.md,
	},
	later: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: SPACE.sm,
		paddingTop: SPACE.md,
	},
	tail: { gap: SPACE.lg, paddingTop: SPACE.lg },
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
