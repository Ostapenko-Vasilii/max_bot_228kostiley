import { Keyboard } from '@maxhub/max-bot-api';
import { getAllBookingPlaces, getBookingPlaceById } from '../db/booking-places.js';
import { getReservationsForPlace, countUserReservations, createBookingReservation } from '../db/booking-reservations.js';

function parseRanges(raw) {
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

function dayBounds(date) {
	const start = new Date(date);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	return { start, end };
}

function weekBounds(date) {
	const ref = new Date(date);
	ref.setHours(0, 0, 0, 0);
	const day = ref.getDay() || 7;
	const start = new Date(ref);
	start.setDate(ref.getDate() - (day - 1));
	const end = new Date(start);
	end.setDate(start.getDate() + 7);
	return { start, end };
}

function buildDayOptions() {
	const today = new Date();
	const tomorrow = new Date();
	tomorrow.setDate(today.getDate() + 1);
	return [
		{ offset: 0, label: `Сегодня (${today.toLocaleDateString()})`, date: today },
		{ offset: 1, label: `Завтра (${tomorrow.toLocaleDateString()})`, date: tomorrow },
	];
}

function formatSlotLabel(start, end) {
	const fmt = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	return `${fmt(start)}-${fmt(end)}`;
}

function slotKeyboard(placeId, slots) {
	const rows = [];
	for (let i = 0; i < slots.length; i += 3) {
		const chunk = slots.slice(i, i + 3).map((slot) =>
			Keyboard.button.callback(
				slot.label,
				`booking_slot_${placeId}_${slot.start.getTime()}`
			)
		);
		rows.push(chunk);
	}
	rows.push([
		Keyboard.button.callback('⬅️ Другой день', `booking_day_menu_${placeId}`),
		Keyboard.button.callback('🏠 К местам', 'booking_back_to_places'),
	]);
	return Keyboard.inlineKeyboard(rows);
}

export async function showBookingEntry(ctx, options = {}) {
	let places;
	try {
		places = await getAllBookingPlaces();
	} catch (err) {
		console.error('showBookingEntry error:', err);
		await ctx.reply('Не удалось получить список мест.');
		return;
	}

	if (!places.length) {
		await ctx.reply('Места для бронирования ещё не добавлены.');
		return;
	}

	if (places.length === 1 && !options.forceList) {
		await showBookingDayMenu(ctx, places[0].place_id);
		return;
	}

	const rows = places.map((place) => [Keyboard.button.callback(place.name, `booking_place_${place.place_id}`)]);
	rows.push([Keyboard.button.callback('Меню', 'show_main_menu')]);
	await ctx.reply('Выберите место:', { attachments: [Keyboard.inlineKeyboard(rows)] });
}

export async function showBookingDayMenu(ctx, placeId) {
	const place = await getBookingPlaceById(placeId);
	if (!place) {
		await ctx.reply('Место не найдено.');
		return;
	}
	const days = buildDayOptions();
	const rows = days.map((item) => [
		Keyboard.button.callback(item.label, `booking_day_${place.place_id}_${item.date.toISOString().slice(0, 10)}`),
	]);
	rows.push([Keyboard.button.callback('🏠 К местам', 'booking_back_to_places')]);
	await ctx.reply(`Расписание для "${place.name}". Выберите день:`, { attachments: [Keyboard.inlineKeyboard(rows)] });
}

export async function handleBookingPlaceSelect(ctx, placeId) {
	const numeric = Number(placeId);
	if (!Number.isInteger(numeric)) return;
	await showBookingDayMenu(ctx, numeric);
}

export async function handleBookingDaySelect(ctx, placeId, dateStr) {
	const numeric = Number(placeId);
	if (!Number.isInteger(numeric)) return;

	const place = await getBookingPlaceById(numeric);
	if (!place) {
		await ctx.reply('Место не найдено.');
		return;
	}

	const target = new Date(`${dateStr}T00:00:00`);
	if (Number.isNaN(target.valueOf())) {
		await ctx.reply('Некорректная дата.');
		return;
	}

	const { start: dayStart, end: dayEnd } = dayBounds(target);
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(userId)) return;

	try {
		const dayCount = await countUserReservations(numeric, userId, dayStart, dayEnd);
		if (dayCount >= place.per_day_limit) {
			await ctx.reply('Вы достигли дневного лимита для этого места.');
			return;
		}
		const { start: weekStart, end: weekEnd } = weekBounds(dayStart);
		const weekCount = await countUserReservations(numeric, userId, weekStart, weekEnd);
		if (weekCount >= place.per_week_limit) {
			await ctx.reply('Вы достигли недельного лимита для этого места.');
			return;
		}

		const ranges = parseRanges(place.work_hours);
		const intervalMs = place.interval_minutes * 60 * 1000;
		const now = new Date();
		const reservations = await getReservationsForPlace(numeric, dayStart, dayEnd);
		const taken = reservations.map((res) => ({
			start: new Date(res.start_time),
			end: new Date(res.end_time),
		}));

		const slots = [];
		ranges.forEach((range) => {
			for (let minutes = range.start; minutes + place.interval_minutes <= range.end; minutes += place.interval_minutes) {
				const start = new Date(dayStart.getTime() + minutes * 60 * 1000);
				const end = new Date(start.getTime() + intervalMs);
				if (dayStart.toDateString() === now.toDateString() && end <= now) continue;
				const busy = taken.some((res) => start < res.end && end > res.start);
				if (!busy) {
					slots.push({ start, end, label: formatSlotLabel(start, end) });
				}
			}
		});

		if (!slots.length) {
			await ctx.reply('Свободных слотов нет.');
			return;
		}

		const keyboard = slotKeyboard(numeric, slots);
		await ctx.reply(`Свободные слоты на ${dayStart.toLocaleDateString()}:`, { attachments: [keyboard] });
	} catch (err) {
		console.error('handleBookingDaySelect error:', err);
		await ctx.reply('Не удалось получить расписание.');
	}
}

export async function handleBookingSlotSelect(ctx, placeId, timestamp) {
	const numeric = Number(placeId);
	const startMs = Number(timestamp);
	const userId = Number(ctx.user?.user_id);
	if (!Number.isInteger(numeric) || !Number.isInteger(startMs) || !Number.isInteger(userId)) return;

	const place = await getBookingPlaceById(numeric);
	if (!place) {
		await ctx.reply('Место не найдено.');
		return;
	}

	const start = new Date(startMs);
	const end = new Date(start.getTime() + place.interval_minutes * 60 * 1000);
	if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
		await ctx.reply('Некорректное время.');
		return;
	}
	if (start < new Date()) {
		await ctx.reply('Нельзя бронировать прошедшее время.');
		return;
	}

	const { start: dayStart, end: dayEnd } = dayBounds(start);
	const { start: weekStart, end: weekEnd } = weekBounds(start);

	try {
		const dayCount = await countUserReservations(numeric, userId, dayStart, dayEnd);
		if (dayCount >= place.per_day_limit) {
			await ctx.reply('Дневной лимит исчерпан.');
			return;
		}
		const weekCount = await countUserReservations(numeric, userId, weekStart, weekEnd);
		if (weekCount >= place.per_week_limit) {
			await ctx.reply('Недельный лимит исчерпан.');
			return;
		}

		await createBookingReservation({
			place_id: numeric,
			user_id: userId,
			start_time: start,
			end_time: end,
		});

		await ctx.reply(`Бронирование подтверждено: ${place.name}, ${formatSlotLabel(start, end)}.`);
		await handleBookingDaySelect(ctx, numeric, dayStart.toISOString().slice(0, 10));
	} catch (err) {
		if (err?.message === 'slot_taken') {
			await ctx.reply('Этот слот уже занят. Обновляем расписание...');
			await handleBookingDaySelect(ctx, numeric, dayStart.toISOString().slice(0, 10));
			return;
		}
		console.error('handleBookingSlotSelect error:', err);
		await ctx.reply('Не удалось создать бронирование.');
	}
}
