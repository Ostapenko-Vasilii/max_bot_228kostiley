import 'dotenv/config';
import { Bot } from '@maxhub/max-bot-api';
import { handleUserResponse } from './services/registration.js';
import { isNewMessage } from './utils/fuilter-by-timestep.js';
import { setListeners } from './utils/listeners.js';
import { startBot } from './services/start.js';
import { getUserState } from './db/states.js';
import { handleCreateEventResponse } from './services/admin-panel/create-event.js';


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
    const userState = await getUserState(ctx.user?.user_id);
    switch (userState) {
      case 'registering':
        await handleUserResponse(ctx, bot);
        break;
      case 'creating_event':
        await handleCreateEventResponse(ctx);
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

