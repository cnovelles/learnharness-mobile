import { timeAgo } from "@/lib/time-ago";

const now = new Date(2026, 10, 15, 12, 0, 0);
const before = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("timeAgo (the desktop session list)", () => {
	it("says just now under a minute, also for a time in the future", () => {
		expect(timeAgo(before(30_000), now)).toBe("just now");
		expect(timeAgo(before(-5_000), now)).toBe("just now");
	});

	it("gives minutes, hours and days", () => {
		expect(timeAgo(before(5 * 60_000), now)).toBe("5m ago");
		expect(timeAgo(before(3 * 3_600_000), now)).toBe("3h ago");
		expect(timeAgo(before(2 * 86_400_000), now)).toBe("2d ago");
	});

	it("gives the date as YYYY-MM-DD after 7 days", () => {
		expect(timeAgo(new Date(2026, 0, 5, 9).toISOString(), now)).toBe("2026-01-05");
	});

	it("gives an empty text for a date that does not parse", () => {
		expect(timeAgo("not a date", now)).toBe("");
	});
});
