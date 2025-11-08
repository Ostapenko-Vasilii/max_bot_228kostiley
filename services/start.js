import { getUserById } from '../db/users.js';
import { registerUser } from '../services/registration.js';
import { showMainMenu } from '../services/menu.js';

export async function startBot(bot, ctx) {
  try {
    await ctx.reply('bot_started');
    const user = await getUserById(ctx.user?.user_id);
    if (user === null) {
      try {
        await registerUser(bot, ctx);
      } catch (error) {
        console.error('Error during user registration:', error);
      }
    } else {
      await showMainMenu(ctx, bot);
    }
  } catch (error) {
    console.error('Error in bot_started handler:', error);
  }
}