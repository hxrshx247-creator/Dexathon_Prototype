import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class Store:
    """SQLite transactions, foreign keys and a private attachment store."""

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / 'fairhold.sqlite3'
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS cases (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                    payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS event_case ON events(case_id);
                CREATE TABLE IF NOT EXISTS attachments (
                    id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                    payload TEXT NOT NULL, content BLOB NOT NULL);
                CREATE INDEX IF NOT EXISTS attachment_case ON attachments(case_id);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, table, identifier):
        assert table in ('cases', 'events', 'attachments')
        with self.connect() as db:
            row = db.execute(f'SELECT payload FROM {table} WHERE id=?', (identifier,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, table, case_id=None):
        assert table in ('cases', 'events', 'attachments')
        with self.connect() as db:
            rows = db.execute(f'SELECT payload FROM {table}' + (' WHERE case_id=?' if case_id else ''),
                              (case_id,) if case_id else ()).fetchall()
        return [json.loads(row[0]) for row in rows]

    def save(self, table, item, content=None):
        assert table in ('cases', 'events', 'attachments')
        with self.connect() as db:
            if table == 'cases':
                db.execute('INSERT INTO cases VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
                           (item['id'], json.dumps(item)))
            elif table == 'events':
                db.execute('INSERT INTO events VALUES (?,?,?)', (item['id'], item['case_id'], json.dumps(item)))
            else:
                db.execute('INSERT INTO attachments VALUES (?,?,?,?)',
                           (item['id'], item['case_id'], json.dumps(item), content))

    def content(self, identifier):
        with self.connect() as db:
            row = db.execute('SELECT content FROM attachments WHERE id=?', (identifier,)).fetchone()
        return bytes(row[0]) if row else None

    def delete_event(self, identifier):
        with self.connect() as db:
            db.execute('DELETE FROM events WHERE id=?', (identifier,))

    def reset(self):
        with self.connect() as db:
            db.execute('DELETE FROM cases')
