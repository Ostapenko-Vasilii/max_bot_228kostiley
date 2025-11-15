import { addUserState } from '../db/states.js';
import { getUserRoles } from '../db/roles.js';
import { getUserById } from '../db/users.js';
import { saveDutySchedule, getDutySchedule, getAllDutySchedules } from '../db/duty-schedules.js';

const DUTY_SELECT_STATE = 'duty_schedule_select_floor';
const DUTY_MESSAGE_STATE = 'duty_schedule_wait_message';
const dutyEditSessions = new Map();

function extractMessageAttachments(ctx) {
	const bodyAttachments = Array.isArray(ctx.message?.body?.attachments) ? ctx.message.body.attachments : [];
	const messageAttachments = Array.isArray(ctx.message?.attachments) ? ctx.message.attachments : [];
	return [...bodyAttachments, ...messageAttachments].filter((item) => item && typeof item === 'object');
}

async function ensureHeadmanAccess(ctx) {
	const userId = ctx.user?.user_id;
	let roles = await getUserRoles(userId);
	if (!Array.isArray(roles)) roles = [];
	if (!(roles.includes(2) || roles.includes(5) || roles.includes(6))) {
		await ctx.reply('У вас нет доступа 😧');
		return false;
	}
	return true;
}

function parseFloorFromRoom(room) {
	if (!room) return null;
	const digits = String(room).match(/\d+/);
	if (!digits || !digits[0]) return null;
	const numeric = Number(digits[0]);
	if (!Number.isFinite(numeric)) return null;
	let floor = Math.floor(numeric / 100);
	if (floor <= 0) {
		floor = Number(digits[0][0]);
	}
	if (!Number.isFinite(floor) || floor < 1 || floor > 5) return null;
	return floor;
}

export async function startDutyScheduleEdit(ctx) {
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(userId)) return;
	if (!await ensureHeadmanAccess(ctx)) return;

	dutyEditSessions.delete(userId);
	await addUserState(userId, DUTY_SELECT_STATE);
	await ctx.reply('Введите номер этажа (1-5), для которого нужно задать график.');
}

export async function handleDutyScheduleFloorInput(ctx) {
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(userId)) return false;
	if (!await ensureHeadmanAccess(ctx)) return true;

	const text = typeof ctx.message?.body?.text === 'string' ? ctx.message.body.text.trim() : '';
	const floor = Number(text);
	if (!Number.isInteger(floor) || floor < 1 || floor > 5) {
		await ctx.reply('Номер этажа должен быть числом от 1 до 5.');
		return true;
	}

	dutyEditSessions.set(userId, { floor });
	await addUserState(userId, DUTY_MESSAGE_STATE);

	try {
		const existing = await getDutySchedule(floor);
		const header = `Текущий график этажа ${floor}:`;
		if (existing && (existing.text?.trim()?.length || (existing.attachments?.length ?? 0))) {
			const textValue = existing.text?.trim() ?? '';
			const attachments = Array.isArray(existing.attachments) ? existing.attachments : [];
			if (attachments.length) {
				await ctx.reply(textValue.length ? `${header}\n${textValue}` : header, { attachments });
			} else {
				await ctx.reply(`${header}\n${textValue}`);
			}
		} else {
			await ctx.reply(`Для этажа ${floor} график пока не задан.`);
		}
	} catch (err) {
		console.error('handleDutyScheduleFloorInput fetch error:', err);
		await ctx.reply('Не удалось получить текущий график этажа.');
	}

	await ctx.reply('Отправьте сообщение с новым графиком (текст и/или вложения).');
	return true;
}

export async function handleDutyScheduleMessage(ctx) {
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(userId)) return false;
	if (!dutyEditSessions.has(userId)) return false;
	if (!await ensureHeadmanAccess(ctx)) return true;

	const { floor } = dutyEditSessions.get(userId);
	const text = typeof ctx.message?.body?.text === 'string' ? ctx.message.body.text.trim() : '';
	const attachments = extractMessageAttachments(ctx);

	if (!text.length && attachments.length === 0) {
		await ctx.reply('Сообщение должно содержать текст или вложения.');
		return true;
	}

	try {
		await saveDutySchedule(floor, { text, attachments });
		await ctx.reply(`График для этажа ${floor} обновлён.`);
	} catch (err) {
		console.error('handleDutyScheduleMessage save error:', err);
		await ctx.reply('Не удалось сохранить график.');
		return true;
	}

	dutyEditSessions.delete(userId);
	await addUserState(userId, null);
	return true;
}

export async function showDutySchedule(ctx) {
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(userId)) return;

	let user = null;
	try {
		user = await getUserById(userId);
	} catch (err) {
		console.error('showDutySchedule user fetch error:', err);
	}

	const room = user?.room ?? null;
	const floor = parseFloorFromRoom(room);
	if (!floor) {
		await ctx.reply('Не удалось определить ваш этаж. Укажите номер комнаты в настройках.');
		return;
	}

	let schedule = null;
	try {
		schedule = await getDutySchedule(floor);
	} catch (err) {
		console.error('showDutySchedule fetch error:', err);
	}

	const text = schedule?.text?.trim() ?? '';
	const attachments = Array.isArray(schedule?.attachments) ? schedule.attachments : [];
	const header = `График дежурств для этажа ${floor}:`;

	if (!text.length && attachments.length === 0) {
		await ctx.reply(`${header}\nРасписание пока не добавлено.`);
		return;
	}

	if (attachments.length) {
		await ctx.reply(text.length ? `${header}\n${text}` : header, { attachments });
	} else {
		await ctx.reply(`${header}\n${text}`);
	}
}

export async function showAllDutySchedules(ctx) {
	let schedules = [];
	try {
		schedules = await getAllDutySchedules();
	} catch (err) {
		console.error('showAllDutySchedules fetch error:', err);
		await ctx.reply('Не удалось получить расписания.');
		return;
	}

	if (!schedules.length) {
		await ctx.reply('Расписания дежурств ещё не заполнены.');
		return;
	}

	for (const schedule of schedules) {
		const floor = schedule.floor;
		const text = schedule.text?.trim() ?? '';
		const attachments = Array.isArray(schedule.attachments) ? schedule.attachments : [];
		const header = `Этаж ${floor}:`;
		if (attachments.length) {
			await ctx.reply(text.length ? `${header}\n${text}` : header, { attachments });
		} else {
			await ctx.reply(`${header}\n${text || '—'}`);
		}
	}
}
