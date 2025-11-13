import { addUserState } from '../../db/states.js';
import { getUserRoles } from '../../db/roles.js';
import { createEvent, getLatestEventIdByCreator, findEventIdByDetails } from '../../db/events.js';
import { notifyUsersAboutNewEvent } from '../notifications.js';
const createEventSteps = [
  'event_name',
  'event_date_time',
  'event_location',
  'event_message',
];
const eventSessions = {};

export async function startCreateEvent(ctx, bot) {
    const user_id = ctx.user.user_id;
    const roles = await getUserRoles(user_id);
    if (!Array.isArray(roles) || !roles.includes(3)) {
        await ctx.reply('У вас нет прав для создания мероприятия.');
        return;
    }

    eventSessions[user_id] = {
        step: 0,
        data: {},
        bot: bot ?? ctx?.bot ?? null
    };
    await addUserState(user_id, 'creating_event');
    await askNextQuestion(ctx, user_id);
}

async function askNextQuestion(ctx, user_id) {
    const session = eventSessions[user_id];
    if (!session) return;

    const step = createEventSteps[session.step];
    switch (step) {
        case 'event_name':
            await ctx.reply('Введите название мероприятия:');
            break;
        case 'event_date_time':
            await ctx.reply('Введите дату и время мероприятия (YYYY-MM-DD HH:mm):');
            break;
        case 'event_location':
            await ctx.reply('Введите место проведения мероприятия:');
            break;
        case 'event_message':
            await ctx.reply('Перешлите пост мероприятия:');
            break;
    }
}

function isValidDateTime(dateStr) {
    if (typeof dateStr !== 'string') return false;
    const re = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    if (!re.test(dateStr)) return false;
    const [datePart, timePart] = dateStr.split(' ');
    const [y, m, d] = datePart.split('-').map(n => Number(n));
    const [hh, mm] = timePart.split(':').map(n => Number(n));
    if (![y,m,d,hh,mm].every(Number.isFinite)) return false;
    const dt = new Date(y, m - 1, d, hh, mm);
    // проверяем, что дата не была "нормализована" (например 2023-02-30 -> 2023-03-02)
    return dt.getFullYear() === y && dt.getMonth() === (m - 1) && dt.getDate() === d && dt.getHours() === hh && dt.getMinutes() === mm;
}

export async function handleCreateEventResponse(ctx, bot) {
    const user_id = ctx.user.user_id;
    const session = eventSessions[user_id];
    if (!session) return;
    if (bot && !session.bot) {
        session.bot = bot;
    }

    const step = createEventSteps[session.step];
    const body = ctx.message?.body || {};
    const hasTextField = Object.prototype.hasOwnProperty.call(body, 'text');
    const rawText = (typeof body.text === 'string' ? body.text : '');
    const text = rawText.trim();
    const attachments = Array.isArray(body.attachments) && body.attachments.length ? body.attachments : null;

    // Валидация для шага с датой
    if (step === 'event_date_time') {
        // если текстовое поле отсутствует или пустое — попросим ввести ещё раз
        if (!hasTextField || text.length === 0) {
            return ctx.reply('Введите дату и время в формате YYYY-MM-DD HH:mm.');
        }
        if (!isValidDateTime(text)) {
            return ctx.reply('Неверный формат даты/времени. Ожидается YYYY-MM-DD HH:mm, например: 2025-12-31 18:30');
        }
        session.data[step] = text;
    } else if (step === 'event_message') {
        // Для сообщения допускается либо текст, либо вложения
        // Если оба отсутствуют — просим снова
        if ((!hasTextField || text.length === 0) && !attachments) {
            return ctx.reply('Перешлите пост мероприятия (вложение) или введите текст сообщения мероприятия.');
        }
        // если текст вообще не передан (null/undefined) но есть attachments — сохраняем пустой текст
        session.data.event_message = text || '';
        if (attachments) session.data.attachments = attachments;
    } else {
        // остальные шаги требуют текстового ввода и поле text должно присутствовать
        if (!hasTextField || text.length === 0) {
            return ctx.reply('Введите текстовое значение.');
        }
        session.data[step] = text;
    }

    if (session.step + 1 < createEventSteps.length) {
        session.step++;
        await askNextQuestion(ctx, user_id);
    } else {
        await finishCreateEvent(ctx, user_id);
    }
}

// Завершение создания мероприятия
async function finishCreateEvent(ctx, user_id) {
    const session = eventSessions[user_id];
    if (!session) return;
    const botInstance = session.bot;
    const data = session.data;
    const name = (data.event_name || '').trim().slice(0, 255);
    const date = String(data.event_date_time || '').trim();
    const location = String(data.event_location || '').trim().slice(0,255);
    const message = String(data.event_message || '').trim();
    const attachments = data.attachments || null; 

    const result = await createEvent({
        name,
        date,
        location,
        attachments, 
        text: message,
        creatorId: user_id
    });
    await ctx.reply(`✅ Мероприятие "${data.event_name}" успешно создано!`);
    await ctx.reply('рассылаем уведомления пользователям...');
    try {
        let eventId = Number(result?.eventId ?? result?.lastID);
        if (!Number.isInteger(eventId) || eventId <= 0) {
            eventId = Number(await getLatestEventIdByCreator(user_id));
        }
        if (!Number.isInteger(eventId) || eventId <= 0) {
            eventId = Number(await findEventIdByDetails({
                name,
                date,
                location,
                text: message,
                creatorId: user_id
            }));
        }
        if (!Number.isInteger(eventId) || eventId <= 0) {
            console.warn('Unable to send notifications: missing eventId.');
        } else if (!botInstance) {
            console.warn('Unable to send notifications: missing bot instance.');
        } else {
            const stats = await notifyUsersAboutNewEvent(botInstance, eventId);
            await ctx.reply(`Уведомления отправлены ${stats.sent}/${stats.total}.`);
        }
    } catch (err) {
        console.error('Error notifying users about new event:', err);
    }
    delete eventSessions[user_id];
    await addUserState(user_id, null);
}
