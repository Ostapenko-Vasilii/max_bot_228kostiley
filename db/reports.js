/*
user_id: int
report_id: int
time_create: time
text: string
img: url
intruder: str
intrurder_room: str
Anonim: bool
*/

import { init, getDb, persist } from './init.js';
init();

export function createReport(report) {
	return new Promise((resolve, reject) => {
		try {
			if (!report || typeof report !== 'object') return reject(new Error('Invalid report object'));

			const userId = Number.isFinite(Number(report.user_id)) ? Number(report.user_id) : null;
			const timeCreate = report.time_create ? String(report.time_create) : new Date().toISOString();
			const text = report.text ? String(report.text).trim() : null;
			const img = report.img ? String(report.img).trim() : null;
			const intruder = report.intruder ? String(report.intruder).trim().slice(0, 255) : null;
			const intruderRoom = report.intruder_room ? String(report.intruder_room).trim().slice(0, 255) : null;
			const anonim = typeof report.anonim === 'boolean' ? (report.anonim ? 1 : 0) : (report.anonim ? 1 : 0);

			const db = getDb();
			const sql = `INSERT INTO reports (user_id, time_create, text, img, intruder, intruder_room, anonim)
									 VALUES (?, ?, ?, ?, ?, ?, ?)`;
			db.run(sql, [userId, timeCreate, text, img, intruder, intruderRoom, anonim]);

			try { persist(); } catch (e) { /* ignore persist errors */ }

			const lastRes = db.exec('SELECT last_insert_rowid() AS id');
			const lastID = (lastRes && lastRes[0] && lastRes[0].values && lastRes[0].values[0]) ? lastRes[0].values[0][0] : null;
			const changesRes = db.exec('SELECT changes() AS changes');
			const changes = (changesRes && changesRes[0] && changesRes[0].values && changesRes[0].values[0]) ? changesRes[0].values[0][0] : null;

			resolve({ lastID, changes });
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
			const stmt = db.prepare('SELECT report_id, user_id, time_create, text, img, intruder, intruder_room, anonim FROM reports WHERE report_id = ?');
			stmt.bind([id]);
			const row = stmt.step() ? stmt.get() : null;
			if (typeof stmt.free === 'function') stmt.free();
			if (!row) return resolve(null);

			resolve({
				report_id: row[0],
				user_id: row[1],
				time_create: row[2],
				text: row[3],
				img: row[4],
				intruder: row[5],
				intruder_room: row[6],
				anonim: row[7]
			});
		} catch (err) {
			reject(err);
		}
	});
}

export function listReports(limit = 50, offset = 0) {
	return new Promise((resolve, reject) => {
		try {
			const l = Number(limit) || 50;
			const o = Number(offset) || 0;
			const db = getDb();
			const sql = `SELECT report_id, user_id, time_create, text, img, intruder, intruder_room, anonim
									 FROM reports ORDER BY time_create DESC LIMIT ? OFFSET ?`;
			const stmt = db.prepare(sql);
			stmt.bind([l, o]);
			const results = [];
			while (stmt.step()) {
				const r = stmt.get();
				results.push({
					report_id: r[0], user_id: r[1], time_create: r[2], text: r[3], img: r[4], intruder: r[5], intruder_room: r[6], anonim: r[7]
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