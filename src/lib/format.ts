// Display and input conversion only. Never derive deadlines or day counts here.
const TZ = "Asia/Kolkata";

// ---------- Money (integer paise, always INR) ----------

export function formatRupees(paise: number | null | undefined): string {
  if (paise == null) return "Not provided";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100);
}

/** "45,000" or "45000.50" typed by the user -> paise. Returns null for empty or invalid. */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

// ---------- Date-only fields (freeze_date, window_deadline) ----------
// Parsed by hand and formatted in UTC so the day never shifts with the viewer's timezone.

export function formatDateOnly(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Pieces of a date-only value for the timeline's date gutter. UTC again, so the day never shifts. */
export function dayParts(ymd: string): { day: string; month: string; year: string; weekday: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return { day: ymd, month: "", year: "", weekday: "" };
  const dt = new Date(Date.UTC(y, m - 1, d));
  const fmt = (o: Intl.DateTimeFormatOptions) => dt.toLocaleDateString("en-IN", { ...o, timeZone: "UTC" });
  return { day: String(d), month: fmt({ month: "short" }), year: String(y), weekday: fmt({ weekday: "long" }) };
}

/** Today as YYYY-MM-DD in IST, for the freeze_date input's max attribute. */
export function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

// ---------- Date-times (ISO 8601 UTC from the API, shown in Asia/Kolkata) ----------

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

/** YYYY-MM-DD in IST, used only to group timeline events under a day heading. */
export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

// ---------- <input type="datetime-local"> ----------
// The input has no timezone. Convert before sending, as CONTRACT.md requires.

/** Value from a datetime-local input -> ISO string with Z, ready for occurred_at. */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** ISO string -> value for a datetime-local input (browser-local time). Use to prefill a parsed draft. */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export const nowForLocalInput = (): string => isoToLocalInput(new Date().toISOString());
