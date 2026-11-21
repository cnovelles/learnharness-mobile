// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
// Turns off ESLint style rules that conflict with Prettier. Keep it last.
const prettierConfig = require("eslint-config-prettier/flat");

/**
 * Error text on the screen (AGENTS.md, "Error states"): the phone never
 * shows raw server or exception text. ErrorText takes only a UserMessage,
 * and these rules close the ways around that type.
 */
const USER_TEXT_RULES = [
	{
		selector: "JSXExpressionContainer MemberExpression[property.name='message']",
		message:
			"Do not show `.message` on screen. Raw error text must go through describeError() (src/lib/user-error.ts).",
	},
	{
		selector: "TSAsExpression[typeAnnotation.typeName.name='UserMessage']",
		message: "Do not cast to UserMessage. Use userMessage('literal text') or describeError(error).",
	},
	{
		selector:
			"CallExpression[callee.name='userMessage'][arguments.0.type!='Literal'][arguments.0.type!='TemplateLiteral']",
		message:
			"userMessage() takes only literal text written for the user. Use describeError() for errors.",
	},
	{
		selector:
			"CallExpression[callee.name='userMessage'] TemplateLiteral MemberExpression[property.name='message']",
		message: "Do not put `.message` into userMessage(). Use describeError() for errors.",
	},
];

/**
 * The spacing scale (src/components/spacing.ts, user decision 2026-11-15):
 * a padding, margin or gap takes a SPACE name, never a number. 0 is allowed.
 */
const SPACING_KEYS =
	"/^(padding|margin)(Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?$|^(gap|rowGap|columnGap)$/";
const SPACING_RULES = [
	{
		selector: `Property[key.name=${SPACING_KEYS}] > Literal.value[value!=0]`,
		message: "Use a SPACE name from src/components/spacing.ts for padding, margin and gap.",
	},
	{
		selector: `Property[key.name=${SPACING_KEYS}] > UnaryExpression.value`,
		message: "Use a SPACE name from src/components/spacing.ts for padding, margin and gap.",
	},
];

/**
 * Transport security (docs/TRANSPORT-SECURITY.md): App Transport Security is
 * off (plugins/with-transport-security.js), so the pinned session is the only
 * thing that protects the network. App code reaches the network only through
 * the PinnedFetch (src/lib/native-pinned-fetch.ts). These rules block the
 * other ways out.
 */
const NETWORK_MESSAGE =
	"This goes around the pinned transport. Reach the Mac through useMacFetch() (PinnedFetch). See docs/TRANSPORT-SECURITY.md.";
const NETWORK_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].map((name) => ({
	name,
	message: NETWORK_MESSAGE,
}));
const NETWORK_PROPERTIES = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].flatMap(
	(property) =>
		["globalThis", "window", "global", "self"].map((object) => ({
			object,
			property,
			message: NETWORK_MESSAGE,
		})),
);
const NETWORK_IMPORTS = {
	paths: [
		{ name: "expo/fetch", message: NETWORK_MESSAGE },
		{ name: "expo-web-browser", message: NETWORK_MESSAGE },
		{ name: "expo-image", message: "Remote images are blocked. " + NETWORK_MESSAGE },
		{
			name: "react-native",
			importNames: ["Image", "ImageBackground"],
			message: "Remote images are blocked. " + NETWORK_MESSAGE,
		},
	],
};

module.exports = defineConfig([
	expoConfig,
	{
		ignores: ["dist/*", "tests/.cache/*", ".cache/*"],
	},
	{
		// The generated island pages (scripts/island-pages/build.cjs): Metro and
		// Jest map this name to .cache/island-pages/islands.js.
		settings: { "import/core-modules": ["lh-island-pages"] },
	},
	{
		files: ["src/**/*.{ts,tsx}"],
		ignores: ["src/lib/user-error.ts"],
		rules: { "no-restricted-syntax": ["error", ...USER_TEXT_RULES, ...SPACING_RULES] },
	},
	{
		files: ["src/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-globals": ["error", ...NETWORK_GLOBALS],
			"no-restricted-properties": ["error", ...NETWORK_PROPERTIES],
			"no-restricted-imports": ["error", NETWORK_IMPORTS],
		},
	},
	prettierConfig,
]);
