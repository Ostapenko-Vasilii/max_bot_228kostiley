import { getEventById, getEventIdsWithStatusZero, removeEventRegistration, addEventRegistration, isUserRegisteredForEvent } from '../db/events.js';
import { Keyboard } from '@maxhub/max-bot-api';
import { addEventMessage, getEventByMid } from '../db/event-messages.js';

export const nextButton = [
    { label: '➡️', payload: { command: 'event_next' } },
];
export const prevButton = [
    { label: '⬅️', payload: { command: 'event_prev' } },
];
export const registrationButton = [
    { label: '✅ записаться', payload: { command: 'event_register' } },
];
export const unregisterButton = [
    { label: '❌ отписаться', payload: { command: 'event_unregister' } },
];

function clampIndex(index, length) {
    if (!length) return 0;
    const numeric = Number(index);
    if (!Number.isInteger(numeric)) return 0;
    return Math.min(Math.max(numeric, 0), length - 1);
}

async function getActiveEventsList() {
    const ids = await getEventIdsWithStatusZero();
    return Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [];
}

async function fetchEventByIndex(activeEvents, idx) {
    const eventId = activeEvents[idx];
    if (eventId == null) return { event: null, eventId: null };
    const event = await getEventById(eventId);
    return { event, eventId };
}

async function fetchRegistrationStatus(eventId, userId) {
    const eid = Number(eventId);
    const uid = Number(userId);
    if (!Number.isInteger(eid) || !Number.isInteger(uid)) return false;
    try {
        return await isUserRegisteredForEvent(eid, uid);
    } catch {
        return false;
    }
}

function parseMediaAttachments(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch { parsed = []; }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.reduce((acc, item) => {
        if (!item || typeof item !== 'object') return acc;
        if (item.type === 'image') {
            acc.push(item);
        } else if (item.type === 'video') {
            const token = item.payload?.token;
            if (token) acc.push({ type: 'video', payload: { token } });
        }
        return acc;
    }, []);
}

function createNavigationKeyboard(idx, total, isRegistered) {
    const buttons = [];
    if (idx > 0) buttons.push(...prevButton);

    if (isRegistered) {
        buttons.push(...unregisterButton);
    } else {
        buttons.push(...registrationButton);
    }
    if (idx < total - 1) buttons.push(...nextButton);
    const sdkButtons = buttons.map(btn => Keyboard.button.callback(btn.label, btn.payload?.command ?? ''));
    return Keyboard.inlineKeyboard([sdkButtons]);
}

function buildEventPayload(event, idx, activeEvents, isRegistered ) {
    const media = parseMediaAttachments(event.attachments);
    const keyboard = createNavigationKeyboard(idx, activeEvents.length, isRegistered);
    return {
        text: event.event_text || '',
        attachments: keyboard ? [...media, keyboard] : media
    };
}

export async function showEvent(ctx, index = 0) {
    try {
        const activeEvents = await getActiveEventsList();
        if (!activeEvents.length) {
            await ctx.reply('Мероприятий нет 😧, скорее всего их скоро добавят');
            return;
        }

        const idx = clampIndex(index, activeEvents.length);
        const { event } = await fetchEventByIndex(activeEvents, idx);
        if (!event) {
            await ctx.reply('Не удалось найти событие.');
            return;
        }
        const userId = ctx.user?.user_id;
        const isRegistered = await fetchRegistrationStatus(event.event_id, userId);

        const payload = buildEventPayload(event, idx, activeEvents, isRegistered);
        const sent = await ctx.reply(payload.text, { attachments: payload.attachments });
        if (sent?.body?.mid) {
            await addEventMessage(sent.body.mid, event.event_id);
        }
    } catch (err) {
        console.error('showEvent error:', err);
        await ctx.reply('Ошибка при получении мероприятия.');
    }
}

export async function updateEvent(ctx, mid, state, currentEventId) {
    try {
        const activeEvents = await getActiveEventsList();
        if (!activeEvents.length) {
            await ctx.reply('Мероприятий нет 😧, скорее всего их скоро добавят');
            return;
        }

        const messageId = mid ? String(mid).trim() : '';
        if (!messageId) return;

        const storedEventIdRaw = currentEventId ?? await getEventByMid(messageId);
        const storedEventId = Number(storedEventIdRaw);
        let currentIndex = Number.isInteger(storedEventId) ? activeEvents.indexOf(storedEventId) : -1;
        if (currentIndex < 0) currentIndex = 0;

        let targetIndex = currentIndex;
        if (state === -1) {
            targetIndex = clampIndex(currentIndex - 1, activeEvents.length);
        } else if (state === 1) {
            targetIndex = clampIndex(currentIndex + 1, activeEvents.length);
        }

        const { event } = await fetchEventByIndex(activeEvents, targetIndex);
        if (!event) {
            await ctx.reply('Не удалось найти событие.');
            return;
        }

        const userId = ctx.user?.user_id;
        const isRegistered = await fetchRegistrationStatus(event.event_id, userId);
        const payload = buildEventPayload(event, targetIndex, activeEvents, isRegistered);

        await ctx.editMessage({
            message_id: messageId,
            text: payload.text,
            attachments: payload.attachments
        });

        await addEventMessage(messageId, event.event_id);
    } catch (err) {
        console.error('updateEvent error:', err);
        await ctx.reply('Ошибка при обновлении мероприятия.');
    }
}


export async function registerUserToEvent(ctx, mid) {
    try {
        const messageId = mid ? String(mid).trim() : '';
        const numericUserId = Number(ctx.user?.user_id);
        if (!messageId || !Number.isInteger(numericUserId)) return;

        const storedEventId = await getEventByMid(messageId);
        const eventId = Number(storedEventId);
        if (!Number.isInteger(eventId)) {
            await ctx.reply('Это мероприятие больше недоступно 😢');
            await updateEvent(ctx, messageId, 0);
            return;
        }

        const result = await addEventRegistration(eventId, numericUserId);
        if (result?.existed) {
            await ctx.reply('Вы уже записаны на это мероприятие.');
        } 

        await updateEvent(ctx, messageId, 0, eventId);
    } catch (err) {
        console.error('Error in registerUserToEvent:', err);
        await ctx.reply('Ошибка при регистрации на мероприятие.');
    }
}

export async function unregisterUserFromEvent(ctx, mid) {
    try {
        const messageId = mid ? String(mid).trim() : '';
        const numericUserId = Number(ctx.user?.user_id);
        if (!messageId || !Number.isInteger(numericUserId)) return;

        const storedEventId = await getEventByMid(messageId);
        const eventId = Number(storedEventId);
        if (!Number.isInteger(eventId)) {
            await ctx.reply('Это мероприятие больше недоступно 😢');
            await updateEvent(ctx, messageId, 0);
            return;
        }

        const result = await removeEventRegistration(eventId, numericUserId);
        let cancelled = false;

        if (typeof result === 'boolean') {
            cancelled = result;
        } else if (typeof result === 'number') {
            cancelled = result > 0;
        } else if (result && typeof result === 'object') {
            if ('removed' in result) {
                cancelled = Boolean(result.removed);
            } else if ('affectedRows' in result) {
                cancelled = Number(result.affectedRows) > 0;
            } else if ('changes' in result) {
                cancelled = Number(result.changes) > 0;
            }
        }

        await updateEvent(ctx, messageId, 0, eventId);
    } catch (err) {
        console.error('Error in unregisterUserFromEvent:', err);
        await ctx.reply('Ошибка при отмене регистрации на мероприятие.');
    }
}

export async function showEventById(ctx, eventId) {
    try {
        const numericId = Number(eventId);
        if (!Number.isInteger(numericId)) {
            await ctx.reply('Не удалось найти событие.');
            return;
        }

        const activeEvents = await getActiveEventsList();
        const idx = activeEvents.indexOf(numericId);
        if (idx >= 0) {
            await showEvent(ctx, idx);
            return;
        }

        const event = await getEventById(numericId);
        if (!event) {
            await ctx.reply('Не удалось найти событие.');
            return;
        }

        const userId = ctx.user?.user_id;
        const isRegistered = await fetchRegistrationStatus(event.event_id, userId);
        const payload = buildEventPayload(event, 0, [event.event_id], isRegistered);
        const sent = await ctx.reply(payload.text, { attachments: payload.attachments });
        if (sent?.body?.mid) {
            await addEventMessage(sent.body.mid, event.event_id);
        }
    } catch (err) {
        console.error('showEventById error:', err);
        await ctx.reply('Ошибка при получении мероприятия.');
    }
}

