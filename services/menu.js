import { Keyboard } from '@maxhub/max-bot-api';
import { getUserRoles, addUserRoles } from '../db/roles.js';


export const userButtons = [
    { label: '📅 Мероприятия', payload: { command: 'menu_open_events' } },
    { label: '📝 Жалоба', payload: { command: 'menu_open_create_complaint' } },
    { label: '🧹 Дежурство', payload: { command: 'menu_open_duty' } },
    { label: '🏢 Бронь места', payload: { command: 'menu_open_booking' } },
    { label: 'ℹ️ Информация', payload: { command: 'menu_open_useful_info' } },
    { label: '⚙️ Настройки', payload: { command: 'menu_open_settings' } },
];
export const headmanButtons = [
    { label: '📓 задать дежурства', payload: { command: 'manage_events' } },
];
export const adminButtons = [
    { label: '🛠 Админ панель', payload: { command: 'menu_open_admin_panel' } },
];
export const responsibleButtons = [
    { label: '📋 Просмотр жалоб', payload: { command: 'menu_open_view_complaints' } },
];
export const supervisorButtons = [
    { label: '📖 графики дежурств', payload: { command: 'menu_open_view_schedule' } },
];
export const foremanButtons = [
    { label: '🔧 Прораб-панель', payload: { command: 'menu_open_manage' } },
];


export async function showMainMenu(ctx, bot) {
    const buttonRows = await getButtonsForMainMenu(ctx.user?.user_id);
    const keyboard = Keyboard.inlineKeyboard(buttonRows);
    await ctx.reply('Главное меню ( /start ):', {
        attachments: [keyboard],
      });
      if (String(ctx.user?.user_id) === process.env.PRORAB_ID) {
          await addUserRoles(ctx.user?.user_id, 6); // добавляем роль прораба
    }
}

async function getButtonsForMainMenu(user_id) {
    let roles = await getUserRoles(user_id);
    if (!Array.isArray(roles)) roles = [];

    let buttons = [];
    if (roles.includes(1)) {
        buttons = buttons.concat(userButtons);
    }
    if (roles.includes(2)) {
        buttons = buttons.concat(headmanButtons);
    }
    if (roles.includes(3)) {
        buttons = buttons.concat(adminButtons);
    }
    if (roles.includes(4)) {
        buttons = buttons.concat(responsibleButtons);
    }
    if (roles.includes(5)) {
        buttons = buttons.concat(supervisorButtons);
    }
    if (roles.includes(6)) {
        buttons = buttons.concat(foremanButtons);
    }

    // Если нет ни одной кнопки — показываем базовые userButtons
    if (buttons.length === 0) {
        buttons = userButtons.slice();
    }

    // Преобразуем объекты в кнопки SDK и группируем по 2 в ряд
    const sdkButtons = buttons.map(btn => Keyboard.button.callback(btn.label, btn.payload?.command ?? ''));
    const rows = [];
    for (let i = 0; i < sdkButtons.length; i += 2) {
        rows.push(sdkButtons.slice(i, i + 2));
    }
    return rows;
}

