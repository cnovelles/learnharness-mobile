/**
 * The shared LearnHarness code that the phone uses, from the desktop fork
 * (../learnharness, see metro.config.js). Import shared code from here only,
 * so one file shows what the phone takes from the fork.
 */
export {
	SessionModel,
	visibleQueuedSteers,
	type SessionRecordSnapshot,
	type SessionState,
	type SessionStatus,
	type SteerQueueItem,
} from "@lh/components/session-core";
export {
	AUTH_PROVIDER_KEYS,
	CLAUDE_CODE_PROVIDER,
	MODELS_NOT_CONFIGURED_CODE,
	PROVIDER_KEY_MISSING_CODE,
	CONFIDENCE_STOPS,
	cliContextWindowOf,
	QUESTION_TOOLS,
	activeProblemOf,
	DEFAULT_CONFIDENCE_INDEX,
	answerForPresentation,
	buildAnswer,
	dismissedAnswer,
	endsInFailedTurn,
	derivePlanStatusesLh,
	derivedNodeStatus,
	emptyDockSelection,
	malformedQuestionsOf,
	parseProbeDoneInput,
	pendingQuestionOf,
	practiceProblemForCall,
	phaseAt3Lh,
	phaseTimeline,
	teachStepIndex,
	questionNeedsReveal,
	projectView,
	questionDataForCall,
	repairMathForDisplay,
	transformMathDelimiters,
	toggleOption,
	toggleOther,
	toolQuestionKind,
	type AnswerRequest,
	type ChatInput,
	type ChatListItem,
	type DockSelection,
	type LhMessage,
	type LhViewMessage,
	type Phase3,
	type PlanNode,
	type PlanTree,
	type QuestionDraft,
	type QuestionAnswerData,
	type QuestionData,
} from "@lh/src/core";
// The plan graph layout (issue 05 slice 0): dagre placement and edge paths,
// with no DOM. The desktop draws the same numbers in components/plan-block.tsx.
export {
	ARROW_HEAD,
	GLOW_BLUR,
	GLOW_MARGIN,
	GLOW_REACH,
	GRAPH_PAD,
	HEAD_H,
	HEAD_W,
	LINE_H,
	NODE_H,
	NODE_W_MIN,
	STROKE_W,
	TEXT_CAP_SCALE,
	blockLayout,
	edgePathD,
	wrapTitle,
	type LayoutNode,
} from "@lh/components/plan-layout";
// The desktop folder order (issue 20): the Chains folders and their order.
// Import the files directly: the src/core barrel is not needed here.
export {
	folderTree,
	type FolderLevelItem,
	type FolderTree,
	type FolderTreeSource,
} from "@lh/src/core/folder-order";
export type {
	OrganizationAction,
	SourceDirectory,
	SourceFolder,
	SourceOrganization,
} from "@lh/src/core/source-organization";
// The desktop rule for "this folder is empty" (no subfolder, no placed source).
export { folderIsEmpty } from "@lh/src/core/source-organization";
export type {
	Cluster,
	GraphChain,
	GraphEdge,
	GraphNode,
	GraphSnapshot,
	Position,
	ProvenancePoint,
} from "@lh/src/core/contracts/graph";
// The Graph tab (issue 08): the desktop chain rows, the graph view helpers,
// the canvas math and the session links. Import the files directly: the
// src/core barrel brings node:crypto.
export {
	DEFAULT_CHAIN_SORT,
	UNLABELED_SOURCE,
	buildChainRows,
	isSourceOpen,
	nextChainSort,
	sourceDisplayName,
	type ChainRows,
	type ChainSort,
	type ChainSortCol,
	type ChainSourceGroup,
} from "@lh/src/core/chain-rows";
export { formatChainLine, type ReasoningChain } from "@lh/src/core/chains";
export {
	displayCostTotals,
	isNodeVisible,
	seedMissingNodePositions,
} from "@lh/src/core/graph-view-model";
export {
	CLICK_SLOP,
	CLUSTER_LIGHTNESS,
	FIT_PADDING,
	GLOW_ALPHA,
	GLOW_SCALE,
	LABEL_GAP,
	LABEL_LINE_HEIGHT,
	LABELS_FADE_RATIO,
	PICKING_PAD,
	REGION_LABEL_LINE_HEIGHT,
	REGION_LABEL_MAX_LINES,
	REGION_LABEL_MAX_WIDTH,
	ZOOM_EXTENT,
	arrowGeometry,
	blurRegionPixels,
	clusterHue,
	edgeGlyphs,
	fitTransform,
	isImpNodeId,
	labelAlpha,
	labelWrapWidth,
	pickNearest,
	regionAnchors,
	regionSplat,
	wrapLabel,
	wrapRegionLabel,
	zoomRatioOf,
	type ArrowGeom,
	type ClusterLightness,
	type EdgeGlyphs,
	type RegionAnchor,
	type RegionSplat,
} from "@lh/src/core/graph-canvas-geometry";
export {
	firstSourceTextParts,
	messageIdFromHash,
	propositionSessionHref,
} from "@lh/src/core/session-navigation";
export type { GraphCostSummary, RecentRun, StageCost } from "@lh/src/core/cost-summary";
// Session stats (issue 08 slice E): the desktop stats bar strings and the
// session usage folds. Import the files directly.
export {
	catalogLimits,
	contextLimitForModel,
	formatContextMeasurement,
	formatTokens,
	formatUsd,
	planCostLabel,
	prettyModel,
} from "@lh/src/core/usage-format";
export {
	sessionCacheHitRate,
	subscriptionLabel,
	subscriptionLabels,
	type SessionPricing,
} from "@lh/src/core/prices";
export type { ChatSettings, TurnUsage } from "@lh/src/core/contracts/chat";
// The stats bar strings: the desktop stats bar uses the same function.
export {
	sessionStatsSummary,
	type SessionStatsInput,
	type SessionStatsSummary,
	type SessionStatsTurn,
} from "@lh/src/core/session-stats";
