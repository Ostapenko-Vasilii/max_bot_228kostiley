import { init, getDb, persist } from './init.js';
init();

export function saveUser(user_id, first_name, last_name, university_id, dorm_id, room, policy_agreed) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));

      const fn = first_name ? String(first_name).trim().slice(0, 255) : null;
      const ln = last_name ? String(last_name).trim().slice(0, 255) : null;
  const uni = university_id ? String(university_id).trim().slice(0, 255) : null;
  const dr = dorm_id ? String(dorm_id).trim().slice(0, 255) : null;
      const rm = room ? String(room).trim().slice(0, 100) : null;
      const policy = typeof policy_agreed === 'boolean' ? (policy_agreed ? 1 : 0)
                    : (policy_agreed === null || policy_agreed === undefined ? null : Number(policy_agreed) ? 1 : 0);

      const db = getDb();
  const sql = 'INSERT OR REPLACE INTO users (user_id, first_name, last_name, university_id, dorm_id, room, policy_agreed) VALUES (?, ?, ?, ?, ?, ?, ?)';
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
  const stmt = db.prepare('SELECT user_id, first_name, last_name, university_id, dorm_id, room, policy_agreed FROM users WHERE user_id = ?');
      stmt.bind([uid]);
      const row = stmt.step() ? stmt.get() : null;
      if (typeof stmt.free === 'function') stmt.free();
      if (!row) return resolve(null);

      // stmt.get() возвращает массив значений в том же порядке, что и SELECT
      resolve({
        user_id: row[0],
        first_name: row[1],
        last_name: row[2],
        university_id: row[3],
        dorm_id: row[4],
        room: row[5],
        policy_agreed: row[6]
      });
    } catch (err) {
      reject(err);
    }
  });
}

