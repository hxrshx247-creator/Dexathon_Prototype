// Display metadata for every contract enum.
// Unknown values from the backend render as the raw string in a neutral style, never a crash.
import type {
  AccountType,
  CaseState,
  Direction,
  EventType,
  FreezeType,
  Urgency,
} from "../api/client";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export type Meta = { label: string; icon?: string; tone?: Tone };

/** Safe lookup: unknown keys come back as { label: <raw>, tone: "neutral" }. */
export function meta<K extends string>(map: Record<K, Meta>, key: string): Meta {
  return (map as Record<string, Meta>)[key] ?? { label: key, tone: "neutral" };
}

/** For select boxes and chip groups: [{ value, label }] in map order. */
export function optionsOf<K extends string>(map: Record<K, Meta>) {
  return (Object.keys(map) as K[]).map((value) => ({ value, label: map[value].label }));
}

// Icon names are lucide-react names (npm i lucide-react).

export const ACCOUNT_TYPE: Record<AccountType, Meta> = {
  savings: { label: "Savings" },
  current: { label: "Current" },
  salary: { label: "Salary" },
  joint: { label: "Joint" },
  other: { label: "Other" },
};

export const FREEZE_TYPE: Record<FreezeType, Meta> = {
  freeze: { label: "Account frozen" },
  debit_hold: { label: "Debit hold (money can't go out)" },
  lien: { label: "Lien on the account" },
  partial_hold: { label: "Part of the balance is held" },
  unknown: { label: "I'm not sure" },
};

export const URGENCY: Record<Urgency, Meta> = {
  rent: { label: "Rent", icon: "Home" },
  medical: { label: "Medical", icon: "HeartPulse" },
  bills: { label: "Bills", icon: "Receipt" },
  education: { label: "Education", icon: "GraduationCap" },
  other: { label: "Something else", icon: "CircleEllipsis" },
};

export const EVENT_TYPE: Record<EventType, Meta> = {
  call: { label: "Phone call", icon: "Phone" },
  sms: { label: "SMS", icon: "MessageSquare" },
  email: { label: "Email", icon: "Mail" },
  branch_visit: { label: "Branch visit", icon: "Building2" },
  request_sent: { label: "Request sent to the bank", icon: "Send" },
  bank_response: { label: "Bank's response", icon: "Inbox", tone: "info" },
  grievance_filed: { label: "Grievance filed with the bank", icon: "FileWarning" },
  ombudsman_filed: { label: "Filed with the ombudsman", icon: "Scale" },
  note: { label: "My note", icon: "StickyNote" },
};

export const CASE_STATE: Record<CaseState, Meta> = {
  awaiting_first_contact: { label: "Not yet contacted the bank", tone: "neutral" },
  within_window: { label: "Waiting for the bank", tone: "info" },
  window_expired: { label: "Response window ended", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
};

// Labels for these two come from the backend (`label`); the frontend only picks the icon.
export const ACTION_ICON: Record<string, string> = {
  make_first_request: "Send",
  wait_for_response: "Clock",
  follow_up_with_bank: "MessageSquarePlus",
  log_reference_number: "Hash",
  escalate_to_ombudsman: "Scale",
  consult_legal_aid: "LifeBuoy",
};

export const BLOCKER_ICON: Record<string, string> = {
  no_first_contact: "CircleDashed",
  window_not_elapsed: "Clock",
  no_reference_number: "Hash",
};

export const iconFor = (map: Record<string, string>, code: string): string =>
  map[code] ?? "Circle";

// ---------- Direction is derived from type (CONTRACT.md section 4) ----------
// The add-event form never asks the user for direction. The backend rejects any other pairing.
// An inbound SMS or email from the bank is logged as bank_response, not sms or email.

export const DIRECTION_FOR_TYPE: Record<EventType, Direction> = {
  call: "outbound",
  sms: "outbound",
  email: "outbound",
  branch_visit: "outbound",
  request_sent: "outbound",
  grievance_filed: "outbound",
  ombudsman_filed: "outbound",
  bank_response: "inbound",
  note: "internal",
};

export const directionFor = (type: EventType): Direction => DIRECTION_FOR_TYPE[type];
