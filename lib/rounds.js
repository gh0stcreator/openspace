/**
 * Счётчик вопроса. Вопрос начинается репликой человека и кончается, когда ход
 * возвращается к нему: концом режима, возвратом хода или паузой. Счёт нужен одному —
 * решению «не пора ли предложить режим»: разговор, который идёт двенадцатый ход
 * без человека, ведут не так, как второй.
 *
 * Журнала на диске у него больше нет: таблицу «во что обходится вопрос» никто не читал,
 * а файл, который пишут и не читают, — это не измерение, а мусор.
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

/** Закрыть вопрос. Дальше считаем следующий. */
export function close(st) {
  st.round = null;
}
