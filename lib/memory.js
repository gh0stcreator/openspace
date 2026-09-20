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
};

export class Memory {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = new Map(); // room -> { items, mtimeMs }
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
   * Применить подтверждённые изменения. Запись не редактируется на месте:
   * новая версия заменяет старую и ссылается на неё, чтобы история осталась.
   *
   * Два висящих предложения могут целиться в одну и ту же запись: первый клик её уже
   * заменил или отменил, второй застаёт чужой diff устаревшим. Тихо применить второй —
   * значит держать в памяти две живые версии одного решения, которые спорят друг с другом
   * в промпте каждого участника. Вместо этого 'заменить'/'отменить' требуют, чтобы old
   * всё ещё был 'живым' — иначе изменение уходит в conflicts, а не применяется.
   */
  commit(room, changes, author) {
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

  /** Память для промпта участника: коротко, по разделам, только живое.
   * Потолок — на выдачу, не на приём: запись в память принимается всегда (commit() её
   * не отклоняет), а здесь при переполнении режем с хвоста по порядку видов и говорим,
   * сколько не вошло — тихого разрастания промпта быть не должно. */
  brief(room, limit = 8000) {
    const items = this.active(room);
    if (!items.length) return '';
    const byKind = {};
    for (const i of items) (byKind[i.kind] ??= []).push(i);

    const order = ['решение', 'ограничение', 'находка', 'допущение', 'вопрос'];
    let used = 0;
    let omitted = 0;
    const sections = [];
    for (const k of order) {
      const list = byKind[k];
      if (!list?.length) continue;
      const lines = [];
      for (const i of list) {
        const line = `- ${i.text}`;
        if (used + line.length + 1 > limit) { omitted++; continue; }
        lines.push(line);
        used += line.length + 1;
      }
      if (lines.length) sections.push(`${k.toUpperCase()}:\n${lines.join('\n')}`);
    }
    const tail = omitted ? `\n\n…ещё ${omitted} не вошли` : '';
    return sections.join('\n\n') + tail;
  }
}
