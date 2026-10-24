// Banner copy built only from fields GET /cases/{id}/status already returns.
// No deadline, state or day-count logic lives here (CONTRACT.md section 3).
import type { CaseStatus, LetterPurpose } from "../api/client";
import { formatDateOnly } from "./format";
import type { Tone } from "./labels";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export type Banner = { tone: Tone; headline: string; detail: string };

export function statusBanner(s: CaseStatus): Banner {
  const deadline = s.window_deadline ? formatDateOnly(s.window_deadline) : null;

  switch (s.state) {
    case "resolved":
      return {
        tone: "success",
        headline: "The bank has documented a resolution",
        detail: "Keep your records. They show what happened and when.",
      };

    case "awaiting_first_contact":
      return {
        tone: "neutral",
        headline: "You haven't contacted the bank yet",
        detail: `Your account has been on hold for ${plural(s.days_since_freeze, "day")}. Send a clear written request and log it here to start your record.`,
      };

    case "within_window": {
      const left = s.days_remaining ?? 0;
      return {
        tone: "info",
        headline:
          left === 0
            ? "Last day of the bank's response window"
            : `${plural(left, "day")} left in the bank's response window`,
        detail: `${deadline ? `The window ends ${deadline}. ` : ""}No documented resolution yet.`,
      };
    }

    case "window_expired": {
      const over = Math.abs(s.days_remaining ?? 0);
      return {
        tone: "warning",
        headline: "The bank's response window has ended",
        detail: `${deadline ? `It ended on ${deadline}` : "It has ended"}${
          over > 0 ? ` (${plural(over, "day")} ago)` : ""
        } and no resolution has been documented.`,
      };
    }

    default:
      // Unknown state from a newer backend: show it plainly, never crash.
      return { tone: "neutral", headline: String(s.state), detail: "" };
  }
}

/** Which letter to offer, chosen from the backend's own next_steps codes. */
export function suggestedLetterPurpose(s: CaseStatus): LetterPurpose {
  return s.next_steps.some((n) => n.code === "follow_up_with_bank")
    ? "follow_up"
    : "initial_request";
}
