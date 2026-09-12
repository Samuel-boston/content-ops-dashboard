/** m:ss — the timecode format used on pins, chips and the transport. */
export function timecode(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Point or range, as shown on a comment chip: "0:14" or "0:11 – 0:23". */
export function timeRange(start: number | null, end: number | null): string | null {
  if (start == null) return null;
  return end != null && end > start ? `${timecode(start)} – ${timecode(end)}` : timecode(start);
}

/** Frame number at 25fps — the "F0341" readout next to the transport time. */
export function frameLabel(seconds: number, fps = 25): string {
  return `F${String(Math.floor(seconds * fps)).padStart(4, "0")}`;
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** "Jul 12" / "Today" — the date stamp in a comment footer. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

export function dayMonth(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

/** Display name, falling back to the email local part. */
export function displayName(
  p: { full_name?: string | null; email?: string | null } | null | undefined
): string {
  if (!p) return "Unknown";
  return p.full_name?.trim() || p.email?.split("@")[0] || "Unknown";
}

export function initials(
  p: { full_name?: string | null; email?: string | null } | null | undefined
): string {
  const name = displayName(p);
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Stable per-person avatar hue, so the same editor is always the same colour
 * across the timeline pins, board cards and comment list.
 */
export function avatarHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/**
 * Currency, formatted in the locale that actually belongs to it — otherwise
 * Intl renders USD in a GB locale as "US$30" rather than "$30".
 */
const CURRENCY_LOCALE: Record<string, string> = {
  USD: "en-US",
  GBP: "en-GB",
  EUR: "en-IE",
  AUD: "en-AU",
  CAD: "en-CA",
};

export function money(cents: number, currency = "USD", opts: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    ...opts,
  }).format(cents / 100);
}

/**
 * Spoken length of a script, at ~150 words per minute — a natural
 * piece-to-camera pace. Written so a 45-second script isn't drafted as 90.
 */
export function readTime(text: string): { words: number; seconds: number; label: string } {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const seconds = Math.round((words / 150) * 60);
  return {
    words,
    seconds,
    label: seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`,
  };
}

/**
 * What the storage is costing, per month.
 *
 * Supabase Pro includes 100 GB and charges $0.021/GB/month beyond it; the free
 * tier includes 1 GB with no overage (it stops you instead). Both numbers live
 * here rather than being sprinkled through the UI, because they're the kind of
 * thing a vendor changes and you then can't find.
 */
export const STORAGE_RATES = {
  /** Included allowance, in bytes, on the Supabase Pro plan. */
  includedBytes: 100 * 1024 ** 3,
  /** Dollars per GB per month beyond the allowance. */
  perGbCents: 2.1,
} as const;

export function storageCost(bytes: number) {
  const overageBytes = Math.max(0, bytes - STORAGE_RATES.includedBytes);
  const overageGb = overageBytes / 1024 ** 3;
  return {
    overageGb,
    /** Cents per month. Zero while inside the included allowance. */
    monthlyCents: Math.round(overageGb * STORAGE_RATES.perGbCents),
    usedFraction: bytes / STORAGE_RATES.includedBytes,
  };
}
