from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

DIRECTIONS = {**dict.fromkeys(('call', 'sms', 'email', 'branch_visit', 'request_sent',
                              'grievance_filed', 'ombudsman_filed'), 'outbound'),
              'bank_response': 'inbound', 'note': 'internal'}
BANK_FACING = set(DIRECTIONS) - {'ombudsman_filed', 'bank_response', 'note'}


def now():
    return datetime.now(timezone.utc)


def iso(value=None):
    return (value or now()).astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def status(case, events, rules, at=None):
    at = at or now()
    tz = ZoneInfo(rules['timezone'])
    today = at.astimezone(tz).date()
    first = next((e for e in events if e['direction'] == 'outbound' and e['type'] in BANK_FACING), None)
    deadline = (datetime.fromisoformat(first['occurred_at'].replace('Z', '+00:00')).astimezone(tz).date()
                + timedelta(days=rules['window_days'])) if first else None
    remaining = (deadline - today).days if deadline else None
    resolved = any(e['is_resolution'] for e in events)
    state = ('resolved' if resolved else 'awaiting_first_contact' if not first else
             'window_expired' if remaining < 0 else 'within_window')
    has_ref = any(e['reference_number'] and e['reference_number'].strip() for e in events)
    ready = state == 'window_expired' and bool(has_ref)
    blockers, steps = [], []
    def add(target, code, label):
        target.append({'code': code, 'label': label})
    if not resolved:
        if not first:
            add(blockers, 'no_first_contact', 'Log your first contact with the bank')
            add(steps, 'make_first_request', 'Send the bank a written request and keep proof of receipt')
        elif state == 'within_window':
            add(blockers, 'window_not_elapsed', "The configured response window has not ended yet")
            add(steps, 'wait_for_response', 'Keep the bank’s written responses and add them to your record')
        if not has_ref:
            add(blockers, 'no_reference_number', 'Add a reference number from your contact with the bank')
            add(steps, 'log_reference_number', 'Ask the bank for a complaint or service reference number')
        if ready:
            add(steps, 'escalate_to_ombudsman', 'Review your packet and check current RBI filing requirements')
            add(steps, 'consult_legal_aid', 'Ask a legal aid clinic about your options')
        elif state == 'window_expired':
            add(steps, 'follow_up_with_bank', 'Send a written follow-up and ask for a reference number')
    return dict(case_id=case['id'], state=state, as_of=iso(at),
                days_since_freeze=max(0, (today - datetime.fromisoformat(case['freeze_date']).date()).days),
                first_contact_at=first['occurred_at'] if first else None,
                window_days=rules['window_days'] if first else None,
                window_deadline=deadline.isoformat() if deadline else None, days_remaining=remaining,
                window_basis=rules['window_basis'], escalation_ready=ready,
                escalation_blockers=blockers, next_steps=steps, disclaimer=rules['disclaimer'])
