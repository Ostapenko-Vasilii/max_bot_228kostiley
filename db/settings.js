import { init, getDb, persist } from './init.js';
init();

function normalizeFlag(value, fallback = 1) {
  if (value === undefined || value === null) return fallback ? 1 : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  if (typeof value === 'string') {
    const norm = value.trim().toLowerCase();
    if (norm === '1' || norm === 'true' || norm === 'yes') return 1;
    if (norm === '0' || norm === 'false' || norm === 'no') return 0;
    const numeric = Number(norm);
    if (!Number.isNaN(numeric)) return numeric ? 1 : 0;
  }
  return value ? 1 : 0;
}

export function addUserSettings(userId, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number(userId);
      if (!Number.isInteger(uid)) return reject(new Error('Invalid userId'));

      const allowNew = normalizeFlag(options.allow_new_events_notifications, 1);
      const allowReminder = normalizeFlag(options.allow_reminder_notifications, 1);

      const db = getDb();
      db.run(
        `INSERT INTO users_settings (user_id, allow_new_events_notifications, allow_reminder_notifications)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           allow_new_events_notifications = excluded.allow_new_events_notifications,
           allow_reminder_notifications = excluded.allow_reminder_notifications`,
        [uid, allowNew, allowReminder]
      );

      try { persist(); } catch { /* ignore */ }

      const changesRes = db.exec('SELECT changes() AS changes');
      const changes = changesRes?.[0]?.values?.[0]?.[0] ?? 0;
      resolve({ changes });
    } catch (err) {
      reject(err);
    }
  });
}

export function updateUserSettings(userId, changes = {}) {
  return new Promise((resolve, reject) => {
    try {
      const uid = Number(userId);
      if (!Number.isInteger(uid)) return reject(new Error('Invalid userId'));

      const allowedMap = {
        allow_new_events_notifications: 'allow_new_events_notifications',
        allow_reminder_notifications: 'allow_reminder_notifications'
      };

      const entries = Object.entries(changes)
        .filter(([key, value]) => key in allowedMap && value !== undefined && value !== null);

      if (!entries.length) return resolve({ changes: 0 });

      const setFragments = [];
      const params = [];

      for (const [key, value] of entries) {
        setFragments.push(`${allowedMap[key]} = ?`);
        params.push(normalizeFlag(value));
      }

      params.push(uid);

      const db = getDb();
      db.run(
        `UPDATE users_settings
         SET ${setFragments.join(', ')}
         WHERE user_id = ?`,
        params
      );

      try { persist(); } catch { /* ignore */ }

      const changesRes = db.exec('SELECT changes() AS changes');
      const affected = changesRes?.[0]?.values?.[0]?.[0] ?? 0;
      resolve({ changes: affected });
    } catch (err) {
      reject(err);
    }
  });
}
