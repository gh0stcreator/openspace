import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  // Имя человека: и в профиле, и в обращениях. Одно, чтобы не расходилось.
  // Имя человека до того, как он его сменит. Подставлять логин системы или имя из git
  // технически можно, но безымянный «Meatbag» сам просит себя переименовать — и это
  // единственная шутка, уместная в комнате, где человек один среди машин.
  user: 'Meatbag',
  // Аватарка человека. Цвет пустой — значит нейтральная, как было до выбора.
  userColor: '',
  userIcon: 'user',
  // Общая цель разговора: её видят все участники. Пусто — каждый работает только по своей роли.
  laws: '',
  // Комната по умолчанию — её открывает интерфейс, если в адресе ничего не указано.
  defaultRoom: 'опенспейс',
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
  // Сколько токенов контекста участник носит с собой, прежде чем его сессия начнётся заново.
  // Движок продолжает сессию, и с каждым ходом она тяжелее: за день выходило с 75 до 450 тысяч
  // токенов на вызов, а читать их приходится и ради реплики в три слова. Ниже ~100 тысяч ставить
  // незачем: около 70 занимает сам движок с инструментами и каноном проекта. 0 — не сбрасывать.
  rotateAt: 150000,
  agents: {
    инженер:   { kind: 'claude', role: 'инженер',   color: 'yellow', lean: true, settingSources: 'project', timeoutMs: 300000 },
    скептик:   { kind: 'codex',  role: 'скептик',   color: 'black',   lean: true, reasoningEffort: 'low',    timeoutMs: 300000 },
    креатор:   { kind: 'claude', role: 'креатор',   color: 'green', lean: true, settingSources: 'project', timeoutMs: 300000 },
    дизайнер:     { kind: 'claude', role: 'дизайнер',     color: 'red', lean: true, settingSources: 'project', timeoutMs: 300000 },
    академик:  { kind: 'codex',  role: 'академик',  color: 'white',   lean: true, reasoningEffort: 'low',    timeoutMs: 300000 },
    продюсер:  { kind: 'claude', role: 'продюсер',  color: 'blue',   lean: true, settingSources: 'project', timeoutMs: 300000 },
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
  // Поле звалось «цель», а держало в себе не задачу, а то, что верно всегда. Имя
  // поправлено, значение со старых машин переносим молча.
  if (!cfg.laws && onDisk.goal) cfg.laws = onDisk.goal;
  delete cfg.goal;
  cfg.workdir = path.resolve(root, cfg.workdir);
  return cfg;
}
