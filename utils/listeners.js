import { isNewMessage } from '../utils/fuilter-by-timestep.js';
import { handlePolicyResponse } from '../services/registration.js';
import { userButtons, headmanButtons, adminButtons, responsibleButtons, supervisorButtons, foremanButtons } from '../services/menu.js';
import { showAdminPanel, adminPanelButtons } from '../services/admin-panel/admin-panel.js';
import { startBot } from '../services/start.js';
import { startCreateEvent } from '../services/admin-panel/create-event.js';
import { showEvent, updateEvent, registerUserToEvent, unregisterUserFromEvent } from '../services/events.js';
import { showAdminActiveEvents, showAdminArchivedEvents, moveEventToArchive, restoreEventFromArchive, eventButtons as adminEventButtons, handleAdminEventButton, cancelEventEdit } from '../services/admin-panel/events-admin-view.js';
import { getAdminState, clearAdminState } from '../db/statedb.js';
import { updateEventField } from '../db/events.js';
import { refreshAdminEventMessage } from '../services/admin-panel/events-admin-view.js';

export async function setListeners(bot, startBotMs) {
    await setAdminPanelListener(bot, startBotMs);
    await setMenuListener(bot, startBotMs);
    await setShowMainMenuListener(bot, startBotMs);
    await setPolicyKeyboardListener(bot, startBotMs);
    handleEventResponse(bot, startBotMs);
    handleAdminEventManagement(bot, startBotMs);
    handleAdminEventButtons(bot, startBotMs);
}


async function setPolicyKeyboardListener(bot, startBotMs) {
  bot.action('policy_yes', async (ctx) => {
    const upTs = ctx.update?.timestamp;
    if (!isNewMessage(startBotMs, upTs)) return;
    ctx.editMessage(
      {
        text: 'Вы согласились с политикой обработки данных.',
        attachments: []
      }
    );
    try {
      await handlePolicyResponse(bot, ctx);
      return;
    } catch (error) {
      ctx.reply(`Ошибка регистрации:( ${error.message}`);
      return;
    }
  });
}

async function setMenuListener(bot, startBotMs) {
    var buttons = userButtons.concat(headmanButtons, adminButtons, responsibleButtons, supervisorButtons, foremanButtons);
    buttons.forEach((button) => {
        bot.action(button.payload.command, async (ctx) => {
            const upTs = ctx.update?.timestamp;
            if (!isNewMessage(startBotMs, upTs)) return;
            switch (button.payload.command) {
                case 'menu_open_events':
                    await showEvent(ctx, 0, bot);
                    return;
                case 'menu_open_admin_panel':
                    await showAdminPanel(ctx, bot);
                    return;
                default:
                    await ctx.reply(`Вы нажали кнопку: ${button.label}`);
                    break;
            }
        });
    });
}

async function setShowMainMenuListener(bot, startBotMs) {
    bot.action('show_main_menu', async (ctx) => {
        const upTs = ctx.update?.timestamp;
        if (!isNewMessage(startBotMs, upTs)) return;
        startBot(bot, ctx);
    });
}

async function setAdminPanelListener(bot, startBotMs) {
  adminPanelButtons.forEach((button) => {
        bot.action(button.payload.command, async (ctx) => {
            const upTs = ctx.update?.timestamp;
            if (!isNewMessage(startBotMs, upTs)) return;
            switch (button.payload.command) {
                case 'admin_panel_create_event':
                    await startCreateEvent(ctx, bot);
                    return;
                case 'admin_panel_show_events_active':
                    await showAdminActiveEvents(ctx);
                    return;
                case 'admin_panel_show_events_archived':
                    await showAdminArchivedEvents(ctx);
                    return;
                default:
                    await ctx.reply(`Вы нажали кнопку: ${button.label}`);
                    break;
            }
        });
    })
}

async function handleEventResponse(bot, startBotMs) {
  bot.action("event_next", async (ctx) => {
    const upTs = ctx.update?.timestamp;
    if (!isNewMessage(startBotMs, upTs)) return;
    const mid = ctx.message?.body?.mid;
    await updateEvent(ctx, mid, 1);
  });

  bot.action("event_prev", async (ctx) => {
    const upTs = ctx.update?.timestamp;
    if (!isNewMessage(startBotMs, upTs)) return;
    const mid = ctx.message?.body?.mid;
    await updateEvent(ctx, mid, -1);
  });

  bot.action("event_register", async (ctx) => {
    const upTs = ctx.update?.timestamp;
    if (!isNewMessage(startBotMs, upTs)) return;
    const mid = ctx.message?.body?.mid;
    await registerUserToEvent(ctx, mid);
  });

  bot.action("event_unregister", async (ctx) => {
    const upTs = ctx.update?.timestamp;
    if (!isNewMessage(startBotMs, upTs)) return;
    const mid = ctx.message?.body?.mid;
    await unregisterUserFromEvent(ctx, mid);
    await updateEvent(ctx, mid, 0);
  });
}

function handleAdminEventManagement(bot, startBotMs) {
  bot.action('admin_panel_event_to_archive', async (ctx) => {
    const upTs = ctx.update?.timestamp;
    if (!isNewMessage(startBotMs, upTs)) return;
    const mid = ctx.message?.body?.mid;
    await moveEventToArchive(ctx, mid);
  });

  bot.action('admin_panel_event_from_archive', async (ctx) => {
    const upTs = ctx.update?.timestamp;
    if (!isNewMessage(startBotMs, upTs)) return;
    const mid = ctx.message?.body?.mid;
    await restoreEventFromArchive(ctx, mid);
  });

  bot.action('admin_panel_event_edit_cancel', async (ctx) => {
    const upTs = ctx.update?.timestamp;
    if (!isNewMessage(startBotMs, upTs)) return;
    await cancelEventEdit(ctx, bot);
  });
}

function handleAdminEventButtons(bot, startBotMs) {
  adminEventButtons.forEach((button) => {
    bot.action(button.payload.command, async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;
      await handleAdminEventButton(ctx, button.payload.command, bot);
    });
  });
}