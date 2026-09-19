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
    this.cache = new Map();
  }

  file(room) {
    return path.join(this.dir, `${room.replace(/[^\w\-Ѐ-ӿ]/g, '_')}.json`);
  }

  load(room) {
    if (this.cache.has(room)) return this.cache.get(room);
    const f = this.file(room);
    let items = [];
    if (fs.existsSync(f)) {
      try { items = JSON.parse(fs.readFileSync(f, 'utf8')).items ?? []; } catch { items = []; }
    }
    this.cache.set(room, items);
    return items;
  }

  save(room) {
    const items = this.load(room);
    fs.writeFileSync(this.file(room), JSON.stringify({ items }, null, 2) + '\n');
    return items;
  }

  /** Живые записи: то, что не отменено и не заменено более новой формулировкой. */
  active(room) {
    return this.load(room).filter((i) => i.status === 'живое');
  }

  /**
   * Применить подтверждённые изменения. Запись не редактируется на месте:
   * новая версия заменяет старую и ссылается на неё, чтобы история осталась.
   */
  commit(room, changes, author) {
    const items = this.load(room);
    const now = new Date().toISOString();
    const applied = [];

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
        if (!old) continue;
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
        if (!old) continue;
        old.status = 'отменено';
        old.supersededAt = now;
        applied.push(old);
      }
    }

    this.save(room);
    return applied;
  }

  /** Память для промпта участника: коротко, по разделам, только живое. */
  brief(room) {
    const items = this.active(room);
    if (!items.length) return '';
    const byKind = {};
    for (const i of items) (byKind[i.kind] ??= []).push(i);

    const order = ['решение', 'ограничение', 'находка', 'допущение', 'вопрос'];
    return order
      .filter((k) => byKind[k]?.length)
      .map((k) => `${k.toUpperCase()}:\n${byKind[k].map((i) => `- ${i.text}`).join('\n')}`)
      .join('\n\n');
  }
}
