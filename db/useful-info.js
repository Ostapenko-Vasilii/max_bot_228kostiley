import { init, getDb, persist } from './init.js';

init();

function ensureTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS useful_info (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            text TEXT,
            attachments TEXT,
            updated_at TEXT
        )
    `);
}

export function saveUsefulInfo({ text, attachments }) {
    return new Promise((resolve, reject) => {
        try {
            const db = getDb();
            ensureTable(db);
            const content = typeof text === 'string' ? text.trim().slice(0, 4096) : '';
            let serialized = '[]';
            try {
                const prepared = Array.isArray(attachments)
                    ? attachments.filter((item) => item && typeof item === 'object').slice(0, 10)
                    : [];
                serialized = JSON.stringify(prepared);
            } catch {
                serialized = '[]';
            }
            db.run(`
                INSERT INTO useful_info (id, text, attachments, updated_at)
                VALUES (1, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    text = excluded.text,
                    attachments = excluded.attachments,
                    updated_at = CURRENT_TIMESTAMP
            `, [content, serialized]);
            try { persist(); } catch { /* ignore persist errors */ }
            resolve();
        } catch (err) {
            reject(err);
        }
    });
}

export function getUsefulInfo() {
    return new Promise((resolve, reject) => {
        try {
            const db = getDb();
            ensureTable(db);
            const stmt = db.prepare(`
                SELECT text, attachments, updated_at
                FROM useful_info
                WHERE id = 1
                LIMIT 1
            `);
            const found = stmt.step();
            let info = null;
            if (found) {
                const row = stmt.get();
                let attachments = [];
                if (row[1]) {
                    try {
                        const parsed = JSON.parse(row[1]);
                        attachments = Array.isArray(parsed) ? parsed : [];
                    } catch {
                        attachments = [];
                    }
                }
                info = {
                    text: row[0] ?? '',
                    attachments,
                    updated_at: row[2] ?? null
                };
            }
            if (typeof stmt.free === 'function') stmt.free();
            resolve(info);
        } catch (err) {
            reject(err);
        }
    });
}
