import { Keyboard } from '@maxhub/max-bot-api';
import { getUserRoles } from '../../db/roles.js';
import { setAdminState, getAdminState, clearAdminState } from '../../db/statedb.js';
import { getAllBookingPlaces, getBookingPlaceById, createBookingPlace, updateBookingPlace } from '../../db/booking-places.js';

const WIZARD_ACTION = 'manage_place_wizard';
const STEPS = ['name', 'work_hours', 'interval', 'day_limit', 'week_limit'];

function parseWorkHoursInput(input) {
	const chunks = String(input || '')
		.split(/\s+/)
		.filter(Boolean);
	if (!chunks.length) throw new Error('Введите интервалы, например "8-12 13-20".');

	const ranges = chunks.map((chunk) => {
		const parts = chunk.split('-');
		if (parts.length !== 2) throw new Error('Неверный формат интервала.');
		const start = Number(parts[0]);
		const end = Number(parts[1]);
		if (![start, end].every((v) => Number.isFinite(v))) throw new Error('Интервал должен быть в формате HH-HH.');
		if (start < 0 || end > 24 || start >= end) throw new Error('Интервал вне рабочего дня.');
		return { start: start * 60, end: end * 60 };
	});

	return ranges;
}

function rangesToString(ranges = []) {
	return ranges
		.map((range) => {
			const start = String(Math.floor(range.start / 60)).padStart(2, '0');
			const end = String(Math.floor(range.end / 60)).padStart(2, '0');
			return `${start}-${end}`;
		})
		.join(' ');
}

function parseStoredRanges(raw) {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed
					.map((item) => ({
						start: Number(item?.start) || 0,
						end: Number(item?.end) || 0,
					}))
					.filter((item) => item.end > item.start)
			: [];
	} catch {
		return [];
	}
}

async function ensureForeman(ctx) {
	const userId = ctx.user?.user_id;
	let roles = await getUserRoles(userId);
	if (!Array.isArray(roles)) roles = [];
	if (!roles.includes(6)) {
		await ctx.reply('У вас нет доступа 😧');
		return false;
	}
	return true;
}

function buildManageKeyboard(places) {
	const rows = [[Keyboard.button.callback('➕ Добавить место', 'manage_places_add_new')]];
	places.forEach((place) => {
		rows.push([Keyboard.button.callback(place.name, `manage_places_edit_${place.place_id}`)]);
	});
	rows.push([Keyboard.button.callback('Меню', 'show_main_menu')]);
	return Keyboard.inlineKeyboard(rows);
}

function promptForStep(step, data) {
	switch (STEPS[step]) {
		case 'name':
			return `Введите название места:\n${data.name ? `Текущее: ${data.name}` : ''}`.trim();
		case 'work_hours':
			return `Введите время работы (например "8-12 13-20"):\n${
				data.work_hours_input ? `Текущее: ${data.work_hours_input}` : ''
			}`.trim();
		case 'interval':
			return `Введите длительность бронирования в минутах (например 45):\n${
				data.interval_minutes ? `Текущее: ${data.interval_minutes}` : ''
			}`.trim();
		case 'day_limit':
			return `Введите дневной лимит бронирований для пользователя:\n${
				data.per_day_limit ? `Текущее: ${data.per_day_limit}` : ''
			}`.trim();
		case 'week_limit':
			return `Введите недельный лимит бронирований для пользователя:\n${
				data.per_week_limit ? `Текущее: ${data.per_week_limit}` : ''
			}`.trim();
		default:
			return 'Введите значение:';
	}
}

export async function showPlaceManagementMenu(ctx) {
	if (!await ensureForeman(ctx)) return;
	let places = [];
	try {
		places = await getAllBookingPlaces();
	} catch (err) {
		console.error('showPlaceManagementMenu error:', err);
		await ctx.reply('Не удалось получить список мест.');
		return;
	}
	const keyboard = buildManageKeyboard(places);
	const text = places.length
		? 'Выберите место для редактирования или добавьте новое.'
		: 'Мест пока нет. Добавьте первое.';
	await ctx.reply(text, { attachments: [keyboard] });
}

export async function beginPlaceWizard(ctx, placeId = null) {
	if (!await ensureForeman(ctx)) return;

	let payload = { step: 0, place_id: placeId ? Number(placeId) : null, data: {} };
	if (payload.place_id) {
		const place = await getBookingPlaceById(payload.place_id);
		if (!place) {
			await ctx.reply('Место не найдено.');
			return;
		}
		const ranges = parseStoredRanges(place.work_hours);
		payload.data = {
			name: place.name,
			work_hours_input: rangesToString(ranges),
			work_hours_ranges: ranges,
			interval_minutes: place.interval_minutes,
			per_day_limit: place.per_day_limit,
			per_week_limit: place.per_week_limit,
		};
	}

	const adminId = Number(ctx.user?.user_id);
	if (!Number.isInteger(adminId)) return;
	await setAdminState(adminId, WIZARD_ACTION, JSON.stringify(payload));
	await ctx.reply(promptForStep(payload.step, payload.data));
}

export async function handlePlaceWizardMessage(ctx) {
	const adminId = Number(ctx.user?.user_id);
	if (!Number.isInteger(adminId)) return false;

	const state = await getAdminState(adminId);
	if (state?.action !== WIZARD_ACTION) return false;

	let payload;
	try {
		payload = state.payload ? JSON.parse(state.payload) : null;
	} catch {
		payload = null;
	}
	if (!payload) {
		await clearAdminState(adminId);
		return false;
	}

	const text = typeof ctx.message?.body?.text === 'string' ? ctx.message.body.text.trim() : '';
	if (!text.length) {
		await ctx.reply('Введите значение.');
		return true;
	}

	try {
		switch (STEPS[payload.step]) {
			case 'name':
				if (text.length < 3 || text.length > 120) throw new Error('Название должно быть 3-120 символов.');
				payload.data.name = text;
				break;
			case 'work_hours':
				payload.data.work_hours_ranges = parseWorkHoursInput(text);
				payload.data.work_hours_input = rangesToString(payload.data.work_hours_ranges);
				break;
			case 'interval': {
				const minutes = Number(text);
				if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) throw new Error('Интервал от 5 до 240 минут.');
				payload.data.interval_minutes = minutes;
				break;
			}
			case 'day_limit': {
				const limit = Number(text);
				if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error('Лимит от 1 до 24.');
				payload.data.per_day_limit = limit;
				break;
			}
			case 'week_limit': {
				const limit = Number(text);
				if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Лимит от 1 до 50.');
				payload.data.per_week_limit = limit;
				break;
			}
			default:
				throw new Error('Неизвестный шаг.');
		}
	} catch (err) {
		await ctx.reply(err.message || 'Некорректное значение.');
		return true;
	}

	payload.step += 1;

	if (payload.step >= STEPS.length) {
		const placeData = {
			name: payload.data.name,
			work_hours: JSON.stringify(payload.data.work_hours_ranges || []),
			interval_minutes: payload.data.interval_minutes,
			per_day_limit: payload.data.per_day_limit,
			per_week_limit: payload.data.per_week_limit,
		};
		try {
			if (payload.place_id) {
				await updateBookingPlace(payload.place_id, placeData);
			} else {
				await createBookingPlace(placeData);
			}
			await clearAdminState(adminId);
			await ctx.reply(payload.place_id ? 'Место обновлено.' : 'Место создано.');
			await showPlaceManagementMenu(ctx);
		} catch (err) {
			console.error('handlePlaceWizardMessage save error:', err);
			await ctx.reply('Не удалось сохранить место.');
		}
		return true;
	}

	await setAdminState(adminId, WIZARD_ACTION, JSON.stringify(payload));
	await ctx.reply(promptForStep(payload.step, payload.data));
	return true;
}
