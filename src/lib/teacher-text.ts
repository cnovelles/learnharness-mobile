/**
 * Text that the teacher wrote, made ready for the screen.
 *
 * Some models (seen with the Claude Code CLI) send a tool argument with the
 * two characters "\" and "n" in place of a line break, also inside code
 * fences. The Mac stores the text as it came. The desktop repairs it before
 * it shows it (`repairMathForDisplay` in components/ai-elements/message.tsx
 * and components/question-preview.tsx). The phone uses the same shared
 * function, so both apps show the same text.
 *
 * The function repairs "\n" only where it is clearly text layout: inside or
 * around a code fence, and a blank line between paragraphs ("\n\n"). A
 * single "\n" in ordinary text stays, because it can be a math command
 * such as "\nabla".
 *
 * Use it only for display. The answer record keeps the original question
 * text, as on the desktop. Do not use it for text that the learner typed.
 */
import { repairMathForDisplay } from "./shared";

/**
 * The number of repaired texts in the cache. The repair runs the Markdown
 * parser 3 times (the Hermes profile of issue 21), so a redraw, a new page
 * of older rows or a second open of the same session uses the cache. The
 * cache forgets the text that it used last a long time ago first.
 */
export const TEACHER_TEXT_CACHE = 1000;

const cache = new Map<string, string>();

export function teacherText(text: string): string {
	const hit = cache.get(text);
	if (hit !== undefined) {
		// A Map keeps the order of insertion: move the text to the newest place.
		cache.delete(text);
		cache.set(text, hit);
		return hit;
	}
	const fixed = repairMathForDisplay(text);
	cache.set(text, fixed);
	if (cache.size > TEACHER_TEXT_CACHE) cache.delete(cache.keys().next().value as string);
	return fixed;
}

/** For tests. */
export function clearTeacherTextCache(): void {
	cache.clear();
}
