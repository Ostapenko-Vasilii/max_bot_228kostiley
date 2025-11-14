import { getDb } from '../db/init.js';
import { getReportById } from '../db/reports.js';

// ...helper to normalize attachments (compatible with other services)...
function parseMediaAttachments(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.reduce((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    const t = (item.type && String(item.type).toLowerCase()) || '';
    if (t === 'image' || t === 'photo') {
      if (item.url) acc.push({ type: 'image', payload: { url: item.url } });
      else if (item.payload && item.payload.token) acc.push({ type: 'image', payload: { token: item.payload.token } });
      else if (item.payload && item.payload.url) acc.push({ type: 'image', payload: { url: item.payload.url } });
    } else if (t === 'video') {
      const token = item.payload?.token;
      if (token) acc.push({ type: 'video', payload: { token } });
      else if (item.payload?.url) acc.push({ type: 'video', payload: { url: item.payload.url } });
    } else {
      const token = item.payload?.token;
      const url = item.payload?.url || item.url;
      if (token) acc.push({ type: 'image', payload: { token } });
      else if (url) acc.push({ type: 'image', payload: { url } });
    }
    return acc;
  }, []);
}

async function getResponsibleUserIds() {
  const db = getDb();
  const candidates = [];

  // try common schema: user_roles(user_id, role_id)
  try {
    const stmt = db.prepare('SELECT user_id FROM user_roles WHERE role_id = ?');
    stmt.bind([4]);
    while (stmt.step()) {
      const row = stmt.get();
      candidates.push(Number(row[0]));
    }
    if (typeof stmt.free === 'function') stmt.free();
    return candidates.filter(Number.isFinite);
  } catch (err) {
    console.debug('getResponsibleUserIds: user_roles query failed, trying fallback', err?.message || err);
  }

  // fallback: try roles table (role assignments stored differently)
  try {
    const stmt2 = db.prepare('SELECT user_id FROM roles WHERE role_id = ?');
    stmt2.bind([4]);
    while (stmt2.step()) {
      const row = stmt2.get();
      candidates.push(Number(row[0]));
    }
    if (typeof stmt2.free === 'function') stmt2.free();
    return candidates.filter(Number.isFinite);
  } catch (err) {
    console.error('getResponsibleUserIds: fallback query failed', err);
  }

  // if nothing — return empty
  return [];
}

function createUserContext(bot, userId) {
  return {
    user: { user_id: userId },
    async reply(text, options = {}) {
      const attachments = Array.isArray(options.attachments) ? options.attachments.filter(Boolean) : [];
      const stringText = typeof text === 'string' && text.length ? text : (attachments.length ? ' ' : '');
      // Try common SDK helper then generic send
      try {
        if (typeof bot.api.sendMessageToUser === 'function') {
          const msg = await bot.api.sendMessageToUser(userId, stringText, { attachments });
          const mid = msg?.mid ?? msg?.message_id ?? msg?.body?.mid ?? null;
          return mid ? { body: { mid } } : msg;
        } else if (typeof bot.api.messages.send === 'function') {
          const msg = await bot.api.messages.send({ user_id: String(userId), text: stringText, attachments });
          const mid = msg?.message_id ?? msg?.mid ?? msg?.body?.mid ?? null;
          return mid ? { body: { mid } } : msg;
        } else {
          // last resort: try bot.send ? (may not exist)
          if (typeof bot.send === 'function') {
            const msg = await bot.send(userId, stringText, { attachments });
            return msg;
          }
        }
      } catch (err) {
        throw err;
      }
      throw new Error('No supported send API on bot instance');
    }
  };
}

/**
 * Отправляет уведомление ответственным (role_id = 4) о конкретном отчёте (object or id).
 * report may be either { report_id, user_id, time_create, text, attachments, intruder, intruder_room, anonim }
 */
export async function notifyResponsibleAboutReport(bot, report) {
  try {
    if (!bot) throw new Error('Missing bot instance');
    if (!report) throw new Error('Missing report');
    // if report is id number, load
    let rpt = report;
    if (typeof report === 'number' || (typeof report === 'string' && /^\d+$/.test(report))) {
      const id = Number(report);
      rpt = await getReportById(id);
      if (!rpt) throw new Error('Report not found');
    }

    const userIds = await getResponsibleUserIds();
    if (!Array.isArray(userIds) || userIds.length === 0) {
      console.debug('notifyResponsibleAboutReport: no responsible users found');
      return { total: 0, sent: 0 };
    }

    const media = parseMediaAttachments(rpt.attachments);
    const textLines = [
      `Новый отчёт #${rpt.report_id || 'unknown'}`,
      `Время: ${rpt.time_create || '-'}`,
      `Пользователь: ${rpt.user_id || '-'}`,
      ''
    ];
    if (rpt.text) textLines.push(rpt.text);
    textLines.push('');
    textLines.push(`Злоумышленник: ${rpt.intruder || '-'}`);
    textLines.push(`Комната: ${rpt.intruder_room || '-'}`);
    textLines.push(`Аноним: ${rpt.anonim ? 'да' : 'нет'}`);
    const messageText = textLines.join('\n');

    const results = await Promise.all(userIds.map(async (uid) => {
      const ctx = createUserContext(bot, uid);
      try {
        await ctx.reply(messageText, { attachments: [...media] });
        return true;
      } catch (err) {
        console.error(`notifyResponsibleAboutReport: failed to notify ${uid}`, err);
        return false;
      }
    }));

    const sent = results.filter(Boolean).length;
    return { total: userIds.length, sent };
  } catch (err) {
    console.error('notifyResponsibleAboutReport error:', err);
    return { total: 0, sent: 0, error: err.message || String(err) };
  }
}

/** shortcut by id */
export async function notifyResponsibleAboutReportId(bot, reportId) {
  return notifyResponsibleAboutReport(bot, reportId);
}

export default { notifyResponsibleAboutReport, notifyResponsibleAboutReportId };
