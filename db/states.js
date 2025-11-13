import { initStateDb, getStateDb, persistStateDb } from './statedb.js';
initStateDb();

export function addUserState(user_id, state) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      const stateValue = state ? String(state).trim().slice(0, 255) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));

      const db = getStateDb();
      const sql = 'INSERT OR REPLACE INTO user_states (user_id, state) VALUES (?, ?)';
      db.run(sql, [uid, stateValue]);

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
export function getUserState(user_id) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));

      const db = getStateDb();
      const stmt = db.prepare('SELECT state FROM user_states WHERE user_id = ?');
      stmt.bind([uid]);
      const state = stmt.step() ? stmt.get()[0] : null;
      if (typeof stmt.free === 'function') stmt.free();
      resolve(state);
    } catch (err) {
      reject(err);
    }
  });
}