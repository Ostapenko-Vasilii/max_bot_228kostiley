import { getUserById } from '../db/users.js';
import { registerUser } from '../services/registration.js';
import { showMainMenu } from '../services/menu.js';

export async function startBot(bot, ctx) {
  try {
    const user = await getUserById(ctx.user?.user_id);
    if (user === null) {
      try {
        await ctx.reply("Привет! 👋 \nЯ — твой общажный помощник. Здесь ты можешь: \n \n✨ Смотреть ближайшие мероприятия в общаге \n📘 Узнавать полезную информацию о жизни в общежитии \n📅 Проверять свой график дежурств \n🏓 Бронировать места — например, стол для настолки или теннис \n📝 Оставлять жалобы и обращения \n🔔 Получать уведомления о новых событиях \n\nВсегда рядом, чтобы сделать жизнь в общаге проще и веселее! 🎉")
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