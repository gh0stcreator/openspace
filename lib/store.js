import fs from 'node:fs';
import path from 'node:path';

/**
 * Append-only лента сообщений, по файлу на комнату.
 * Писать имеет право только серверный процесс, поэтому гонок нет:
 * очередь запросов сериализует HTTP-цикл, а не файловый лок.
 */
export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.rooms = new Map();
    this.listeners = new Set();
  }

  file(room) {
    return path.join(this.dir, `${room.replace(/[^\w\-\u0400-\u04FF]/g, '_')}.jsonl`);
  }

  load(room) {
    if (this.rooms.has(room)) return this.rooms.get(room);
    const messages = [];
    const f = this.file(room);
    if (fs.existsSync(f)) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          messages.push(m);
          if (m.kind === 'edit') this.applyEdit(messages, m);
          if (m.kind === 'memory-resolved') this.applyResolve(messages, m);
        } catch { /* битая строка — пропускаем */ }
      }
    }
    this.rooms.set(room, messages);
    return messages;
  }

  append(room, msg) {
    const messages = this.load(room);
    const full = {
      seq: messages.length + 1,
      id: `${room}:${messages.length + 1}`,
      room,
      ts: Date.now(),
      kind: 'message',
      mentions: [],
      ...msg,
    };
    messages.push(full);
    if (full.kind === 'edit') this.applyEdit(messages, full);
    if (full.kind === 'memory-resolved') this.applyResolve(messages, full);
    fs.appendFileSync(this.file(room), JSON.stringify(full) + '\n');
    for (const fn of this.listeners) {
      try { fn(full); } catch (e) { console.error('listener failed:', e.message); }
    }
    return full;
  }

  /**
   * Правка реплики. Файл остаётся append-only: исходная строка на месте, правка ложится
   * следом отдельным событием и применяется при чтении. Так видно, что было сказано сначала,
   * а участник, читавший старый текст, узнаёт о правке из своей дельты.
   */
  edit(room, seq, text, extra = {}) {
    const target = this.load(room).find((m) => m.seq === seq && m.kind === 'message');
    if (!target) throw new Error('такой реплики нет');
    return this.append(room, { kind: 'edit', from: target.from, target: seq, was: target.text, text, ...extra });
  }

  applyEdit(messages, edit) {
    const target = messages.find((m) => m.seq === edit.target);
    if (!target) return;
    target.text = edit.text;
    target.edited = edit.ts;
    if (edit.mentions) target.mentions = edit.mentions;
  }

  /**
   * Решение по предложению памяти. Файл остаётся append-only: предложение — на месте,
   * решение ложится следом и применяется при чтении — тот же приём, что у applyEdit.
   */
  resolveMemory(room, seq, status) {
    const target = this.load(room).find((m) => m.seq === seq && m.kind === 'memory-proposal');
    if (!target) throw new Error('такого предложения памяти нет');
    if (target.status && target.status !== 'ожидает') throw new Error('предложение уже решено');
    return this.append(room, { kind: 'memory-resolved', target: seq, status });
  }

  applyResolve(messages, event) {
    const target = messages.find((m) => m.seq === event.target);
    if (!target) return;
    target.status = event.status;
  }

  since(room, seq) {
    return this.load(room).filter((m) => m.seq > seq);
  }

  tail(room, n) {
    const messages = this.load(room);
    return messages.slice(Math.max(0, messages.length - n));
  }

  /** Очистить ленту. Файл не удаляем, а отводим в сторону: история — не то, что стоит терять молча. */
  clear(room) {
    const f = this.file(room);
    if (fs.existsSync(f)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(f, f.replace(/\.jsonl$/, `.${stamp}.jsonl`));
    }
    this.rooms.set(room, []);
  }

  listRooms() {
    const onDisk = fs.existsSync(this.dir)
      ? fs.readdirSync(this.dir).filter((f) => f.endsWith('.jsonl') && !/\.\d{4}-\d{2}-\d{2}T/.test(f))
      .map((f) => f.slice(0, -6))
      : [];
    return [...new Set([...onDisk, ...this.rooms.keys()])].sort();
  }

  onMessage(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
