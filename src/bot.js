import { Bot, InlineKeyboard } from 'grammy';
import { CATEGORIES, byId, normalize, parseListRequest, parseDeleteRequest } from './categories.js';
import { extractDate, formatDate } from './dates.js';
import { plannedWarnings } from './reminders.js';

const GREETINGS = new Set(['oi', 'ola', 'menu', 'inicio', 'comecar', 'bom dia', 'boa tarde', 'boa noite']);

function categoryKeyboard(prefix) {
  const kb = new InlineKeyboard();
  CATEGORIES.forEach((c, i) => {
    kb.text(`${c.emoji} ${c.label}`, `${prefix}:${c.id}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

function formatList(db, chatId, cat) {
  const items = db.listCategory(chatId, cat.id);
  if (items.length === 0) return `${cat.emoji} Nenhum item em ${cat.plural}.`;
  const lines = items.map((it) => {
    const when = it.remind_at ? ` — ${formatDate(it.remind_at)}${it.remind_at < Date.now() ? ' (passou)' : ''}` : '';
    return `#${it.id} ${it.content}${when}`;
  });
  return `${cat.emoji} ${cat.plural} (${items.length}):\n\n${lines.join('\n')}`;
}

// Botões embaixo de uma lista (só quando ela tem itens)
function listOptions(db, chatId, cat) {
  if (db.listCategory(chatId, cat.id).length === 0) return {};
  return { reply_markup: new InlineKeyboard().text('🗑️ Remover item', `rmpick:${cat.id}`).text('🧹 Limpar lista', `clearask:${cat.id}`) };
}

const MAX_ITEM_BUTTONS = 30;

// Teclado com um botão por item, para escolher qual remover
function itemsKeyboard(items) {
  const kb = new InlineKeyboard();
  for (const it of items.slice(0, MAX_ITEM_BUTTONS)) {
    const label = `${byId[it.category].emoji} #${it.id} ${it.content}`;
    kb.text(label.length > 48 ? label.slice(0, 47) + '…' : label, `del:${it.id}`).row();
  }
  return kb.text('Cancelar', 'cancel');
}

const clearName = (category) => (category === 'all' ? 'todas as listas' : byId[category].plural);

export function createBot({ token, allowedUserId, db }) {
  const bot = new Bot(token);

  // Estado da conversa por chat: { step: 'content' | 'category' | 'date', category?, content? }
  const state = new Map();

  // Só o dono usa o bot. Sem ALLOWED_USER_ID configurado, informa o ID para configurar.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!allowedUserId) {
      await ctx.reply(`Seu ID do Telegram é ${userId}.\nColoque ALLOWED_USER_ID=${userId} no arquivo .env e reinicie o bot.`);
      return;
    }
    if (String(userId) !== String(allowedUserId)) return;
    await next();
  });

  const showMenu = (ctx) => {
    state.set(ctx.chat.id, { step: 'category' });
    return ctx.reply('O que deseja anotar?', { reply_markup: categoryKeyboard('cat') });
  };

  const save = async (ctx, category, content, remindAt = null, defaultTime = false) => {
    const id = db.addItem(ctx.chat.id, category, content, remindAt);
    state.delete(ctx.chat.id);
    const cat = byId[category];
    const lines = [`✅ Salvo em ${cat.plural} (#${id})`];
    if (remindAt) {
      const w = plannedWarnings(remindAt);
      lines.push(
        `📝 ${content}`,
        `⏰ ${formatDate(remindAt)}${defaultTime ? ' (sem hora informada, usei 9h)' : ''}`,
        `Vou avisar ${w.length > 1 ? w.slice(0, -1).join(', ') + ' e ' + w.at(-1) : w[0]}.`);
    }
    lines.push('', 'Deseja fazer uma nova anotação?');
    await ctx.reply(lines.join('\n'), {
      reply_markup: new InlineKeyboard().text('➕ Sim', 'again:yes').text('Não', 'again:no'),
    });
  };

  const DATE_EXAMPLES = 'daqui a 30 minutos\nem 2 horas\nhoje 21h\namanhã às 9h\nsexta 15h\n25/12 14:30';

  const askDate = (ctx, content) => {
    state.set(ctx.chat.id, { step: 'date', category: 'lembrete', content });
    return ctx.reply(`Para quando? Exemplos:\n${DATE_EXAMPLES}`);
  };

  // Salva um lembrete a partir de uma data encontrada no texto; sem data, pergunta
  const saveReminder = (ctx, text) => {
    const found = extractDate(text);
    if (!found || found.date <= new Date()) return askDate(ctx, text);
    return save(ctx, 'lembrete', found.content || text, found.date, found.defaultTime);
  };

  const sendList = (ctx, cat) => ctx.reply(formatList(db, ctx.chat.id, cat), listOptions(db, ctx.chat.id, cat));

  // Pede confirmação antes de limpar uma lista (category = id ou 'all')
  const askClear = (ctx, category) => {
    const items = db.listChat(ctx.chat.id).filter((it) => category === 'all' || it.category === category);
    if (items.length === 0) return ctx.reply(`${category === 'all' ? 'Não há' : `${byId[category].plural}: não há`} itens para apagar.`);
    return ctx.reply(`Apagar ${items.length === 1 ? 'o item' : `os ${items.length} itens`} de ${clearName(category)}? Não dá para desfazer.`, {
      reply_markup: new InlineKeyboard().text('🧹 Sim, limpar', `clear:${category}`).text('Cancelar', 'cancel'),
    });
  };

  const askClearPick = (ctx) => ctx.reply('Qual lista deseja limpar?', {
    reply_markup: CATEGORIES.reduce((kb, c, i) => {
      kb.text(`${c.emoji} ${c.plural}`, `clearask:${c.id}`);
      return i % 2 === 1 ? kb.row() : kb;
    }, new InlineKeyboard()).row().text('🗑️ Tudo', 'clearask:all').text('Cancelar', 'cancel'),
  });

  const deleteById = async (ctx, id) => {
    const item = db.getItem(ctx.chat.id, id);
    if (!item || !db.deleteItem(ctx.chat.id, id)) return ctx.reply(`Item #${id} não encontrado.`);
    await ctx.reply(`🗑️ Removido de ${byId[item.category].plural}: ${item.content}`);
  };

  bot.command(['start', 'menu'], (ctx) => showMenu(ctx));

  bot.command('listar', (ctx) =>
    ctx.reply('Qual categoria?', { reply_markup: categoryKeyboard('list') }));

  bot.command('cancelar', async (ctx) => {
    state.delete(ctx.chat.id);
    await ctx.reply('Ok, cancelado.');
  });

  bot.command('apagar', async (ctx) => {
    const id = Number(ctx.match.replace('#', '').trim());
    if (!id) return ctx.reply('Use: /apagar 12 (o número aparece nas listas), ou "remover Duna".');
    await deleteById(ctx, id);
  });

  bot.command('limpar', (ctx) => askClearPick(ctx));

  bot.command('ajuda', (ctx) => ctx.reply(
    'Como usar:\n' +
    '• Mande qualquer texto e escolha a categoria\n' +
    '• Ou mande "oi" / /menu para escolher a categoria primeiro\n' +
    '• "listar filmes", "liste as bandas salvas", "mostrar vídeos", "listar tudo"\n' +
    '• /listar — escolher categoria para listar\n' +
    '• "apagar 12" ou /apagar 12 — remover o item #12\n' +
    '• "remover Duna" — procura o item pelo nome e pergunta qual remover\n' +
    '• "limpar filmes", "limpar tudo" ou /limpar — esvaziar uma lista (pede confirmação)\n' +
    '• /cancelar — cancelar a anotação em andamento'));

  // Botão de categoria no modo "anotar"
  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const category = ctx.match[1];
    const cat = byId[category];
    const current = state.get(ctx.chat.id);
    await ctx.editMessageText(`Categoria: ${cat.emoji} ${cat.label}`);

    // Texto já enviado antes de escolher a categoria
    if (current?.content) {
      if (category === 'lembrete') return saveReminder(ctx, current.content);
      return save(ctx, category, current.content);
    }
    state.set(ctx.chat.id, { step: 'content', category });
    await ctx.reply(category === 'lembrete' ? 'Do que devo te lembrar?' : `Qual ${cat.label.toLowerCase()}?`);
  });

  // Sugestão de lembrete para um texto com data ("dentista amanhã 15h")
  bot.callbackQuery(/^rem:(yes|other)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const current = state.get(ctx.chat.id);
    if (current?.step !== 'confirm') return ctx.editMessageText('Essa sugestão expirou. Mande a mensagem de novo.');
    if (ctx.match[1] === 'other') {
      state.set(ctx.chat.id, { step: 'category', content: current.raw });
      return ctx.editMessageText('O que deseja anotar?', { reply_markup: categoryKeyboard('cat') });
    }
    await ctx.editMessageReplyMarkup();
    await save(ctx, 'lembrete', current.content, current.date, current.defaultTime);
  });

  // Resposta a "Deseja fazer uma nova anotação?" (remove os botões da mensagem anterior)
  bot.callbackQuery(/^again:(yes|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    if (ctx.match[1] === 'yes') return showMenu(ctx);
    await ctx.reply('Ok! Quando quiser anotar algo, é só mandar uma mensagem.');
  });

  // Botão de categoria no modo "listar"
  bot.callbackQuery(/^list:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const cat = byId[ctx.match[1]];
    await ctx.editMessageText(formatList(db, ctx.chat.id, cat), listOptions(db, ctx.chat.id, cat));
  });

  // "🗑️ Remover item" embaixo de uma lista: mostra um botão por item
  bot.callbackQuery(/^rmpick:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const items = db.listCategory(ctx.chat.id, ctx.match[1]);
    if (items.length === 0) return ctx.reply('Essa lista está vazia.');
    const more = items.length > MAX_ITEM_BUTTONS ? `\n(mostrando ${MAX_ITEM_BUTTONS} de ${items.length}; para outros use "apagar NÚMERO")` : '';
    await ctx.reply(`Qual item remover?${more}`, { reply_markup: itemsKeyboard(items) });
  });

  // Escolher um item para remover já é a confirmação
  bot.callbackQuery(/^del:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await deleteById(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^clearask:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await askClear(ctx, ctx.match[1]);
  });

  bot.callbackQuery(/^clear:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const category = ctx.match[1];
    const n = db.clear(ctx.chat.id, category);
    await ctx.editMessageText(`🧹 ${clearName(category)}: ${n} ${n === 1 ? 'item apagado' : 'itens apagados'}.`);
  });

  bot.callbackQuery('cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Ok, nada foi removido.');
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    const current = state.get(ctx.chat.id);

    if (current?.step === 'date') {
      const found = extractDate(text);
      if (!found) {
        console.log('Data não reconhecida:', JSON.stringify(text));
        return ctx.reply(`Não entendi a data. Tente, por exemplo:\n${DATE_EXAMPLES}\n\n(ou /cancelar)`);
      }
      if (found.date <= new Date()) return ctx.reply(`${formatDate(found.date)} já passou. Mande uma data futura (ou /cancelar).`);
      return save(ctx, 'lembrete', current.content, found.date, found.defaultTime);
    }

    if (current?.step === 'what') return save(ctx, 'lembrete', text, current.date, current.defaultTime);

    if (current?.step === 'content') {
      if (current.category === 'lembrete') return saveReminder(ctx, text);
      return save(ctx, current.category, text);
    }

    const list = parseListRequest(text);
    if (list === 'all') {
      state.delete(ctx.chat.id);
      const filled = CATEGORIES.filter((cat) => db.listCategory(ctx.chat.id, cat.id).length);
      if (filled.length === 0) return ctx.reply('Nada salvo ainda.');
      for (const cat of filled) await sendList(ctx, cat);
      return;
    }
    if (list) {
      state.delete(ctx.chat.id);
      return sendList(ctx, list);
    }

    const del = parseDeleteRequest(text);
    if (del?.type === 'id') { state.delete(ctx.chat.id); return deleteById(ctx, del.id); }
    if (del?.type === 'clear') { state.delete(ctx.chat.id); return askClear(ctx, del.category === 'all' ? 'all' : del.category.id); }
    if (del?.type === 'pick') { state.delete(ctx.chat.id); return askClearPick(ctx); }
    if (del?.type === 'search') {
      const matches = db.listChat(ctx.chat.id).filter((it) =>
        (!del.category || it.category === del.category.id) && del.words.every((w) => normalize(it.content).includes(w)));
      // Sem resultado: provavelmente é uma anotação ("limpar a casa"), segue o fluxo normal
      if (matches.length > 0) {
        state.delete(ctx.chat.id);
        return ctx.reply(matches.length === 1 ? 'Remover este item?' : `Encontrei ${matches.length} itens. Qual remover?`,
          { reply_markup: itemsKeyboard(matches) });
      }
    }

    if (GREETINGS.has(normalize(text))) return showMenu(ctx);

    // Texto com data futura ("dentista amanhã 15h"): sugere criar o lembrete direto
    const found = extractDate(text);
    if (found && found.date > new Date() && !found.content) {
      state.set(ctx.chat.id, { step: 'what', date: found.date, defaultTime: found.defaultTime });
      return ctx.reply(`⏰ ${formatDate(found.date)}\nDo que devo te lembrar?`);
    }
    if (found && found.date > new Date()) {
      const content = found.content;
      state.set(ctx.chat.id, { step: 'confirm', raw: text, content, date: found.date, defaultTime: found.defaultTime });
      return ctx.reply(`Criar este lembrete?\n📝 ${content}\n⏰ ${formatDate(found.date)}${found.defaultTime ? ' (sem hora informada, usei 9h)' : ''}`, {
        reply_markup: new InlineKeyboard().text('✅ Criar lembrete', 'rem:yes').text('📂 Outra categoria', 'rem:other'),
      });
    }

    // Texto livre: guarda e pergunta a categoria
    state.set(ctx.chat.id, { step: 'category', content: text });
    await ctx.reply('O que deseja anotar?', { reply_markup: categoryKeyboard('cat') });
  });

  bot.catch((err) => console.error('Erro no bot:', err.error ?? err));

  return bot;
}
