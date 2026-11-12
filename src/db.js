import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const HOUR = 60 * 60 * 1000;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id     INTEGER NOT NULL,
      category    TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,          -- epoch ms
      remind_at   INTEGER,                   -- epoch ms, só para lembretes
      sent_24h    INTEGER NOT NULL DEFAULT 0,
      sent_2h     INTEGER NOT NULL DEFAULT 0,
      sent_now    INTEGER NOT NULL DEFAULT 0  -- aviso na hora do lembrete
    );
    CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
  `);
  // Bancos criados antes do aviso "na hora"
  if (!db.prepare('PRAGMA table_info(items)').all().some((c) => c.name === 'sent_now')) {
    db.exec('ALTER TABLE items ADD COLUMN sent_now INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    DROP INDEX IF EXISTS idx_items_pending;
    CREATE INDEX IF NOT EXISTS idx_items_due ON items (remind_at) WHERE sent_now = 0;
  `);

  const stmts = {
    insert: db.prepare(`INSERT INTO items (chat_id, category, content, created_at, remind_at, sent_24h, sent_2h)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`),
    byCategory: db.prepare(`SELECT * FROM items WHERE chat_id = ? AND category = ?
                            ORDER BY CASE WHEN remind_at IS NULL THEN created_at ELSE remind_at END DESC`),
    all: db.prepare('SELECT * FROM items ORDER BY created_at DESC'),
    byChat: db.prepare('SELECT * FROM items WHERE chat_id = ? ORDER BY created_at DESC'),
    get: db.prepare('SELECT * FROM items WHERE id = ? AND chat_id = ?'),
    delete: db.prepare('DELETE FROM items WHERE id = ? AND chat_id = ?'),
    deleteById: db.prepare('DELETE FROM items WHERE id = ?'),
    deleteCategory: db.prepare('DELETE FROM items WHERE chat_id = ? AND category = ?'),
    deleteChat: db.prepare('DELETE FROM items WHERE chat_id = ?'),
    pending: db.prepare('SELECT * FROM items WHERE remind_at IS NOT NULL AND sent_now = 0 AND remind_at <= ?'),
    mark24: db.prepare('UPDATE items SET sent_24h = 1 WHERE id = ?'),
    mark2: db.prepare('UPDATE items SET sent_24h = 1, sent_2h = 1 WHERE id = ?'),
    markDone: db.prepare('UPDATE items SET sent_24h = 1, sent_2h = 1, sent_now = 1 WHERE id = ?'),
  };

  return {
    addItem(chatId, category, content, remindAt = null, now = Date.now()) {
      // Avisos cuja hora já passou no momento da criação são marcados como enviados,
      // para não disparar "falta 1 dia" num lembrete criado para daqui a 3 horas.
      const ms = remindAt ? remindAt.getTime() : null;
      const skip24 = ms !== null && ms - now <= 24 * HOUR ? 1 : 0;
      const skip2 = ms !== null && ms - now <= 2 * HOUR ? 1 : 0;
      const r = stmts.insert.run(chatId, category, content, now, ms, skip24, skip2);
      return Number(r.lastInsertRowid);
    },
    listCategory: (chatId, category) => stmts.byCategory.all(chatId, category),
    listAll: () => stmts.all.all(),
    listChat: (chatId) => stmts.byChat.all(chatId),
    getItem: (chatId, id) => stmts.get.get(id, chatId),
    deleteItem: (chatId, id) => stmts.delete.run(id, chatId).changes > 0,
    // Usado pelo dashboard, que mostra os itens de todos os chats
    deleteById: (id) => stmts.deleteById.run(id).changes > 0,
    // category = id da categoria, ou 'all' para apagar tudo. Retorna quantos itens saíram.
    clear: (chatId, category) => Number(
      (category === 'all' ? stmts.deleteChat.run(chatId) : stmts.deleteCategory.run(chatId, category)).changes),
    // Lembretes com algum aviso vencido até `until` (epoch ms)
    pendingReminders: (until) => stmts.pending.all(until + 24 * HOUR),
    mark24: (id) => stmts.mark24.run(id),
    mark2: (id) => stmts.mark2.run(id),
    markDone: (id) => stmts.markDone.run(id),
    close: () => db.close(),
  };
}
