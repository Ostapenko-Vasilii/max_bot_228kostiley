import { init, getDb, persist } from './init.js';
init();

export function createEvent(event) {
  return new Promise((resolve, reject) => {
    try {
      if (!event || typeof event !== 'object') return reject(new Error('Invalid event object'));

      const name = String(event.name || '').trim().slice(0, 255);
      const date = String(event.date || '').trim();
      const location = String(event.location || '').trim();
      const attachments = event.attachments ? JSON.stringify(event.attachments) : null;
      const text = String(event.text || '').trim();
      const status = 0;
      const creatorId = Number.isFinite(Number(event.creatorId)) ? Number(event.creatorId) : null;

      const db = getDb();
      const sql = `INSERT INTO events (event_name, event_date, event_location, attachments, event_text, event_status, creator_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`;
      db.run(sql, [name, date, location, attachments, text, status, creatorId]);

      try { persist(); } catch (e) { /* ignore persist errors */ }

      const lastRes = db.exec('SELECT last_insert_rowid() AS id');
      const lastID = (lastRes && lastRes[0] && lastRes[0].values && lastRes[0].values[0]) ? lastRes[0].values[0][0] : null;
      const changesRes = db.exec('SELECT changes() AS changes');
      const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : null;
      const numericLastID = lastID != null ? Number(lastID) : null;
      const finalLastID = Number.isInteger(numericLastID) && numericLastID > 0 ? numericLastID : null;
      const numericChanges = changes != null ? Number(changes) : 0;
      const finalChanges = Number.isFinite(numericChanges) ? numericChanges : 0;

      resolve({ eventId: finalLastID, lastID: finalLastID, changes: finalChanges });
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
      const stmt = db.prepare('SELECT event_id, event_name, event_date, event_location, attachments, event_text, event_status, creator_id FROM events WHERE event_id = ?');
      stmt.bind([id]);
      const row = stmt.step() ? stmt.get() : null;
      if (typeof stmt.free === 'function') stmt.free();
      if (!row) return resolve(null);

      resolve({
        event_id: row[0],
        event_name: row[1],
        event_date: row[2],
        event_location: row[3],
        attachments: row[4],
        event_text: row[5],
        event_status: row[6],
        creator_id: row[7]
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
      console.log('Event registration changes:', changes);
      resolve({ lastID, changes, existed: false });
    } catch (err) {
      console.error('Error in addEventRegistration:', err);
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

export function getEventIdsWithStatusZero() {
  return new Promise((resolve, reject) => {
    try {
      const db = getDb();
      const stmt = db.prepare('SELECT event_id FROM events WHERE event_status = ?');
      stmt.bind(['0']);
      const ids = [];
      while (stmt.step()) {
        const row = stmt.get();
        ids.push(Number(row[0]));
      }
      if (typeof stmt.free === 'function') stmt.free();
      resolve(ids);
    } catch (err) {
      reject(err);
    }
  });
}

export function isUserRegisteredForEvent(event_id, user_id) {
  return new Promise((resolve, reject) => {
    try {
      const eid = Number.isFinite(Number(event_id)) ? Number(event_id) : null;
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      if (eid === null || uid === null) return reject(new Error('Invalid event_id or user_id'));

      const db = getDb();
      const stmt = db.prepare('SELECT 1 FROM event_registrations WHERE event_id = ? AND user_id = ? LIMIT 1');
      stmt.bind([eid, uid]);
      const registered = stmt.step();
      if (typeof stmt.free === 'function') stmt.free();
      
      resolve(registered);
    } catch (err) {
      reject(err);
    }
  });
}

export function getEventsByStatus(status) {
  return new Promise((resolve, reject) => {
    try {
      const numericStatus = Number(status);
      if (!Number.isFinite(numericStatus)) return reject(new Error('Invalid status'));

      const db = getDb();
      const stmt = db.prepare(`SELECT event_id, event_name, event_date, event_location, attachments, event_text, event_status, creator_id FROM events WHERE event_status = ? ORDER BY event_date IS NULL, event_date`);
      stmt.bind([numericStatus]);

      const events = [];
      while (stmt.step()) {
        const row = stmt.get();
        events.push({
          event_id: row[0],
          event_name: row[1],
          event_date: row[2],
          event_location: row[3],
          attachments: row[4],
          event_text: row[5],
          event_status: row[6],
          creator_id: row[7]
        });
      }
      if (typeof stmt.free === 'function') stmt.free();
      resolve(events);
    } catch (err) {
      reject(err);
    }
  });
}

export function getEventsWithStatusNot(status) {
  return new Promise((resolve, reject) => {
    try {
      const numericStatus = Number(status);
      if (!Number.isFinite(numericStatus)) return reject(new Error('Invalid status'));

      const db = getDb();
      const stmt = db.prepare(`SELECT event_id, event_name, event_date, event_location, attachments, event_text, event_status, creator_id FROM events WHERE event_status != ? ORDER BY event_date IS NULL, event_date`);
      stmt.bind([numericStatus]);

      const events = [];
      while (stmt.step()) {
        const row = stmt.get();
        events.push({
          event_id: row[0],
          event_name: row[1],
          event_date: row[2],
          event_location: row[3],
          attachments: row[4],
          event_text: row[5],
          event_status: row[6],
          creator_id: row[7]
        });
      }
      if (typeof stmt.free === 'function') stmt.free();
      resolve(events);
    } catch (err) {
      reject(err);
    }
  });
}

export function updateEventStatus(eventId, status) {
  return new Promise((resolve, reject) => {
    try {
      const id = Number(eventId);
      const numericStatus = Number(status);
      if (!Number.isInteger(id) || !Number.isFinite(numericStatus)) return reject(new Error('Invalid eventId or status'));

      const db = getDb();
      db.run('UPDATE events SET event_status = ? WHERE event_id = ?', [numericStatus, id]);

      try { persist(); } catch (e) { /* ignore persist errors */ }

      const changesRes = db.exec('SELECT changes() AS changes');
      const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : 0;
      resolve({ changes });
    } catch (err) {
      reject(err);
    }
  });
}

export function getEventParticipants(event_id) {
  return new Promise((resolve, reject) => {
    try {
      const eid = Number.isFinite(Number(event_id)) ? Number(event_id) : null;
      if (eid === null) return reject(new Error('Invalid event_id'));

      const db = getDb();
      // Получаем список зарегистрированных пользователей и их имена (если есть)
      const stmt = db.prepare(`SELECT er.user_id, u.first_name, u.last_name, er.registration_date, er.status
                               FROM event_registrations er
                               LEFT JOIN users u ON u.user_id = er.user_id
                               WHERE er.event_id = ? ORDER BY er.registration_date ASC`);
      stmt.bind([eid]);
      const participants = [];
      while (stmt.step()) {
        const row = stmt.get();
        participants.push({
          user_id: row[0],
          first_name: row[1] || null,
          last_name: row[2] || null,
          registration_date: row[3] || null,
          status: row[4] ?? 0
        });
      }
      if (typeof stmt.free === 'function') stmt.free();
      resolve(participants);
    } catch (err) {
      reject(err);
    }
  });
}

export function updateEventField(event_id, field, value) {
  return new Promise((resolve, reject) => {
    try {
      const eid = Number.isInteger(Number(event_id)) ? Number(event_id) : null;
      if (eid === null) return reject(new Error('Invalid event_id'));
      const allowed = {
        event_name: (v) => String(v || '').trim().slice(0, 255),
        event_date: (v) => String(v || '').trim(),
        event_location: (v) => String(v || '').trim().slice(0, 255),
        event_text: (v) => String(v || '').trim()
      };
      if (!(field in allowed)) return reject(new Error('Field not allowed'));
      const newVal = allowed[field](value);

      const db = getDb();
      db.run(`UPDATE events SET ${field} = ? WHERE event_id = ?`, [newVal, eid]);

      try { persist(); } catch (e) { /* ignore persist errors */ }

      const changesRes = db.exec('SELECT changes() AS changes');
      const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : 0;
      resolve({ changes });
    } catch (err) {
      reject(err);
    }
  });
}

export function getLatestEventIdByCreator(creatorId) {
  return new Promise((resolve, reject) => {
    try {
      const cid = Number(creatorId);
      if (!Number.isInteger(cid)) return reject(new Error('Invalid creatorId'));
      const db = getDb();
      const stmt = db.prepare('SELECT event_id FROM events WHERE creator_id = ? ORDER BY event_id DESC LIMIT 1');
      stmt.bind([cid]);
      const row = stmt.step() ? stmt.get() : null;
      if (typeof stmt.free === 'function') stmt.free();
      resolve(row ? Number(row[0]) : null);
    } catch (err) {
      reject(err);
    }
  });
}

export function findEventIdByDetails(event) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDb();
      const name = String(event?.name ?? '').trim();
      const date = String(event?.date ?? '').trim();
      const location = String(event?.location ?? '').trim();
      const text = String(event?.text ?? '').trim();
      const creator = Number.isInteger(Number(event?.creatorId)) ? Number(event.creatorId) : null;

      const stmt = db.prepare(`
        SELECT event_id
        FROM events
        WHERE event_name = ?
          AND event_date = ?
          AND event_location = ?
          AND event_text = ?
          AND (
            (? IS NULL AND creator_id IS NULL)
            OR creator_id = ?
          )
        ORDER BY event_id DESC
        LIMIT 1
      `);
      stmt.bind([name, date, location, text, creator, creator]);
      const row = stmt.step() ? stmt.get() : null;
      if (typeof stmt.free === 'function') stmt.free();
      resolve(row ? Number(row[0]) : null);
    } catch (err) {
      reject(err);
    }
  });
}


