// user_id: int
// report_id: int
// time_create: time
// text: string
// img: url
// intruder: str
// intrurder_room: str
// Anonim: bool


import { init, getDb, persist } from './init.js';
init();

// ensure optional columns exist (user_msg_id, admin_msg_id)
(function ensureColumns() {
	try {
		const db = getDb();
		const pragma = db.exec("PRAGMA table_info(reports)");
		const cols = [];
		if (pragma && pragma[0] && Array.isArray(pragma[0].values)) {
			for (const row of pragma[0].values) {
				// PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
				cols.push(row[1]);
			}
		}
		if (!cols.includes('user_msg_id')) {
			try { db.run("ALTER TABLE reports ADD COLUMN user_msg_id TEXT"); } catch (e) { /* ignore */ }
		}
		if (!cols.includes('admin_msg_id')) {
			try { db.run("ALTER TABLE reports ADD COLUMN admin_msg_id TEXT"); } catch (e) { /* ignore */ }
		}
	} catch (e) {
		console.error('ensureColumns error', e);
	}
})();

export function createReport(report) {
	return new Promise((resolve, reject) => {
		try {
			if (!report || typeof report !== 'object') return reject(new Error('Invalid report object'));

			const userId = Number.isFinite(Number(report.user_id)) ? Number(report.user_id) : null;
			const timeCreate = report.time_create ? String(report.time_create) : new Date().toISOString();
			const text = report.text ? String(report.text).trim() : '';

			// Normalize attachments: accept JSON string, array, single object, or legacy img field
			let rawAttachments = report.attachments ?? report.img ?? null;
			let attachmentsArr = [];

			if (rawAttachments) {
				if (typeof rawAttachments === 'string') {
					// try parse JSON, otherwise treat as single URL
					try {
						const parsed = JSON.parse(rawAttachments);
						if (Array.isArray(parsed)) attachmentsArr = parsed;
						else if (parsed && typeof parsed === 'object') attachmentsArr = [parsed];
						else attachmentsArr = [{ type: 'image', url: String(parsed) }];
					} catch {
						// treat as single URL string
						attachmentsArr = [{ type: 'image', url: String(rawAttachments).trim() }];
					}
				} else if (Array.isArray(rawAttachments)) {
					attachmentsArr = rawAttachments.slice();
				} else if (rawAttachments && typeof rawAttachments === 'object') {
					attachmentsArr = [rawAttachments];
				}
			}

			// normalize items: ensure each is object with type and url/payload
			attachmentsArr = attachmentsArr.map(item => {
				if (!item || typeof item !== 'object') return null;
				// normalize and lower-case type, treat 'photo' as 'image'
				let typeRaw = item.type ? String(item.type).toLowerCase() : (item.url ? 'image' : null);
				if (typeRaw === 'photo') typeRaw = 'image';
				if (!typeRaw) return null;
				// prefer url field, fallback to payload?.url or payload?.token
				const url = item.url ?? item.payload?.url ?? item.payload?.token ?? null;
				const normalized = { type: typeRaw };
				if (url) normalized.url = String(url);
				if (item.payload && typeof item.payload === 'object') normalized.payload = item.payload;
				return normalized;
			}).filter(Boolean);

			// previously required at least one image; make attachments optional now
			// note: text is still required
			if (!text) return reject(new Error('Report must contain text'));
			// if you later want to require images again, restore/check here

			const attachmentsJson = attachmentsArr.length ? JSON.stringify(attachmentsArr) : null;

			const intruder = report.intruder ? String(report.intruder).trim().slice(0, 255) : null;
			const intruderRoom = report.intruder_room ? String(report.intruder_room).trim().slice(0, 255) : null;
			const anonim = typeof report.anonim === 'boolean' ? (report.anonim ? 1 : 0) : (report.anonim ? 1 : 0);

			const db = getDb();
			const sql = `INSERT INTO reports (user_id, time_create, text, attachments, intruder, intruder_room, anonim)
									 VALUES (?, ?, ?, ?, ?, ?, ?)`;
			db.run(sql, [userId, timeCreate, text, attachmentsJson, intruder, intruderRoom, anonim]);

			try { persist(); } catch (e) { /* ignore persist errors */ }

			const lastRes = db.exec('SELECT last_insert_rowid() AS id');
			let lastID = (lastRes && lastRes[0] && lastRes[0].values && lastRes[0].values[0]) ? lastRes[0].values[0][0] : null;
			const changesRes = db.exec('SELECT changes() AS changes');
			let changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : null;

			// If both lastID and changes are zeroy, try to find the inserted record by (user_id, time_create, text)
			if ((!lastID || Number(lastID) === 0) && (!changes || Number(changes) === 0)) {
				try {
					const stmt = db.prepare('SELECT report_id FROM reports WHERE user_id = ? AND time_create = ? AND text = ? ORDER BY report_id DESC LIMIT 1');
					stmt.bind([userId, timeCreate, text]);
					const found = stmt.step() ? stmt.get() : null;
					if (typeof stmt.free === 'function') stmt.free();
					if (found && found[0]) {
						lastID = found[0];
						changes = 1;
					} else {
						// not found — keep existing lastID/changes (likely 0)
						console.error('createReport fallback lookup did not find inserted row', { userId, timeCreate, text });
					}
				} catch (findErr) {
					console.error('createReport fallback lookup error:', findErr);
				}
			}

			resolve({ lastID, changes });
		} catch (err) {
			reject(err);
		}
	});
}

export function setReportMessageIds(reportId, userMsgId, adminMsgId) {
	return new Promise((resolve, reject) => {
		try {
			const id = Number(reportId);
			if (!Number.isInteger(id)) return reject(new Error('Invalid reportId'));
			const db = getDb();
			db.run('UPDATE reports SET user_msg_id = ?, admin_msg_id = ? WHERE report_id = ?', [userMsgId ?? null, adminMsgId ?? null, id]);
			try { persist(); } catch (e) { /* ignore */ }
			const changesRes = db.exec('SELECT changes() AS changes');
			const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : 0;
			resolve({ updated: changes > 0, changes });
		} catch (err) {
			reject(err);
		}
	});
}

export function getReportById(reportId) {
	return new Promise((resolve, reject) => {
		try {
			const id = Number(reportId);
			if (!Number.isInteger(id)) return reject(new Error('Invalid reportId'));

			const db = getDb();
			// include user_msg_id and admin_msg_id
			const stmt = db.prepare('SELECT report_id, user_id, time_create, text, attachments, intruder, intruder_room, anonim, user_msg_id, admin_msg_id FROM reports WHERE report_id = ?');
			stmt.bind([id]);
			const row = stmt.step() ? stmt.get() : null;
			if (typeof stmt.free === 'function') stmt.free();
			if (!row) return resolve(null);

			resolve({
				report_id: row[0],
				user_id: row[1],
				time_create: row[2],
				text: row[3],
				attachments: row[4],
				intruder: row[5],
				intruder_room: row[6],
				anonim: row[7],
				user_msg_id: row[8] ?? null,
				admin_msg_id: row[9] ?? null
			});
		} catch (err) {
			reject(err);
		}
	});
}

export function listReports(limit = 10, offset = 0) {
	return new Promise((resolve, reject) => {
		try {
			const l = Number(limit) || 10;
			const o = Number(offset) || 0;
			const db = getDb();
			// include user_msg_id and admin_msg_id
			const sql = `SELECT report_id, user_id, time_create, text, attachments, intruder, intruder_room, anonim, user_msg_id, admin_msg_id
									 FROM reports ORDER BY time_create DESC LIMIT ? OFFSET ?`;
			const stmt = db.prepare(sql);
			stmt.bind([l, o]);
			const results = [];
			while (stmt.step()) {
				const r = stmt.get();
				results.push({
					report_id: r[0], 
					user_id: r[1], 
					time_create: r[2], 
					text: r[3], 
					attachments: r[4], 
					intruder: r[5], 
					intruder_room: r[6], 
					anonim: r[7],
					user_msg_id: r[8] ?? null,
					admin_msg_id: r[9] ?? null
				});
			}
			if (typeof stmt.free === 'function') stmt.free();
			resolve(results);
		} catch (err) {
			reject(err);
		}
	});
}

export function listReportsByRoom(room, limit = 10, offset = 0) {
	return new Promise((resolve, reject) => {
		try {
			const rroom = room ? String(room).trim() : null;
			const l = Number(limit) || 10;
			const o = Number(offset) || 0;
			const db = getDb();
			const sql = `SELECT report_id, user_id, time_create, text, attachments, intruder, intruder_room, anonim
						 FROM reports WHERE intruder_room = ? ORDER BY time_create DESC LIMIT ? OFFSET ?`;
			const stmt = db.prepare(sql);
			stmt.bind([rroom, l, o]);
			const results = [];
			while (stmt.step()) {
				const rr = stmt.get();
				results.push({
					report_id: rr[0], 
					user_id: rr[1], 
					time_create: rr[2], 
					text: rr[3], 
					attachments: rr[4], 
					intruder: rr[5], 
					intruder_room: rr[6], 
					anonim: rr[7]
				});
			}
			if (typeof stmt.free === 'function') stmt.free();
			resolve(results);
		} catch (err) {
			reject(err);
		}
	});
}

export function deleteReport(reportId) {
	return new Promise((resolve, reject) => {
		try {
			const id = Number(reportId);
			if (!Number.isInteger(id)) return reject(new Error('Invalid reportId'));
			const db = getDb();
			db.run('DELETE FROM reports WHERE report_id = ?', [id]);
			try { persist(); } catch (e) { /* ignore */ }
			const changesRes = db.exec('SELECT changes() AS changes');
			const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : 0;
			resolve({ deleted: changes > 0, changes });
		} catch (err) {
			reject(err);
		}
	});
}