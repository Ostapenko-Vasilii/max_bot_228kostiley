import { isNewMessage } from '../utils/fuilter-by-timestep.js';
import { handlePolicyResponse } from '../services/registration.js';
import { userButtons, headmanButtons, adminButtons, responsibleButtons, supervisorButtons, foremanButtons } from '../services/menu.js';
import { showAdminPanel, adminPanelButtons } from '../services/admin-panel/admin-panel.js';
import { startBot } from '../services/start.js';
import { startCreateEvent } from '../services/admin-panel/create-event.js';
import { startCreateReport, handleReportAction } from '../services/create-report.js';
import { showEvent, updateEvent, registerUserToEvent, unregisterUserFromEvent } from '../services/events.js';
import { showAdminActiveEvents, showAdminArchivedEvents, moveEventToArchive, restoreEventFromArchive, eventButtons as adminEventButtons, handleAdminEventButton, cancelEventEdit } from '../services/admin-panel/events-admin-view.js';
import { getAdminState, setAdminState, clearAdminState } from '../db/statedb.js';
import { Keyboard } from '@maxhub/max-bot-api';
import { updateEventField } from '../db/events.js';
import { refreshAdminEventMessage } from '../services/admin-panel/events-admin-view.js';
import { submitReport, adminShowReports, adminGetReport, adminDeleteReport } from '../services/reports.js';

export async function setListeners(bot, startBotMs) {
    await setAdminPanelListener(bot, startBotMs);
    await setMenuListener(bot, startBotMs);
    await setShowMainMenuListener(bot, startBotMs);
    await setPolicyKeyboardListener(bot, startBotMs);
    await setReportListeners(bot, startBotMs);
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
                case 'menu_open_view_reports':
                    await adminShowReports(ctx);
                    return;
                case 'menu_open_create_complaint':
                  // Start the multi-step report creation flow
                  await startCreateReport(ctx, bot);
                  return;
                case 'menu_open_admin_panel':
                    await showAdminPanel(ctx, bot);
                    return;
                case 'menu_open_view_complaints':
                    await adminShowReports(ctx);
                    return;
                default:
                    await ctx.reply(`Вы нажали кнопку: ${button.label}`);
                    break;
                  
            }
        });
    });
}

async function setReportListeners(bot, startBotMs) {
  // Register dynamic report action handlers (view/delete). Some SDKs accept RegExp in bot.action.
  try {
    // view report callbacks like: admin_report_view:123
    // bot.action('menu_open_create_complaint', async (ctx) => {
    //   const upTs = ctx.update?.timestamp;
    //   if (!isNewMessage(startBotMs, upTs)) return;
    //   const payload = ctx.update?.payload?.command || ctx.update?.callback_query?.data || '';
    //   const m = String(payload).match(/^admin_report_view:(\d+)$/);
    //   if (!m) return;
    //   const id = Number(m[1]);
    //   await adminGetReport(ctx, id);
    // });

    bot.action('menu_open_create_complaint', async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;
      // start report creation when user presses the button
      await startCreateReport(ctx, bot);
    });

    // delete report callbacks like: admin_report_delete:123
    bot.action(/^admin_report_delete:\d+$/, async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;
      const payload = ctx.update?.payload?.command || ctx.update?.callback_query?.data || ctx.update?.callback?.payload || '';
      const m = String(payload).match(/^admin_report_delete:(\d+)$/);
      if (!m) return;
      const id = Number(m[1]);
      await adminDeleteReport(ctx, id, bot); // pass bot so service can delete messages
    });

    // view report callbacks like: admin_report_view:123
    bot.action(/^admin_report_view:\d+$/, async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;

      // ack callback if possible
      try { if (typeof ctx.answerCallbackQuery === 'function') await ctx.answerCallbackQuery(); } catch(e){/*ignore*/}

      // normalize ctx.user similar to other handlers (some SDKs put user info under callback.user)
      if (!ctx.user || !ctx.user.user_id) {
        const uid = ctx.update?.callback?.user?.user_id
                  ?? ctx.update?.callback?.user?.id
                  ?? ctx.update?.callback_query?.from?.user_id
                  ?? ctx.update?.callback_query?.from?.id
                  ?? ctx.update?.payload?.user?.user_id
                  ?? ctx.update?.payload?.user?.id
                  ?? ctx.update?.user?.user_id
                  ?? ctx.update?.from?.id
                  ?? null;
        if (uid) ctx.user = { user_id: String(uid) };
      }

      // extract id robustly
      const payload = ctx.update?.payload?.command || ctx.update?.callback_query?.data || ctx.update?.callback?.payload || '';
      const m = String(payload).match(/^admin_report_view:(\d+)$/);
      if (!m) return;
      const id = Number(m[1]);
      await adminGetReport(ctx, id);
    });

    // new: back from single report view - just remove the report message for the user
    bot.action('report_back', async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;

      // ack callback to give UI feedback
      try { if (typeof ctx.answerCallbackQuery === 'function') await ctx.answerCallbackQuery(); } catch(e){/*ignore*/ }

      // try ctx.deleteMessage() first (most SDKs)
      try {
        if (typeof ctx.deleteMessage === 'function') {
          await ctx.deleteMessage();
          return;
        }
      } catch (delErr) {
        console.error('ctx.deleteMessage failed for report_back:', delErr);
      }

      // fallback: try to obtain mid and call bot.api.messages.delete
      const mid = ctx.message?.body?.mid ?? ctx.update?.callback_query?.message?.mid ?? ctx.update?.message?.body?.mid ?? null;
      if (mid && bot && bot.api && bot.api.messages && typeof bot.api.messages.delete === 'function') {
        try {
          await bot.api.messages.delete({ message_id: String(mid) });
          return;
        } catch (apiErr) {
          console.error('bot.api.messages.delete failed for report_back:', apiErr);
        }
      }

      // final fallback: try to edit message to indicate it's closed (best-effort)
      try {
        const editMid = mid;
        if (editMid && ctx.editMessage) {
          await ctx.editMessage({ message_id: editMid, text: 'Сообщение закрыто.', attachments: [] });
        }
      } catch (editErr) {
        console.error('fallback edit for report_back failed:', editErr);
      }
    });

    // quick action: show latest reports
    bot.action('reports_last', async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;
      await adminShowReports(ctx);
    });

    // handle report button callbacks (cancel/skip/anonim) - keep generic RegExp handler
    bot.action(/^report_.*$/, async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;

      // ensure ctx.user.user_id is present for handleReportAction
      if (!ctx.user || !ctx.user.user_id) {
        const uid = ctx.update?.callback?.user?.user_id
                  ?? ctx.update?.callback?.user?.id
                  ?? ctx.update?.callback_query?.from?.user_id
                  ?? ctx.update?.callback_query?.from?.id
                  ?? ctx.update?.payload?.user?.user_id
                  ?? ctx.update?.payload?.user?.id
                  ?? ctx.update?.user?.user_id
                  ?? ctx.update?.from?.id
                  ?? null;
        if (uid) ctx.user = { user_id: String(uid) };
      }

      // ack callback if possible
      try { if (typeof ctx.answerCallbackQuery === 'function') await ctx.answerCallbackQuery(); } catch(e){/*ignore*/}

      // normalize payload into ctx.update.payload so handler sees it reliably
      if (!ctx.update?.payload) {
        if (ctx.update?.callback && ctx.update.callback.payload) ctx.update.payload = ctx.update.callback.payload;
        else if (ctx.update?.callback_query && ctx.update.callback_query.data) ctx.update.payload = ctx.update.callback_query.data;
      }

      await handleReportAction(ctx, bot);
    });

    // Explicit handlers to ensure buttons are caught regardless of how SDK provides payload
    bot.action('report_cancel', async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;

      // normalize user
      if (!ctx.user || !ctx.user.user_id) {
        const uid = ctx.update?.callback?.user?.user_id ?? ctx.update?.callback?.user?.id ?? ctx.update?.callback_query?.from?.user_id ?? ctx.update?.callback_query?.from?.id ?? ctx.update?.payload?.user?.user_id ?? ctx.update?.payload?.user?.id ?? ctx.update?.user?.user_id ?? ctx.update?.from?.id ?? null;
        if (uid) ctx.user = { user_id: String(uid) };
      }

      try { if (typeof ctx.answerCallbackQuery === 'function') await ctx.answerCallbackQuery(); } catch(e){/*ignore*/}

      // normalize payload for explicit handler too
      if (!ctx.update?.payload) {
        if (ctx.update?.callback && ctx.update.callback.payload) ctx.update.payload = ctx.update.callback.payload;
        else if (ctx.update?.callback_query && ctx.update.callback_query.data) ctx.update.payload = ctx.update.callback_query.data;
      }

      await handleReportAction(ctx, bot);
    });

    bot.action('report_skip', async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;

      if (!ctx.user || !ctx.user.user_id) {
        const uid = ctx.update?.callback?.user?.user_id ?? ctx.update?.callback?.user?.id ?? ctx.update?.callback_query?.from?.user_id ?? ctx.update?.callback_query?.from?.id ?? ctx.update?.payload?.user?.user_id ?? ctx.update?.payload?.user?.id ?? ctx.update?.user?.user_id ?? ctx.update?.from?.id ?? null;
        if (uid) ctx.user = { user_id: String(uid) };
      }

      try { if (typeof ctx.answerCallbackQuery === 'function') await ctx.answerCallbackQuery(); } catch(e){/*ignore*/}

      // normalize payload
      if (!ctx.update?.payload) {
        if (ctx.update?.callback && ctx.update.callback.payload) ctx.update.payload = ctx.update.callback.payload;
        else if (ctx.update?.callback_query && ctx.update.callback_query.data) ctx.update.payload = ctx.update.callback_query.data;
      }

      await handleReportAction(ctx, bot);
    });

    bot.action('report_anonim:yes', async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;

      if (!ctx.user || !ctx.user.user_id) {
        const uid = ctx.update?.callback?.user?.user_id ?? ctx.update?.callback?.user?.id ?? ctx.update?.callback_query?.from?.user_id ?? ctx.update?.callback_query?.from?.id ?? ctx.update?.payload?.user?.user_id ?? ctx.update?.payload?.user?.id ?? ctx.update?.user?.user_id ?? ctx.update?.from?.id ?? null;
        if (uid) ctx.user = { user_id: String(uid) };
      }

      try { if (typeof ctx.answerCallbackQuery === 'function') await ctx.answerCallbackQuery(); } catch(e){/*ignore*/}

      // normalize payload
      if (!ctx.update?.payload) {
        if (ctx.update?.callback && ctx.update.callback.payload) ctx.update.payload = ctx.update.callback.payload;
        else if (ctx.update?.callback_query && ctx.update.callback_query.data) ctx.update.payload = ctx.update.callback_query.data;
      }

      await handleReportAction(ctx, bot);
    });

    bot.action('report_anonim:no', async (ctx) => {
      const upTs = ctx.update?.timestamp;
      if (!isNewMessage(startBotMs, upTs)) return;

      if (!ctx.user || !ctx.user.user_id) {
        const uid = ctx.update?.callback?.user?.user_id ?? ctx.update?.callback?.user?.id ?? ctx.update?.callback_query?.from?.user_id ?? ctx.update?.callback_query?.from?.id ?? ctx.update?.payload?.user?.user_id ?? ctx.update?.payload?.user?.id ?? ctx.update?.user?.user_id ?? ctx.update?.from?.id ?? null;
        if (uid) ctx.user = { user_id: String(uid) };
      }

      try { if (typeof ctx.answerCallbackQuery === 'function') await ctx.answerCallbackQuery(); } catch(e){/*ignore*/}

      // normalize payload
      if (!ctx.update?.payload) {
        if (ctx.update?.callback && ctx.update.callback.payload) ctx.update.payload = ctx.update.callback.payload;
        else if (ctx.update?.callback_query && ctx.update.callback_query.data) ctx.update.payload = ctx.update.callback_query.data;
      }

      await handleReportAction(ctx, bot);
    });

  } catch (err) {
    console.error('setReportListeners setup error', err);
  }
}

async function setShowMainMenuListener(bot, startBotMs) {
    bot.action('show_main_menu', async (ctx) => {
        const upTs = ctx.update?.timestamp;
        if (!isNewMessage(startBotMs, upTs)) return;

        // try to delete the current message (with report or list)
        try {
          if (typeof ctx.deleteMessage === 'function') {
            await ctx.deleteMessage();
          }
        } catch (delErr) {
          console.error('ctx.deleteMessage failed for show_main_menu:', delErr);
          // fallback: try bot.api.messages.delete
          const mid = ctx.message?.body?.mid ?? ctx.update?.callback_query?.message?.mid ?? ctx.update?.message?.body?.mid ?? null;
          if (mid && bot && bot.api && bot.api.messages && typeof bot.api.messages.delete === 'function') {
            try {
              await bot.api.messages.delete({ message_id: String(mid) });
            } catch (apiErr) {
              console.error('bot.api.messages.delete failed for show_main_menu:', apiErr);
            }
          }
        }

        // ack callback
        try { if (typeof ctx.answerCallbackQuery === 'function') await ctx.answerCallbackQuery(); } catch(e){/*ignore*/}

        // show main menu
        await startBot(bot, ctx);
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