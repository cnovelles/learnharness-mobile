import { statusText } from "@/app/index";
import type { Connection } from "@/lib/pairing";

const connection: Connection = {
	name: "Studio Mac",
	urls: ["https://192.168.1.20:47821"],
	pin: `sha256/${"A".repeat(43)}=`,
	token: "secret-token",
	deviceId: "device-1",
	pairedAt: "2026-11-14T10:00:00.000Z",
};
const checkedAt = "2026-11-14T10:05:00.000Z";

describe("statusText for an unreachable Mac", () => {
	it("tells the user to check the network when no address answered", () => {
		const text = statusText({ status: "unreachable", connection, checkedAt });
		expect(text.label).toBe("Not connected");
		expect(text.tone).toBe("danger");
		expect(text.detail).toContain("cannot reach Studio Mac");
		expect(text.detail).not.toContain("certificate");
	});

	it("tells the user that another device answered when the certificate is wrong", () => {
		const text = statusText({
			status: "unreachable",
			connection,
			checkedAt,
			wrongCertificate: true,
		});
		expect(text.label).toBe("Not connected");
		expect(text.tone).toBe("danger");
		expect(text.detail).toContain("is not Studio Mac");
		expect(text.detail).toContain("The phone sent nothing");
		expect(text.detail).toContain("pair again");
		expect(text.detail).not.toContain("—");
	});
});
