// Typed wrapper over the FairHold+ contract.
// Types come from schema.d.ts (npm run api:types). Never hand-write them.
// Nothing here computes state, deadlines or day counts: the backend owns that.
import type { components } from "./schema";

type S = components["schemas"];
export type Case = S["Case"];
export type CaseCreate = S["CaseCreate"];
export type CaseUpdate = S["CaseUpdate"];
export type CaseState = S["CaseState"];
export type CaseEvent = S["Event"]; // not "Event", which would shadow the DOM type
export type EventCreate = S["EventCreate"];
export type EventType = S["EventType"];
export type Direction = S["Direction"];
export type Attachment = S["Attachment"];
export type EvidenceDraft = S["EvidenceDraft"];
export type CaseStatus = S["CaseStatusSummary"];
export type Letter = S["Letter"];
export type LetterPurpose = S["LetterPurpose"];
export type AccountType = S["AccountType"];
export type FreezeType = S["FreezeType"];
export type Urgency = S["Urgency"];

// Vite only exposes env vars prefixed with VITE_.
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.PROD ? "/api/v1" : "http://localhost:8000/api/v1");

// ---------- Errors ----------

export type ApiErrorCode = S["Error"]["error"]["code"] | "NETWORK";
export type FieldIssue = { field: string; issue: string };

export class ApiError extends Error {
  status: number;
  code: ApiErrorCode;
  details: FieldIssue[];

  constructor(status: number, code: ApiErrorCode, message: string, details: FieldIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The issue text for one form field, to show next to that field (422 VALIDATION_ERROR). */
  issueFor(field: string): string | undefined {
    return this.details.find((d) => d.field === field)?.issue;
  }
}

function fallbackCode(status: number): ApiErrorCode {
  if (status === 404) return "NOT_FOUND";
  if (status === 413) return "FILE_TOO_LARGE";
  if (status === 415) return "UNSUPPORTED_FILE";
  if (status === 422) return "VALIDATION_ERROR";
  return "INTERNAL_ERROR";
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const e = (await res.json())?.error;
    if (e && typeof e.code === "string") {
      return new ApiError(
        res.status,
        e.code,
        String(e.message ?? ""),
        Array.isArray(e.details) ? e.details : [],
      );
    }
  } catch {
    // body was not JSON; fall through
  }
  return new ApiError(res.status, fallbackCode(res.status), res.statusText);
}

/** Plain-language message for each error, following CONTRACT.md section 6. */
export function friendlyError(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Please try again.";
  switch (e.code) {
    case "NOT_FOUND":
      return "We couldn't find that case.";
    case "FILE_TOO_LARGE":
      return "That file is too large. The limit is 10 MB.";
    case "UNSUPPORTED_FILE":
      return "We can't read that kind of file. Please use PNG, JPEG, PDF or plain text.";
    case "VALIDATION_ERROR":
      return "Please check the highlighted fields.";
    case "PARSE_FAILED":
      return "We couldn't read details from that. You can enter them yourself instead.";
    case "NETWORK":
      return "We can't reach the server. Check your connection and try again.";
    default:
      return "Something went wrong on our side. Please try again.";
  }
}

// ---------- Transport ----------

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the server");
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json() as Promise<T>;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

const enc = encodeURIComponent;

// ---------- Endpoints (one per operationId) ----------

export const api = {
  health: () => json<{ status: "ok" }>("/health"),

  listCases: () => json<{ items: Case[] }>("/cases").then((r) => r.items),
  createCase: (body: CaseCreate) => json<Case>("/cases", jsonInit("POST", body)),
  getCase: (id: string) => json<Case>(`/cases/${enc(id)}`),
  updateCase: (id: string, body: CaseUpdate) =>
    json<Case>(`/cases/${enc(id)}`, jsonInit("PATCH", body)),

  listEvents: (id: string) =>
    json<{ items: CaseEvent[] }>(`/cases/${enc(id)}/events`).then((r) => r.items),
  createEvent: (id: string, body: EventCreate) =>
    json<CaseEvent>(`/cases/${enc(id)}/events`, jsonInit("POST", body)),
  deleteEvent: async (id: string, eventId: string) => {
    await send(`/cases/${enc(id)}/events/${enc(eventId)}`, { method: "DELETE" });
  },

  getStatus: (id: string) => json<CaseStatus>(`/cases/${enc(id)}/status`),

  uploadAttachment: (id: string, file: File) => {
    const form = new FormData(); // no Content-Type header: the browser sets the boundary
    form.append("file", file);
    return json<Attachment>(`/cases/${enc(id)}/attachments`, { method: "POST", body: form });
  },

  /** Never saves an event. Send a file, pasted text, or both. */
  parseEvidence: (id: string, input: { file?: File; text?: string }) => {
    const form = new FormData();
    if (input.file) form.append("file", input.file);
    if (input.text) form.append("text", input.text);
    return json<EvidenceDraft>(`/cases/${enc(id)}/evidence/parse`, { method: "POST", body: form });
  },

  generateLetter: (id: string, purpose: LetterPurpose) =>
    json<Letter>(`/cases/${enc(id)}/letter`, jsonInit("POST", { purpose })),

  /** Returns the PDF as a blob; open it with URL.createObjectURL(blob). */
  exportCase: async (id: string) => {
    const res = await send(`/cases/${enc(id)}/export`);
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `fairhold-case-${id}.pdf`;
    return { blob, filename };
  },

  seedDemo: () => json<Case>("/demo/seed", { method: "POST" }),
  resetDemo: async () => {
    await send("/demo/reset", { method: "POST" });
  },
};

// ---------- Helpers ----------

/** The three calls the case page makes on load, in parallel. */
export async function loadDashboard(caseId: string) {
  const [caseData, status, events] = await Promise.all([
    api.getCase(caseId),
    api.getStatus(caseId),
    api.listEvents(caseId),
  ]);
  return { caseData, status, events };
}

/** After every create or delete, re-fetch. Never patch local state by guessing. */
export async function refreshStatusAndEvents(caseId: string) {
  const [status, events] = await Promise.all([api.getStatus(caseId), api.listEvents(caseId)]);
  return { status, events };
}

/**
 * Attachment.url may be a path or an absolute URL. Paths are resolved against the
 * API origin. Confirm with Member B whether paths start at the origin or at /api/v1.
 */
export function attachmentUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = new URL(API_BASE, window.location.href).origin;
  return origin + (url.startsWith("/") ? url : `/${url}`);
}
