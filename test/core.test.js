import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'America/Sao_Paulo';
const { parseReminderDate, extractDate, formatDate } = await import('../src/dates.js');
const { parseListRequest, parseDeleteRequest } = await import('../src/categories.js');
const { openDb } = await import('../src/db.js');
const { checkReminders } = await import('../src/reminders.js');

const HOUR = 3600 * 1000;
const now = new Date(2026, 10, 2, 10, 0); // 02/11/2026 10:00

test('parseReminderDate: formatos aceitos', () => {
  assert.deepEqual(parseReminderDate('25/12/2026 14:30', now), new Date(2026, 11, 25, 14, 30));
  assert.deepEqual(parseReminderDate('25/12 9h', now), new Date(2026, 11, 25, 9, 0));
  assert.deepEqual(parseReminderDate('05/01/27 8h15', now), new Date(2027, 0, 5, 8, 15));
  assert.deepEqual(parseReminderDate('amanhã às 18:00', now), new Date(2026, 10, 3, 18, 0));
  assert.deepEqual(parseReminderDate('hoje 21h', now), new Date(2026, 10, 2, 21, 0));
  assert.deepEqual(parseReminderDate('01/02 10:00', now), new Date(2027, 1, 1, 10, 0)); // já passou este ano
});

test('parseReminderDate: rejeita inválidos', () => {
  for (const s of ['31/02/2027 10:00', '25/12 25:00', 'blabla', 'Duna parte 2', '13 Reasons Why']) {
    assert.equal(parseReminderDate(s, now), null, s);
  }
});

test('extractDate: datas dinâmicas e texto do lembrete', () => {
  const cases = [
    ['quero criar um lembrete pra daqui a 2 minutos para ir ao dentista', new Date(2026, 10, 2, 10, 2), 'Ir ao dentista'],
    ['me lembra de ligar pra mãe na sexta às 3 da tarde', new Date(2026, 10, 6, 15, 0), 'Ligar pra mãe'],
    ['dentista amanhã 15h', new Date(2026, 10, 3, 15, 0), 'Dentista'],
    ['reunião na próxima segunda às 9', new Date(2026, 10, 9, 9, 0), 'Reunião'],
    ['daqui a meia hora tirar o bolo do forno', new Date(2026, 10, 2, 10, 30), 'Tirar o bolo do forno'],
    ['em 2 horas buscar as crianças', new Date(2026, 10, 2, 12, 0), 'Buscar as crianças'],
    ['daqui 3 dias renovar CNH', new Date(2026, 10, 5, 10, 0), 'Renovar CNH'],
    ['comprar pão às 18', new Date(2026, 10, 2, 18, 0), 'Comprar pão'],
    ['almoço meio-dia', new Date(2026, 10, 2, 12, 0), 'Almoço'],
    ['lembrete: tomar remédio 22h30', new Date(2026, 10, 2, 22, 30), 'Tomar remédio'],
    ['segunda que vem 10h dentista', new Date(2026, 10, 9, 10, 0), 'Dentista'],
    ['Show dia 15/03 às 21h', new Date(2027, 2, 15, 21, 0), 'Show'],
    ['9h', new Date(2026, 10, 3, 9, 0), ''], // já passou hoje: amanhã
  ];
  for (const [text, date, content] of cases) {
    const r = extractDate(text, now);
    assert.deepEqual(r?.date, date, text);
    assert.equal(r.content, content, text);
  }
  const d = extractDate('pagar boleto dia 10', now);
  assert.deepEqual(d.date, new Date(2026, 10, 10, 9, 0));
  assert.equal(d.defaultTime, true);
});

test('parseListRequest', () => {
  assert.equal(parseListRequest('Liste os filmes salvos').id, 'filme');
  assert.equal(parseListRequest('listar bandas').id, 'banda');
  assert.equal(parseListRequest('Liste os vídeos salvos').id, 'video');
  assert.equal(parseListRequest('mostrar séries').id, 'filme');
  assert.equal(parseListRequest('listar tudo'), 'all');
  assert.equal(parseListRequest('Duna parte 2'), null);
  assert.equal(parseListRequest('ir ver o show da banda'), null);
  assert.equal(parseListRequest('ver bandas').id, 'banda');
});

test('parseDeleteRequest', () => {
  assert.deepEqual(parseDeleteRequest('apagar 12'), { type: 'id', id: 12 });
  assert.deepEqual(parseDeleteRequest('Remover #7'), { type: 'id', id: 7 });
  assert.deepEqual(parseDeleteRequest('excluir o item 3'), { type: 'id', id: 3 });
  assert.equal(parseDeleteRequest('limpar filmes').category.id, 'filme');
  assert.equal(parseDeleteRequest('apagar todas as bandas').category.id, 'banda');
  assert.equal(parseDeleteRequest('limpar a lista de vídeos').category.id, 'video');
  assert.deepEqual(parseDeleteRequest('limpar tudo'), { type: 'clear', category: 'all' });
  assert.deepEqual(parseDeleteRequest('limpar lista'), { type: 'pick' });
  assert.deepEqual(parseDeleteRequest('remover Duna'), { type: 'search', words: ['duna'], category: null });
  const s = parseDeleteRequest('apagar o filme duna');
  assert.equal(s.type, 'search');
  assert.deepEqual(s.words, ['duna']);
  assert.equal(s.category.id, 'filme');
  assert.equal(parseDeleteRequest('limpar 2').type, 'search'); // nunca apaga direto pelo número
  assert.equal(parseDeleteRequest('Duna parte 2'), null);
  assert.equal(parseDeleteRequest('apagar'), null);
});

test('db: limpar categoria e tudo', () => {
  const db = openDb(':memory:');
  db.addItem(1, 'filme', 'A');
  db.addItem(1, 'filme', 'B');
  db.addItem(1, 'banda', 'C');
  db.addItem(2, 'filme', 'de outro chat');
  assert.equal(db.clear(1, 'filme'), 2);
  assert.equal(db.listChat(1).length, 1);
  assert.equal(db.clear(1, 'all'), 1);
  assert.equal(db.listChat(2).length, 1);
});

test('lembretes: avisa 24h e 2h antes, uma vez cada', async () => {
  const db = openDb(':memory:');
  const sent = [];
  const send = async (chatId, text) => sent.push(text);
  const t = now.getTime() + 48 * HOUR;
  db.addItem(1, 'lembrete', 'Dentista', new Date(t), now.getTime());

  await checkReminders(db, send, t - 30 * HOUR);
  assert.equal(sent.length, 0);
  await checkReminders(db, send, t - 23 * HOUR);
  await checkReminders(db, send, t - 22 * HOUR);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /amanhã/);
  await checkReminders(db, send, t - 2 * HOUR + 1000);
  await checkReminders(db, send, t - HOUR);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /2 horas/);
  await checkReminders(db, send, t + 20 * 1000);
  await checkReminders(db, send, t + 60 * 1000);
  assert.equal(sent.length, 3);
  assert.match(sent[2], /Agora/);
});

test('lembretes: daqui a 2 minutos avisa só na hora', async () => {
  const db = openDb(':memory:');
  const sent = [];
  const send = async (c, text) => sent.push(text);
  const t = now.getTime() + 2 * 60 * 1000;
  db.addItem(1, 'lembrete', 'Dentista', new Date(t), now.getTime());
  await checkReminders(db, send, now.getTime() + 30 * 1000);
  assert.equal(sent.length, 0);
  await checkReminders(db, send, t + 5 * 1000);
  assert.deepEqual(sent, [`⏰ Agora: Dentista\n🕒 ${formatDate(t)}`]);
});

test('lembretes: criado a menos de 24h pula o aviso de 1 dia', async () => {
  const db = openDb(':memory:');
  const sent = [];
  const t = now.getTime() + 5 * HOUR;
  db.addItem(1, 'lembrete', 'Reunião', new Date(t), now.getTime());
  await checkReminders(db, async (c, text) => sent.push(text), now.getTime() + 60000);
  assert.equal(sent.length, 0);
  await checkReminders(db, async (c, text) => sent.push(text), t - HOUR);
  assert.deepEqual(sent.length, 1);
});

test('lembretes: horário perdido com bot desligado não avisa atrasado', async () => {
  const db = openDb(':memory:');
  const sent = [];
  const t = now.getTime() + 48 * HOUR;
  db.addItem(1, 'lembrete', 'Show', new Date(t), now.getTime());
  await checkReminders(db, async (c, text) => sent.push(text), t + HOUR);
  assert.equal(sent.length, 0);
  assert.equal(db.pendingReminders(t + 2 * HOUR).length, 0);
});
