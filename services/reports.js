import { Keyboard } from '@maxhub/max-bot-api';
import { listReports, listReportsByRoom, createReport, getReportById, deleteReport, setReportMessageIds } from '../db/reports.js';
import { getUserRoles } from '../db/roles.js';

export async function submitReport(ctx, reportData) {
  // reportData expected to contain: user_id, text, attachments, intruder, intruder_room, anonim
  try {
    const res = await createReport(reportData);
    // consider success if lastID or changes reported
    const success = res && (Number(res.lastID) > 0 || Number(res.changes) > 0);
    if (success) {
      ctx.reply('Спасибо, отчет создан.');
    } else {
      console.error('createReport did not report insertion', res, reportData);
      ctx.reply('Не удалось сохранить отчет.');
    }
  } catch (err) {
    ctx.reply('Ошибка при сохранении отчета.');
    console.error('submitReport error', err);
  }
}

function parseMediaAttachments(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];

  // Normalize to SDK-friendly attachment objects: { type, payload: { url } } or { type, payload: { token } }
  const out = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const t = (item.type && String(item.type).toLowerCase()) || '';
    if (t === 'image' || t === 'photo') {
      if (item.url) {
        out.push({ type: 'image', payload: { url: String(item.url) } });
      } else if (item.payload && item.payload.token) {
        out.push({ type: 'image', payload: { token: item.payload.token } });
      } else if (item.payload && item.payload.url) {
        out.push({ type: 'image', payload: { url: item.payload.url } });
      }
    } else if (t === 'video') {
      const token = item.payload?.token;
      if (token) out.push({ type: 'video', payload: { token } });
      else if (item.payload?.url) out.push({ type: 'video', payload: { url: item.payload.url } });
    } else {
      // fallback: if payload.token or payload.url present, treat as image
      const token = item.payload?.token;
      const url = item.payload?.url || item.url;
      if (token) out.push({ type: 'image', payload: { token } });
      else if (url) out.push({ type: 'image', payload: { url } });
    }
  }

  return out;
}

export async function adminShowReports(ctx, room = null) {
  try {
    let roles = await getUserRoles(ctx.user.user_id);
    if (!Array.isArray(roles)) roles = [];
    if (!roles.includes(4)) {
      ctx.reply('У вас нет доступа 😧');
      return;
    }

    const reports = room ? await listReportsByRoom(room, 10, 0) : await listReports(10, 0);
    if (!reports || reports.length === 0) {
      ctx.reply('Нет доступных отчетов.');
      return;
    }

    // Send each report as its own message with attachments and per-report buttons
    for (const r of reports) {
      const header = `Отчет #${r.report_id} — ${r.time_create}\nПользователь: ${r.user_id}`;
      const body = r.text ? `\n\n${r.text}` : '';
      const footer = `\n\nЗлоумышленник: ${r.intruder || '-'}\nКомната: ${r.intruder_room || '-'}\nАноним: ${r.anonim ? 'да' : 'нет'}`;
      const message = header + body + footer;

      // per-report keyboard with view/delete actions (callback contains id)
      const sdkButtons = [
        [
          Keyboard.button.callback('🔍 Просмотреть', `admin_report_view:${r.report_id}`),
          Keyboard.button.callback('🗑️ Удалить', `admin_report_delete:${r.report_id}`)
        ]
      ];
      const keyboard = Keyboard.inlineKeyboard(sdkButtons);

      const media = parseMediaAttachments(r.attachments);
      // ensure we only send non-empty, SDK-valid attachments
      const attachments = [];
      if (Array.isArray(media) && media.length) attachments.push(...media);
      // keyboard should be last
      attachments.push(keyboard);

      // send and try to persist admin message id for later deletion
      const sent = attachments.length ? await ctx.reply(message, { attachments }) : await ctx.reply(message);
      const sentMsgId = sent?.message_id ?? sent?.mid ?? sent?.body?.mid ?? null;
      try {
        if (sentMsgId && r.report_id) {
          await setReportMessageIds(r.report_id, r.user_msg_id ?? null, String(sentMsgId));
        }
      } catch (err) {
        console.error('Failed to set admin_msg_id for report', r.report_id, err);
      }
    }

    // final navigation keyboard
    const navButtons = [Keyboard.button.callback('🔙 Открыть меню', 'show_main_menu')];
    const navKeyboard = Keyboard.inlineKeyboard([[navButtons[0]]]);
    await ctx.reply('Конец списка отчетов.', { attachments: [navKeyboard] });
  } catch (err) {
    console.error('adminShowReports error', err);
    ctx.reply('Ошибка при получении отчетов.');
  }
}

export async function adminGetReport(ctx, reportId) {
  try {
    const report = await getReportById(reportId);
    if (!report) return ctx.reply('Отчет не найден.');

    let text = `Отчет #${report.report_id}\nВремя: ${report.time_create}\nПользователь: ${report.user_id}\n`;
    if (report.intruder) text += `Злоумышленник: ${report.intruder}\n`;
    if (report.intruder_room) text += `Комната: ${report.intruder_room}\n`;
    if (report.text) text += `Текст: ${report.text}\n`;
    text += `Аноним: ${report.anonim ? 'да' : 'нет'}`;

    const media = parseMediaAttachments(report.attachments);
    // add Delete button next to Back — BACK changed to 'report_back' so it only removes THIS message
    const backButton = Keyboard.button.callback('🔙 Назад', 'report_back');
    const delButton = Keyboard.button.callback('🗑️ Удалить', `admin_report_delete:${report.report_id}`);
    const keyboard = Keyboard.inlineKeyboard([[backButton, delButton]]);

    const attachments = [];
    if (Array.isArray(media) && media.length) attachments.push(...media);
    attachments.push(keyboard);

    // send and persist admin message id
    const sent = attachments.length ? await ctx.reply(text, { attachments }) : await ctx.reply(text);
    const sentMsgId = sent?.message_id ?? sent?.mid ?? sent?.body?.mid ?? null;
    try {
      if (sentMsgId && report.report_id) {
        await setReportMessageIds(report.report_id, report.user_msg_id ?? null, String(sentMsgId));
      }
    } catch (err) {
      console.error('Failed to set admin_msg_id for report (adminGetReport)', report.report_id, err);
    }
  } catch (err) {
    console.error('adminGetReport error', err);
    ctx.reply('Ошибка при получении отчета.');
  }
}

export async function adminDeleteReport(ctx, reportId, bot = null) {
  try {
    // first get the report and try to delete associated messages
    const report = await getReportById(reportId);
    if (report) {
      const userMid = report.user_msg_id || null;
      const adminMid = report.admin_msg_id || null;

      // attempt to delete messages via bot if provided
      if (bot && bot.api && bot.api.messages && typeof bot.api.messages.delete === 'function') {
        try {
          if (adminMid) {
            await bot.api.messages.delete({ message_id: String(adminMid) }).catch(()=>{});
          }
          if (userMid) {
            await bot.api.messages.delete({ message_id: String(userMid) }).catch(()=>{});
          }
        } catch (delErr) {
          console.error('Error deleting associated messages for report', reportId, delErr);
        }
      }
    }

    // remove DB record
    const res = await deleteReport(reportId);
    if (res && res.deleted) ctx.reply('Отчет удалён.');
    else ctx.reply('Отчет не найден или не удалён.');
  } catch (err) {
    console.error('adminDeleteReport error', err);
    ctx.reply('Ошибка при удалении отчета.');
  }
}
