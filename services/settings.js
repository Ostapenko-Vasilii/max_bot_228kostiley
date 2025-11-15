import { Keyboard } from '@maxhub/max-bot-api';
import { getUserNotificationPreference, toggleUserEventNotifications } from '../db/user-preferences.js';
import { addUserState } from '../db/states.js';
import { updateUserFields } from '../db/users.js';
import { getUserById } from '../db/users.js';

const SETTINGS_UPDATE_STATE = 'settings_update_profile';
const settingsUpdateSessions = new Map();

function validateSettingsValue(field, value) {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	if (!trimmed.length) return null;

	if (field === 'first_name' || field === 'last_name') {
		if (trimmed.length < 4 || trimmed.length > 20) return null;
		return trimmed;
	}
	if (field === 'room') {
		if (!/^\d+$/.test(trimmed)) return null;
		const numeric = Number(trimmed);
		if (numeric < 1 || numeric > 600) return null;
		return String(numeric);
	}
	return null;
}

async function startSettingsFieldUpdate(ctx, field, prompt, successMessage) {
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(userId)) return;

	settingsUpdateSessions.set(userId, { field, successMessage });
	await addUserState(userId, SETTINGS_UPDATE_STATE);
	await ctx.reply(prompt);
}

function buildSettingsText(userId, profile) {
	const firstName = profile?.first_name?.trim() || 'не указано';
	const lastName = profile?.last_name?.trim() || 'не указана';
	const room = profile?.room?.trim() || 'не указана';
	return `Настройки
Ваш ID: ${userId}
Имя: ${firstName}
Фамилия: ${lastName}
Комната: ${room}`;
}

function buildSettingsKeyboard(notifyEventsEnabled) {
	const toggleLabel = `Уведомления о мероприятиях: ${notifyEventsEnabled ? 'да' : 'нет'}`;
	return Keyboard.inlineKeyboard([
		[Keyboard.button.callback('Изменить имя', 'settings_change_first_name')],
		[Keyboard.button.callback('Изменить фамилию', 'settings_change_last_name')],
		[Keyboard.button.callback('Изменить номер комнаты', 'settings_change_room')],
		[Keyboard.button.callback(toggleLabel, 'settings_toggle_event_notifications')],
		[Keyboard.button.callback('Меню', 'show_main_menu')],
	]);
}

export async function showSettings(ctx) {
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(userId)) return;

	let notifyEvents = true;
	let profile = null;
	try {
		notifyEvents = await getUserNotificationPreference(userId);
	} catch (err) {
		console.error('showSettings preference error:', err);
	}
	try {
		profile = await getUserById(userId);
	} catch (err) {
		console.error('showSettings profile error:', err);
	}

	const keyboard = buildSettingsKeyboard(notifyEvents);
	await ctx.reply(buildSettingsText(userId, profile), { attachments: [keyboard] });
}

export async function toggleSettingsNotifications(ctx) {
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(userId)) return;

	let notifyEvents;
	try {
		notifyEvents = await toggleUserEventNotifications(userId);
	} catch (err) {
		console.error('toggleSettingsNotifications update error:', err);
		await ctx.reply('Не удалось изменить настройки уведомлений.');
		return;
	}
	let profile = null;
	try {
		profile = await getUserById(userId);
	} catch (err) {
		console.error('toggleSettingsNotifications profile error:', err);
	}

	const keyboard = buildSettingsKeyboard(notifyEvents);
	const payload = {
		message_id: ctx.message?.body?.mid ?? ctx.message?.mid ?? undefined,
		text: buildSettingsText(userId, profile),
		attachments: [keyboard],
	};

	if (payload.message_id && typeof ctx.editMessage === 'function') {
		try {
			await ctx.editMessage(payload);
			return;
		} catch (err) {
			console.error('toggleSettingsNotifications edit error:', err);
		}
	}

	await ctx.reply(payload.text, { attachments: payload.attachments });
}

export async function startSettingsChangeFirstName(ctx) {
	await startSettingsFieldUpdate(ctx, 'first_name', 'Введите новое имя (4-20 символов):', 'Имя обновлено.');
}

export async function startSettingsChangeLastName(ctx) {
	await startSettingsFieldUpdate(ctx, 'last_name', 'Введите новую фамилию (4-20 символов):', 'Фамилия обновлена.');
}

export async function startSettingsChangeRoom(ctx) {
	await startSettingsFieldUpdate(ctx, 'room', 'Введите новый номер комнаты (1-600):', 'Номер комнаты обновлён.');
}

export async function handleSettingsUpdateResponse(ctx) {
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(userId)) return false;

	const session = settingsUpdateSessions.get(userId);
	if (!session) return false;

	const raw = typeof ctx.message?.body?.text === 'string' ? ctx.message.body.text : '';
	const normalized = validateSettingsValue(session.field, raw);
	if (!normalized) {
		await ctx.reply('Некорректное значение, попробуйте ещё раз.');
		return true;
	}

	try {
		await updateUserFields(userId, { [session.field]: normalized });
		await ctx.reply(session.successMessage ?? 'Данные обновлены.');
	} catch (err) {
		console.error('handleSettingsUpdateResponse update error:', err);
		await ctx.reply('Не удалось сохранить данные.');
		return true;
	}

	settingsUpdateSessions.delete(userId);
	await addUserState(userId, null);
	await showSettings(ctx);
	return true;
}
