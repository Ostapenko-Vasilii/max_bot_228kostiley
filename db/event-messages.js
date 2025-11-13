import { initStateDb, getStateDb, persistStateDb } from './statedb.js';
initStateDb();

export function addEventMessage(mid, message) {
  return new Promise((resolve, reject) => {
    try {
      const midValue = mid ? String(mid).trim().slice(0, 255) : null;
      const eventValue = message !== undefined && message !== null ? String(message).trim().slice(0, 255) : null;
      if (!midValue || eventValue === null) return reject(new Error('Invalid mid or event id'));

      const db = getStateDb();
      const sql = 'INSERT OR REPLACE INTO events_messages (mid, event_id) VALUES (?, ?)';
      db.run(sql, [midValue, eventValue]);

      try { persistStateDb(); } catch (e) { /* ignore persist errors */ }

      const changesRes = db.exec('SELECT changes() AS changes');
      const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : null;
      const lastRes = db.exec('SELECT last_insert_rowid() AS id');
      const lastID = (lastRes && lastRes[0] && lastRes[0].values && lastRes[0].values[0]) ? lastRes[0].values[0][0] : null;

      resolve({ lastID, changes });
    } catch (err) {
      reject(err);
    }
  });
}
export function getEventByMid(mid) {
  return new Promise((resolve, reject) => {
    try {
      const midValue = mid ? String(mid).trim().slice(0, 255) : null;
      if (!midValue) return reject(new Error('Invalid mid'));

      const db = getStateDb();
      const stmt = db.prepare('SELECT event_id FROM events_messages WHERE mid = ?');
      stmt.bind([midValue]);
      const message = stmt.step() ? stmt.get()[0] : null;
      if (typeof stmt.free === 'function') stmt.free();
      resolve(message);
    } catch (err) {
      reject(err);
    }
  });
}
