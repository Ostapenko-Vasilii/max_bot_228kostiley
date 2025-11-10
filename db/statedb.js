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
  if (fs.existsSync(DB_FILE)) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();

    addStatesTable();
    fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  }
}

export function getStateDb() {
  if (!db) init();
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