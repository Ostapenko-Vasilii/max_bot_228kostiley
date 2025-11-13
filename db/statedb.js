import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.resolve(__dirname, '..', 'states.sqlite');
const SQLJS_DIST = path.resolve(__dirname, '..', 'node_modules', 'sql.js', 'dist');

const SQL = await initSqlJs({
  locateFile: file => path.join(SQLJS_DIST, file)
});

let db;

export function initStateDb() {
  if (db) return;
  const exists = fs.existsSync(DB_FILE);
  if (exists) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();
  }

  addStatesTable();
  addEventsMessagesTable();
  addAdminStatesTable();

  if (!exists) {
    fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  }
}

export function getStateDb() {
  if (!db) initStateDb();
  return db;
}
export function persistStateDb() {
  if (!db) return;
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function addStatesTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS user_states (
      user_id INTEGER PRIMARY KEY,
      state TEXT DEFAULT 'registering'
    );`
  );
}

function addEventsMessagesTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS events_messages (
      mid TEXT PRIMARY KEY,
      event_id InTEGER
    );`
  );
}

function addAdminStatesTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS admin_states (
      user_id INTEGER PRIMARY KEY,
      action TEXT,
      payload TEXT
    );`
  );
}

// Новые экспортируемые helper-методы:
export function getAdminState(user_id) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isInteger(Number(user_id)) ? Number(user_id) : null;
      if (uid === null) return resolve(null);
      const db = getStateDb();
      const stmt = db.prepare('SELECT action, payload FROM admin_states WHERE user_id = ?');
      stmt.bind([uid]);
      const row = stmt.step() ? stmt.get() : null;
      if (typeof stmt.free === 'function') stmt.free();
      if (!row) return resolve(null);
      resolve({ action: row[0], payload: row[1] });
    } catch (err) {
      reject(err);
    }
  });
}

export function setAdminState(user_id, action, payload) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isInteger(Number(user_id)) ? Number(user_id) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));
      const db = getStateDb();
      db.run('INSERT OR REPLACE INTO admin_states (user_id, action, payload) VALUES (?, ?, ?)', [uid, String(action || ''), payload === undefined || payload === null ? null : String(payload)]);
      try { persistStateDb(); } catch (e) { /* ignore */ }
      resolve(true);
    } catch (err) {
      reject(err);
    }
  });
}

export function clearAdminState(user_id) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number.isInteger(Number(user_id)) ? Number(user_id) : null;
      if (uid === null) return reject(new Error('Invalid user_id'));
      const db = getStateDb();
      db.run('DELETE FROM admin_states WHERE user_id = ?', [uid]);
      try { persistStateDb(); } catch (e) { /* ignore */ }
      resolve(true);
    } catch (err) {
      reject(err);
    }
  });
}