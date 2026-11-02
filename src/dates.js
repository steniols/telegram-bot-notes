// Leitura de datas em português, inclusive no meio de uma frase:
//   "daqui a 2 minutos", "em 3 horas", "daqui a meia hora", "daqui a 2 dias"
//   "hoje 21h", "amanhã às 9h30", "depois de amanhã 10:00"
//   "sexta 15h", "na próxima segunda às 9", "sábado que vem 3 da tarde"
//   "25/12 14:30", "25/12/2026 9h", "dia 25 às 18h", "meio-dia"
// Dia sem hora usa 9h; hora sem dia usa hoje (ou amanhã, se já passou).

const NUMBERS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
};
const NUM = `(\\d+|${Object.keys(NUMBERS).join('|')})`;
const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const PERIOD = '(?:\\s+(?:da|de)\\s+(manha|tarde|noite|madrugada))?';
const DEFAULT_HOUR = 9;

// Cada expressão já engole as preposições que vêm antes ("pra daqui a", "na sexta", "às 15h"),
// para que o texto que sobra fique limpo.
const RE = {
  relLong: new RegExp(`(?:\\b(?:pra|para)\\s+)?\\b(?:daqui\\s+(?:a\\s+)?|dentro\\s+de\\s+|em\\s+)(?:(meia)\\s+hora|${NUM}\\s*(minutos?|min|horas?|hrs?|dias?|semanas?))\\b`),
  relShort: new RegExp(`(?:\\b(?:pra|para)\\s+)?\\bdaqui\\s+(?:a\\s+)?${NUM}\\s*(m|h)\\b`),
  dayWord: /(?:\b(?:pra|para|de)\s+)?\b(depois\s+de\s+amanha|amanha|hoje)\b/,
  weekday: /(?:\b(?:pra|para)\s+)?(?:\b(?:n[ao]|nest[ae]|est[ae])\s+)?(?:\b(proxim[ao])\s+)?\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:[\s-]feira)?\b(\s+que\s+vem)?/,
  dmy: /(?:\b(?:pra|para|n[ao]|em)\s+)?(?:\bdia\s+)?\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
  dayOfMonth: /(?:\b(?:pra|para|n[ao]|em)\s+)?\bdia\s+(\d{1,2})\b(?!\s*\/)/,
  clock: new RegExp(`(?:\\b(?:pra|para)\\s+)?(?:\\b(?:as|a|pras|pelas|por\\s+volta\\s+das)\\s+)?\\b(\\d{1,2})(?::(\\d{2})|h(?:rs?|s)?\\s*(\\d{2})?|\\s+horas?)(?:\\s*min(?:utos?)?)?${PERIOD}(?![\\w:/])`),
  bareAs: new RegExp(`(?:\\b(?:pra|para)\\s+)?\\b(?:as|pelas)\\s+(\\d{1,2})\\b(?![/:h])${PERIOD}`),
  noon: /(?:\b(?:pra|para)\s+)?(?:\b(?:ao?|as)\s+)?\b(meio[\s-]dia|meia[\s-]noite)\b/,
};

const toNum = (s) => NUMBERS[s] ?? Number(s);

// Minúsculas e sem acentos, com o MESMO comprimento do original (para mapear as posições de volta)
function fold(text) {
  let out = '';
  for (const ch of text) {
    const n = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    out += n.length === ch.length ? n : ch;
  }
  return out;
}

function adjustPeriod(hour, period) {
  if ((period === 'tarde' || period === 'noite') && hour < 12) return hour + 12;
  return hour;
}

// Tira da frase as palavras de "pedido" para sobrar só o assunto do lembrete
const PREFIXES = [
  /^(?:eu\s+)?(?:quero|queria|preciso|gostaria\s+de|pode|poderia)\s+/i,
  /^(?:criar|crie|cria|fazer|faça|faca|faz|adicionar|adicione|marcar|marque|colocar|coloque|salvar|salve|anotar|anote|agendar|agende)\s+/i,
  /^(?:um\s+)?(?:novo\s+)?(?:lembrete|alarme)\b[\s:,-]*/i,
  /^(?:me\s+)?(?:lembre-me|lembr[ae]r?)\b\s*/i,
  /^me\s+/i,
  /^(?:pra|para|de|que|do|da)\s+/i,
];
const SUFFIX = /(?:[\s,.;:-]+|\s+(?:pra|para|de|as|às|e|no|na|em))$/i;

function cleanContent(text) {
  let c = text.replace(/\s+/g, ' ').trim();
  for (let changed = true; changed;) {
    changed = false;
    for (const re of PREFIXES) {
      const next = c.replace(re, '');
      if (next !== c) { c = next; changed = true; }
    }
    const next = c.replace(SUFFIX, '');
    if (next !== c) { c = next; changed = true; }
  }
  return c.charAt(0).toUpperCase() + c.slice(1);
}

// Procura uma data/hora no texto. Retorna { date, content, defaultTime } ou null.
// `content` é o texto sem a parte da data (pode ser vazio).
export function extractDate(text, now = new Date()) {
  const original = text.normalize('NFC');
  let norm = fold(original);
  const spans = [];
  const take = (re) => {
    const m = re.exec(norm);
    if (!m) return null;
    spans.push([m.index, m.index + m[0].length]);
    norm = norm.slice(0, m.index) + ' '.repeat(m[0].length) + norm.slice(m.index + m[0].length);
    return m;
  };
  const result = (date, defaultTime = false) => {
    let rest = original;
    for (const [a, b] of spans.sort((x, y) => y[0] - x[0])) rest = rest.slice(0, a) + ' ' + rest.slice(b);
    return { date, content: cleanContent(rest), defaultTime };
  };

  let day = null; // meia-noite do dia escolhido
  let keepNowTime = false;
  let weekdayMatch = false;

  // 1. Relativo: "daqui a 2 minutos" resolve tudo; "daqui a 2 dias" só define o dia
  const rl = take(RE.relLong);
  const rs = rl ? null : take(RE.relShort);
  if (rl || rs) {
    const amount = rl ? (rl[1] ? 0.5 : toNum(rl[2])) : toNum(rs[1]);
    const unit = rl ? (rl[1] ? 'h' : rl[3][0]) : rs[2];
    if (unit === 'm') return result(new Date(now.getTime() + amount * 60_000));
    if (unit === 'h') return result(new Date(now.getTime() + amount * 3_600_000));
    const days = unit === 's' ? amount * 7 : amount;
    day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    keepNowTime = true;
  }

  // 2. Dia
  let m;
  if (!day && (m = take(RE.dayWord))) {
    const offset = { hoje: 0, amanha: 1 }[m[1]] ?? 2;
    day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  } else if (!day && (m = take(RE.weekday))) {
    let diff = (WEEKDAYS.indexOf(m[2]) - now.getDay() + 7) % 7;
    if (diff === 0 && (m[1] || m[3])) diff = 7;
    day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
    weekdayMatch = true;
  } else if (!day && (m = take(RE.dmy))) {
    const d = Number(m[1]), mo = Number(m[2]) - 1;
    let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : now.getFullYear();
    day = new Date(y, mo, d);
    if (day.getDate() !== d || day.getMonth() !== mo) return null; // ex.: 31/02
    if (!m[3] && day < new Date(now.getFullYear(), now.getMonth(), now.getDate())) day.setFullYear(y + 1);
  } else if (!day && (m = take(RE.dayOfMonth))) {
    const d = Number(m[1]);
    for (let add = 0; add < 3 && !day; add++) {
      const cand = new Date(now.getFullYear(), now.getMonth() + add, d);
      if (cand.getDate() === d && cand >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) day = cand;
    }
    if (!day) return null;
  }

  // 3. Hora
  let hour = null, minute = 0;
  if ((m = take(RE.clock))) {
    hour = adjustPeriod(Number(m[1]), m[4]);
    minute = Number(m[2] ?? m[3] ?? 0);
  } else if ((m = take(RE.bareAs))) {
    hour = adjustPeriod(Number(m[1]), m[2]);
  } else if ((m = take(RE.noon))) {
    hour = m[1].startsWith('meio') ? 12 : 0;
  }
  if (hour !== null && (hour > 23 || minute > 59)) return null;

  if (!day && hour === null) return null;

  if (!day) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    if (date <= now) date.setDate(date.getDate() + 1);
    return result(date);
  }

  const defaultTime = hour === null && !keepNowTime;
  if (hour === null) {
    hour = keepNowTime ? now.getHours() : DEFAULT_HOUR;
    minute = keepNowTime ? now.getMinutes() : 0;
  }
  const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
  // "sexta 9h" dito numa sexta às 10h significa a próxima sexta
  if (weekdayMatch && date <= now) date.setDate(date.getDate() + 7);
  return result(date, defaultTime);
}

export function parseReminderDate(text, now = new Date()) {
  return extractDate(text, now)?.date ?? null;
}

export function formatDate(date) {
  return new Date(date).toLocaleString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
