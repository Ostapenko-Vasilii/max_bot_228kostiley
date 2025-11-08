import { init, getDb, persist } from './init.js';
init();

export function createEvent(event) {
  return new Promise((resolve, reject) => {
    try {
      if (!event || typeof event !== 'object') return reject(new Error('Invalid event object'));

      const name = String(event.name || '').trim().slice(0, 255);
      const date = String(event.date || '').trim();
      const attachments = event.attachments ? JSON.stringify(event.attachments) : null;
      const text = String(event.text || '').trim();
      const status = String(event.status || '').trim().slice(0, 50);
      const creatorId = Number.isFinite(Number(event.creatorId)) ? Number(event.creatorId) : null;

      const db = getDb();
      const sql = `INSERT INTO events (event_name, event_date, attachments, event_text, event_status, creator_id)
                   VALUES (?, ?, ?, ?, ?, ?)`;
      db.run(sql, [name, date, attachments, text, status, creatorId]);

      try { persist(); } catch (e) { /* ignore persist errors */ }

      const lastRes = db.exec('SELECT last_insert_rowid() AS id');
      const lastID = (lastRes && lastRes[0] && lastRes[0].values && lastRes[0].values[0]) ? lastRes[0].values[0][0] : null;
      const changesRes = db.exec('SELECT changes() AS changes');
      const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : null;

      resolve({ lastID, changes });
    } catch (err) {
      reject(err);
    }
  });
}

export function getEventById(eventId) {
  return new Promise((resolve, reject) => {
    try {
      const id = Number(eventId);
      if (!Number.isInteger(id)) return reject(new Error('Invalid eventId'));

      const db = getDb();
      const stmt = db.prepare('SELECT event_id, event_name, event_date, attachments, event_text, event_status, creator_id FROM events WHERE event_id = ?');
      stmt.bind([id]);
      const row = stmt.step() ? stmt.get() : null;
      if (typeof stmt.free === 'function') stmt.free();
      if (!row) return resolve(null);

      resolve({
        event_id: row[0],
        event_name: row[1],
        event_date: row[2],
        attachments: row[3],
        event_text: row[4],
        event_status: row[5],
        creator_id: row[6]
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function addEventRegistration(event_id, user_id) {
  return new Promise((resolve, reject) => {
    try {
      const eid = Number.isFinite(Number(event_id)) ? Number(event_id) : null;
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      if (eid === null || uid === null) return reject(new Error('Invalid event_id or user_id'));

      const db = getDb();

      // проверим, есть ли уже регистрация
      const checkStmt = db.prepare('SELECT registration_id FROM event_registrations WHERE event_id = ? AND user_id = ?');
      checkStmt.bind([eid, uid]);
      const existing = checkStmt.step() ? checkStmt.get()[0] : null;
      if (typeof checkStmt.free === 'function') checkStmt.free();
      if (existing) return resolve({ registration_id: existing, existed: true });

      const regDate = new Date().toISOString();
      db.run('INSERT INTO event_registrations (event_id, user_id, registration_date, status) VALUES (?, ?, ?, ?)', [eid, uid, regDate, 0]);

      try { persist(); } catch (e) { /* ignore persist errors */ }

      const lastRes = db.exec('SELECT last_insert_rowid() AS id');
      const lastID = (lastRes && lastRes[0] && lastRes[0].values && lastRes[0].values[0]) ? lastRes[0].values[0][0] : null;
      const changesRes = db.exec('SELECT changes() AS changes');
      const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : null;

      resolve({ lastID, changes, existed: false });
    } catch (err) {
      reject(err);
    }
  });
}

export function removeEventRegistration(event_id, user_id) {
  return new Promise((resolve, reject) => {
    try {
      const eid = Number.isFinite(Number(event_id)) ? Number(event_id) : null;
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      if (eid === null || uid === null) return reject(new Error('Invalid event_id or user_id'));

      const db = getDb();
      db.run('DELETE FROM event_registrations WHERE event_id = ? AND user_id = ?', [eid, uid]);

      try { persist(); } catch (e) { /* ignore persist errors */ }

      const changesRes = db.exec('SELECT changes() AS changes');
      const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : 0;
      resolve({ deleted: changes > 0, changes });
    } catch (err) {
      reject(err);
    }
  });
}

