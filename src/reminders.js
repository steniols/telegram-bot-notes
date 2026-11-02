import { formatDate } from './dates.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// Até quanto tempo depois do horário ainda vale mandar o aviso "na hora" (ex.: bot reiniciando)
const LATE_TOLERANCE = 10 * MIN;

// Quais avisos um lembrete criado agora vai receber
export function plannedWarnings(remindAt, now = Date.now()) {
  const left = new Date(remindAt).getTime() - now;
  return [left > 24 * HOUR && '1 dia antes', left > 2 * HOUR && '2 horas antes', 'na hora'].filter(Boolean);
}

// Verifica os lembretes e decide quais avisos mandar agora.
// Exportada separada do timer para poder ser testada.
export async function checkReminders(db, send, now = Date.now()) {
  for (const r of db.pendingReminders(now)) {
    const t = r.remind_at;
    if (now >= t) {
      // Passou muito do horário (bot estava desligado): não avisa atrasado
      if (now - t <= LATE_TOLERANCE) await send(r.chat_id, `⏰ Agora: ${r.content}\n🕒 ${formatDate(t)}`);
      db.markDone(r.id);
    } else if (!r.sent_2h && now >= t - 2 * HOUR) {
      await send(r.chat_id, `⏰ Daqui a 2 horas:\n${r.content}\n🕒 ${formatDate(t)}`);
      db.mark2(r.id);
    } else if (!r.sent_24h && now >= t - 24 * HOUR) {
      await send(r.chat_id, `📅 Lembrete para amanhã:\n${r.content}\n🕒 ${formatDate(t)}`);
      db.mark24(r.id);
    }
  }
}

export function startReminderLoop(db, bot, intervalMs = 30 * 1000) {
  const send = (chatId, text) => bot.api.sendMessage(chatId, text);
  const tick = () => checkReminders(db, send).catch((err) => console.error('Erro nos lembretes:', err));
  tick();
  return setInterval(tick, intervalMs);
}
