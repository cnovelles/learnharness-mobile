/**
 * The figure and the demo of a sub-agent in the lesson (issue 19, D-017).
 * The desktop draws them in fork components/artifacts/visual-card.tsx and
 * demo-card.tsx. Layout B (user, 2026-11-23): the figure shows in the
 * lesson; the demo is a still card, and it runs in a sheet after a tap.
 *
 * Security review: docs/reviews/2026-11-23-artifact-sandbox.md. Error
 * states: docs/ISSUES.md, issue 19. No model, page or server text shows.
 */
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentRef,
	type ReactNode,
} from "react";
import { Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
	demoErrorText,
	parseDemoMessage,
	parseImageSnapshot,
	svgAspect,
	svgNaturalWidth,
	type Artifact,
	type ArtifactWhat,
} from "@/lib/artifacts";
import { DEMO_SCRIPT, FIGURE_SCRIPT, demoPage, figurePage } from "@/lib/artifact-html";
import { embedLearnerImage } from "@/lib/shared";
import { userMessage, type UserMessage } from "@/lib/user-error";

import { useNearScreenState } from "./island-viewport";
import { useReportReady } from "./reveal";
import { SPACE } from "./spacing";
import { Button, ErrorText, FONT, LABEL, TYPE, alpha, usePalette } from "./ui";
import { WebIsland } from "./web-island";
import { ExpandButton, ZoomViewer } from "./zoom-viewer";

export const MESSAGES = {
	figureUnreadable: userMessage("This figure could not be shown."),
	demoUnreadable: userMessage("This demo could not be shown."),
	figureFailed: userMessage("The figure could not be drawn."),
	demoFailed: userMessage("The demo could not be built."),
	figureTooLarge: userMessage("This figure is too large for the phone. Open it on the Mac."),
	demoTooLarge: userMessage("This demo is too large for the phone. Open it on the Mac."),
	blockedSource: userMessage(
		"This demo needs a file from the internet that the phone blocks. Open it on the Mac.",
	),
	macOnly: userMessage("This result can only be shown on the Mac."),
	figureLoad: userMessage("The phone cannot show this figure."),
	demoStopped: userMessage("This demo stopped. Try again."),
	demoError: userMessage("This demo has an error."),
	switchNotSaved: userMessage("Could not save the switch."),
	imageLoading: userMessage("Loading image…"),
	imageFailed: userMessage("The image could not be loaded."),
} as const;

/** The session that the artifacts belong to. Without it (tests, previews) the switch stays local. */
export type ArtifactActions = {
	chatId: string;
	fetch: typeof globalThis.fetch;
	/** Sends a learner message (a steer while a turn runs). True when the Mac accepts it. */
	sendText: (text: string) => Promise<boolean>;
};

const ActionsContext = createContext<ArtifactActions | null>(null);

export function ArtifactActionsProvider({
	value,
	children,
}: {
	value: ArtifactActions;
	children: ReactNode;
}) {
	return <ActionsContext value={value}>{children}</ActionsContext>;
}

/** The height of a figure WebView: between these, as the desktop demo. */
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 2400;

/**
 * The invert switch, saved on the Mac (`POST /api/chats/:id/artifact-ui`).
 * Error state 7: a write that fails puts the switch back and shows a message.
 */
function useInvert(messageId: string, initial: boolean) {
	const actions = useContext(ActionsContext);
	const [inverted, setInverted] = useState(initial);
	const [failed, setFailed] = useState(false);
	const seq = useRef(0);
	const toggle = (next: boolean) => {
		setInverted(next);
		setFailed(false);
		if (!actions) return;
		const mine = ++seq.current;
		const back = () => {
			if (seq.current !== mine) return;
			setInverted(!next);
			setFailed(true);
		};
		actions
			.fetch(`/api/chats/${encodeURIComponent(actions.chatId)}/artifact-ui`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ input: { messageId, inverted: next } }),
			})
			.then((res) => {
				if (!res.ok) back();
			}, back);
	};
	return { inverted, toggle, failed };
}

function InvertSwitch({
	value,
	onChange,
	what,
	testID,
}: {
	value: boolean;
	onChange: (next: boolean) => void;
	what: ArtifactWhat;
	testID: string;
}) {
	const c = usePalette();
	return (
		<View style={styles.switchRow}>
			{/* The desktop's half-filled disc (invert-disc.tsx). */}
			<View style={[styles.disc, { borderColor: c.muted }]}>
				<View style={[styles.discHalf, { backgroundColor: c.muted }]} />
			</View>
			<Switch
				value={value}
				onValueChange={onChange}
				accessibilityLabel={`Invert ${what} brightness`}
				trackColor={{ true: c.text, false: c.line }}
				thumbColor={value ? c.bg : "#ffffff"}
				ios_backgroundColor={c.line}
				style={styles.switch}
				testID={testID}
			/>
		</View>
	);
}

function Note({ children, testID }: { children: UserMessage; testID: string }) {
	const c = usePalette();
	return (
		<View style={[styles.note, { borderColor: c.line }]} testID={testID}>
			<Text style={[styles.noteText, { color: c.muted }]}>{children}</Text>
		</View>
	);
}

function KindLabel({ what }: { what: ArtifactWhat }) {
	const c = usePalette();
	return (
		<Text style={[LABEL, { color: c.muted }]}>
			{what === "figure" ? "FIGURE" : "INTERACTIVE DEMO"}
		</Text>
	);
}

/** One artifact row of the transcript. */
export function ArtifactRow({
	id,
	messageId,
	artifact,
}: {
	id: string;
	messageId: string;
	artifact: Artifact;
}) {
	const c = usePalette();
	const testID = `artifact-${id}`;
	switch (artifact.kind) {
		case "figure":
			return (
				<Figure
					svg={artifact.svg}
					snapshotId={artifact.snapshotId}
					messageId={messageId}
					initialInverted={artifact.inverted}
					testID={testID}
				/>
			);
		case "demo":
			return (
				<DemoCard
					title={artifact.title}
					html={artifact.html}
					messageId={messageId}
					initialInverted={artifact.inverted}
					testID={testID}
				/>
			);
		case "failed":
			return (
				<View style={[styles.card, { borderColor: c.line }]} testID={testID}>
					<View style={styles.head}>
						<KindLabel what={artifact.what} />
						<Text
							style={[styles.badge, { color: c.danger, backgroundColor: alpha(c.danger, 0.15) }]}
						>
							FAILED
						</Text>
					</View>
					<Text style={[styles.noteText, { color: c.muted }]}>
						{artifact.what === "figure" ? MESSAGES.figureFailed : MESSAGES.demoFailed}
					</Text>
				</View>
			);
		case "unreadable":
			return (
				<Note testID={testID}>
					{artifact.what === "figure" ? MESSAGES.figureUnreadable : MESSAGES.demoUnreadable}
				</Note>
			);
		case "too-large":
			return (
				<Note testID={testID}>
					{artifact.what === "figure" ? MESSAGES.figureTooLarge : MESSAGES.demoTooLarge}
				</Note>
			);
		case "blocked-source":
			return <Note testID={testID}>{MESSAGES.blockedSource}</Note>;
		case "mac-only":
			return <Note testID={testID}>{MESSAGES.macOnly}</Note>;
	}
}

type Photo = { state: "loading" } | { state: "failed" } | { state: "ready"; svg: string };

/** Error state 10: the photo of a photo figure, from the Mac. */
function usePhotoSvg(svg: string, snapshotId: string | null): Photo {
	const actions = useContext(ActionsContext);
	const [photo, setPhoto] = useState<Photo>(
		snapshotId === null
			? { state: "ready", svg }
			: actions
				? { state: "loading" }
				: { state: "failed" },
	);
	useEffect(() => {
		if (snapshotId === null || !actions) return;
		let live = true;
		actions
			.fetch(`/api/chats/${encodeURIComponent(actions.chatId)}/images/${snapshotId}`)
			.then(async (res) => {
				if (!res.ok) throw new Error("image");
				const image = parseImageSnapshot(await res.json());
				if (!image) throw new Error("image");
				if (live) setPhoto({ state: "ready", svg: embedLearnerImage(svg, image) });
			})
			.catch(() => {
				if (live) setPhoto({ state: "failed" });
			});
		return () => {
			live = false;
		};
	}, [svg, snapshotId, actions]);
	return photo;
}

function Figure({
	svg: source,
	snapshotId,
	messageId,
	initialInverted,
	testID,
}: {
	svg: string;
	snapshotId: string | null;
	messageId: string;
	initialInverted: boolean;
	testID: string;
}) {
	const c = usePalette();
	const slot = useRef<ComponentRef<typeof View>>(null);
	const nearState = useNearScreenState(slot);
	const near = nearState === "near";
	const invertible = snapshotId === null;
	const { inverted, toggle, failed: switchFailed } = useInvert(messageId, initialInverted);
	const photo = usePhotoSvg(source, snapshotId);
	const svg = photo.state === "ready" ? photo.svg : null;
	const [loadFailed, setLoadFailed] = useState(false);
	const [height, setHeight] = useState<number | null>(null);
	const [width, setWidth] = useState<number | null>(null);
	const [viewing, setViewing] = useState(false);
	const natural = useMemo(() => svgNaturalWidth(source), [source]);
	const aspect = useMemo(() => svgAspect(source), [source]);
	const html = useMemo(() => (svg === null ? null : figurePage(svg, natural)), [svg, natural]);
	const zoomHtml = useMemo(
		() => (svg === null ? null : figurePage(svg, natural, { zoom: true })),
		[svg, natural],
	);
	const data = useMemo(() => ({ inverted: invertible && inverted }), [invertible, inverted]);
	// Before the page reports a height: the height from the SVG's own size.
	const guess =
		width !== null && aspect !== null
			? Math.round(Math.min(width, natural ?? width) * aspect)
			: null;
	const shown = height ?? guess;
	useReportReady(loadFailed || height !== null || nearState === "far" || photo.state === "failed");

	let body: ReactNode;
	if (photo.state === "loading")
		body = <Text style={[styles.noteText, { color: c.muted }]}>{MESSAGES.imageLoading}</Text>;
	else if (photo.state === "failed")
		body = <ErrorText testID={`${testID}-photo-error`}>{MESSAGES.imageFailed}</ErrorText>;
	else if (loadFailed)
		body = <ErrorText testID={`${testID}-error`}>{MESSAGES.figureLoad}</ErrorText>;
	else if (near && html !== null)
		body = (
			<WebIsland
				html={html}
				script={FIGURE_SCRIPT}
				data={data}
				live
				minHeight={Math.min(Math.max(guess ?? MIN_HEIGHT, MIN_HEIGHT), MAX_HEIGHT)}
				maxHeight={MAX_HEIGHT}
				initialHeight={shown}
				onHeight={setHeight}
				onFail={() => setLoadFailed(true)}
				testID={`${testID}-webview`}
			/>
		);
	// Far from the screen: no WebView (issue 21), only the space it takes.
	else body = <View style={{ height: shown ?? MIN_HEIGHT }} />;

	return (
		<View
			ref={slot}
			collapsable={false}
			onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
			testID={testID}
		>
			<View>
				{body}
				{html !== null && !loadFailed ? (
					<ExpandButton
						onPress={() => setViewing(true)}
						what="figure"
						testID={`${testID}-expand`}
					/>
				) : null}
			</View>
			<View style={styles.caption}>
				<KindLabel what="figure" />
				<View style={styles.controls}>
					{invertible ? (
						<InvertSwitch
							value={inverted}
							onChange={toggle}
							what="figure"
							testID={`${testID}-invert`}
						/>
					) : null}
				</View>
			</View>
			{switchFailed ? (
				<ErrorText testID={`${testID}-switch-error`}>{MESSAGES.switchNotSaved}</ErrorText>
			) : null}
			{viewing && zoomHtml !== null ? (
				<ZoomViewer visible kind="FIGURE" onClose={() => setViewing(false)}>
					{(fitKey) => (
						<WebIsland
							key={fitKey}
							html={zoomHtml}
							script={FIGURE_SCRIPT}
							data={data}
							minHeight={MIN_HEIGHT}
							maxHeight={MAX_HEIGHT}
							onFail={() => setViewing(false)}
							fill
							testID={`${testID}-zoom`}
						/>
					)}
				</ZoomViewer>
			) : null}
		</View>
	);
}

function DemoCard({
	title,
	html,
	messageId,
	initialInverted,
	testID,
}: {
	title: string;
	html: string;
	messageId: string;
	initialInverted: boolean;
	testID: string;
}) {
	const c = usePalette();
	const actions = useContext(ActionsContext);
	const { inverted, toggle, failed: switchFailed } = useInvert(messageId, initialInverted);
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [stopped, setStopped] = useState(false);
	const [run, setRun] = useState(0);
	const [sent, setSent] = useState(false);
	const [sending, setSending] = useState(false);
	const page = useMemo(() => demoPage(html), [html]);
	const data = useMemo(() => ({ inverted }), [inverted]);
	useReportReady(true);

	const start = () => {
		setStopped(false);
		setRun((n) => n + 1);
		setOpen(true);
	};
	const send = () => {
		if (!actions || error === null || sending) return;
		setSending(true);
		void actions.sendText(demoErrorText(title, error)).then((ok) => {
			setSending(false);
			// A text that the Mac did not take shows the session's own unsent banner.
			if (ok) setSent(true);
		});
	};

	const header = (
		<View style={styles.head}>
			<View style={styles.titleRow}>
				<KindLabel what="demo" />
				<Text numberOfLines={1} style={[styles.title, { color: c.text }]}>
					{title}
				</Text>
			</View>
			<InvertSwitch value={inverted} onChange={toggle} what="demo" testID={`${testID}-invert`} />
		</View>
	);
	const errorChip =
		error !== null ? (
			<View
				style={[styles.chip, { backgroundColor: alpha(c.danger, 0.1) }]}
				testID={`${testID}-page-error`}
			>
				<ErrorText>{MESSAGES.demoError}</ErrorText>
				{actions ? (
					sent ? (
						<Text style={[styles.noteText, { color: c.muted }]}>Sent to the teacher.</Text>
					) : (
						<Button
							title="Send to teacher"
							kind="danger"
							size="sm"
							onPress={send}
							busy={sending}
							testID={`${testID}-send-error`}
						/>
					)
				) : null}
			</View>
		) : null;

	return (
		<View style={[styles.card, { borderColor: c.line }]} testID={testID}>
			{header}
			{errorChip}
			{stopped ? (
				<View style={styles.stopped}>
					<ErrorText testID={`${testID}-stopped`}>{MESSAGES.demoStopped}</ErrorText>
					<Button title="Try again" size="sm" onPress={start} testID={`${testID}-retry`} />
				</View>
			) : (
				<Pressable
					onPress={start}
					accessibilityRole="button"
					accessibilityLabel={`Run demo: ${title}`}
					style={[styles.poster, { backgroundColor: c.codeBg, borderColor: c.line }]}
					testID={`${testID}-run`}
				>
					<View style={[styles.runButton, { backgroundColor: c.primary }]}>
						<Text style={[styles.runText, { color: c.onPrimary }]}>▶︎ Run demo</Text>
					</View>
				</Pressable>
			)}
			{switchFailed ? (
				<ErrorText testID={`${testID}-switch-error`}>{MESSAGES.switchNotSaved}</ErrorText>
			) : null}
			<Modal
				visible={open}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setOpen(false)}
			>
				<SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: c.bg }]}>
					<View style={[styles.sheetHead, { borderColor: c.line }]}>
						<View style={styles.sheetTitle}>{header}</View>
						<Pressable
							onPress={() => setOpen(false)}
							accessibilityRole="button"
							hitSlop={SPACE.sm}
							testID={`${testID}-done`}
						>
							<Text style={[styles.done, { color: c.text }]}>Done</Text>
						</Pressable>
					</View>
					{errorChip ? <View style={styles.sheetChip}>{errorChip}</View> : null}
					{open ? (
						<View style={[styles.frame, { borderColor: c.line }]}>
							<WebIsland
								key={run}
								html={page}
								script={DEMO_SCRIPT}
								data={data}
								live
								fill
								minHeight={MIN_HEIGHT}
								maxHeight={MAX_HEIGHT}
								onOtherMessage={(raw) => {
									const message = parseDemoMessage(raw);
									if (message) setError((old) => old ?? message.text);
								}}
								onFail={() => {
									setOpen(false);
									setStopped(true);
								}}
								testID={`${testID}-webview`}
							/>
						</View>
					) : null}
				</SafeAreaView>
			</Modal>
		</View>
	);
}

const styles = StyleSheet.create({
	card: { borderWidth: 1, borderRadius: 16, padding: SPACE.md, gap: SPACE.sm },
	head: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: SPACE.sm,
	},
	titleRow: { flexDirection: "row", alignItems: "baseline", gap: SPACE.sm, flexShrink: 1 },
	title: { ...TYPE.sm, fontFamily: FONT.ui, fontWeight: "600", flexShrink: 1 },
	badge: {
		...TYPE.xs,
		fontFamily: FONT.ui,
		borderRadius: 4,
		paddingHorizontal: SPACE.xs,
		overflow: "hidden",
	},
	caption: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginTop: SPACE.xs,
	},
	controls: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
	switchRow: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
	switch: { transform: [{ scale: 0.8 }] },
	disc: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, overflow: "hidden" },
	discHalf: { width: "50%", height: "100%" },
	note: {
		borderWidth: 1,
		borderRadius: 12,
		paddingVertical: SPACE.sm,
		paddingHorizontal: SPACE.md,
	},
	noteText: { ...TYPE.sm, fontFamily: FONT.prose },
	chip: { borderRadius: 12, padding: SPACE.sm, gap: SPACE.xs, alignItems: "flex-start" },
	stopped: { gap: SPACE.xs, alignItems: "flex-start" },
	poster: {
		height: 140,
		borderRadius: 12,
		borderWidth: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	runButton: { borderRadius: 20, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.lg },
	runText: { ...TYPE.sm, fontFamily: FONT.ui, fontWeight: "600" },
	sheet: { flex: 1 },
	sheetHead: {
		flexDirection: "row",
		alignItems: "center",
		gap: SPACE.md,
		paddingHorizontal: SPACE.lg,
		paddingVertical: SPACE.md,
		borderBottomWidth: 1,
	},
	sheetTitle: { flex: 1 },
	sheetChip: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm },
	done: { ...TYPE.base, fontFamily: FONT.ui, fontWeight: "600" },
	frame: {
		flex: 1,
		margin: SPACE.md,
		borderRadius: 12,
		borderWidth: 1,
		overflow: "hidden",
		backgroundColor: "#ffffff",
	},
});
