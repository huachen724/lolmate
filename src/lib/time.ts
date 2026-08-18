export function timeAgo(timestamp: number): string {
  const hours = Math.round((Date.now() - timestamp) / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
