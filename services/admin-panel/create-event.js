import { addUserState } from '../../db/states.js';
import { getUserRoles } from '../../db/roles.js';
import { createEvent } from '../../db/events.js';  
const createEventSteps = [
  'event_name',
  'event_date_time',
  'event_location',
  'event_message',
];
const eventSessions = {};

export async function startCreateEvent(ctx) {
    const user_id = ctx.user.user_id;
    const roles = await getUserRoles(user_id);
    if (!Array.isArray(roles) || !roles.includes(3)) {
        await ctx.reply('У вас нет прав для создания мероприятия.');
        return;
    }

    eventSessions[user_id] = {
        step: 0,
        data: {}
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
export async function handleCreateEventResponse(ctx) {
    const user_id = ctx.user.user_id;
    const session = eventSessions[user_id];
    if (!session) return;

    const step = createEventSteps[session.step];
    const text = ctx.message.body?.text?.trim();

    if (!text) {
        return ctx.reply('Введите текстовое значение.');
    }

    // сохраняем ответ
    session.data[step] = text;

    // если есть следующий шаг — переходим
    if (session.step + 1 < createEventSteps.length) {
        session.step++;
        ctx.
        await askNextQuestion(ctx, user_id);
    } else {
        await finishCreateEvent(ctx, user_id);
    }
}

// Завершение создания мероприятия
async function finishCreateEvent(ctx, user_id) {
    if (!eventSessions[user_id]) return;
    const data = eventSessions[user_id].data;
    const name = (data.event_name || '').trim().slice(0, 255);
    const date = String(data.event_date_time || '').trim();
    const location = String(data.event_location || '').trim();
    const message = String(data.event_message || '');

    createEvent({
        name,
        date,
        location,
        message
    });
    await ctx.reply(`✅ Мероприятие "${data.event_name}" успешно создано!`);
    delete eventSessions[user_id];
    await addUserState(user_id, null);
}
