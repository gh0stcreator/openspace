import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Имя человека при первом запуске. Спрашивать его отдельным экраном не за чем: имя уже
 * есть в системе. Порядок — от самого человеческого к самому техническому.
 */
function guessUser() {
  try {
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (name) return name.slice(0, 40);
  } catch { /* гита нет или имя не настроено */ }
  try {
    const login = os.userInfo().username;
    // Логин вида «rpopov» — не имя, но лучше безличного «Человек»: его видно и можно исправить.
    if (login) return login.slice(0, 40);
  } catch { /* бывает в контейнерах без записи в passwd */ }
  return 'Человек';
}

export const DEFAULTS = {
  // Имя человека: и в профиле, и в обращениях. Одно, чтобы не расходилось.
  user: guessUser(),
  // Аватарка человека. Цвет пустой — значит нейтральная, как было до выбора.
  userColor: '',
  userIcon: 'user',
  // Общая цель разговора: её видят все участники. Пусто — каждый работает только по своей роли.
  goal: '',
  // Комната по умолчанию — её открывает интерфейс, если в адресе ничего не указано.
  defaultRoom: 'общая',
  port: 4477,
  // Папка, в которой участники читают и правят файлы. По умолчанию сам репозиторий, а не
  // папка над ним: у участников право на запись, и вся ~/Documents им ни к чему.
  workdir: '.',
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
