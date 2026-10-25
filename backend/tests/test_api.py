import io
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft4Validator, FormatChecker
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader

from backend.app import SPEC, create_app
from backend.domain import iso, status


def schema_check(response, name):
    response.raise_for_status()
    Draft4Validator(dict(SPEC, **{'$ref': f'#/components/schemas/{name}'}),
                    format_checker=FormatChecker()).validate(response.json())
    return response.json()


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        yield client


def case(client):
    return schema_check(client.post('/api/v1/cases', json={
        'bank_name': 'Test Bank', 'account_type': 'savings', 'freeze_type': 'debit_hold',
        'freeze_date': '2026-09-01', 'amount_held_minor': 4500000, 'urgency': ['rent'],
    }), 'Case')


def event(**extra):
    return dict(type='call', direction='outbound', occurred_at='2026-09-02T12:00:00+05:30',
                summary='Called the bank', **extra)


def test_every_contract_endpoint_and_persistence(client, tmp_path):
    assert client.get('/api/v1/health').json() == {'status': 'ok'}
    c = case(client)
    base = '/api/v1/cases/' + c['id']
    assert schema_check(client.get('/api/v1/cases'), 'CaseList')['items'][0] == c
    assert schema_check(client.get(base), 'Case') == c
    updated = schema_check(client.patch(base, json={'reason_given': 'Under review', 'account_last4': '1234'}), 'Case')
    assert updated['reason_given'] == 'Under review'
    assert schema_check(client.get(base + '/status'), 'CaseStatusSummary')['state'] == 'awaiting_first_contact'
    a = schema_check(client.post(base + '/attachments', files={'file': ('message.txt', b'Reference SR-55102 under review', 'text/plain')}), 'Attachment')
    assert client.get(a['url']).content == b'Reference SR-55102 under review'
    e = schema_check(client.post(base + '/events', json=event(reference_number='CC-001', attachment_ids=[a['id']])), 'Event')
    assert e['occurred_at'] == '2026-09-02T06:30:00.000000Z'
    schema_check(client.get(base + '/events'), 'EventList')
    for purpose in ('initial_request', 'follow_up'):
        letter = schema_check(client.post(base + '/letter', json={'purpose': purpose}), 'Letter')
        assert 'CC-001' in letter['body'] and 'INR 45,000.00' in letter['body']
    parsed = schema_check(client.post(base + '/evidence/parse', data={'text': '2026-10-09 Reference SR-2026-55102: INR 45,000.50 on hold. Under review.'}), 'EvidenceDraft')
    assert parsed['suggested_event']['reference_number'] == 'SR-2026-55102'
    assert any('4500050' in w for w in parsed['warnings'])
    assert len(client.get(base + '/events').json()['items']) == 1  # Parsing does not save.
    schema_check(client.post(base + '/events', json=parsed['suggested_event']), 'Event')
    pdf = client.get(base + '/export')
    assert pdf.headers['content-type'] == 'application/pdf' and 'attachment;' in pdf.headers['content-disposition']
    text = '\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(pdf.content)).pages)
    assert text.index('Called the bank') < text.index('Bank communication:')
    assert 'CC-001' in text and 'message.txt' in text and 'not legal advice' in text.lower()
    # Re-open the same SQLite store in a fresh application instance.
    with TestClient(create_app(tmp_path)) as reopened:
        assert reopened.get(base).json()['event_count'] == 2
        assert reopened.get(a['url']).content == client.get(a['url']).content
    assert client.delete(base + '/events/' + e['id']).status_code == 204
    assert client.delete(base + '/events/' + e['id']).status_code == 404
    seeded = schema_check(client.post('/api/v1/demo/seed'), 'Case')
    assert seeded['event_count'] == 5
    assert client.get('/api/v1/cases/' + seeded['id'] + '/status').json()['escalation_ready']
    assert client.post('/api/v1/demo/reset').status_code == 204
    assert client.get('/api/v1/cases').json() == {'items': []}
    assert client.get(a['url']).status_code == 404


@pytest.mark.parametrize('payload', [
    {'freeze_date': '2026-02-30'}, {'amount_held_minor': -1}, {'amount_held_minor': True},
    {'amount_held_minor': 10.5}, {'bank_name': ' '}, {'account_last4': '123'}, {'urgency': ['urgent']},
    {'urgency': None}, {'account_type': 'invalid'}, {'reason_given': 'x' * 1001},
])
def test_case_validation(client, payload):
    c = case(client)
    response = client.patch('/api/v1/cases/' + c['id'], json=payload)
    assert response.status_code == 422
    Draft4Validator(dict(SPEC, **{'$ref': '#/components/schemas/Error'})).validate(response.json())


@pytest.mark.parametrize('field,value', [('direction', 'inbound'), ('occurred_at', '2026-10-01T10:00'),
    ('occurred_at', '2026-02-30T10:00:00Z'), ('is_resolution', 'false'), ('attachment_ids', 'x'),
    ('source', 'ai'), ('summary', ' '), ('attachment_ids', ['missing'])])
def test_event_validation(client, field, value):
    c = case(client)
    payload = event()
    payload[field] = value
    response = client.post('/api/v1/cases/' + c['id'] + '/events', json=payload)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'VALIDATION_ERROR'


def test_attachment_case_isolation(client):
    a, b = case(client), case(client)
    base = '/api/v1/cases/' + a['id']
    attachment = client.post(base + '/attachments', files={'file': ('test.txt', b'hello', 'text/plain')}).json()
    other = '/api/v1/cases/' + b['id']
    assert client.post(other + '/events', json=event(attachment_ids=[attachment['id']])).status_code == 422
    assert client.get(other + '/attachments/' + attachment['id']).status_code == 404


def test_errors_upload_limits_and_cors(client):
    c = case(client)
    base = '/api/v1/cases/' + c['id']
    assert client.get('/api/v1/missing').json()['error']['code'] == 'NOT_FOUND'
    assert client.get('/api/v1/cases/missing/events').status_code == 404
    assert client.post('/api/v1/cases', content='{').status_code == 422
    for mime, data in [('application/octet-stream', b'MZ'), ('image/png', b'fake'), ('text/plain', b'\0')]:
        assert client.post(base + '/attachments', files={'file': ('bad.exe', data, mime)}).status_code == 415
    response = client.post(base + '/attachments', files={'file': ('huge.txt', b'a' * (10 * 1024 * 1024 + 1), 'text/plain')})
    assert response.status_code == 413
    response = client.post(base + '/attachments', files={'file': ('huge.txt', b'a' * (11 * 1024 * 1024), 'text/plain')})
    assert response.status_code == 413
    assert client.post(base + '/evidence/parse', data={'text': ' '}).status_code == 422
    assert client.post(base + '/evidence/parse', data={'text': 'a' * 5001}).status_code == 422
    assert client.post(base + '/evidence/parse', data={'text': '!!!'}).json()['error']['code'] == 'PARSE_FAILED'
    draft = schema_check(client.post(base + '/evidence/parse', data={'text': 'Your account is under review.'}), 'EvidenceDraft')
    assert 'occurred_at_defaulted' in draft['warnings'] and draft['confidence']['occurred_at'] == 0
    response = client.options(base, headers={'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'PATCH'})
    assert response.headers['access-control-allow-origin'] == 'http://localhost:5173'
    response = client.get(base + '/export', headers={'Origin': 'http://localhost:5173'})
    assert 'Content-Disposition' in response.headers['access-control-expose-headers']


def test_real_screenshot_ocr(client, tmp_path):
    image = Image.new('RGB', (1200, 500), 'white')
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 36)
    except OSError:
        font = ImageFont.truetype('DejaVuSans.ttf', 36)
    for i, line in enumerate(['Example National Bank', 'Date: 09/10/2026', 'Reference: SR-2026-55102',
                              'INR 45,000.00 is on hold.', 'Your account is under review.']):
        draw.text((45, 35 + i * 80), line, fill='black', font=font)
    out = io.BytesIO()
    image.save(out, 'PNG')
    c = case(client)
    base = '/api/v1/cases/' + c['id']
    draft = schema_check(client.post(base + '/evidence/parse', files={'file': ('sms.png', out.getvalue(), 'image/png')}), 'EvidenceDraft')
    assert draft['suggested_event']['reference_number'] == 'SR-2026-55102'
    assert draft['suggested_event']['occurred_at'].startswith('2026-10-08T18:30')
    assert any('4500000' in w for w in draft['warnings'])
    assert draft['attachment_id'] in draft['suggested_event']['attachment_ids']
    assert client.get(base + '/events').json() == {'items': []}
    schema_check(client.post(base + '/events', json=draft['suggested_event']), 'Event')


def test_resolution_and_deletion_recompute(client):
    c = schema_check(client.post('/api/v1/demo/seed'), 'Case')
    base = '/api/v1/cases/' + c['id']
    ev = event(is_resolution=True)
    saved = client.post(base + '/events', json=ev).json()
    resolved = client.get(base + '/status').json()
    assert resolved['state'] == 'resolved' and resolved['next_steps'] == [] and resolved['escalation_blockers'] == []
    client.delete(base + '/events/' + saved['id'])
    assert client.get(base + '/status').json()['escalation_ready']


@pytest.mark.parametrize('days,ref,resolved,expected', [
    (None, None, False, 'awaiting_first_contact'), (29, 'SR-1', False, 'within_window'),
    (30, 'SR-1', False, 'within_window'), (31, 'SR-1', False, 'window_expired'),
    (31, None, False, 'window_expired'), (31, 'SR-1', True, 'resolved'),
])
def test_rule_boundaries(client, days, ref, resolved, expected):
    at = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
    c = case(client)
    evs = [] if days is None else [dict(event(reference_number=ref, is_resolution=resolved),
        occurred_at=iso(at - timedelta(days=days)))]
    result = status(c, evs, client.app.state.rules, at)
    assert result['state'] == expected
    assert result['escalation_ready'] == (expected == 'window_expired' and ref is not None)
    if days == 30:
        assert result['days_remaining'] == 0


def test_ist_midnight_and_config_override(client):
    c = case(client)
    rules = dict(client.app.state.rules, window_days=2)
    evs = [dict(event(reference_number='SR-1', is_resolution=False), occurred_at='2026-10-22T20:00:00Z')]
    # Contact was already October 23 in India, so deadline is October 25.
    assert status(c, evs, rules, datetime(2026, 10, 25, 18, 29, tzinfo=timezone.utc))['state'] == 'within_window'
    assert status(c, evs, rules, datetime(2026, 10, 25, 18, 30, tzinfo=timezone.utc))['state'] == 'window_expired'


def test_rfc3339_lowercase_timestamp(client):
    c = case(client)
    payload = event()
    payload['occurred_at'] = '2026-10-01t10:00:00z'
    saved = schema_check(client.post('/api/v1/cases/' + c['id'] + '/events', json=payload), 'Event')
    assert saved['occurred_at'] == '2026-10-01T10:00:00.000000Z'
