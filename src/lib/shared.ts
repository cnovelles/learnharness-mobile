/**
 * The shared LearnHarness code that the phone uses, from the desktop fork
 * (../learnharness, see metro.config.js). Import shared code from here only,
 * so one file shows what the phone takes from the fork.
 */
export { SessionModel, type SessionState, type SessionStatus } from "@lh/components/session-core";
export {
	AUTH_PROVIDER_KEYS,
	CLAUDE_CODE_PROVIDER,
	MODELS_NOT_CONFIGURED_CODE,
	PROVIDER_KEY_MISSING_CODE,
	CONFIDENCE_STOPS,
	QUESTION_TOOLS,
	DEFAULT_CONFIDENCE_INDEX,
	buildAnswer,
	emptyDockSelection,
	malformedQuestionsOf,
	pendingQuestionOf,
	projectView,
	questionDataForCall,
	toggleOption,
	toggleOther,
	toolQuestionKind,
	type AnswerRequest,
	type ChatInput,
	type ChatListItem,
	type DockSelection,
	type LhMessage,
	type LhViewMessage,
	type QuestionAnswerData,
	type QuestionData,
} from "@lh/src/core";
