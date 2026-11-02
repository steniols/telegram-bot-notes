// Categorias disponíveis. `words` são as palavras reconhecidas em "listar ...".
export const CATEGORIES = [
  { id: 'nota', label: 'Nota', plural: 'Notas', emoji: '📝', words: ['nota', 'notas'] },
  { id: 'musica', label: 'Música', plural: 'Músicas', emoji: '🎵', words: ['musica', 'musicas'] },
  { id: 'banda', label: 'Banda', plural: 'Bandas', emoji: '🎸', words: ['banda', 'bandas'] },
  { id: 'filme', label: 'Filme/Série', plural: 'Filmes/Séries', emoji: '🎬', words: ['filme', 'filmes', 'serie', 'series'] },
  { id: 'video', label: 'Vídeo', plural: 'Vídeos', emoji: '📺', words: ['video', 'videos'] },
  { id: 'lembrete', label: 'Lembrete', plural: 'Lembretes', emoji: '⏰', words: ['lembrete', 'lembretes'] },
];

export const byId = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// Remove acentos e deixa minúsculo: "Vídeos" -> "videos"
export function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Reconhece pedidos como "listar filmes", "liste as bandas salvas", "mostrar vídeos".
// Retorna a categoria, 'all' para "listar tudo", ou null se não for um pedido de listagem.
export function parseListRequest(text) {
  const words = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  // O verbo precisa abrir a frase, senão "ver o show da banda" viraria uma listagem
  if (!/^(list|liste|listar|lista|mostre|mostrar|mostra|ver)$/.test(words[0] ?? '')) return null;
  const cat = CATEGORIES.find((c) => c.words.some((w) => words.includes(w)));
  if (cat) return cat;
  if (words.some((w) => ['tudo', 'todos', 'todas', 'itens'].includes(w))) return 'all';
  return null;
}

const DELETE_VERBS = /^(apagar|apague|apaga|remover|remova|remove|excluir|exclua|exclui|deletar|delete|deleta|limpar|limpe|limpa)$/;
const FILLER = new Set(['o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'meu', 'minha', 'meus', 'minhas', 'item',
  'itens', 'numero', 'n', 'salvo', 'salvos', 'salva', 'salvas', 'lista', 'listas', 'tudo', 'todos', 'todas']);

// Reconhece pedidos de remoção. Retorna:
//   { type: 'id', id }                    "apagar 12", "remover #12", "excluir o item 12"
//   { type: 'clear', category: cat|'all' } "limpar filmes", "apagar todas as bandas", "limpar tudo"
//   { type: 'pick' }                       "limpar lista" (sem dizer qual)
//   { type: 'search', words, category }    "remover Duna", "apagar o filme duna"
//   null                                   não é um pedido de remoção
export function parseDeleteRequest(text) {
  const words = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  if (!DELETE_VERBS.test(words[0] ?? '')) return null;
  const rest = words.slice(1);
  const cat = CATEGORIES.find((c) => c.words.some((w) => rest.includes(w)));
  const meaningful = rest.filter((w) => !FILLER.has(w) && !cat?.words.includes(w));

  // Remoção por número é imediata, então "limpar" (que é para listas) não vale aqui
  if (meaningful.length === 1 && /^\d+$/.test(meaningful[0]) && !words[0].startsWith('limp')) {
    return { type: 'id', id: Number(meaningful[0]) };
  }
  if (meaningful.length > 0) return { type: 'search', words: meaningful, category: cat ?? null };
  if (cat) return { type: 'clear', category: cat };
  if (rest.some((w) => ['tudo', 'todos', 'todas'].includes(w))) return { type: 'clear', category: 'all' };
  if (rest.some((w) => ['lista', 'listas'].includes(w))) return { type: 'pick' };
  return null;
}
