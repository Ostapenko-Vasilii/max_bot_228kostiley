import 'dotenv/config';
import { Bot } from '@maxhub/max-bot-api';
import { handleUserResponse } from './services/registration.js';
import { isNewMessage } from './utils/fuilter-by-timestep.js';
import { setListeners } from './utils/listeners.js';
import { startBot } from './services/start.js';
import { getUserState } from './db/states.js';
import { handleCreateEventResponse } from './services/admin-panel/create-event.js';
import { getAdminState, clearAdminState } from './db/statedb.js';
import { updateEventField, getEventById } from './db/events.js';
import { refreshAdminEventMessage } from './services/admin-panel/events-admin-view.js';
import { broadcastEventMessageToParticipants } from './services/notifications.js';

const startBotMs = Date.now();



const bot = new Bot(process.env.BOT_TOKEN);


bot.on('bot_started', async (ctx) => {
    const upTs = ctx.update?.timestamp;
    if (!isNewMessage(startBotMs, upTs)) return;
    await startBot(bot, ctx);
});

bot.command('start', async (ctx) => {
  const upTs = ctx.update?.timestamp;
  if (!isNewMessage(startBotMs, upTs)) return;
  await startBot(bot, ctx);
});

bot.on('message_created', async (ctx) => {
  const upTs = ctx.update?.timestamp;
  if (!isNewMessage(startBotMs, upTs)) return;
  try {
    const userId = Number(ctx.user?.user_id);
    if (!Number.isInteger(userId)) return;

    const adminState = await getAdminState(userId);
    if (adminState?.action === 'broadcast_event_message') {
      let payload = null;
      try {
        payload = adminState.payload ? JSON.parse(adminState.payload) : null;
      } catch {
        payload = null;
      }

      if (!payload || !payload.event_id) {
        await clearAdminState(userId);
        await ctx.reply('Не удалось определить мероприятие для рассылки.');
        return;
      }

      const body = ctx.message?.body ?? {};
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];

      if (!text && !attachments.length) {
        await ctx.reply('Сообщение должно содержать текст или вложения.');
        return;
      }

      try {
        const stats = await broadcastEventMessageToParticipants(bot, payload.event_id, { text, attachments });
        await clearAdminState(userId);
        if (payload.prompt_mid && bot.api?.messages?.edit) {
          try {
            await bot.api.messages.edit({
              message_id: String(payload.prompt_mid),
              text: '✅ Сообщение отправлено участникам.',
              attachments: []
            });
          } catch (editErr) {
            console.error('broadcast prompt cleanup error:', editErr);
          }
        }
        await ctx.reply(`Рассылка участникам выполнена: ${stats.sent}/${stats.total}.`);
      } catch (err) {
        console.error('broadcastEventMessageToParticipants error:', err);
        await ctx.reply('Не удалось отправить сообщение участникам.');
      }
      return;
    }

    if (adminState?.action === 'edit_event_field') {
      let payload = null;
      try {
        payload = adminState.payload ? JSON.parse(adminState.payload) : null;
      } catch {
        payload = null;
      }

      if (!payload || !payload.event_id || !payload.field) {
        await clearAdminState(userId);
        return;
      }

      const text = (typeof ctx.message?.body?.text === 'string') ? ctx.message.body.text.trim() : '';
      if (!text) {
        await ctx.reply('Введите текстовое значение.');
        return;
      }

      try {
        await updateEventField(payload.event_id, payload.field, text);
        await clearAdminState(userId);
        if (payload.prompt_mid && bot.api?.messages?.edit) {
          try {
            await bot.api.messages.edit({
              message_id: String(payload.prompt_mid),
              text: '✅ Значение сохранено.',
              attachments: []
            });
          } catch (editErr) {
            console.error('edit prompt cleanup error:', editErr);
          }
        }
        await ctx.reply('Значение успешно обновлено.');
        if (payload.message_id) {
          const updatedEvent = await getEventById(payload.event_id);
          if (updatedEvent) {
            await refreshAdminEventMessage(ctx, payload.message_id, updatedEvent);
          }
        }
      } catch (err) {
        console.error('Error applying event update:', err);
        await ctx.reply('Не удалось применить изменение.');
      }
      return;
    }

    const userState = await getUserState(userId);
    switch (userState) {
      case 'registering':
        await handleUserResponse(ctx, bot);
        break;
      case 'creating_event':
        await handleCreateEventResponse(ctx, bot);
        break;
      default:
        return;
    }
  } catch (error) {
    console.error('Error handling user response:', error);
  }
});

bot.start();
setListeners(bot, startBotMs);

