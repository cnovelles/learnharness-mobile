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

module.exports = defineConfig([
	expoConfig,
	{
		ignores: ["dist/*", "tests/.cache/*"],
	},
	{
		files: ["src/**/*.{ts,tsx}"],
		ignores: ["src/lib/user-error.ts"],
		rules: { "no-restricted-syntax": ["error", ...USER_TEXT_RULES] },
	},
	prettierConfig,
]);
