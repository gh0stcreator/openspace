import fs from 'node:fs';
import path from 'node:path';

/**
 * Память пространства: не транскрипт разговора, а то, что из него следует.
 * У каждой записи есть происхождение — кто и в какой реплике это сказал,
 * — иначе общая память быстро превращается в общий мусор.
 */

export const KINDS = {
  решение: 'что решили делать',
  допущение: 'во что верим, но не проверили',
  находка: 'что выяснили и подтвердили',
  ограничение: 'чего нельзя или нет',
  вопрос: 'что осталось открытым',
  // Единственный вид не про предмет, а про саму работу. Без него команда каждый раз
  // заново наступает на те же грабли: разговор кончился, вывод из него — нет.
  урок: 'что поняли про то, как работаем',
};

/**
 * Откуда запись и кто при ней был. Присутствие считается не по составу комнаты, а по
 * тому, кто этот кусок ленты действительно читал: участник, включённый, но ни разу
 * не разбуженный за сорок реплик, разговора не видел, и делать вид, что видел, —
 * то же враньё, только в другую сторону.
 *
 * `уровень` ставит архивариус: «главное» знает всё пространство, «деталь» — только те,
 * кто был. По умолчанию деталь: чужой промпт не место для подробностей чужого разговора.
 */
function born(ch, ctx, room) {
  return {
    where: ctx.where ?? room,
    saw: Array.isArray(ctx.saw) ? [...ctx.saw] : null,
    span: Array.isArray(ctx.span) ? [...ctx.span] : null,
    level: ch.level === 'главное' ? 'главное' : 'деталь',
  };
}

/** Слова записи для сравнения с разговором: без коротких, с грубой обрезкой окончаний. */
function words(text) {
  return [...new Set(String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length > 3)
    .map((w) => w.slice(0, 6)))];
}

// Вес вида: решение и ограничение — обязательства, их забывать нельзя; вопрос
// и допущение живут до первого ответа. Тот же порядок, по которому раньше резали хвост.
const WEIGHT = {
  решение: 1, ограничение: 1, урок: 0.9, находка: 0.6, допущение: 0.5, вопрос: 0.5,
};
// Пересказанное уступает своему при нехватке места: так и в жизни.
const TOLD = 0.6;
// Затухание: чем дальше разговор ушёл с последнего обращения к записи, тем она тусклее.
// Считаем в десятках реплик, а не в часах: комната, в которой неделю молчали, ничего
// не забыла. Сто реплик — 0.6, триста — 0.21.
const FADE = 0.95;
const FLOOR = 0.25;

export class Memory {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = new Map(); // room -> { items, mtimeMs }
    // Когда запись последний раз попадала в промпт. Обращение освежает воспоминание,
    // а на диск это не пишем: brief() зовётся перед каждым ходом каждого участника,
    // и перезапись файла ради числа стоила бы дороже потери этого числа.
    this.hot = new Map(); // id -> seq
  }

  file(room) {
    return path.join(this.dir, `${room.replace(/[^\w\-Ѐ-ӿ]/g, '_')}.json`);
  }

  /** Перечитывает файл, только если он менялся с прошлого чтения: другая сессия или
   * отдельный вызов архивариуса пишут в тот же файл, и застрявший в памяти кэш для них слеп. */
  load(room) {
    const f = this.file(room);
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(f).mtimeMs; } catch { /* файла ещё нет */ }
    const cached = this.cache.get(room);
    if (cached && cached.mtimeMs === mtimeMs) return cached.items;

    let items = [];
    if (mtimeMs) {
      try { items = JSON.parse(fs.readFileSync(f, 'utf8')).items ?? []; } catch { items = []; }
    }
    this.cache.set(room, { items, mtimeMs });
    return items;
  }

  /**
   * Стереть память комнаты целиком. Копию кладём рядом с отметкой времени — так же,
   * как поступает очистка ленты: память копилась кликами человека, и «нажал не туда»
   * не должно стоить ему всего накопленного.
   */
  clear(room) {
    const items = this.load(room);
    if (items.length) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const f = this.file(room);
      try { fs.copyFileSync(f, f.replace(/\.json$/, `.${stamp}.json`)); } catch { /* копии нет — не беда */ }
    }
    items.length = 0;
    return this.save(room);
  }

  save(room) {
    const items = this.load(room);
    const f = this.file(room);
    // Пишем через временный файл: прерванная запись не должна оставить огрызок JSON,
    // который потом читается как пустая память и следующий commit её затирает.
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2) + '\n');
    fs.renameSync(tmp, f);
    this.cache.set(room, { items, mtimeMs: fs.statSync(f).mtimeMs });
    return items;
  }

  /** Живые записи: то, что не отменено и не заменено более новой формулировкой. */
  active(room) {
    return this.load(room).filter((i) => i.status === 'живое');
  }

  /**
   * Живое «главное» из всех комнат — то, что знает всё пространство. Отдельного файла
   * у него нет и быть не должно: копия записи разошлась бы с оригиналом на первом же
   * «заменить». Запись живёт там, где родилась, а `level` говорит, кому она видна
   * за пределами своей комнаты.
   */
  shared(except = '') {
    let files = [];
    try { files = fs.readdirSync(this.dir); } catch { return []; }
    const rooms = files
      .filter((f) => f.endsWith('.json') && !f.endsWith('.state.json'))
      // Копии, которые оставляет clear(), в память пространства не поднимаем: стёртое
      // должно оставаться стёртым, а не возвращаться через соседнюю комнату.
      .filter((f) => !/\.\d{4}-\d{2}-\d{2}T/.test(f))
      .map((f) => f.slice(0, -5))
      .filter((r) => r !== except);
    return rooms.flatMap((r) => this.active(r).filter((i) => i.level === 'главное'));
  }

  /**
   * Применить подтверждённые изменения. Запись не редактируется на месте:
   * новая версия заменяет старую и ссылается на неё, чтобы история осталась.
   *
   * Два висящих предложения могут целиться в одну и ту же запись: первый клик её уже
   * заменил или отменил, второй застаёт чужой diff устаревшим. Тихо применить второй —
   * значит держать в памяти две живые версии одного решения, которые спорят друг с другом
   * в промпте каждого участника. Вместо этого 'заменить'/'отменить' требуют, чтобы old
   * всё ещё был 'живым' — иначе изменение уходит в conflicts, а не применяется.
   */
  commit(room, changes, author, ctx = {}) {
    const items = this.load(room);
    const now = new Date().toISOString();
    const applied = [];
    const conflicts = [];

    for (const ch of changes) {
      if (ch.action === 'добавить') {
        const item = {
          id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          kind: KINDS[ch.kind] ? ch.kind : 'находка',
          text: String(ch.text ?? '').trim().slice(0, 600),
          source: ch.source ?? null,
          author,
          createdAt: now,
          status: 'живое',
          supersedes: null,
          ...born(ch, ctx, room),
        };
        if (!item.text) continue;
        items.push(item);
        applied.push(item);
      }

      if (ch.action === 'заменить' && ch.id) {
        const old = items.find((i) => i.id === ch.id);
        if (!old || old.status !== 'живое') { conflicts.push(ch); continue; }
        old.status = 'заменено';
        old.supersededAt = now;
        const item = {
          id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          kind: KINDS[ch.kind] ? ch.kind : old.kind,
          text: String(ch.text ?? '').trim().slice(0, 600),
          source: ch.source ?? null,
          author,
          createdAt: now,
          status: 'живое',
          supersedes: old.id,
          ...born(ch, ctx, room),
        };
        items.push(item);
        applied.push(item);
      }

      if (ch.action === 'отменить' && ch.id) {
        const old = items.find((i) => i.id === ch.id);
        if (!old || old.status !== 'живое') { conflicts.push(ch); continue; }
        old.status = 'отменено';
        old.supersededAt = now;
        applied.push(old);
      }
    }

    this.save(room);
    return { applied, conflicts };
  }

  /** Выдача для архивариуса: с id, чтобы он мог предложить 'заменить'/'отменить'.
   * brief() ниже id не печатает — участникам он не нужен и только замусоривает промпт. */
  forArchivist(room) {
    return this.active(room).map((i) => ({ id: i.id, kind: i.kind, text: i.text }));
  }

  /**
   * Память для промпта участника: коротко, по разделам, только живое — и только та,
   * которая к этому разговору относится. Раньше она ехала целиком и всем одинаковая;
   * теперь у каждого своя, из двух частей.
   *
   * ПРИ ТЕБЕ — записи этой комнаты, при которых он был: с подробностями, по видам.
   * СО СЛОВ — то, чего он не слышал: записи этой комнаты, родившиеся без него, и «главное»
   * из других комнат. Их печатаем плоским списком и без плашки вида: плашка «РЕШЕНИЕ»
   * над строкой, которой человек не слышал, провоцирует говорить о ней уверенно.
   *
   * Что попадёт в выдачу, решает не порядок видов, а близость к разговору: вес вида,
   * затухание по возрасту и совпадение слов с хвостом ленты. Решения и ограничения
   * своей комнаты печатаются всегда, мимо затухания: забыть решение — значит начать
   * спор заново, и экономия промпта этого не стоит.
   */
  brief(room, opts = {}) {
    const { me = '', tail = '', seq = 0, limit = 8000 } = typeof opts === 'number' ? { limit: opts } : opts;
    const mine = this.active(room);
    const others = me ? this.shared(room) : [];
    if (!mine.length && !others.length) return { text: '', told: false };

    const spoken = new Set(words(tail));
    const idf = new Map();
    const all = [...mine, ...others];
    for (const i of all) for (const w of words(i.text)) idf.set(w, (idf.get(w) ?? 0) + 1);
    // Редкость слова: то, что есть в половине записей, само себя обнуляет — а это ровно
    // слова предметной области, которые в комнате говорят все и всегда. Пол не даём уйти
    // в минус: на двух записях логарифм отрицателен, и близость считалась бы наоборот.
    const rare = (w) => Math.max(0.1, Math.log((all.length + 1) / (1 + (idf.get(w) ?? 0))));

    const near = (item) => {
      const ws = words(item.text);
      if (!ws.length || !spoken.size) return 0;
      const sum = ws.reduce((n, w) => n + rare(w), 0);
      const hit = ws.filter((w) => spoken.has(w)).reduce((n, w) => n + rare(w), 0);
      return sum > 0 ? hit / sum : 0;
    };

    const seen = (item) => !me || !item.saw || item.saw.includes(me);
    const score = (item, own) => {
      const age = Math.max(0, (seq - (this.hot.get(item.id) ?? item.span?.[1] ?? 0)) / 10);
      const weight = (WEIGHT[item.kind] ?? 0.5) * (own && seen(item) ? 1 : TOLD);
      return weight * (FADE ** age) * (0.4 + 0.6 * near(item));
    };

    // Обязательства своей комнаты — вне отбора: их не забывают.
    const always = (i) => (i.kind === 'решение' || i.kind === 'ограничение') && seen(i);

    const own = mine.filter(seen);
    const told = [...mine.filter((i) => !seen(i)), ...others];
    const pick = (list, isOwn) => list
      .map((i) => ({ i, s: always(i) && isOwn ? Infinity : score(i, isOwn) }))
      .filter((x) => x.s >= FLOOR)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.i);

    let used = 0;
    let omitted = 0;
    const fits = (line) => {
      if (used + line.length + 1 > limit) { omitted += 1; return false; }
      used += line.length + 1;
      return true;
    };

    const byKind = {};
    for (const i of pick(own, true)) {
      if (!fits(`- ${i.text}`)) continue;
      this.hot.set(i.id, seq);
      (byKind[i.kind] ??= []).push(`- ${i.text}`);
    }
    const order = ['решение', 'ограничение', 'урок', 'находка', 'допущение', 'вопрос'];
    const sections = order
      .filter((k) => byKind[k]?.length)
      .map((k) => `${k.toUpperCase()}:\n${byKind[k].join('\n')}`);

    const heard = [];
    for (const i of pick(told, false)) {
      const where = i.where && i.where !== room ? `(${i.where}) ` : '';
      const line = `- ${where}${i.text}`;
      if (!fits(line)) continue;
      this.hot.set(i.id, seq);
      heard.push(line);
    }

    const parts = [];
    if (sections.length) parts.push(`ПРИ ТЕБЕ\n${sections.join('\n\n')}`);
    if (heard.length) parts.push(`СО СЛОВ — ТЕБЯ ПРИ ЭТОМ НЕ БЫЛО\n${heard.join('\n')}`);
    const tailLine = omitted ? `\n\n…ещё ${omitted} не подошли к этому разговору` : '';
    return { text: parts.join('\n\n') + tailLine, told: heard.length > 0 };
  }
}
