import { getDb } from '../db/init.js';
import { getEventById, getEventParticipants } from '../db/events.js';
import { showEventById } from './events.js';

function getUsersWithNewEventNotifications() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT u.user_id
    FROM users u
    LEFT JOIN users_settings s ON s.user_id = u.user_id
    WHERE COALESCE(s.allow_new_events_notifications, 1) = 1
  `);

  const users = [];
  while (stmt.step()) {
    const row = stmt.get();
    users.push(Number(row[0]));
  }
  if (typeof stmt.free === 'function') stmt.free();
  return users.filter(Number.isInteger);
}

function createUserContext(bot, userId) {
  return {
    user: { user_id: userId },
    async reply(text, options = {}) {
      const attachments = Array.isArray(options.attachments) ? options.attachments.filter(Boolean) : [];
      const stringText = typeof text === 'string' && text.length ? text : (attachments.length ? ' ' : '');
      const extra = attachments.length ? { attachments } : undefined;
      const message = await bot.api.sendMessageToUser(userId, stringText, extra);
      const mid = message?.mid ?? message?.message_id ?? message?.body?.mid ?? null;
      return mid ? { body: { mid } } : message;
    }
  };
}

export async function notifyUsersAboutNewEvent(bot, eventId) {
  const event = await getEventById(eventId);
  if (!event) {
    throw new Error('Event not found');
  }

  const users = getUsersWithNewEventNotifications();
  if (!users.length) {
    return { total: 0, sent: 0 };
  }

  const results = await Promise.all(users.map(async (userId) => {
    const ctx = createUserContext(bot, userId);
    try {
      await showEventById(ctx, eventId);
      return true;
    } catch (err) {
      console.error(`Failed to notify user ${userId}:`, err);
      return false;
    }
  }));

  const sent = results.filter(Boolean).length;
  return { total: users.length, sent };
}

export async function notifyEventParticipants(bot, eventId) {
  const event = await getEventById(eventId);
  if (!event) {
    throw new Error('Event not found');
  }

  const participants = await getEventParticipants(eventId);
  if (!Array.isArray(participants) || !participants.length) {
    return { total: 0, sent: 0 };
  }

  const uniqueIds = Array.from(
    new Set(
      participants
        .map((p) => Number(p.user_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );

  if (!uniqueIds.length) {
    return { total: 0, sent: 0 };
  }

  const results = await Promise.all(
    uniqueIds.map(async (userId) => {
      const ctx = createUserContext(bot, userId);
      try {
        await showEventById(ctx, eventId);
        return true;
      } catch (err) {
        console.error(`Failed to notify participant ${userId}:`, err);
        return false;
      }
    })
  );

  const sent = results.filter(Boolean).length;
  return { total: uniqueIds.length, sent };
}

export async function broadcastEventMessageToParticipants(bot, eventId, message = {}) {
  const event = await getEventById(eventId);
  if (!event) {
    throw new Error('Event not found');
  }

  const participants = await getEventParticipants(eventId);
  if (!Array.isArray(participants) || !participants.length) {
    return { total: 0, sent: 0 };
  }

  const uniqueIds = Array.from(
    new Set(
      participants
        .map((p) => Number(p.user_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );

  if (!uniqueIds.length) {
    return { total: 0, sent: 0 };
  }

  const rawText = typeof message.text === 'string' ? message.text : '';
  const trimmedText = rawText.trim();
  const attachments = Array.isArray(message.attachments) ? message.attachments.filter(Boolean) : [];

  if (!trimmedText && !attachments.length) {
    throw new Error('Message must contain text or attachments');
  }

  const safeText = trimmedText || (attachments.length ? ' ' : '');

  const results = await Promise.all(
    uniqueIds.map(async (userId) => {
      const ctx = createUserContext(bot, userId);
      try {
        await ctx.reply(safeText, { attachments });
        return true;
      } catch (err) {
        console.error(`Failed to notify participant ${userId}:`, err);
        return false;
      }
    })
  );

  const sent = results.filter(Boolean).length;
  return { total: uniqueIds.length, sent };
}

export async function broadcastMessageToAllUsers(bot, message = {}) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT u.user_id
    FROM users u
  `);

  const ids = [];
  while (stmt.step()) {
    const row = stmt.get();
    const userId = Number(row[0]);
    if (Number.isInteger(userId) && userId > 0) ids.push(userId);
  }
  if (typeof stmt.free === 'function') stmt.free();

  if (!ids.length) {
    return { total: 0, sent: 0 };
  }

  const rawText = typeof message.text === 'string' ? message.text : '';
  const trimmedText = rawText.trim();
  const rawAttachments = Array.isArray(message.attachments) ? message.attachments : [];
  const attachments = rawAttachments
    .filter((item) => item && typeof item === 'object' && typeof item.type === 'string')
    .map((item) => ({ ...item }));

  if (!trimmedText && !attachments.length) {
    throw new Error('Message must contain text or attachments');
  }

  const safeText = trimmedText || (attachments.length ? ' ' : '');

  const results = await Promise.all(
    ids.map(async (userId) => {
      const ctx = createUserContext(bot, userId);
      try {
        await ctx.reply(safeText, { attachments });
        return true;
      } catch (err) {
        console.error(`Failed to notify user ${userId}:`, err);
        return false;
      }
    })
  );

  const sent = results.filter(Boolean).length;
  return { total: ids.length, sent };
}
