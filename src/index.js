import { existsSync } from 'node:fs';

// TZ precisa ser definido antes de qualquer data ser criada
if (existsSync('.env')) process.loadEnvFile('.env');
process.env.TZ ||= 'America/Sao_Paulo';

const { openDb } = await import('./db.js');
const { createBot } = await import('./bot.js');
const { startReminderLoop } = await import('./reminders.js');
const { startDashboard } = await import('./dashboard.js');

const env = process.env;
if (!env.BOT_TOKEN) {
  console.error('Defina BOT_TOKEN no arquivo .env (copie .env.example). Veja o README.');
  process.exit(1);
}

const db = openDb(env.DB_PATH || 'data/cerebro.db');
const bot = createBot({ token: env.BOT_TOKEN, allowedUserId: env.ALLOWED_USER_ID, db });

await bot.api.setMyCommands([
  { command: 'menu', description: 'Anotar algo' },
  { command: 'listar', description: 'Listar uma categoria' },
  { command: 'apagar', description: 'Apagar um item pelo número' },
  { command: 'limpar', description: 'Esvaziar uma lista' },
  { command: 'cancelar', description: 'Cancelar anotação em andamento' },
  { command: 'ajuda', description: 'Como usar' },
]);

const timer = startReminderLoop(db, bot);
const server = startDashboard({
  db,
  host: env.DASHBOARD_HOST || '127.0.0.1',
  port: Number(env.DASHBOARD_PORT || 3000),
  token: env.DASHBOARD_TOKEN,
});

const shutdown = async () => {
  clearInterval(timer);
  server.close();
  await bot.stop();
  db.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

if (!env.ALLOWED_USER_ID) console.log('ALLOWED_USER_ID vazio: mande uma mensagem ao bot para descobrir seu ID.');
console.log('Bot rodando. Ctrl+C para parar.');
bot.start();
