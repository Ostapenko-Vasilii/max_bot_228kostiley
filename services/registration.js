import { Keyboard } from '@maxhub/max-bot-api';
import { saveUser } from '../db/users.js';
import { addUserRoles } from '../db/roles.js';
import { startBot } from '../services/start.js';
import { addUserState } from '../db/states.js';
import { addUserSettings } from '../db/settings.js';



// Простое хранилище состояний пользователей

const registrationSteps = [
  'first_name',
  'last_name',
  'university_id',
  'dorm_id',
  'room',
  'policy_agreed'
];
const userSessions = {};

// Инициализация регистрации
export async function registerUser(bot, ctx) {
  const user_id = ctx.user.user_id;

  // создаём объект состояния
  userSessions[user_id] = {
    step: 0,
    data: {}
  };
  
  await askNextQuestion(ctx, user_id, bot);
  await addUserState(user_id, 'registering');
}

// Вопрос пользователю в зависимости от шага
async function askNextQuestion(ctx, user_id, bot) {
  try {
  const step = registrationSteps[userSessions[user_id].step];

  switch (step) {
    case 'first_name':
      await ctx.reply('Введите ваше имя:');
      break;
    case 'last_name':
      await ctx.reply('Введите вашу фамилию:');
      break;
    case 'university_id':
      await ctx.reply('Введите ID университета:');
      break;
    case 'dorm_id':
      await ctx.reply('Введите номер общежития:');
      break;
    case 'room':
      await ctx.reply('Введите номер комнаты:');
      break;
    case 'policy_agreed':
      const keyboard = Keyboard.inlineKeyboard([
        [
          Keyboard.button.callback('✅ Согласен', 'policy_yes'),
        ],
      ]);
      await ctx.reply('Вы согласны с политикой обработки данных?', {
        attachments: [keyboard],
      });
      break;
  }
} catch (error) {
  console.error('Error in askNextQuestion:', error);
  ctx.reply('Пожалуйста, попробуйте заново пройти регистрацию, пропишите /start');
}
}

// Обработка текстовых ответов
export async function handleUserResponse(ctx, bot) {
  const user_id = ctx.user.user_id;
  const session = userSessions[user_id];
  if (!session) return; // регистрация не начата

  const stepKey = registrationSteps[session.step];
  const text = ctx.message.body?.text?.trim();

  if (!text) {
    return ctx.reply('Введите текстовое значение.');
  }

  // сохраняем ответ
  session.data[stepKey] = text;

  // если есть следующий шаг — переходим
  if (session.step + 1 < registrationSteps.length) {
    if (validateInput(stepKey, text)) {
      session.step++;
    } else {
      ctx.reply('Некорректное значение, попробуйте еще раз.');
    }
    await askNextQuestion(ctx, user_id, bot);
  } else {
    if (session.step < 5) return;
    await finishRegistration(ctx, user_id);
  }
}

// Обработка кнопок для согласия с политикой
export async function handlePolicyResponse(bot, ctx) {
  const user_id = ctx.user.user_id;
  const session = userSessions[user_id];
  if (!session ) return;
  if (session.step < 5) return;
  session.data.policy_agreed = true;
  await finishRegistration(bot, ctx, user_id);
}

// Завершение регистрации
async function finishRegistration(bot, ctx, user_id) {
  if (!userSessions[user_id]) return;
  const data = userSessions[user_id].data;

  await saveUser(
    user_id,
    data.first_name,
    data.last_name,
    data.university_id,
    data.dorm_id,
    data.room,
    data.policy_agreed
  );

  await addUserRoles(user_id, 1);
  if (String(user_id) === process.env.ADMIN_USER_ID) {
    await addUserRoles(user_id, 3); // добавляем роль администратора
  }
  await addUserSettings(user_id, { allow_new_events_notifications: 1, allow_reminder_notifications: 1 });
  await ctx.reply(`✅ Регистрация завершена! Спасибо, ${data.first_name}.`);
  delete userSessions[user_id]; // очищаем состояние
  await addUserState(user_id, null);
  startBot(bot, ctx);
}


function validateInput(step, value) {
  switch (step) {
    case 'first_name':
    case 'last_name':
      return value.length >= 4 && value.length <= 20;

    case 'university_id':
      return /^\d+$/.test(value) && +value >= 1 && +value <= 10;

    case 'dorm_id':
      return /^\d+$/.test(value) && +value >= 1 && +value <= 20;

    case 'room':
      return /^\d+$/.test(value) && +value >= 1 && +value <= 600;

    default:
      return false;
  }
}

