# API behavior

The [OpenAPI schema](openapi.yaml) defines request and response shapes. These rules describe how the implementation behaves.

## Data conventions

- Base path: `/api/v1`; JSON fields use `snake_case`.
- IDs are opaque UUIDs. Money is integer paise in INR.
- Timestamps use ISO 8601 UTC with `Z`; date-only fields use `YYYY-MM-DD`.
- Responses include nullable fields as `null` and empty arrays as `[]`.
- Lists use `{ "items": [...] }`. Cases are newest first; events are oldest first by `occurred_at`, then `created_at`.
- Errors use `{ "error": { "code": "...", "message": "...", "details": [] } }`.

## Case status

The backend computes status on every request; the frontend displays it.

1. Any event marked `is_resolution` makes the case `resolved`.
2. Without a bank-facing event, the case is `awaiting_first_contact`.
3. Through the configured deadline date, the case is `within_window`.
4. On the following calendar day, it becomes `window_expired`.

Bank-facing events are outbound calls, SMS, emails, branch visits, requests and grievances. The first such event starts the configured window. India calendar dates are used by default. Configuration lives in `backend/rules.json`; restart after edits.

Packet readiness requires an expired window and at least one reference number. Blockers report missing first contact, an unelapsed window or a missing reference. Resolved cases have no blockers or next steps. This is a prototype preparation policy, not an assessment of legal eligibility.

Direction follows event type: `bank_response` is inbound, `note` is internal, and all other event types are outbound. Invalid combinations return `422 VALIDATION_ERROR`.

## Evidence and outputs

- PNG, JPEG, PDF and UTF-8 text uploads are limited to 10 MB. Attachments must belong to the event's case.
- Parsing stores the attachment and returns an editable draft. It never saves a timeline event; only a confirmed `POST /cases/{id}/events` does that.
- Missing dates use upload time with an `occurred_at_defaulted` warning. Dates without a timezone are interpreted in Asia/Kolkata and flagged for review.
- Confidence values are review heuristics, not calibrated probabilities. The parser never infers resolution automatically.
- The event schema has no amount field. Detected INR amounts remain in the message text and review warnings; intake amounts stay unchanged.
- Letter generation does not send a message or create an event. PDF export preserves timeline order and includes an attachment manifest, not embedded original files.
- Original files are retrievable through the returned `Attachment.url`, scoped to their case.
- Demo reset deletes all cases, events and attachments in the instance. Demo seed creates fictional records.

After a mutation, the frontend reloads status and events from the backend. The status card displays the server's policy basis and not-legal-advice disclaimer.
