import { isNewMessage } from '../utils/fuilter-by-timestep.js';
import { handlePolicyResponse } from '../services/registration.js';
import { userButtons, headmanButtons, adminButtons, responsibleButtons, supervisorButtons, foremanButtons } from '../services/menu.js';
import { showAdminPanel, adminPanelButtons } from '../services/admin-panel/admin-panel.js';
import { startBot } from '../services/start.js';
import { startCreateEvent } from '../services/admin-panel/create-event.js';


export async function setListeners(bot, startBotMs) {
    await setAdminPanelListener(bot, startBotMs);
    await setMenuListener(bot, startBotMs);
    await setShowMainMenuListener(bot, startBotMs);
    await setPolicyKeyboardListener(bot, startBotMs);
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
                    await startCreateEvent(ctx);
                    return;
                default:
                    await ctx.reply(`Вы нажали кнопку: ${button.label}`);
                    break;
            }
        });
    })
}