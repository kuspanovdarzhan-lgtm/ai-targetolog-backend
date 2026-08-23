import { db } from './db.js';

// Дневной бюджет "единиц" по тарифам. Текстовые генерации (стратегия, тексты)
// стоят 1 единицу, генерация картинки — 5 (она заметно дороже по API).
export const TARIFF_LIMITS = {
  START: 15,
  PRO: 40,
  MAX: 100,
};

export function requireAdmin(req, res, next) {
  if (req.headers['x-api-key'] !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

export function requireClient(req, res, next) {
  const code = req.headers['x-client-code'];
  if (!code) {
    return res.status(401).json({ error: 'нет кода доступа (заголовок x-client-code)' });
  }
  const client = db.data.clients.find((c) => c.code === code && c.active !== false);
  if (!client) {
    return res.status(401).json({ error: 'неверный или отключённый код доступа' });
  }
  req.client = client;
  next();
}

const todayKey = () => new Date().toISOString().slice(0, 10);

// Возвращает true и списывает единицы, если у клиента есть запас на сегодня.
// Возвращает false, если дневной лимит тарифа исчерпан.
export async function spendUnits(client, units) {
  if (client.usageDate !== todayKey()) {
    client.usageDate = todayKey();
    client.usageUnits = 0;
  }
  const limit = TARIFF_LIMITS[client.tariff] ?? TARIFF_LIMITS.START;
  if (client.usageUnits + units > limit) return false;
  client.usageUnits += units;
  await db.write();
  return true;
}
