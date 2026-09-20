import fs from 'node:fs';
import path from 'node:path';

/**
 * Счётчик вопросов. Вопрос начинается репликой человека и кончается, когда ход
 * возвращается к нему: концом режима, возвратом хода или паузой. Записываем, во что
 * он обошёлся — сколько ходов, токенов и минут, — иначе любое суждение о том, какой
 * режим лучше, остаётся вкусовщиной: «сказано больше» не значит «решено лучше».
 *
 * Пишем в JSONL рядом с состоянием комнат: это журнал, а не состояние, его дописывают.
 */
export function open(st, seq, mode) {
  if (st.round) return;
  st.round = { from: seq, mode: mode ?? '', turns: 0, tokens: 0, at: Date.now() };
}

export function count(st, meta) {
  if (!st.round) return;
  st.round.turns += 1;
  const u = meta?.usage ?? {};
  st.round.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
}

/** Закрыть вопрос и дописать строку. Пустой вопрос (ни одного хода) не пишем. */
export function close(dir, room, st, why) {
  const r = st.round;
  st.round = null;
  if (!dir || !r || !r.turns) return null;
  const line = {
    room,
    mode: r.mode || 'open',
    from: r.from,
    turns: r.turns,
    tokens: r.tokens,
    ms: Date.now() - r.at,
    why,
    at: new Date(r.at).toISOString(),
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${room.replace(/[^\w\-Ѐ-ӿ]/g, '_')}.rounds.jsonl`), JSON.stringify(line) + '\n');
  } catch { /* журнал не должен ронять разговор */ }
  return line;
}

/** Последние вопросы и сводка по режимам — для сравнения режимов между собой. */
export function read(dir, room, limit = 50) {
  if (!dir) return { rounds: [], byMode: [] };
  const f = path.join(dir, `${room.replace(/[^\w\-Ѐ-ӿ]/g, '_')}.rounds.jsonl`);
  let rounds = [];
  try {
    rounds = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { /* журнала ещё нет */ }

  const acc = new Map();
  for (const r of rounds) {
    const m = acc.get(r.mode) ?? { mode: r.mode, n: 0, turns: 0, tokens: 0, ms: 0 };
    m.n += 1; m.turns += r.turns; m.tokens += r.tokens; m.ms += r.ms;
    acc.set(r.mode, m);
  }
  const byMode = [...acc.values()]
    .map((m) => ({ mode: m.mode, n: m.n, turns: m.turns / m.n, tokens: m.tokens / m.n, ms: m.ms / m.n }))
    .sort((a, b) => b.n - a.n);

  return { rounds: rounds.slice(-limit).reverse(), byMode };
}
