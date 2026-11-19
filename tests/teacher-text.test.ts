/**
 * teacherText keeps a cache of the repaired text (issue 21, the Hermes
 * profile): the repair runs the Markdown parser 3 times, so a redraw or a
 * second open must not repeat it.
 */
import { repairMathForDisplay } from "@/lib/shared";
import { TEACHER_TEXT_CACHE, clearTeacherTextCache, teacherText } from "@/lib/teacher-text";

jest.mock("@/lib/shared", () => {
	const actual = jest.requireActual("@/lib/shared");
	return { ...actual, repairMathForDisplay: jest.fn(actual.repairMathForDisplay) };
});
const repair = jest.mocked(repairMathForDisplay);

beforeEach(() => {
	clearTeacherTextCache();
	repair.mockClear();
});

it("repairs the text as before", () => {
	expect(teacherText("First:\\n\\n- a probe")).toBe("First:\n\n- a probe");
	expect(teacherText("$\\nabla f$")).toBe("$\\nabla f$");
});

it("repairs the same text only one time", () => {
	const a = teacherText("Line one.\\n\\nLine two.");
	const b = teacherText("Line one.\\n\\nLine two.");
	expect(b).toBe(a);
	expect(repair).toHaveBeenCalledTimes(1);
});

it("keeps at most TEACHER_TEXT_CACHE texts and forgets the oldest first", () => {
	for (let i = 0; i <= TEACHER_TEXT_CACHE; i++) teacherText(`text ${i}`);
	repair.mockClear();
	teacherText(`text ${TEACHER_TEXT_CACHE}`);
	expect(repair).not.toHaveBeenCalled();
	teacherText("text 0");
	expect(repair).toHaveBeenCalledTimes(1);
});

it("a text that is used again moves to the newest place", () => {
	for (let i = 0; i < TEACHER_TEXT_CACHE; i++) teacherText(`text ${i}`);
	teacherText("text 0");
	teacherText("one more");
	repair.mockClear();
	teacherText("text 0");
	expect(repair).not.toHaveBeenCalled();
	teacherText("text 1");
	expect(repair).toHaveBeenCalledTimes(1);
});
