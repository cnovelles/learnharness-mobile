import { brailleDots, SPINNER_FRAMES } from "@/components/ui";

describe("the braille spinner frames (the desktop BrailleSpinner)", () => {
	it("reads the dots of each braille character in braille order", () => {
		// ⠋ is dots 1, 2 and 4: left top, left middle, right top.
		expect(brailleDots("⠋")).toEqual([0, 1, 3]);
		// ⠸ is dots 4, 5 and 6: the right column.
		expect(brailleDots("⠸")).toEqual([3, 4, 5]);
	});

	it("has the 10 desktop frames, each with 3 or 4 dots", () => {
		expect([...SPINNER_FRAMES]).toHaveLength(10);
		for (const frame of SPINNER_FRAMES) {
			const n = brailleDots(frame).length;
			expect(n === 3 || n === 4).toBe(true);
		}
	});
});
