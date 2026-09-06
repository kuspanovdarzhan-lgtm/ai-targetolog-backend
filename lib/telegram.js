const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function notifyTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы — уведомление пропущено');
    return { skipped: true };
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[telegram] отправка не удалась:', body);
  }
  return { skipped: false, ok: res.ok };
}

export async function notifyTelegramPhoto(caption, base64Png) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы — уведомление пропущено');
    return { skipped: true };
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const buffer = Buffer.from(base64Png, 'base64');
  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  // Telegram caption limit — 1024 символа, короткая подпись, детали идут отдельным сообщением
  form.append('caption', caption.slice(0, 1000));
  form.append('parse_mode', 'HTML');
  form.append('photo', new Blob([buffer], { type: 'image/png' }), 'creative.png');
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text();
    console.error('[telegram] отправка фото не удалась:', body);
  }
  return { skipped: false, ok: res.ok };
}
