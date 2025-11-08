import { init, getDb, persist } from './init.js';
init();

export function saveMessage(mid, seq) {
  const db = getDb();
  const stmt = db.prepare('INSERT OR REPLACE INTO messages (mid, seq) VALUES (?, ?)');
  stmt.run([mid ?? null, seq ?? null]);
  if (typeof stmt.free === 'function') stmt.free();
  persist();
}

export function getMessageByMid(mid) {
  const db = getDb();
  const stmt = db.prepare('SELECT mid, seq FROM messages WHERE mid = ?');
  stmt.bind([mid]);
  const row = stmt.step() ? stmt.get() : null;
  if (typeof stmt.free === 'function') stmt.free();
  if (!row) return null;
  return { mid: row[0], seq: row[1] };
}
