import { init, getDb, persist } from './init.js';

init();

function ensureTable(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS duty_schedules (
			floor INTEGER PRIMARY KEY,
			text TEXT,
			attachments TEXT,
			updated_at TEXT
		)
	`);
}

function normalizeFloor(floor) {
	const numeric = Number(floor);
	if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
		throw new Error('Invalid floor');
	}
	return numeric;
}

function sanitizeAttachments(raw) {
	const normalize = (value, depth = 0) => {
		if (depth > 5) return null;
		if (typeof value === 'bigint') return value.toString();
		if (Array.isArray(value)) return value.map((item) => normalize(item, depth + 1));
		if (value && typeof value === 'object') {
			const plain = {};
			for (const [key, val] of Object.entries(value)) {
				plain[key] = normalize(val, depth + 1);
			}
			return plain;
		}
		if (typeof value === 'function' || value === undefined) return null;
		return value;
	};
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((item) => item && typeof item === 'object')
		.map((item) => normalize(item));
}

export function saveDutySchedule(floor, payload = {}) {
	return new Promise((resolve, reject) => {
		try {
			const targetFloor = normalizeFloor(floor);
			const db = getDb();
			ensureTable(db);

			const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 4096) : '';
			let serialized = '[]';
			try {
				const attachments = sanitizeAttachments(payload.attachments).slice(0, 10);
				serialized = JSON.stringify(attachments);
			} catch {
				serialized = '[]';
			}

			db.run(`
				INSERT INTO duty_schedules (floor, text, attachments, updated_at)
				VALUES (?, ?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(floor) DO UPDATE SET
					text = excluded.text,
					attachments = excluded.attachments,
					updated_at = CURRENT_TIMESTAMP
			`, [targetFloor, text, serialized]);

			try { persist(); } catch { /* ignore persist errors */ }
			resolve();
		} catch (err) {
			reject(err);
		}
	});
}

export function getDutySchedule(floor) {
	return new Promise((resolve, reject) => {
		try {
			const targetFloor = normalizeFloor(floor);
			const db = getDb();
			ensureTable(db);

			const stmt = db.prepare(`
				SELECT floor, text, attachments, updated_at
				FROM duty_schedules
				WHERE floor = ?
				LIMIT 1
			`);
			stmt.bind([targetFloor]);
			const hasRow = stmt.step();
			if (!hasRow) {
				if (typeof stmt.free === 'function') stmt.free();
				return resolve(null);
			}
			const row = stmt.get();
			if (typeof stmt.free === 'function') stmt.free();

			let attachments = [];
			if (row[2]) {
				try {
					const parsed = JSON.parse(row[2]);
					attachments = Array.isArray(parsed) ? parsed : [];
				} catch {
					attachments = [];
				}
			}

			resolve({
				floor: Number(row[0]),
				text: row[1] ?? '',
				attachments,
				updated_at: row[3] ?? null
			});
		} catch (err) {
			reject(err);
		}
	});
}

export function getAllDutySchedules() {
	return new Promise((resolve, reject) => {
		try {
			const db = getDb();
			ensureTable(db);
			const stmt = db.prepare(`
				SELECT floor, text, attachments, updated_at
				FROM duty_schedules
				ORDER BY floor ASC
			`);

			const schedules = [];
			while (stmt.step()) {
				const row = stmt.get();
				let attachments = [];
				if (row[2]) {
					try {
						const parsed = JSON.parse(row[2]);
						attachments = Array.isArray(parsed) ? parsed : [];
					} catch {
						attachments = [];
					}
				}
				schedules.push({
					floor: Number(row[0]),
					text: row[1] ?? '',
					attachments,
					updated_at: row[3] ?? null
				});
			}
			if (typeof stmt.free === 'function') stmt.free();
			resolve(schedules);
		} catch (err) {
			reject(err);
		}
	});
}
