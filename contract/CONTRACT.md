# FairHold+ Integration Contract

`openapi.yaml` defines the shapes. This file defines the rules the shapes cannot express. If the two ever disagree, `openapi.yaml` wins for shapes and this file wins for behavior.

**Ownership**
- Member A (frontend) consumes the contract. Member B (backend) implements it.
- Put the `contract/` folder in the repo root so both of you work from the same copy.

## 1. How to use it

1. **Frontend builds against a mock, not the real backend.**
   `npx @stoplight/prism-cli mock contract/openapi.yaml -p 4010`
   Point the frontend at the mock with an `API_BASE` env var:
   `http://localhost:4010/api/v1` (mock) or `http://localhost:8000/api/v1` (real).
   If the mock returns 404 for every route, check that `/api/v1` is in the base URL.
2. **Frontend generates its types from the file, never hand-writes them.**
   `npx openapi-typescript contract/openapi.yaml -o src/api/schema.d.ts`
   Re-run this after every contract change.
3. **Backend checks its own responses against the file.** Add one test per endpoint that validates the JSON response against the matching schema (or run Schemathesis against the running backend). A response that does not match is a backend bug, not a frontend problem.
4. **Switching from mock to real is one env var.** If that switch breaks something, the contract was not followed. Fix the side that deviated.

## 2. Global conventions

| Topic | Rule |
|---|---|
| Base URL | `/api/v1`. Backend on port 8000, mock on 4010, frontend on 3000 or 5173. |
| Format | JSON, `snake_case` keys, UTF-8. Uploads use `multipart/form-data`. |
| IDs | Opaque strings (UUID v4). Never parse them or assume a pattern. |
| Date-times | ISO 8601 UTC with `Z`, e.g. `2026-10-03T05:30:00Z`. The frontend converts to `Asia/Kolkata` only for display. |
| Date-only fields | `freeze_date` and `window_deadline` are `YYYY-MM-DD` with no timezone. |
| Sending times | `<input type="datetime-local">` has no timezone. Convert with `new Date(value).toISOString()` before sending. |
| Money | Integer paise (`amount_held_minor`), currency always `INR`. Divide by 100 only for display. |
| Null vs missing | Responses always contain every field in the schema. "No value" is `null`, never an omitted key. Arrays are never `null`; use `[]`. |
| Lists | Always wrapped: `{ "items": [...] }`. No pagination in the prototype. |
| Ordering | Cases newest first by `created_at`. Events oldest first by `occurred_at`, ties broken by `created_at`. |
| Enums | Lowercase `snake_case`. Existing values are never renamed or removed. |
| Auth | None. Single demo user. |
| CORS | Backend allows origins `http://localhost:3000` and `http://localhost:5173`, all methods, and the `Content-Disposition` response header. |

## 3. Who owns what logic

The frontend **never** computes deadlines, states, day counts, or escalation readiness. It displays what `GET /cases/{id}/status` returns. This is what keeps the two sides from ever disagreeing.

| Backend decides | Frontend decides |
|---|---|
| `state`, `days_since_freeze`, `window_deadline`, `days_remaining` | Layout, colors, icons, which tab is open |
| `escalation_ready`, `escalation_blockers`, `next_steps` | How to render each `code` (icon, color). `label` is already display text |
| Event ordering | Grouping events by day in the timeline |
| Letter text, PDF content | Showing the letter in an editable box, opening the PDF |

## 4. Business rules (backend implements, frontend relies on)

**Bank-facing event** = `direction` is `outbound` and `type` is one of `call`, `sms`, `email`, `branch_visit`, `request_sent`, `grievance_filed`.

| `state` | Condition (checked in this order) |
|---|---|
| `resolved` | Any event has `is_resolution = true` |
| `awaiting_first_contact` | No bank-facing event exists |
| `window_expired` | First bank-facing event exists and now is past `window_deadline` |
| `within_window` | First bank-facing event exists and now is on or before `window_deadline` |

- `first_contact_at` is the `occurred_at` of the earliest bank-facing event, else `null`.
- `window_deadline` is `first_contact_at` plus `window_days`, as a date. Both are `null` until first contact.
- `window_days` comes from a backend config file. **Default 30, marked as to-be-verified.** Confirm it against the current RBI Integrated Ombudsman Scheme text before the demo and update `window_basis` to say what you verified.
- `escalation_ready` is `true` only when `state` is `window_expired` **and** at least one event has a `reference_number`.
- `escalation_blockers` lists what is missing: `no_first_contact`, `window_not_elapsed`, `no_reference_number`. It is empty when `escalation_ready` is `true` or `state` is `resolved`.
- `next_steps` is empty when `state` is `resolved`.

**Direction is derived from type.** The frontend sets it automatically and does not ask the user. The backend rejects other combinations with `422 VALIDATION_ERROR`.

| `type` | Required `direction` |
|---|---|
| `bank_response` | `inbound` |
| `note` | `internal` |
| `call`, `sms`, `email`, `branch_visit`, `request_sent`, `grievance_filed`, `ombudsman_filed` | `outbound` |

An inbound SMS or email from the bank is logged as `bank_response`, not `sms` or `email`.

## 5. Flow to endpoint map

| Screen or action | Calls |
|---|---|
| Intake wizard, submit | `POST /cases`, then go to the case page |
| Case dashboard, load | In parallel: `GET /cases/{id}`, `GET /cases/{id}/status`, `GET /cases/{id}/events` |
| Add event (manual form) | `POST /cases/{id}/events`, then re-fetch status and events |
| Add event (upload or paste) | `POST /cases/{id}/evidence/parse` shows an editable form prefilled from `suggested_event`. On confirm: `POST /cases/{id}/events` with the edited event (`attachment_ids` should contain `attachment_id`). Then re-fetch status and events. |
| Attach a file with no parsing | `POST /cases/{id}/attachments`, then include the returned `id` in `attachment_ids` |
| Generate request letter | `POST /cases/{id}/letter`, show in an editable box. When the user confirms they sent it: `POST /cases/{id}/events` with `type: request_sent`. |
| Export | `GET /cases/{id}/export`, open or download as a blob |
| Demo | `POST /demo/reset`, then `POST /demo/seed` |

**Rules for parse.**
- `suggested_event` always satisfies `EventCreate`, so it can be posted unchanged after the user reviews it.
- Optional fields the parser could not find are `null` or omitted from `suggested_event`; the parser must not invent them. If it cannot find a date, it uses the upload time and adds a `"occurred_at_defaulted"` entry to `warnings`.
- Frontend: highlight any field with confidence below 0.7 and show every string in `warnings`.
- Parsing never saves an event. Only `POST /events` does.
- If the user discards a draft, the stored attachment is simply left behind. That is acceptable.

## 6. Errors

Every error response, whatever the framework, has this body:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [ { "field": "freeze_date", "issue": "must be a date in YYYY-MM-DD format" } ] } }
```

> **Backend warning:** framework default errors (FastAPI `{"detail": ...}`, Express HTML pages, Spring whitelabel) do not match this. Install a global exception handler that converts them, including for 404 on unknown routes and uncaught exceptions (`INTERNAL_ERROR`, HTTP 500).

| HTTP | `code` | Frontend behavior |
|---|---|---|
| 404 | `NOT_FOUND` | Show "case not found" and link back to the dashboard |
| 413 | `FILE_TOO_LARGE` | Say the limit is 10 MB |
| 415 | `UNSUPPORTED_FILE` | Say allowed types: PNG, JPEG, PDF, plain text |
| 422 | `VALIDATION_ERROR` | Show `issue` next to the field named in `field` |
| 422 | `PARSE_FAILED` | Show a message and open the manual event form |
| 500 | `INTERNAL_ERROR` | Show a generic retry message |

## 7. Frontend defensive rules

- Unknown enum value from the backend: render the raw string with a neutral style. Never crash.
- Ignore unknown extra fields in responses.
- Never send fields that are not in the request schema.
- Always show the `disclaimer` from `/status` on the status card.
- After every create or delete, re-fetch status and events. Do not update local state by guessing.

## 8. Changing the contract

Agree first, then edit. Both of you must see the change before it is merged.

| Change | Allowed? |
|---|---|
| New endpoint, new optional response field, new enum value | Yes. Edit `openapi.yaml`, bump the minor version, regenerate types, message the other person |
| Rename, remove, or change the type of an existing field, or change an enum value | Only before the end of Phase 2 (core features). After that it is frozen, so work around it |
| New required request field | Treat as breaking |

Keep a one-line changelog at the bottom of this file:

- 1.0.0: initial contract.

## 9. Integration smoke test (run together before every demo)

1. `POST /demo/reset`, then `POST /demo/seed`. Dashboard shows one case.
2. Open the case. Timeline shows seeded events oldest first, with reference numbers.
3. Status card shows the countdown, `window_basis`, and the disclaimer.
4. Add a manual event. Timeline and status refresh without a page reload.
5. Upload a screenshot. The draft form appears prefilled. Edit it and save. A new timeline entry appears with a "parsed" badge.
6. Upload an unsupported file (e.g. `.exe`). A friendly 415 message appears.
7. Generate a letter and confirm it. A `request_sent` event is added.
8. Export. The PDF opens and its events match the timeline order.
9. Stop the backend. The frontend shows a retry message, not a blank screen.
