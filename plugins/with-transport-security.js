/**
 * The iOS App Transport Security (ATS) policy of the app, in one place.
 * See docs/TRANSPORT-SECURITY.md before you change the policy.
 *
 * Every request to the Mac goes through the native pinned session
 * (modules/pinned-fetch): HTTPS only, the SPKI pin from the QR code, no
 * redirects. ATS checks the certificate against the system trust store
 * before the pin check runs. The Mac's certificate is self-signed, so ATS
 * refuses it on every address that ATS does not treat as local. Tailscale
 * addresses (100.64.0.0/10) are not local for ATS (issue 15, 2026-11-16).
 *
 * Policies:
 * - "pinned": ATS is off (NSAllowsArbitraryLoads). The pin is the trust.
 *   Works on the LAN and on Tailscale. App Store review asks for a reason
 *   for this key.
 * - "local-only": ATS is on, with local networking allowed. The phone can
 *   reach the Mac only on the LAN (the policy before issue 15).
 *
 * To add a policy (for example an ATS exception for a Tailscale name, or a
 * real certificate with system trust), add it to POLICIES, then change the
 * option in app.json. tests/transport-security.test.ts checks the result.
 */
const { withInfoPlist } = require("expo/config-plugins");

const POLICIES = {
	pinned: () => ({ NSAllowsArbitraryLoads: true }),
	"local-only": () => ({ NSAllowsLocalNetworking: true }),
};

/**
 * The NSAppTransportSecurity dictionary for a policy. It replaces the whole
 * dictionary: iOS ignores NSAllowsArbitraryLoads when NSAllowsLocalNetworking,
 * NSAllowsArbitraryLoadsInWebContent, NSAllowsArbitraryLoadsForMedia or
 * NSExceptionDomains is also present, so no key may stay from another policy.
 */
function transportSecurity(policy) {
	const make = POLICIES[policy];
	if (!make) {
		throw new Error(
			`with-transport-security: unknown policy "${policy}". Use one of: ${Object.keys(POLICIES).join(", ")}.`,
		);
	}
	return make();
}

function withTransportSecurity(config, options = {}) {
	const ats = transportSecurity(options.policy);
	return withInfoPlist(config, (plist) => {
		plist.modResults.NSAppTransportSecurity = ats;
		return plist;
	});
}

module.exports = withTransportSecurity;
module.exports.transportSecurity = transportSecurity;
module.exports.POLICIES = Object.keys(POLICIES);
