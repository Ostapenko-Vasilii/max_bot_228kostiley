import { Keyboard } from '@maxhub/max-bot-api';
import { listReports, createReport, getReportById, deleteReport } from '../db/reports.js';
import { getUserRoles } from '../db/roles.js';

// Buttons for admin actions
const adminButtons = [
  { label: '📄 Просмотреть отчеты', payload: { command: 'admin_reports_list' } },
  { label: '🗑️ Удалить отчет', payload: { command: 'admin_reports_delete' } },
];

const standardButtons = [
  { label: '🔙 Открыть меню', payload: { command: 'show_main_menu' } },
];

export async function submitReport(ctx, reportData) {
  // reportData expected to contain: user_id, text, img, intruder, intruder_room, anonim
  try {
    const res = await createReport(reportData);
    if (res && res.lastID) {
      ctx.reply('Спасибо, отчет создан.');
    } else {
      ctx.reply('Не удалось сохранить отчет.');
    }
  } catch (err) {
    ctx.reply('Ошибка при сохранении отчета.');
    console.error('submitReport error', err);
  }
}

export async function adminShowReports(ctx) {
  try {
    let roles = await getUserRoles(ctx.user.user_id);
    if (!Array.isArray(roles)) roles = [];
    if (!roles.includes(3)) {
      ctx.reply('У вас нет доступа 😧');
      return;
    }

    const reports = await listReports(50, 0);
    if (!reports || reports.length === 0) {
      ctx.reply('Нет доступных отчетов.');
      return;
    }

    // Send each report as its own message with optional image preview and per-report buttons
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

      const attachments = [keyboard];
      // If image url present, add it before keyboard so platform can render preview
      if (r.img) attachments.unshift({ type: 'image', url: r.img });

      await ctx.reply(message, { attachments });
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
    if (report.img) text += `Изображение: ${report.img}\n`;
    text += `Аноним: ${report.anonim ? 'да' : 'нет'}`;

    ctx.reply(text);
  } catch (err) {
    console.error('adminGetReport error', err);
    ctx.reply('Ошибка при получении отчета.');
  }
}

export async function adminDeleteReport(ctx, reportId) {
  try {
    const res = await deleteReport(reportId);
    if (res && res.deleted) ctx.reply('Отчет удалён.');
    else ctx.reply('Отчет не найден или не удалён.');
  } catch (err) {
    console.error('adminDeleteReport error', err);
    ctx.reply('Ошибка при удалении отчета.');
  }
}
