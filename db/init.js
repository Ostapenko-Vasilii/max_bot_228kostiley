import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.resolve(__dirname, '..', 'data.sqlite');
const SQLJS_DIST = path.resolve(__dirname, '..', 'node_modules', 'sql.js', 'dist');

const SQL = await initSqlJs({
  locateFile: file => path.join(SQLJS_DIST, file)
});

let db;

export function init() {
  if (db) return;
  if (fs.existsSync(DB_FILE)) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();

    addUserTable();
    addUserRolesTable();
    addRolesTable();
    addEventsTable();
    addRegistrationsToEventsTable();
    addEventMessagesTable();
    addSettingsTable();
    addReportsTable();
    
    fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  }
}

export function getDb() {
  if (!db) init();
  return db;
}

export function persist() {
  if (!db) return;
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function addUserTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      univesity_id INTEGER,
      drom_id INTEGER,
      room TEXT,
      policy_agreed INTEGER DEFAULT 0
    );`
  );
}

function addUserRolesTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER,
      role_id INTEGER,
      PRIMARY KEY (user_id, role_id)
    );`
  );
}

function addRolesTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS roles (
      role_id INTEGER PRIMARY KEY,
      role_name TEXT
    );`
  );
}

function addEventsTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS events (
      event_id INTEGER PRIMARY KEY,
      event_name TEXT,
      event_date TIME,
      event_location TEXT,
      attachments TEXT,
      event_text TEXT,
      event_status INTEGER,
      creator_id INTEGER,
      FOREIGN KEY (creator_id) REFERENCES users (user_id)
    );`
  ); 
}

function addRegistrationsToEventsTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS event_registrations (
      registration_id INTEGER PRIMARY KEY,
      event_id INTEGER,
      user_id INTEGER,
      registration_date TEXT,
      status INTEGER DEFAULT 0,
      FOREIGN KEY (event_id) REFERENCES events (event_id),
      FOREIGN KEY (user_id) REFERENCES users (user_id)
    );`
  );
}

function addEventMessagesTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS event_messages (
      message_id INTEGER PRIMARY KEY,
      event_id INTEGER,
      user_id INTEGER,
      message_text TEXT,
      message_attachments TEXT,
      message_date TEXT,
      creator_id INTEGER,
      FOREIGN KEY (event_id) REFERENCES events (event_id),
      FOREIGN KEY (user_id) REFERENCES users (user_id),
      FOREIGN KEY (creator_id) REFERENCES users (user_id)
    );`
  );
}

function addSettingsTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS users_settings (
    user_id INTEGER PRIMARY KEY,
    allow_new_events_notifications INTEGER DEFAULT 1,
    allow_reminder_notifications INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users (user_id)
  );`
  );
}

function addReportsTable(){
  db.run(
    `CREATE TABLE IF NOT EXISTS reports (
      report_id INTEGER PRIMARY KEY,
      user_id INTEGER,
      time_create TEXT,
      text TEXT,
      attachments TEXT,
      intruder TEXT,
      intruder_room TEXT,
      anonim INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users (user_id)
    );`
  );
}
export { DB_FILE };
export default db;
