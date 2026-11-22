/**
 * Jest setup for the native SwiftUI views of `@expo/ui` (the Chains sort
 * menu, issue 08 slice D). Jest cannot load the native views, so each one
 * is a plain view: the menu shows its label and all its items at all
 * times, and an item is a button with its label. A Maestro flow checks the
 * real menu on the Simulator.
 */
jest.mock("@expo/ui/swift-ui", () => {
	const React = jest.requireActual<typeof import("react")>("react");
	const { Pressable, Text, View } =
		jest.requireActual<typeof import("react-native")>("react-native");
	type MockProps = { children?: React.ReactNode; testID?: string };
	return {
		Host: ({ children }: MockProps) => React.createElement(View, null, children),
		Menu: ({ label, children, testID }: MockProps & { label: string }) =>
			React.createElement(
				View,
				{ testID },
				React.createElement(Text, { testID: testID && `${testID}-label` }, label),
				children,
			),
		Button: ({
			label,
			onPress,
			testID,
			systemImage,
		}: MockProps & { label: string; onPress?: () => void; systemImage?: string }) =>
			React.createElement(
				Pressable,
				{ testID, onPress, accessibilityRole: "button", accessibilityHint: systemImage },
				React.createElement(Text, null, label),
			),
	};
});
jest.mock("@expo/ui/swift-ui/modifiers", () => ({
	font: () => ({}),
	foregroundStyle: () => ({}),
}));
