import {getUserRoles} from '../../db/roles.js';
import { Keyboard } from '@maxhub/max-bot-api';


export const adminPanelButtons = [
    { label: '📅 Создать мероприятие', payload: { command: 'admin_panel_create_event' } },
    { label: '📋 Список мероприятий', payload: { command: 'admin_panel_list_events' } },
];
const standartButtons = [
    { label: '🔙 Открыть меню', payload: { command: 'show_main_menu' } },
];

export async function showAdminPanel(ctx) {
    const roles = await getUserRoles(ctx.user.user_id);
    if (!Array.isArray(roles)) roles = [];

    if (!roles.includes(3)) {
        ctx.reply('У вас нет доступа 😧');
        return;
    }
    const buttons = adminPanelButtons.concat(standartButtons);
    const sdkButtons = buttons.map(btn => [Keyboard.button.callback(btn.label, btn.payload?.command ?? '')]);
    const keyboard = Keyboard.inlineKeyboard(sdkButtons);
    ctx.reply('Админ-панель', {
        attachments: [keyboard]
    });
}

