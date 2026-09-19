import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  // Имя человека: и в профиле, и в обращениях. Одно, чтобы не расходилось.
  user: 'Roman',
  // Цвет аватарки человека; у участников он свой в agents[].color.
  userColor: 'creator',
  // Общая цель разговора: её видят все участники. Пусто — каждый работает только по своей роли.
  goal: '',
  // Комната по умолчанию — её открывает интерфейс, если в адресе ничего не указано.
  defaultRoom: 'общая',
  port: 4477,
  // Общая папка, в которой оба агента читают и правят файлы.
  workdir: '..',
  // Сколько реплик агенты могут сделать подряд, ни разу не спросив человека.
  maxAutoTurns: 12,
  // Сколько последних сообщений видит участник, впервые позванный в идущий разговор.
  catchUp: 25,
  // Могут ли участники продолжать разговор между собой, никого не называя.
  freeTalk: true,
  agents: {
    инженер:   { kind: 'claude', role: 'инженер',   color: 'yellow', trust: 'safe', lean: true, settingSources: 'project', timeoutMs: 300000 },
    скептик:   { kind: 'codex',  role: 'скептик',   color: 'black',   trust: 'safe', lean: true, reasoningEffort: 'low',    timeoutMs: 300000 },
    креатор:   { kind: 'claude', role: 'креатор',   color: 'green', trust: 'safe', lean: true, settingSources: 'project', timeoutMs: 300000 },
    эстет:     { kind: 'claude', role: 'эстет',     color: 'red', trust: 'safe', lean: true, settingSources: 'project', timeoutMs: 300000 },
    академик:  { kind: 'codex',  role: 'академик',  color: 'white',   trust: 'safe', lean: true, reasoningEffort: 'low',    timeoutMs: 300000 },
    продюсер:  { kind: 'claude', role: 'продюсер',  color: 'blue',   trust: 'safe', lean: true, settingSources: 'project', timeoutMs: 300000 },
  },
};

export function loadConfig(root, overrides = {}) {
  const file = path.join(root, 'openspace.config.json');
  let onDisk = {};
  if (fs.existsSync(file)) {
    onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + '\n');
  }

  const cfg = {
    ...DEFAULTS,
    ...onDisk,
    ...overrides,
    // Состав берём с диска как есть: участник, которого убрали или переименовали,
    // не должен возвращаться из значений по умолчанию при следующем запуске.
    agents: onDisk.agents ?? DEFAULTS.agents,
  };
  cfg.workdir = path.resolve(root, cfg.workdir);
  return cfg;
}
