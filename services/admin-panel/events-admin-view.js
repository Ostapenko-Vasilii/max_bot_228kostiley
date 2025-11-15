import { Keyboard } from '@maxhub/max-bot-api';
import { getEventsByStatus, getEventsWithStatusNot, updateEventStatus, getEventById, getEventParticipants } from '../../db/events.js';
import { addEventMessage, getEventByMid } from '../../db/event-messages.js';
import { setAdminState, clearAdminState, getAdminState } from '../../db/statedb.js';
import { getUserRoles } from '../../db/roles.js';
import { notifyEventParticipants } from '../notifications.js';

export const eventButtons = [
    { label: '👥 участники', payload: { command: 'admin_panel_event_participants' } },
    { label: '📨 рассылка участникам', payload: { command: 'admin_panel_event_delete' } },
    { label: '✏️ изменить имя', payload: { command: 'admin_panel_event_edit_name' } },
    { label: '🗓️ изменить дату', payload: { command: 'admin_panel_event_edit_date' } },
    { label: '📍 изменить локацию', payload: { command: 'admin_panel_event_edit_location' } },
    { label: '📝 изменить пост', payload: { command: 'admin_panel_event_edit_message' } },
];

export const archiveEventButtons = [
    { label: '📥 в архив', payload: { command: 'admin_panel_event_to_archive' } }
];
export const unarchiveEventButtons = [
    { label: '📤 из архива', payload: { command: 'admin_panel_event_from_archive' } }
];

const BUTTONS_PER_ROW = 2;

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

function chunkButtons(buttons, size = BUTTONS_PER_ROW) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += size) {
    rows.push(buttons.slice(i, i + size));
  }
  return rows;
}

function createAdminEventKeyboard(eventStatus) {
  const numericStatus = Number(eventStatus) || 0;
  const controls = [...eventButtons, ...(numericStatus === 0 ? archiveEventButtons : unarchiveEventButtons)];
  const rows = chunkButtons(controls);
  return Keyboard.inlineKeyboard(rows.map(row =>
    row.map(btn => Keyboard.button.callback(btn.label, btn.payload.command))
  ));
}

function buildAdminEventText(event) {
  const statusLabel = Number(event.event_status) === 0 ? 'Активное' : 'В архиве';
  const lines = [`Название: ${event.event_name || '—'}`];
  if (event.event_date) lines.push(`Дата: ${event.event_date}`);
  if (event.event_location) lines.push(`Локация: ${event.event_location}`);
  lines.push(`Статус: ${statusLabel}`);
  if (event.event_text) {
    lines.push('');
    lines.push(event.event_text);
  }
  return lines.join('\n');
}

function buildAdminEventPayload(event) {
  const media = parseMediaAttachments(event.attachments);
  const keyboard = createAdminEventKeyboard(event.event_status);
  return {
    text: buildAdminEventText(event),
    attachments: [...media, keyboard]
  };
}

async function trackEventMessage(mid, eventId) {
  try {
    if (mid) await addEventMessage(mid, eventId);
  } catch (err) {
    console.error('Failed to store admin event message link:', err);
  }
}

async function sendAdminEvent(ctx, event) {
  const payload = buildAdminEventPayload(event);
  const sent = await ctx.reply(payload.text, { attachments: payload.attachments });
  const mid = sent?.body?.mid;
  await trackEventMessage(mid, event.event_id);
}

export async function refreshAdminEventMessage(ctx, messageId, event) {
  const payload = buildAdminEventPayload(event);
  await ctx.editMessage({
    message_id: messageId,
    text: payload.text,
    attachments: payload.attachments
  });
  await trackEventMessage(messageId, event.event_id);
}

async function resolveEventFromMessage(messageId) {
  const storedEventId = await getEventByMid(messageId);
  if (storedEventId == null) return null;
  return await getEventById(storedEventId);
}

export async function showAdminActiveEvents(ctx) {
  try {
    const events = await getEventsByStatus(0);
    if (!events.length) {
      await ctx.reply('Активных мероприятий нет.');
      return;
    }
    for (const event of events) {
      await sendAdminEvent(ctx, event);
    }
  } catch (err) {
    console.error('showAdminActiveEvents error:', err);
    await ctx.reply('Не удалось получить активные мероприятия.');
  }
}

export async function showAdminArchivedEvents(ctx) {
  try {
    const events = await getEventsWithStatusNot(0);
    if (!events.length) {
      await ctx.reply('Архивных мероприятий нет.');
      return;
    }
    for (const event of events) {
      await sendAdminEvent(ctx, event);
    }
  } catch (err) {
    console.error('showAdminArchivedEvents error:', err);
    await ctx.reply('Не удалось получить архивные мероприятия.');
  }
}

export async function moveEventToArchive(ctx, messageId) {
  try {
    if(!await checkPermissions(ctx)) {
        return;
    }
    const mid = messageId ? String(messageId).trim() : '';
    if (!mid) return;

    const event = await resolveEventFromMessage(mid);
    if (!event) {
      await ctx.reply('Мероприятие не найдено.');
      return;
    }

    await updateEventStatus(event.event_id, 1);
    const updated = await getEventById(event.event_id);
    if (!updated) {
      await ctx.reply('Не удалось обновить мероприятие.');
      return;
    }

    await refreshAdminEventMessage(ctx, mid, updated);
  } catch (err) {
    console.error('moveEventToArchive error:', err);
    await ctx.reply('Не удалось переместить мероприятие в архив.');
  }
}

export async function restoreEventFromArchive(ctx, messageId) {
  try {
    if(!await checkPermissions(ctx)) {
        return;
    }
    const mid = messageId ? String(messageId).trim() : '';
    if (!mid) return;

    const event = await resolveEventFromMessage(mid);
    if (!event) {
      await ctx.reply('Мероприятие не найдено.');
      return;
    }

    await updateEventStatus(event.event_id, 0);
    const updated = await getEventById(event.event_id);
    if (!updated) {
      await ctx.reply('Не удалось обновить мероприятие.');
      return;
    }

    await refreshAdminEventMessage(ctx, mid, updated);
  } catch (err) {
    console.error('restoreEventFromArchive error:', err);
    await ctx.reply('Не удалось вернуть мероприятие из архива.');
  }
}

export async function showEventParticipants(ctx) {
  try {
    const mid = ctx.message?.body?.mid ? String(ctx.message.body.mid).trim() : '';
    if (!mid) {
      await ctx.reply('Не удалось определить сообщение мероприятия.');
      return;
    }
    const event = await resolveEventFromMessage(mid);
    if (!event) {
      await ctx.reply('Мероприятие не найдено.');
      return;
    }

    const participants = await getEventParticipants(event.event_id);
    if (!participants || !participants.length) {
      await ctx.reply(`Нет зарегистрированных участников для "${event.event_name}".`);
      return;
    }

    // Форматируем список участников
    const lines = participants.map((p, idx) => {
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || `Пользователь ${p.user_id}`;
      const date = p.registration_date ? ` (${p.registration_date})` : '';
      const status = p.status ? ` [статус:${p.status}]` : '';
      return `${idx + 1}. ${name}${date}${status}`;
    });
    await ctx.reply(`Участники для "${event.event_name}":\n\n` + lines.join('\n'));
  } catch (err) {
    console.error('showEventParticipants error:', err);
    await ctx.reply('Не удалось получить список участников.');
  }
}

// helper: start edit flow for a specific field
export async function startEditEventField(ctx, field) {
  try {
    const mid = ctx.message?.body?.mid ? String(ctx.message.body.mid).trim() : '';
    if (!mid) {
      await ctx.reply('Не удалось определить сообщение мероприятия.');
      return;
    }
    const event = await resolveEventFromMessage(mid);
    if (!event) {
      await ctx.reply('Мероприятие не найдено.');
      return;
    }

    const allowedFields = {
      'admin_panel_event_edit_name': 'event_name',
      'admin_panel_event_edit_date': 'event_date',
      'admin_panel_event_edit_location': 'event_location',
      'admin_panel_event_edit_message': 'event_text'
    };
    const targetField = allowedFields[field];
    if (!targetField) {
      await ctx.reply('Поле для редактирования не распознано.');
      return;
    }

    const prettyMap = {
      event_name: 'название',
      event_date: 'дату',
      event_location: 'локацию',
      event_text: 'описание/пост'
    };
    const pretty = prettyMap[targetField] || targetField;

    // Устанавливаем состояние админа, чтобы следующий ввод текста был трактован как новое значение
    const userId = Number(ctx.user?.user_id);
    const keyboard = Keyboard.inlineKeyboard([
      [Keyboard.button.callback('❌ отмена', 'admin_panel_event_edit_cancel')]
    ]);

    const prompt = await ctx.reply(
      `Отправьте новое значение для ${pretty} мероприятия "${event.event_name}".`,
      { attachments: [keyboard] }
    );
    const promptMid = prompt?.body?.mid ?? prompt?.mid ?? null;

    await setAdminState(
      userId,
      'edit_event_field',
      JSON.stringify({
        event_id: event.event_id,
        field: targetField,
        message_id: mid,
        prompt_mid: promptMid
      })
    );
  } catch (err) {
    console.error('startEditEventField error:', err);
    await ctx.reply('Не удалось начать редактирование мероприятия.');
  }
}

async function startBroadcastToParticipants(ctx, event) {
  const userId = Number(ctx.user?.user_id);
  if (!Number.isInteger(userId)) return;

  const keyboard = Keyboard.inlineKeyboard([
    [Keyboard.button.callback('❌ отмена', 'admin_panel_event_edit_cancel')]
  ]);

  const prompt = await ctx.reply(
    `Отправьте сообщение для рассылки участникам "${event.event_name}".`,
    { attachments: [keyboard] }
  );
  const promptMid = prompt?.body?.mid ?? prompt?.mid ?? null;

  await setAdminState(
    userId,
    'broadcast_event_message',
    JSON.stringify({ event_id: event.event_id, prompt_mid: promptMid })
  );
}

export async function cancelEventEdit(ctx, bot) {
  try {
    if(!await checkPermissions(ctx)) {
        return;
    }
    const userId = Number(ctx.user?.user_id);
    if (!Number.isInteger(userId)) return;

    const state = await getAdminState(userId);
    let promptMid = null;
    if (state?.payload) {
      try {
        const parsed = JSON.parse(state.payload);
        promptMid = parsed?.prompt_mid ?? null;
      } catch { /* ignore parse errors */ }
    }

    await clearAdminState(userId);

    const currentMid = ctx.message?.body?.mid ? String(ctx.message.body.mid) : null;
    const targetMid = currentMid || (promptMid ? String(promptMid) : null);

    if (targetMid) {
      try {
        const editPayload = {
          message_id: targetMid,
          text: '❌ Действие отменено.',
          attachments: []
        };
        if (currentMid && typeof ctx.editMessage === 'function') {
          await ctx.editMessage(editPayload);
        } else if (bot?.api?.messages?.edit) {
          await bot.api.messages.edit(editPayload);
        }
      } catch (editErr) {
        console.error('cancelEventEdit edit error:', editErr);
      }
    }

    await ctx.reply('Действие отменено.');
  } catch (err) {
    console.error('cancelEventEdit error:', err);
    await ctx.reply('Не удалось отменить действие.');
  }
}

export async function handleAdminEventButton(ctx, command, bot) {
  try {
    if(!await checkPermissions(ctx)) {
        return;
    }
    const midRaw = ctx.message?.body?.mid;
    const mid = midRaw ? String(midRaw).trim() : '';
    if (!mid) {
      await ctx.reply('Не удалось определить сообщение мероприятия.');
      return;
    }
    const event = await resolveEventFromMessage(mid);
    if (!event) {
      await ctx.reply('Мероприятие не найдено.');
      return;
    }
    switch (command) {
      case 'admin_panel_event_participants':
        await showEventParticipants(ctx);
        return;
      case 'admin_panel_event_delete':
        await startBroadcastToParticipants(ctx, event);
        return;
      case 'admin_panel_event_edit_name':
      case 'admin_panel_event_edit_date':
      case 'admin_panel_event_edit_location':
      case 'admin_panel_event_edit_message':
        await startEditEventField(ctx, command);
        return;
      default:
        await ctx.reply('Действие не поддерживается.');
    }
  } catch (err) {
    console.error('handleAdminEventButton error:', err);
    await ctx.reply('Ошибка при обработке действия мероприятия.');
  }
}


async function checkPermissions(ctx) {
      const user_id = ctx.user.user_id;
      const roles = await getUserRoles(user_id);
      if (!Array.isArray(roles) || !roles.includes(3)) {
          await ctx.reply('У вас нет прав для создания мероприятия.');
          return false;
      }
      return true;
}