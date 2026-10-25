# Member B handoff

Member A's completed UI already has typed API requests, intake, timeline, evidence review, letter generation, export and escalation screens. No layout overhaul was needed. The integration edit makes production builds use the same API origin. Development remains on port 5173 with backend port 8000.

Keep `contract/` and generated frontend types unchanged unless both members agree on a revision. The real server replaces `npm run mock`. The frontend sends exactly the same requests to either implementation.

## Three-minute integration demo

1. **0:00-0:25:** Explain the problem: essential funds are held, and records are scattered. Load the demo case. All bank names and evidence are fictional.
2. **0:25-0:50:** Show the status card, 35-day-old written complaint, reference numbers, urgency and the visible policy/disclaimer. The seeded case is past the configured 30-day window.
3. **0:50-1:40:** Add evidence using `output/demo/bank-sms.png` or paste `output/demo/bank-sms.txt`. Show OCR-derived date, reference, INR amount in the message and warning, and the bank statement. Point out low-confidence fields. Change a field, then save. Explain that extraction alone never writes a timeline event.
4. **1:40-2:10:** Open the letter sheet. Show that references and case details are inserted. Do not mark it sent unless demonstrating the explicit send-confirmation flow; the app itself does not send mail.
5. **2:10-2:40:** Open the escalation packet and download the actual PDF. Show that its chronology and reference numbers match the dashboard, with the original-file manifest and disclaimer.
6. **2:40-3:00:** Explain feasibility: local CPU OCR, no AI key, SQLite persistence, config-driven rules, one-container deployment. State the next steps: authentication, maintained legal rules and multilingual extraction.

## Known integration points

- A parsed INR amount stays in the event text and review warning because EventCreate has no amount field. It does not overwrite intake.
- The timeline UI shows attachment counts. `Attachment.url` supports retrieving original files; the PDF includes a manifest, not embedded originals.
- Uploads with no readable text return `PARSE_FAILED`; the UI opens its manual-entry fallback.
- The seeded case is deliberately escalation-ready under the prototype policy. Fresh intake starts with `awaiting_first_contact`.
- `demo/reset` clears all data in that server instance; use only fictional records.
- A pitch deck remains Member A's deliverable. The feasibility content is available in the architecture document for that slide.
