"""Exercise a live deployment with fictional data; rerun to verify persistence."""
import argparse
import io
import json
from pathlib import Path

import httpx
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    parser.add_argument('--record', default='tmp/docker-verification.json')
    args = parser.parse_args()
    record_path = Path(args.record)
    with httpx.Client(base_url=args.url, timeout=120) as client:
        def get(path):
            response = client.get(path)
            response.raise_for_status()
            return response
        assert get('/api/v1/health').json() == {'status': 'ok'}
        assert 'FairHold' in get('/').text
        if record_path.exists():
            record = json.loads(record_path.read_text())
            base = '/api/v1/cases/' + record['case_id']
            assert get(base).json()['event_count'] == record['event_count']
            assert get(record['attachment_url']).content == (ROOT / 'output/demo/bank-sms.png').read_bytes()
            print('Restart persistence: case, events and original attachment retained')
        else:
            seeded = client.post('/api/v1/demo/seed')
            seeded.raise_for_status()
            case = seeded.json()
            base = '/api/v1/cases/' + case['id']
            before = len(get(base + '/events').json()['items'])
            with (ROOT / 'output/demo/bank-sms.png').open('rb') as screenshot:
                response = client.post(base + '/evidence/parse', files={'file': ('bank-sms.png', screenshot, 'image/png')})
            response.raise_for_status()
            draft = response.json()
            assert draft['suggested_event']['reference_number'] == 'SR-2026-55102'
            assert any('4500000' in w for w in draft['warnings'])
            assert len(get(base + '/events').json()['items']) == before
            saved = client.post(base + '/events', json=draft['suggested_event'])
            saved.raise_for_status()
            record = {'case_id': case['id'], 'event_count': before + 1,
                      'attachment_url': base + '/attachments/' + draft['attachment_id']}
            record_path.parent.mkdir(parents=True, exist_ok=True)
            record_path.write_text(json.dumps(record, indent=2))
            print('Screenshot OCR, amount/reference extraction, draft-only parsing and confirmed save: passed')
        assert get(base + '/status').json()['escalation_ready']
        letter = client.post(base + '/letter', json={'purpose': 'follow_up'})
        letter.raise_for_status()
        assert 'SR-2026-55102' in letter.json()['body']
        pdf = get(base + '/export')
        assert pdf.headers['content-type'] == 'application/pdf'
        pages = PdfReader(io.BytesIO(pdf.content)).pages
        assert 'SR-2026-55102' in '\n'.join(page.extract_text() for page in pages)
        assert get(base).json()['event_count'] == record['event_count']
        print(f"Health, frontend, status, letter and {len(pages)}-page PDF: passed")
        print('Case: ' + args.url + '/cases/' + record['case_id'])


if __name__ == '__main__':
    main()
