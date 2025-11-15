import { init, getDb, persist } from './init.js';
init();

export function saveUser(user_id, first_name, last_name, univesity_id, drom_id, room, policy_agreed) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));

      const fn = first_name ? String(first_name).trim().slice(0, 255) : null;
      const ln = last_name ? String(last_name).trim().slice(0, 255) : null;
      const uni = univesity_id ? String(univesity_id).trim().slice(0, 255) : null;
      const dr = drom_id ? String(drom_id).trim().slice(0, 255) : null;
      const rm = room ? String(room).trim().slice(0, 100) : null;
      const policy = typeof policy_agreed === 'boolean' ? (policy_agreed ? 1 : 0)
                    : (policy_agreed === null || policy_agreed === undefined ? null : Number(policy_agreed) ? 1 : 0);

      const db = getDb();
      const sql = 'INSERT OR REPLACE INTO users (user_id, first_name, last_name, univesity_id, drom_id, room, policy_agreed) VALUES (?, ?, ?, ?, ?, ?, ?)';
      db.run(sql, [uid, fn, ln, uni, dr, rm, policy]);

      try { persist(); } catch (e) { /* ignore persist errors */ }

      // Получаем metadata через SQL
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

export function getUserById(user_id) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));

      const db = getDb();
      const stmt = db.prepare('SELECT user_id, first_name, last_name, univesity_id, drom_id, room, policy_agreed FROM users WHERE user_id = ?');
      stmt.bind([uid]);
      const row = stmt.step() ? stmt.get() : null;
      if (typeof stmt.free === 'function') stmt.free();
      if (!row) return resolve(null);

      // stmt.get() возвращает массив значений в том же порядке, что и SELECT
      resolve({
        user_id: row[0],
        first_name: row[1],
        last_name: row[2],
        univesity_id: row[3],
        drom_id: row[4],
        room: row[5],
        policy_agreed: row[6]
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function getAllUsers() {
  return new Promise((resolve, reject) => {
    try {
      const db = getDb();
      let stmt;
      try {
        stmt = db.prepare(`
            SELECT user_id, first_name, last_name, room
            FROM users
            ORDER BY user_id ASC
        `);
      } catch {
        stmt = db.prepare(`
            SELECT user_id, first_name, last_name, room_number
            FROM users
            ORDER BY user_id ASC
        `);
      }
      const users = [];
      while (stmt.step()) {
        const row = stmt.get();
        users.push({
          user_id: Number(row[0]),
          first_name: row[1] ?? '',
          last_name: row[2] ?? '',
          room: row[3] ?? null,
        });
      }
      if (typeof stmt.free === 'function') stmt.free();
      resolve(users);
    } catch (err) {
      reject(err);
    }
  });
}

export function updateUserFields(user_id, fields = {}) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));

      const allowed = {
        first_name: (v) => v == null ? null : (String(v).trim().slice(0, 255) || null),
        last_name: (v) => v == null ? null : (String(v).trim().slice(0, 255) || null),
        room: (v) => v == null ? null : (String(v).trim().slice(0, 100) || null),
      };

      const assignments = [];
      const values = [];
      for (const [field, normalizer] of Object.entries(allowed)) {
        if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
        assignments.push(`${field} = ?`);
        values.push(normalizer(fields[field]));
      }

      if (!assignments.length) return resolve({ changes: 0 });

      const db = getDb();
      db.run(`UPDATE users SET ${assignments.join(', ')} WHERE user_id = ?`, [...values, uid]);

      try { persist(); } catch { /* ignore persist errors */ }

      const changesRes = db.exec('SELECT changes() AS changes');
      const changes = changesRes?.[0]?.values?.[0]?.[0] ?? 0;
      resolve({ changes: Number(changes) || 0 });
    } catch (err) {
      reject(err);
    }
  });
}

