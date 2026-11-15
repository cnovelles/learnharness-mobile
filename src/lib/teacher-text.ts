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

export function teacherText(text: string): string {
	return repairMathForDisplay(text);
}
