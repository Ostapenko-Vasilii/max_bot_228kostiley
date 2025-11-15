import { init, getDb, persist } from './init.js';

init();

function ensureTable(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS user_preferences (
			user_id INTEGER PRIMARY KEY,
			notify_events INTEGER NOT NULL DEFAULT 1,
			updated_at TEXT
		)
	`);
}

function normalizeUserId(userId) {
	const numeric = Number(userId);
	if (!Number.isInteger(numeric)) throw new Error('Invalid user_id');
	return numeric;
}

export function getUserNotificationPreference(userId) {
	return new Promise((resolve, reject) => {
		try {
			const uid = normalizeUserId(userId);
			const db = getDb();
			ensureTable(db);
			const stmt = db.prepare('SELECT notify_events FROM user_preferences WHERE user_id = ? LIMIT 1');
			stmt.bind([uid]);
			const row = stmt.step() ? stmt.get() : null;
			if (typeof stmt.free === 'function') stmt.free();
			resolve(row ? Boolean(row[0]) : true);
		} catch (err) {
			reject(err);
		}
	});
}

export function setUserNotificationPreference(userId, enabled) {
	return new Promise((resolve, reject) => {
		try {
			const uid = normalizeUserId(userId);
			const db = getDb();
			ensureTable(db);
			db.run(`
				INSERT INTO user_preferences (user_id, notify_events, updated_at)
				VALUES (?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(user_id) DO UPDATE SET
					notify_events = excluded.notify_events,
					updated_at = CURRENT_TIMESTAMP
			`, [uid, enabled ? 1 : 0]);
			try { persist(); } catch { /* ignore persist errors */ }
			resolve(Boolean(enabled));
		} catch (err) {
			reject(err);
		}
	});
}

export async function toggleUserEventNotifications(userId) {
	const current = await getUserNotificationPreference(userId);
	await setUserNotificationPreference(userId, !current);
	return !current;
}
