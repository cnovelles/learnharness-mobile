import { Alert, Linking } from "react-native";

/** Opens a safe link (see `safeLinkUrl`). Error state 6: "Could not open the link." */
export function openLink(url: string) {
	Linking.openURL(url).catch(() => {
		Alert.alert("Could not open the link.");
	});
}
