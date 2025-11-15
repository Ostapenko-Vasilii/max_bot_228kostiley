import { init, getDb, persist } from './init.js';

init();

function ensureTable(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS booking_places (
			place_id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			work_hours TEXT NOT NULL,
			interval_minutes INTEGER NOT NULL,
			per_day_limit INTEGER NOT NULL,
			per_week_limit INTEGER NOT NULL,
			created_at TEXT,
			updated_at TEXT
		)
	`);
}

function normalizePlaceId(placeId) {
	const id = Number(placeId);
	if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid place_id');
	return id;
}

function normalizePayload(data) {
	const name = String(data?.name ?? '').trim();
	if (!name.length || name.length > 120) throw new Error('Invalid name');

	const workHours = typeof data?.work_hours === 'string' && data.work_hours.trim().length
		? data.work_hours.trim()
		: null;
	if (!workHours) throw new Error('Invalid work hours');

	const interval = Number(data?.interval_minutes);
	if (!Number.isInteger(interval) || interval < 5 || interval > 240) throw new Error('Invalid interval');

	const perDay = Number(data?.per_day_limit);
	if (!Number.isInteger(perDay) || perDay < 1 || perDay > 24) throw new Error('Invalid per-day limit');

	const perWeek = Number(data?.per_week_limit);
	if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > 50) throw new Error('Invalid per-week limit');

	return { name, workHours, interval, perDay, perWeek };
}

export function createBookingPlace(data) {
	return new Promise((resolve, reject) => {
		try {
			const db = getDb();
			ensureTable(db);
			const normalized = normalizePayload(data);
			const now = new Date().toISOString();
			db.run(`
				INSERT INTO booking_places
					(name, work_hours, interval_minutes, per_day_limit, per_week_limit, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`, [normalized.name, normalized.workHours, normalized.interval, normalized.perDay, normalized.perWeek, now, now]);
			try { persist(); } catch { /* ignore persist errors */ }
			resolve();
		} catch (err) {
			reject(err);
		}
	});
}

export function updateBookingPlace(placeId, data) {
	return new Promise((resolve, reject) => {
		try {
			const id = normalizePlaceId(placeId);
			const db = getDb();
			ensureTable(db);
			const normalized = normalizePayload(data);
			const now = new Date().toISOString();
			db.run(`
				UPDATE booking_places
				SET name = ?, work_hours = ?, interval_minutes = ?, per_day_limit = ?, per_week_limit = ?, updated_at = ?
				WHERE place_id = ?
			`, [normalized.name, normalized.workHours, normalized.interval, normalized.perDay, normalized.perWeek, now, id]);
			try { persist(); } catch { /* ignore persist errors */ }
			resolve();
		} catch (err) {
			reject(err);
		}
	});
}

export function getAllBookingPlaces() {
	return new Promise((resolve, reject) => {
		try {
			const db = getDb();
			ensureTable(db);
			const stmt = db.prepare(`
				SELECT place_id, name, work_hours, interval_minutes, per_day_limit, per_week_limit
				FROM booking_places
				ORDER BY place_id ASC
			`);
			const places = [];
			while (stmt.step()) {
				const row = stmt.get();
				places.push({
					place_id: Number(row[0]),
					name: row[1] ?? '',
					work_hours: row[2] ?? '[]',
					interval_minutes: Number(row[3]) || 0,
					per_day_limit: Number(row[4]) || 1,
					per_week_limit: Number(row[5]) || 1,
				});
			}
			if (typeof stmt.free === 'function') stmt.free();
			resolve(places);
		} catch (err) {
			reject(err);
		}
	});
}

export function getBookingPlaceById(placeId) {
	return new Promise((resolve, reject) => {
		try {
			const id = normalizePlaceId(placeId);
			const db = getDb();
			ensureTable(db);
			const stmt = db.prepare(`
				SELECT place_id, name, work_hours, interval_minutes, per_day_limit, per_week_limit
				FROM booking_places
				WHERE place_id = ?
				LIMIT 1
			`);
			stmt.bind([id]);
			const has = stmt.step();
			const row = has ? stmt.get() : null;
			if (typeof stmt.free === 'function') stmt.free();
			if (!row) return resolve(null);
			resolve({
				place_id: Number(row[0]),
				name: row[1] ?? '',
				work_hours: row[2] ?? '[]',
				interval_minutes: Number(row[3]) || 0,
				per_day_limit: Number(row[4]) || 1,
				per_week_limit: Number(row[5]) || 1,
			});
		} catch (err) {
			reject(err);
		}
	});
}
