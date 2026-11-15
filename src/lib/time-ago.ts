/**
 * "How long ago", as the desktop session list (fork components/sidebar.tsx
 * `timeAgo`): "just now", "5m ago", "3h ago", "2d ago", then the date as
 * YYYY-MM-DD after 7 days. A date that does not parse gives "".
 */
export function timeAgo(iso: string, now = new Date()): string {
	const then = new Date(iso);
	if (Number.isNaN(then.getTime())) return "";
	const ms = now.getTime() - then.getTime();
	if (ms < 60_000) return "just now";
	const min = Math.floor(ms / 60_000);
	if (min < 60) return `${min}m ago`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d ago`;
	const mm = String(then.getMonth() + 1).padStart(2, "0");
	const dd = String(then.getDate()).padStart(2, "0");
	return `${then.getFullYear()}-${mm}-${dd}`;
}
