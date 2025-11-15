import 'dotenv/config';
import { Bot } from '@maxhub/max-bot-api';
import { handleUserResponse } from './services/registration.js';
import { isNewMessage } from './utils/fuilter-by-timestep.js';
import { setListeners } from './utils/listeners.js';
import { startBot } from './services/start.js';
import { getUserState } from './db/states.js';
import { handleCreateEventResponse } from './services/admin-panel/create-event.js';
import { handleCreateReportResponse } from './services/create-report.js';
import { getAdminState, clearAdminState } from './db/statedb.js';
import { updateEventField, getEventById } from './db/events.js';
import { refreshAdminEventMessage } from './services/admin-panel/events-admin-view.js';
import { broadcastEventMessageToParticipants, broadcastMessageToAllUsers } from './services/notifications.js';
import { processAssignRoleUserIdInput } from './services/manage_panel/manage-panel.js';
import { processEditInfoInput } from './services/manage_panel/manage-panel.js';
import { handleSettingsUpdateResponse } from './services/settings.js';
import { handleDutyScheduleFloorInput, handleDutyScheduleMessage } from './services/duty.js';
import { handlePlaceWizardMessage } from './services/manage_panel/place-booking.js';

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
    const action = adminState?.action ?? null;

    switch (action) {
      case 'broadcast_all_message': {
        let payload = null;
        try {
          payload = adminState.payload ? JSON.parse(adminState.payload) : null;
        } catch {
          payload = null;
        }

        const body = ctx.message?.body ?? {};
        const rawText = typeof body.text === 'string' ? body.text : '';
        const trimmedText = rawText.trim();
        const attachments = Array.isArray(body.attachments) ? body.attachments.filter(Boolean) : [];

        if (!trimmedText && !attachments.length) {
          await ctx.reply('Сообщение не может быть пустым. Попробуйте снова или отмените действие.');
          return;
        }

        const promptMid = payload?.prompt_mid ? String(payload.prompt_mid) : null;

        try {
          const stats = await broadcastMessageToAllUsers(bot, { text: trimmedText, attachments });
          if (promptMid && bot.api?.messages?.edit) {
            try {
              await bot.api.messages.edit({
                message_id: promptMid,
                text: '✅ Рассылка завершена.',
                attachments: []
              });
            } catch (editErr) {
              console.error('broadcast_all prompt cleanup error:', editErr);
            }
          }
          await ctx.reply(`Рассылка отправлена: ${stats.sent}/${stats.total}.`);
        } catch (err) {
          console.error('broadcastMessageToAllUsers error:', err);
          await ctx.reply('Не удалось выполнить рассылку.');
        } finally {
          await clearAdminState(userId);
        }
        return;
      }
      case 'broadcast_event_message': {
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
      case 'edit_info_wait_message' : {
        try {
          await processEditInfoInput(ctx);
        } catch (err) {
          console.error('edit_info_wait_message error:', err);
          await ctx.reply('Не удалось сохранить информацию. Попробуйте снова.');
        }
        return;
      }
      case 'edit_event_field': {
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
      case 'assign_role_wait_user_id': {
        await processAssignRoleUserIdInput(ctx);
        return;
      }
      case 'assign_role_manage': {
        await ctx.reply('Используйте кнопки, чтобы дать или убрать роли, либо нажмите «Готово».');
        return;
      }
      case 'manage_place_wizard': {
        await handlePlaceWizardMessage(ctx);
        return;
      }
      default:
        break;
    }
    const userState = await getUserState(userId);
    switch (userState) {
      case 'registering':
        await handleUserResponse(ctx, bot);
        break;
      case 'creating_event':
        await handleCreateEventResponse(ctx, bot);
        break;
      case 'creating_report':
        await handleCreateReportResponse(ctx, bot);
        break;
      case 'settings_update_profile':
        await handleSettingsUpdateResponse(ctx);
        break;
      case 'duty_schedule_select_floor':
        await handleDutyScheduleFloorInput(ctx);
        break;
      case 'duty_schedule_wait_message':
        await handleDutyScheduleMessage(ctx);
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

