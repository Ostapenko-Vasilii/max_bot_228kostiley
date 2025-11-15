import { init, getDb, persist } from './init.js';

init();

function ensureTable(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS booking_reservations (
			reservation_id INTEGER PRIMARY KEY,
			place_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			start_time TEXT NOT NULL,
			end_time TEXT NOT NULL,
			created_at TEXT,
			FOREIGN KEY (place_id) REFERENCES booking_places(place_id)
		)
	`);
}

function normalizeIds(placeId, userId) {
	const pid = Number(placeId);
	const uid = Number(userId);
	if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid place_id');
	if (!Number.isInteger(uid) || uid <= 0) throw new Error('Invalid user_id');
	return { pid, uid };
}

function toIso(dateLike) {
	if (dateLike instanceof Date) return dateLike.toISOString();
	const d = new Date(dateLike);
	if (Number.isNaN(d.valueOf())) throw new Error('Invalid date');
	return d.toISOString();
}

export function createBookingReservation({ place_id, user_id, start_time, end_time }) {
	return new Promise((resolve, reject) => {
		try {
			const { pid, uid } = normalizeIds(place_id, user_id);
			const startIso = toIso(start_time);
			const endIso = toIso(end_time);
			if (new Date(endIso) <= new Date(startIso)) throw new Error('Invalid time range');

			const db = getDb();
			ensureTable(db);

			const conflictStmt = db.prepare(`
				SELECT reservation_id
				FROM booking_reservations
				WHERE place_id = ?
				  AND NOT (end_time <= ? OR start_time >= ?)
				LIMIT 1
			`);
			conflictStmt.bind([pid, startIso, endIso]);
			const conflict = conflictStmt.step();
			if (typeof conflictStmt.free === 'function') conflictStmt.free();
			if (conflict) return reject(new Error('slot_taken'));

			const now = new Date().toISOString();
			db.run(`
				INSERT INTO booking_reservations (place_id, user_id, start_time, end_time, created_at)
				VALUES (?, ?, ?, ?, ?)
			`, [pid, uid, startIso, endIso, now]);
			try { persist(); } catch { /* ignore persist errors */ }
			resolve();
		} catch (err) {
			reject(err);
		}
	});
}

export function getReservationsForPlace(placeId, start_time, end_time) {
	return new Promise((resolve, reject) => {
		try {
			const pid = Number(placeId);
			if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid place_id');
			const startIso = toIso(start_time);
			const endIso = toIso(end_time);

			const db = getDb();
			ensureTable(db);
			const stmt = db.prepare(`
				SELECT start_time, end_time
				FROM booking_reservations
				WHERE place_id = ?
				  AND NOT (end_time <= ? OR start_time >= ?)
			`);
			stmt.bind([pid, startIso, endIso]);
			const list = [];
			while (stmt.step()) {
				const row = stmt.get();
				list.push({
					start_time: row[0],
					end_time: row[1],
				});
			}
			if (typeof stmt.free === 'function') stmt.free();
			resolve(list);
		} catch (err) {
			reject(err);
		}
	});
}

export function countUserReservations(placeId, userId, start_time, end_time) {
	return new Promise((resolve, reject) => {
		try {
			const { pid, uid } = normalizeIds(placeId, userId);
			const startIso = toIso(start_time);
			const endIso = toIso(end_time);

			const db = getDb();
			ensureTable(db);
			const stmt = db.prepare(`
				SELECT COUNT(*) as cnt
				FROM booking_reservations
				WHERE place_id = ?
				  AND user_id = ?
				  AND start_time >= ?
				  AND start_time < ?
			`);
			stmt.bind([pid, uid, startIso, endIso]);
			const has = stmt.step();
			const row = has ? stmt.get() : [0];
			if (typeof stmt.free === 'function') stmt.free();
			resolve(Number(row[0]) || 0);
		} catch (err) {
			reject(err);
		}
	});
}
