// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
// Turns off ESLint style rules that conflict with Prettier. Keep it last.
const prettierConfig = require("eslint-config-prettier/flat");

module.exports = defineConfig([
	expoConfig,
	{
		ignores: ["dist/*"],
	},
	prettierConfig,
]);
