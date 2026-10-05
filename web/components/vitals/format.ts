/**
 * Numbers the way macOS writes them: memory in binary gigabytes (a 24 GB Mac
 * reads 24 GB), disks and network in decimal ones, as Finder and Activity
 * Monitor do. Three significant figures, so a column of them lines up.
 */

function scaled(n: number, base: number, units: readonly string[]): string {
  if (!Number.isFinite(n) || n <= 0) return `0 ${units[0]}`;
  let i = 0;
  while (n >= base && i < units.length - 1) {
    n /= base;
    i++;
  }
  // Whole amounts stay whole: a 24 GB Mac, not a 24.0 GB one.
  const digits = i === 0 || n >= 100 || Number.isInteger(n) ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(digits)} ${units[i]}`;
}

const BYTES = ["bytes", "KB", "MB", "GB", "TB"] as const;
const RATES = ["B/s", "KB/s", "MB/s", "GB/s"] as const;

/** Memory, in 1024s. */
export const memory = (n: number) => scaled(n, 1024, BYTES);

/** Disk space, in 1000s. */
export const space = (n: number) => scaled(n, 1000, BYTES);

/** Bytes a second, in 1000s. */
export const rate = (n: number | null) => (n === null ? "–" : scaled(n, 1000, RATES));

/** A share of something: one decimal below 10, whole numbers above. */
export function pct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "–";
  if (n <= 0) return "0%";
  return n < 10 ? `${n.toFixed(1)}%` : `${Math.round(n)}%`;
}

export function watts(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "–";
  if (n < 0.0005) return "0 W";
  return n < 1 ? `${Math.round(n * 1000)} mW` : `${n.toFixed(1)} W`;
}

/** "3 days", "5 h 12 min", "12 min". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days >= 2) return `${days} days`;
  if (days === 1) return hours ? `1 day ${hours} h` : "1 day";
  if (hours) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes) return `${minutes} min`;
  return "under a minute";
}

/** A list in a sentence: "3000", "3000 and 5173", "3000, 5173 and 5174". */
export function andList(items: (string | number)[]): string {
  const words = items.map(String);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** A path under the home folder, written the short way. */
export function homePath(p: string, home: string | null): string {
  if (home && (p === home || p.startsWith(`${home}/`))) return `~${p.slice(home.length)}`;
  return p.replace(/^\/Users\/[^/]+/, "~");
}
