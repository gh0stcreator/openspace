import fs from 'node:fs';
import path from 'node:path';

/**
 * Состояние комнаты на диске: режим, шаг, пауза, кто что прочитал и сессии движков.
 *
 * Лента и так лежит файлом, а вот всё остальное жило только в памяти процесса: после
 * перезапуска идущая стратсессия исчезала на середине, а участники теряли свои сессии
 * и начинали разговор заново. Здесь ровно то, без чего комнату нельзя поднять такой же.
 */
const safeName = (room) => String(room).replace(/[^\w\-Ѐ-ӿ]/g, '_');

export const stateFile = (dir, room) => path.join(dir, `${safeName(room)}.state.json`);

export function readState(dir, room) {
  const f = stateFile(dir, room);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    // Битый файл состояния — не повод не открыть комнату: лента важнее.
    return null;
  }
}

export function writeState(dir, room, data) {
  fs.mkdirSync(dir, { recursive: true });
  const f = stateFile(dir, room);
  // Пишем через временный файл: прерванная запись не должна оставить огрызок JSON.
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, f);
}

export function dropState(dir, room) {
  const f = stateFile(dir, room);
  if (fs.existsSync(f)) fs.rmSync(f);
}
