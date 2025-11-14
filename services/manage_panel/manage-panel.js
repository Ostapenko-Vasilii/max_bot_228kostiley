import { getUserRoles, addUserRoles, removeUserRole } from '../../db/roles.js';
import { Keyboard } from '@maxhub/max-bot-api';
import { setAdminState, getAdminState, clearAdminState } from '../../db/statedb.js';
import { getUserById, getAllUsers } from '../../db/users.js';

const ROLE_ITEMS = [
    { id: 1, label: 'user (1)' },
    { id: 2, label: 'дежурный (2)' },
    { id: 3, label: 'админ (3)' },
    { id: 4, label: 'отвецтвенный (4)' },
    { id: 5, label: 'главный староста (5)' },
    { id: 6, label: 'прораб (6)' },
];

async function ensureForemanAccess(ctx) {
    const userId = ctx.user?.user_id;
    let roles = await getUserRoles(userId);
    if (!Array.isArray(roles)) roles = [];
    if (!roles.includes(6)) {
        await ctx.reply('У вас нет доступа 😧');
        return null;
    }
    return roles;
}

function buildRolePanelText(user, currentRoles) {
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || '—';
    const room = user.room ?? user.room_number ?? 'не указан';
    const statuses = ROLE_ITEMS
        .map((role) => `${currentRoles.includes(role.id) ? '✅' : '❌'} ${role.label}`)
        .join('\n');
    return `Выберите роли для:\n${fullName}\nКомната: ${room}\nID: ${user.user_id}\n\nТекущие роли:\n${statuses}`;
}

function buildRoleKeyboard(currentRoles) {
    const rows = ROLE_ITEMS.map((role) => {
        const hasRole = currentRoles.includes(role.id);
        const label = `${hasRole ? 'Убрать' : 'Дать'} ${role.label}`;
        return [Keyboard.button.callback(label, `manage_panel_toggle_role_${role.id}`)];
    });
    rows.push([Keyboard.button.callback('✅ Готово', 'manage_panel_assign_finish')]);
    rows.push([Keyboard.button.callback('❌ Отмена', 'manage_panel_assign_cancel')]);
    return Keyboard.inlineKeyboard(rows);
}

export const managePanelButtons = [
    { label: '🎭 Назначить роль', payload: { command: 'manage_panel_assign_role' } },
    { label: '📨 рассылка всем', payload: { command: 'manage_panel_broadcast_all' } },
    { label: '✏️ изменить информацию', payload: { command: 'manage_panel_edit_info' } },
    { label: '👥 посмотреть пользователей', payload: { command: 'manage_panel_view_users' } },
];

const standartButtons = [
    { label: '🔙 Открыть меню', payload: { command: 'show_main_menu' } },
];
export async function showManagePanel(ctx) {
    if (!await ensureForemanAccess(ctx)) return;
    let roles = await getUserRoles(ctx.user.user_id);
    if (!Array.isArray(roles)) roles = [];
    if (!roles.includes(6)) {
        ctx.reply('У вас нет доступа 😧');
        return;
    }
    var buttons = managePanelButtons.concat(standartButtons);
    var sdkButtons = buttons.map(btn => [Keyboard.button.callback(btn.label, btn.payload.command)]);
    var keyboard = Keyboard.inlineKeyboard(sdkButtons);
    await ctx.reply('Добро пожаловать в панель управления!', {
        attachments: [keyboard]
    });
}

export async function startBroadcastToAll(ctx) {
    const userId = Number(ctx.user?.user_id);
    if (!Number.isInteger(userId)) return;
    if (!await ensureForemanAccess(ctx)) return;
    const keyboard = Keyboard.inlineKeyboard([
        [Keyboard.button.callback('❌ отмена', 'admin_panel_event_edit_cancel')]
    ]);

    const prompt = await ctx.reply('Отправьте сообщение для рассылки всем пользователям.', {
        attachments: [keyboard]
    });
    const promptMid = prompt?.body?.mid ?? prompt?.mid ?? null;

    await setAdminState(
        userId,
        'broadcast_all_message',
        JSON.stringify({ prompt_mid: promptMid })
    );
}

export async function startAssignRole(ctx) {
    const userId = Number(ctx.user?.user_id);
    if (!Number.isInteger(userId)) return;
    if (!await ensureForemanAccess(ctx)) return;

    const keyboard = Keyboard.inlineKeyboard([
        [Keyboard.button.callback('❌ Отмена', 'manage_panel_assign_cancel')]
    ]);

    await ctx.reply('Введите ID пользователя, которому нужно назначить роли.', {
        attachments: [keyboard]
    });

    await setAdminState(userId, 'assign_role_wait_user_id', '{}');
}

export async function processAssignRoleUserIdInput(ctx) {
    const adminId = Number(ctx.user?.user_id);
    if (!Number.isInteger(adminId)) return false;
    if (!await ensureForemanAccess(ctx)) return false;

    const text = typeof ctx.message?.body?.text === 'string' ? ctx.message.body.text.trim() : '';
    const targetId = Number(text);
    if (!Number.isInteger(targetId) || targetId <= 0) {
        await ctx.reply('ID должен быть положительным числом.');
        return false;
    }

    const user = await getUserById(targetId);
    if (!user) {
        await ctx.reply('Пользователь не найден.');
        return false;
    }

    let currentRoles = await getUserRoles(targetId);
    if (!Array.isArray(currentRoles)) currentRoles = [];

    const keyboard = buildRoleKeyboard(currentRoles);
    const message = await ctx.reply(buildRolePanelText(user, currentRoles), {
        attachments: [keyboard]
    });
    const panelMid = message?.body?.mid ?? message?.mid ?? null;

    await setAdminState(
        adminId,
        'assign_role_manage',
        JSON.stringify({ target_user_id: user.user_id, panel_mid: panelMid })
    );
    return true;
}

export async function handleAssignRoleToggle(ctx, roleId) {
    const adminId = Number(ctx.user?.user_id);
    if (!Number.isInteger(adminId)) return;
    if (!await ensureForemanAccess(ctx)) return;

    const state = await getAdminState(adminId);
    if (state?.action !== 'assign_role_manage') {
        await ctx.reply('Сначала выберите пользователя для изменения ролей.');
        return;
    }

    let payload = null;
    try {
        payload = state.payload ? JSON.parse(state.payload) : null;
    } catch {
        payload = null;
    }

    const targetUserId = Number(payload?.target_user_id);
    if (!Number.isInteger(targetUserId)) {
        await clearAdminState(adminId);
        await ctx.reply('Не удалось определить пользователя для изменения ролей.');
        return;
    }

    let currentRoles = await getUserRoles(targetUserId);
    if (!Array.isArray(currentRoles)) currentRoles = [];
    const hasRole = currentRoles.includes(roleId);

    try {
        if (hasRole) {
            await removeUserRole(targetUserId, roleId);
        } else {
            await addUserRoles(targetUserId, roleId);
        }
    } catch (err) {
        console.error('handleAssignRoleToggle update error:', err);
        await ctx.reply('Не удалось обновить роль.');
        return;
    }

    currentRoles = await getUserRoles(targetUserId);
    if (!Array.isArray(currentRoles)) currentRoles = [];

    const user = await getUserById(targetUserId);
    if (!user) {
        await clearAdminState(adminId);
        await ctx.reply('Пользователь не найден.');
        return;
    }

    const keyboard = buildRoleKeyboard(currentRoles);
    const text = buildRolePanelText(user, currentRoles);
    const mid = ctx.message?.body?.mid ? String(ctx.message.body.mid) : payload?.panel_mid ? String(payload.panel_mid) : null;
    const editPayload = { text, attachments: [keyboard] };
    if (mid) editPayload.message_id = mid;

    try {
        if (typeof ctx.editMessage === 'function') {
            await ctx.editMessage(editPayload);
        } else {
            await ctx.reply(text, { attachments: [keyboard] });
        }
    } catch (err) {
        console.error('handleAssignRoleToggle edit error:', err);
        await ctx.reply(text, { attachments: [keyboard] });
    }

    await setAdminState(
        adminId,
        'assign_role_manage',
        JSON.stringify({ target_user_id: targetUserId, panel_mid: mid || payload?.panel_mid || null })
    );
}

export async function finishAssignRole(ctx) {
    const adminId = Number(ctx.user?.user_id);
    if (!Number.isInteger(adminId)) return;

    const state = await getAdminState(adminId);
    if (state?.action !== 'assign_role_manage') {
        await ctx.reply('Нет активного процесса назначения ролей.');
        return;
    }

    let payload = null;
    try {
        payload = state.payload ? JSON.parse(state.payload) : null;
    } catch {
        payload = null;
    }

    await clearAdminState(adminId);

    const mid = ctx.message?.body?.mid ? String(ctx.message.body.mid) : payload?.panel_mid ? String(payload.panel_mid) : null;
    if (mid && typeof ctx.editMessage === 'function') {
        try {
            await ctx.editMessage({ message_id: mid, text: '✅ Назначение ролей завершено.', attachments: [] });
        } catch (err) {
            console.error('finishAssignRole edit error:', err);
        }
    }

    await ctx.reply('Назначение ролей завершено.');
}

export async function cancelAssignRole(ctx) {
    const adminId = Number(ctx.user?.user_id);
    if (!Number.isInteger(adminId)) return;

    const state = await getAdminState(adminId);
    if (!state || (state.action !== 'assign_role_wait_user_id' && state.action !== 'assign_role_manage')) {
        await ctx.reply('Нет активного процесса назначения ролей.');
        return;
    }

    let payload = null;
    try {
        payload = state.payload ? JSON.parse(state.payload) : null;
    } catch {
        payload = null;
    }

    await clearAdminState(adminId);

    const mid = ctx.message?.body?.mid ? String(ctx.message.body.mid) : payload?.panel_mid ? String(payload.panel_mid) : null;
    if (mid && typeof ctx.editMessage === 'function') {
        try {
            await ctx.editMessage({ message_id: mid, text: '❌ Назначение ролей отменено.', attachments: [] });
        } catch (err) {
            console.error('cancelAssignRole edit error:', err);
        }
    }

    await ctx.reply('Назначение ролей отменено.');
}

export async function viewAllUsers(ctx) {
    if (!await ensureForemanAccess(ctx)) return;

    let users;
    try {
        users = await getAllUsers();
    } catch (err) {
        console.error('viewAllUsers fetch error:', err);
        await ctx.reply('Не удалось получить список пользователей.');
        return;
    }

    if (!users.length) {
        await ctx.reply('Нет зарегистрированных пользователей.');
        return;
    }

    const lines = users.map((user) => {
        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || '—';
        const room = user.room && String(user.room).trim() ? String(user.room).trim() : 'не указана';
        return `${user.user_id} - ${fullName} - ${room}`;
    });

    const maxChunkSize = 3500;
    let buffer = 'Список пользователей:\n';
    for (const line of lines) {
        if (buffer.length + line.length + 1 > maxChunkSize) {
            await ctx.reply(buffer.trimEnd());
            buffer = '';
        }
        buffer += `${line}\n`;
    }
    if (buffer.trim().length) {
        await ctx.reply(buffer.trimEnd());
    }
}
