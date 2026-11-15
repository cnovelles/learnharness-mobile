/**
 * Jest setup for the plan graph gestures (issue 05 slice E).
 *
 * react-native-gesture-handler uses Reanimated when it can load it. The app
 * does not use Reanimated, and under Jest it is only a partial mock (the
 * expo-router test tools even make it an empty object, which breaks the
 * gesture hooks). So Jest gives the gesture library no Reanimated and no
 * Worklets: it runs its plain JS path, as in an app without Reanimated.
 */
// Jest can load the package source or its build: mock both.
jest.mock("react-native-gesture-handler/src/handlers/gestures/reanimatedWrapper", () => ({
	Reanimated: undefined,
	Worklets: undefined,
}));
jest.mock("react-native-gesture-handler/lib/module/handlers/gestures/reanimatedWrapper", () => ({
	Reanimated: undefined,
	Worklets: undefined,
}));
