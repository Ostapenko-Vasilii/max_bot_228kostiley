import { init, getDb, persist } from './init.js';
init();

export function addUserRoles(user_id, role_id) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      const rid = Number.isFinite(Number(role_id)) ? Number(role_id) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));

      const db = getDb();
      const sql = 'INSERT OR REPLACE INTO user_roles (user_id, role_id) VALUES (?, ?)';
      db.run(sql, [uid, rid]);

      try { persist(); } catch (e) { /* ignore persist errors */ }

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
export function getUserRoles(user_id) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));

      const db = getDb();
      const stmt = db.prepare('SELECT role_id FROM user_roles WHERE user_id = ?');
      stmt.bind([uid]);
      const roles = [];
      while (stmt.step()) {
        const row = stmt.get(); // массив, первый элемент - role_id
        roles.push(row[0]);
      }
      if (typeof stmt.free === 'function') stmt.free();
      resolve(roles);
    } catch (err) {
      reject(err);
    }
  });
}
export function removeUserRole(user_id, role_id) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      const rid = Number.isFinite(Number(role_id)) ? Number(role_id) : null;
      if (uid === null || rid === null) return reject(new Error('Invalid arguments'));

      const db = getDb();
      const stmt = db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?');
      stmt.run([uid, rid]);
      if (typeof stmt.free === 'function') stmt.free();

      try { persist(); } catch (e) { /* ignore persist errors */ }

      resolve();
    } catch (err) {
      reject(err);
    }
  });
}