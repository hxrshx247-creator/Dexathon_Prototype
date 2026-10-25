"""Create fictional demonstration inputs and an export without changing the running database."""
import io
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from datetime import timedelta

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont
from backend.app import create_app
from backend.domain import now


def main():
    target = ROOT / 'output/demo'
    target.mkdir(parents=True, exist_ok=True)
    date = (now() - timedelta(days=2)).strftime('%d/%m/%Y')
    lines = ['Example National Bank', f'Date: {date}', 'Reference: SR-2026-55102',
             'INR 45,000.00 is on hold.', 'Your account is under review.', 'We will update you shortly.']
    text = '\n'.join(lines)
    (target / 'bank-sms.txt').write_text(text, encoding='utf-8')
    image = Image.new('RGB', (1200, 650), '#ffffff')
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 36)
    except OSError:
        font = ImageFont.truetype('DejaVuSans.ttf', 36)
    for index, line in enumerate(lines):
        draw.text((48, 40 + index * 85), line, font=font, fill='#183c32')
    image.save(target / 'bank-sms.png')
    with TemporaryDirectory() as data_dir, TestClient(create_app(data_dir)) as client:
        case = client.post('/api/v1/demo/seed').json()
        base = '/api/v1/cases/' + case['id']
        with (target / 'bank-sms.png').open('rb') as source:
            draft = client.post(base + '/evidence/parse', files={'file': ('bank-sms.png', source, 'image/png')})
        draft.raise_for_status()
        saved = client.post(base + '/events', json=draft.json()['suggested_event'])
        saved.raise_for_status()
        pdf = client.get(base + '/export')
        pdf.raise_for_status()
        (target / 'sample-chronology.pdf').write_bytes(pdf.content)
    print('Created fictional SMS, screenshot and sample-chronology.pdf in output/demo')


if __name__ == '__main__':
    main()
