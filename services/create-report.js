import { Keyboard } from '@maxhub/max-bot-api';
import { addUserState } from '../db/states.js';
import { createReport, setReportMessageIds } from '../db/reports.js'; // added setReportMessageIds
import { notifyResponsibleAboutReportId } from './report_notifications.js'; // <- new import

const createReportSteps = [
  'report_text',
  'report_attachments',
  'report_intruder',
  'report_room',
  'report_anonim'
];

const reportSessions = {};

export async function startCreateReport(ctx, bot) {
  const user_id = ctx.user?.user_id;
  if (!user_id) return ctx.reply('Невозможно определить пользователя.');

  reportSessions[user_id] = {
    step: 0,
    data: {},
    bot: bot ?? ctx?.bot ?? null
  };

  await addUserState(user_id, 'creating_report');
  await askNextQuestion(ctx, user_id);
}

async function askNextQuestion(ctx, user_id) {
  const session = reportSessions[user_id];
  if (!session) return;
  const step = createReportSteps[session.step];

  // helper to send reply with keyboard and store prompt mid in session
  const sendWithKeyboard = async (text, buttonsMatrix) => {
    const keyboard = Keyboard.inlineKeyboard(buttonsMatrix);
    const sent = await ctx.reply(text, { attachments: [keyboard] });
    // store prompt mid and chat id for later deletion (best-effort)
    const mid = sent?.body?.mid ?? sent?.mid ?? sent?.message_id ?? null;
    const chat = sent?.body?.recipient?.chat_id ?? sent?.recipient?.chat_id ?? null;
    if (mid) session.prompt_mid = String(mid);
    if (chat) session.prompt_chat_id = String(chat);
  };

  switch (step) {
    case 'report_text':
      // text required — offer Cancel
      await sendWithKeyboard('Опишите ситуацию. Расскажите коротко что произошло:', [
        [ Keyboard.button.callback('Отмена', 'report_cancel') ]
      ]);
      break;
    case 'report_attachments':
      // attachments required — offer Skip and Cancel
      await sendWithKeyboard('Прикрепите фотографию(и). Отправьте изображение(я) в сообщении (или пропустите):', [
        [ Keyboard.button.callback('Пропустить', 'report_skip'), Keyboard.button.callback('Отмена', 'report_cancel') ]
      ]);
      break;
    case 'report_intruder':
      // optional — offer Skip and Cancel
      await sendWithKeyboard('Укажите имя/описание злоумышленника (можно пропустить):', [
        [ Keyboard.button.callback('Пропустить', 'report_skip'), Keyboard.button.callback('Отмена', 'report_cancel') ]
      ]);
      break;
    case 'report_room':
      // optional — offer Skip and Cancel
      await sendWithKeyboard('Укажите комнату/место (можно пропустить):', [
        [ Keyboard.button.callback('Пропустить', 'report_skip'), Keyboard.button.callback('Отмена', 'report_cancel') ]
      ]);
      break;
    case 'report_anonim':
      // yes/no plus cancel
      await sendWithKeyboard('Вы хотите отправить отчёт анонимно? Выберите вариант:', [
        [ Keyboard.button.callback('Да', 'report_anonim:yes'), Keyboard.button.callback('Нет', 'report_anonim:no') ],
        [ Keyboard.button.callback('Отмена', 'report_cancel') ]
      ]);
      break;
  }
}

function attachmentsHasImage(attachments) {
  if (!Array.isArray(attachments)) return false;
  // accept items with type 'image' or 'photo' or items that contain payload.token (SDK may provide token)
  return attachments.some(a => {
    if (!a || typeof a !== 'object') return false;
    const t = (a.type && String(a.type).toLowerCase()) || '';
    if (t === 'image' || t === 'photo') return true;
    // some SDKs provide payload.token without explicit 'image' type
    if (a.payload && (a.payload.token || a.payload.url)) return true;
    // fallback: presence of url field
    if (a.url) return true;
    return false;
  });
}

// New helper: try API delete with multiple parameter shapes
async function tryApiDelete(botInstance, messageId, chatId, userId) {
  if (!botInstance || !botInstance.api || !botInstance.api.messages || typeof botInstance.api.messages.delete !== 'function') return false;
  const attempts = [
    { message_id: String(messageId) },
    chatId ? { message_id: String(messageId), chat_id: String(chatId) } : null,
    userId ? { message_id: String(messageId), user_id: String(userId) } : null,
    chatId ? { message_id: String(messageId), peer_id: String(chatId) } : null
  ].filter(Boolean);
  for (const params of attempts) {
    try {
      await botInstance.api.messages.delete(params);
      return true;
    } catch (err) {
      // try next
      console.debug('tryApiDelete attempt failed with params', params, err?.message || err);
    }
  }
  return false;
}

// New helper: try delete stored user's reply or current ctx message (best-effort)
async function tryDeleteAnyUserReply(session, ctx) {
  if (!session || !ctx) return;
  const botInstance = session.bot ?? ctx?.bot ?? null;

  // 1) if current ctx has a message, try to delete it directly (preferred)
  const currentMid = ctx.message?.body?.mid ?? ctx.message?.mid ?? ctx.message?.message_id ?? null;
  if (currentMid) {
    try {
      if (typeof ctx.deleteMessage === 'function') {
        await ctx.deleteMessage();
        // clear stored last_user_mid if it matches current
        if (session.last_user_mid && String(session.last_user_mid) === String(currentMid)) session.last_user_mid = null;
        return;
      }
    } catch (e) {
      console.debug('ctx.deleteMessage failed in tryDeleteAnyUserReply (current):', e?.message || e);
    }
  }

  // 2) try edit current message (some SDKs allow editing other's messages)
  try {
    if (currentMid && typeof ctx.editMessage === 'function') {
      await ctx.editMessage({ message_id: String(currentMid), text: '', attachments: [] }).catch(()=>{});
      if (session.last_user_mid && String(session.last_user_mid) === String(currentMid)) session.last_user_mid = null;
      return;
    }
  } catch (e) {
    console.debug('ctx.editMessage failed in tryDeleteAnyUserReply (current):', e?.message || e);
  }

  // 3) if no current ctx message deleted, try stored last_user_mid from session
  const storedMid = session.last_user_mid ?? null;
  if (!storedMid) return;

  const chatId = ctx.message?.body?.recipient?.chat_id ?? ctx.message?.recipient?.chat_id ?? session.prompt_chat_id ?? ctx.update?.callback?.user?.user_id ?? ctx.update?.callback_query?.from?.user_id ?? null;
  const userId = session.user_id ?? ctx.user?.user_id ?? null;

  try {
    const ok = await tryApiDelete(botInstance, storedMid, chatId, userId);
    // clear stored regardless to avoid repeated attempts
    session.last_user_mid = null;
    return ok;
  } catch (err) {
    console.error('tryDeleteAnyUserReply tryApiDelete error:', err);
    session.last_user_mid = null;
  }
}

// New helper: try delete user's reply message (best-effort)
async function tryDeleteUserReply(session, ctx) {
  if (!session || !ctx) return;
  const botInstance = session.bot ?? ctx?.bot ?? null;
  const mid = ctx.message?.body?.mid ?? ctx.message?.mid ?? ctx.message?.message_id ?? null;
  const chatId = ctx.message?.body?.recipient?.chat_id ?? ctx.message?.recipient?.chat_id ?? ctx.update?.callback?.user?.user_id ?? ctx.update?.callback_query?.from?.user_id ?? null;
  const userId = ctx.user?.user_id ?? null;
  if (!mid) return;
  // 1) try ctx.deleteMessage()
  try {
    if (typeof ctx.deleteMessage === 'function') {
      await ctx.deleteMessage();
      return;
    }
  } catch (e) {
    console.debug('ctx.deleteMessage failed in tryDeleteUserReply:', e?.message || e);
  }
  // 2) try ctx.editMessage to blank (some SDKs allow editing incoming message)
  try {
    if (typeof ctx.editMessage === 'function') {
      await ctx.editMessage({ message_id: String(mid), text: '', attachments: [] }).catch(()=>{});
    }
  } catch (e) {
    console.debug('ctx.editMessage failed in tryDeleteUserReply:', e?.message || e);
  }
  // 3) try API delete with various params
  try {
    const ok = await tryApiDelete(botInstance, mid, chatId, userId);
    if (ok) return;
  } catch (err) {
    console.error('tryDeleteUserReply tryApiDelete error:', err);
  }
}

// New helper: try delete stored prompt message (best-effort)
async function tryDeletePrompt(session, ctx) {
  if (!session) return;
  const mid = session.prompt_mid ?? null;
  if (!mid) return;
  const botInstance = session.bot ?? ctx?.bot ?? null;
  const chatId = session.prompt_chat_id ?? ctx.message?.body?.recipient?.chat_id ?? ctx.message?.recipient?.chat_id ?? ctx.update?.callback?.user?.user_id ?? ctx.update?.callback_query?.from?.user_id ?? null;
  const userId = ctx.user?.user_id ?? null;

  // 1) try edit to remove keyboard/text
  try {
    if (typeof ctx.editMessage === 'function') {
      await ctx.editMessage({ message_id: String(mid), text: '', attachments: [] }).catch(()=>{});
    }
  } catch (e) {
    console.debug('ctx.editMessage failed in tryDeletePrompt:', e?.message || e);
  }

  // 2) try API delete with various params
  try {
    const ok = await tryApiDelete(botInstance, mid, chatId, userId);
    if (ok) {
      session.prompt_mid = null;
      session.prompt_chat_id = null;
      return;
    }
  } catch (err) {
    console.error('tryDeletePrompt tryApiDelete error:', err);
  }

  // final: clear stored ids to avoid retry loops
  session.prompt_mid = null;
  session.prompt_chat_id = null;
}

export async function handleCreateReportResponse(ctx, bot) {
  const user_id = ctx.user?.user_id;
  const session = reportSessions[user_id];
  if (!session) return;
  if (bot && !session.bot) session.bot = bot;

  const step = createReportSteps[session.step];
  const body = ctx.message?.body || {};
  const hasTextField = Object.prototype.hasOwnProperty.call(body, 'text');
  const rawText = (typeof body.text === 'string' ? body.text : '');
  const text = rawText.trim();
  const attachments = Array.isArray(body.attachments) && body.attachments.length ? body.attachments : null;

  // capture mid of user's message for later deletion attempts
  const userMessageMid = ctx.message?.body?.mid ?? ctx.message?.mid ?? ctx.message?.message_id ?? null;
  if (userMessageMid) session.last_user_mid = String(userMessageMid);

  if (step === 'report_text') {
    if (!hasTextField || text.length === 0) return ctx.reply('Опишите ситуацию, текст обязателен.');
    session.data.text = text;
    // delete user's reply first (best-effort), then delete the prompt
    await tryDeleteAnyUserReply(session, ctx);
    await tryDeletePrompt(session, ctx);
    // ensure last_user_mid cleared
    session.last_user_mid = null;
  } else if (step === 'report_attachments') {
    // if attachments were optional via skip, ensure skip flow handles null; here require image if not skipped
    if (!attachments || !attachmentsHasImage(attachments)) {
      return ctx.reply('Нужна как минимум 1 фотография. Пожалуйста, прикрепите фото или нажмите "Пропустить".');
    }
    session.data.attachments = attachments;
    await tryDeleteAnyUserReply(session, ctx);
    await tryDeletePrompt(session, ctx);
    session.last_user_mid = null;
  } else if (step === 'report_intruder') {
    // optional
    session.data.intruder = text || null;
    await tryDeleteAnyUserReply(session, ctx);
    await tryDeletePrompt(session, ctx);
    session.last_user_mid = null;
  } else if (step === 'report_room') {
    session.data.intruder_room = text || null;
    await tryDeleteAnyUserReply(session, ctx);
    await tryDeletePrompt(session, ctx);
    session.last_user_mid = null;
  } else if (step === 'report_anonim') {
    if (!hasTextField || text.length === 0) return ctx.reply('Введите "да" или "нет".');
    const t = text.toLowerCase();
    session.data.anonim = (t === 'да' || t === 'yes' || t === 'y' || t === 'true');
    await tryDeleteAnyUserReply(session, ctx);
    await tryDeletePrompt(session, ctx);
    session.last_user_mid = null;
  }

  if (session.step + 1 < createReportSteps.length) {
    session.step++;
    await askNextQuestion(ctx, user_id);
  } else {
    await finishCreateReport(ctx, user_id);
  }
}

// New: handle button callbacks for report flow
export async function handleReportAction(ctx, bot) {
  // ensure ctx.user.user_id exists (try multiple places from different SDK shapes)
  if ((!ctx.user || !ctx.user.user_id) && ctx.update) {
    const uid =
      ctx.update?.callback?.user?.user_id ??
      ctx.update?.callback?.user?.id ??
      ctx.update?.callback_query?.from?.user_id ??
      ctx.update?.callback_query?.from?.id ??
      ctx.update?.payload?.user?.user_id ??
      ctx.update?.payload?.user?.id ??
      ctx.update?.user?.user_id ??
      ctx.update?.from?.id ??
      null;
    if (uid) ctx.user = { user_id: String(uid) };
  }

  // normalize payload early: prefer explicit update.payload, fallback to callback.payload or callback_query.data
  if (!ctx.update?.payload) {
    if (ctx.update?.callback && ctx.update.callback.payload) ctx.update.payload = ctx.update.callback.payload;
    else if (ctx.update?.callback_query && ctx.update.callback_query.data) ctx.update.payload = ctx.update.callback_query.data;
  }

  const user_id = ctx.user?.user_id;
  if (!user_id) return ctx.reply('Невозможно определить пользователя.');
  const session = reportSessions[user_id];
  if (!session) return ctx.reply('Нет активного создания отчёта.');

  // debug: log full update to see exact payload shape
  console.debug('handleReportAction update:', ctx.update);

  // acknowledge callback if SDK supports it (prevents "кнопка не реагирует" UI)
  try {
    if (typeof ctx.answerCallbackQuery === 'function') {
      await ctx.answerCallbackQuery();
    }
  } catch (ackErr) {
    console.error('answerCallbackQuery error:', ackErr);
  }

  // robust payload extraction (cover different SDK shapes)
  let payload = '';
  try {
    // common: payload.command (object), payload (string)
    if (ctx.update?.payload) {
      if (typeof ctx.update.payload === 'string') payload = ctx.update.payload;
      else payload = ctx.update.payload.command || ctx.update.payload;
    }
    // callback object used in your example: ctx.update.callback.payload (string)
    if (!payload && ctx.update?.callback) {
      if (typeof ctx.update.callback.payload === 'string') payload = ctx.update.callback.payload;
      else payload = ctx.update.callback.payload?.command || ctx.update.callback.payload;
    }
    // classic callback_query.data
    if (!payload && ctx.update?.callback_query) {
      payload = ctx.update.callback_query.data || ctx.update.callback_query.payload || ctx.update.callback_query.payload?.command || '';
    }
    // fallback to top-level fields
    if (!payload) payload = ctx.update?.payload?.command || ctx.update?.callback_query?.data || ctx.update?.callback?.payload || '';
  } catch (e) {
    console.error('payload extraction error:', e);
    payload = '';
  }

  payload = typeof payload === 'string' ? payload : (payload && String(payload.command || payload?.payload || '')) || '';
  payload = payload.trim();

  console.debug('handleReportAction payload:', payload);
  if (!payload) {
    // if no payload found — log and ignore (prevents silent failure)
    console.warn('No payload detected for report action, update dumped above.');
    return;
  }

  // cancel flow
  if (payload === 'report_cancel') {
    // delete any stored user reply and the prompt (best-effort)
    await tryDeleteAnyUserReply(session, ctx);
    await tryDeletePrompt(session, ctx);
    delete reportSessions[user_id];
    await addUserState(user_id, null);
    return ctx.reply('Создание отчёта отменено.');
  }

  // skip optional field
  if (payload === 'report_skip') {
    // delete any stored user reply and the prompt (best-effort)
    await tryDeleteAnyUserReply(session, ctx);
    await tryDeletePrompt(session, ctx);

    const stepName = createReportSteps[session.step];

    // allow skipping attachments as well
    if (stepName === 'report_intruder') session.data.intruder = null;
    else if (stepName === 'report_room') session.data.intruder_room = null;
    else if (stepName === 'report_attachments') session.data.attachments = null;

    // advance
    if (session.step + 1 < createReportSteps.length) {
      session.step++;
      await askNextQuestion(ctx, user_id);
    } else {
      await finishCreateReport(ctx, user_id);
    }
    return;
  }

  // anonim yes/no
  if (payload.startsWith('report_anonim:')) {
    const choice = payload.split(':')[1];
    session.data.anonim = (choice === 'yes' || choice === 'y' || choice === 'да');
    // delete any stored user reply and the prompt, then finish
    await tryDeleteAnyUserReply(session, ctx);
    await tryDeletePrompt(session, ctx);
    await finishCreateReport(ctx, user_id);
    return;
  }

  // unknown action
  return ctx.reply('Неизвестное действие.');
}

async function finishCreateReport(ctx, user_id) {
  const session = reportSessions[user_id];
  if (!session) return;
  const botInstance = session.bot ?? ctx?.bot ?? null;
  const data = session.data || {};

  const reportPayload = {
    user_id: Number(user_id),
    time_create: new Date().toISOString(),
    text: String(data.text || '').trim(),
    attachments: data.attachments || null,
    intruder: data.intruder || null,
    intruder_room: data.intruder_room || null,
    anonim: !!data.anonim
  };

  try {
    const res = await createReport(reportPayload);
    // debug log to help diagnose "Не удалось сохранить отчёт."
    console.debug('createReport result:', res);

    // consider success either by lastID or by changes > 0
    const success = (res && (res.lastID || res.changes));

    if (success) {
      // capture user reply result
      let userMsgId = null;
      try {
        const userResp = await ctx.reply('✅ Отчёт отправлен. Спасибо.');
        // try several common locations for message id
        userMsgId = userResp?.message_id || userResp?.mid || userResp?.body?.mid || null;
      } catch (uErr) {
        console.error('Failed to send user confirmation message', uErr);
      }

      // Notify admin if configured and capture admin message id
      let adminMsgId = null;
      const adminId = process.env.ADMIN_USER_ID;
      if (adminId && botInstance && botInstance.api && botInstance.api.messages && typeof botInstance.api.messages.send === 'function') {
        try {
          const adminText = `Новый отчёт #${res.lastID || 'unknown'} от пользователя ${user_id}`;
          const attachmentsForAdmin = reportPayload.attachments || [];
          const adminResp = await botInstance.api.messages.send({ user_id: String(adminId), text: adminText, attachments: attachmentsForAdmin });
          adminMsgId = adminResp?.message_id || adminResp?.mid || adminResp?.body?.mid || null;
        } catch (notifyErr) {
          console.error('Failed to notify admin about new report:', notifyErr);
        }
      }

      // try persist message ids to DB
      try {
        const reportId = res.lastID || null;
        if (reportId) {
          await setReportMessageIds(reportId, userMsgId, adminMsgId);
          // notify responsible users (best-effort, do not block flow)
          try {
            await notifyResponsibleAboutReportId(botInstance, reportId);
          } catch (notifyErr) {
            console.error('notifyResponsibleAboutReportId error:', notifyErr);
          }
        }
      } catch (setErr) {
        console.error('Failed to set report message ids:', setErr);
      }

    } else {
      console.error('createReport did not return lastID or changes', res, reportPayload);
      await ctx.reply('Не удалось сохранить отчёт.');
    }
  } catch (err) {
    console.error('finishCreateReport error:', err);
    await ctx.reply('Ошибка при сохранении отчёта.');
  }

  delete reportSessions[user_id];
  await addUserState(user_id, null);
}

export default { startCreateReport, handleCreateReportResponse, handleReportAction };
