import fs from 'node:fs';
import path from 'node:path';
import { buildAgent } from './agents.js';
import { dropState, readState, writeState } from './state.js';
import { parseMentions, resolveTargets } from './mentions.js';
import { roleOf } from './roles.js';
import { BUILTIN, listModes, loadMode, modeOfName, sideOf, stepTargets } from './modes.js';
import { Memory, KINDS } from './memory.js';
import * as rounds from './rounds.js';
import { skillsOf } from './skills.js';
import { loadArchetype } from './archetypes.js';
import { DEFAULTS } from './config.js';

const SKIP = /^\[skip\]$/i;

/**
 * Ведущий начинает режим заново. Границу слова здесь считаем сами: `\b` в JS знает
 * только латиницу, и «Заново — новый предмет» ей не граница — маркер молча не срабатывал,
 * а спор доходил до приговора по тезису, который человек уже отменил.
 */
const RESTART = /^\s*заново(?![\p{L}\p{N}])/iu;

/** Сказал ли ведущий «заново». Отдельной функцией — потому что это проверяется тестом. */
export const saysRestart = (text) => RESTART.test(String(text ?? ''));

/**
 * Лимит подписки. Движок отвечает этим мгновенно и бесплатно, но оркестратор продолжал
 * раздавать ходы — за один вечер вышло двадцать шесть одинаковых ошибок подряд, а человек
 * спрашивал «ну как?» у команды, которой не было. Подписка у движка одна на всех, кто сидит
 * на той же модели, поэтому упёрся один — не зовём всю группу.
 */
const LIMIT = /(hit your|reached your|usage|rate)[^.]{0,40}limit/i;

/** Сказал ли движок, что упёрся в лимит. Отдельной функцией — потому что проверяется тестом. */
export const saysLimit = (text) => LIMIT.test(String(text ?? ''));

// Когда лимит вернётся, движок пишет словами и в своём поясе — разбирать это ненадёжно.
// Поэтому просто не зовём четверть часа и пробуем снова: отказ по лимиту ничего не стоит.
const LIMIT_COOLDOWN_MS = 15 * 60_000;

/**
 * Сколько контекста участник несёт в сессии: вход одного вызова модели. Движок отдаёт сумму
 * по всем вызовам агентного цикла внутри хода, поэтому делим на их число — иначе ход
 * с десятью чтениями файлов выглядел бы вдесятеро тяжелее, чем сессия есть на самом деле.
 */
export const weigh = (meta) => {
  const input = meta?.usage?.input_tokens ?? 0;
  return input ? Math.round(input / Math.max(1, meta?.turns ?? 1)) : 0;
};

// Хвост ленты, с которым участник начинает новую сессию, ограничен и по знакам: двадцать пять
// реплик — это и двадцать пять строк, и три статьи по тридцать тысяч знаков, вставленные
// в ленту целиком. Второе вернуло бы сессию к порогу первым же ходом.
const TAIL_CHARS = 40_000;

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

const MEMORY_KINDS = new Set(Object.keys(KINDS));

// Сколько реплик свободного разговора копится до свёртки. Свёртка — отдельный вызов
// движка, поэтому запускать её на каждой паузе дорого, а не запускать вовсе — значит
// терять всё, что в разговоре поняли.
const FOLD_AFTER = 40;

/**
 * Свёртка не лезет в живой разговор: её запускает тишина, а не счётчик реплик. Раньше
 * условием было «ход некому передать», а это случается после каждой второй реплики —
 * и человек получал карточку памяти каждые пять минут посреди работы, да ещё одну
 * на каждый перезапуск сервера. Карточка — это решение, которое человек должен принять
 * кликом; такие не показывают посреди чужого хода.
 *
 * Полчаса тишины и сорок реплик — это про вечер работы, а не про перекур. Десяти минут
 * и двадцати реплик оказалось мало: человек отходил за чаем и возвращался к карточке.
 */
const FOLD_IDLE_MS = 30 * 60_000;

// Сколько реплик копится, прежде чем Сборщику есть смысл заходить. Меньше — он ходит
// впустую и стоит как участник, больше — работа расползается по ленте кусками.
const ASSEMBLE_AFTER = 12;
const MEMORY_ACTIONS = new Set(['добавить', 'заменить', 'отменить']);

/**
 * Разобрать ответ архивариуса. Он не участник беседы — читает его код, не человек,
 * поэтому текст вне ```json``` не годится ни на что, кроме мусора. null — модель ответила
 * не json-ом, это ошибка вызова, а не «нечего менять»: то возвращается пустым массивом.
 */
function parseArchiveDiff(text) {
  const fenced = String(text ?? '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text ?? '').trim();
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(parsed)) return null;

  return parsed
    .filter((ch) => MEMORY_ACTIONS.has(ch?.action))
    .filter((ch) => ch.action !== 'добавить' || MEMORY_KINDS.has(ch.kind))
    .filter((ch) => (ch.action === 'добавить' || !!ch.id))
    .map((ch) => ({
      action: ch.action,
      kind: MEMORY_KINDS.has(ch.kind) ? ch.kind : undefined,
      text: String(ch.text ?? '').trim().slice(0, 600),
      id: ch.id ? String(ch.id) : undefined,
    }))
    .filter((ch) => ch.action === 'отменить' || ch.text);
}

/**
 * Событийный цикл: сообщение с тегом будит адресата, его ответ будит следующего.
 * Агент никогда не опрашивает ленту сам — его вызывают, и только на дельту.
 */
export class Orchestrator {
  constructor({ store, config, log = console, build = buildAgent, stateDir = null }) {
    this.store = store;
    this.config = config;
    this.log = log;
    // Фабрика адаптеров — параметром: тесты подставляют заглушки вместо claude и codex.
    this.build = build;
    // Куда класть состояние комнат. Пусто — держим только в памяти (так делают тесты).
    this.stateDir = stateDir;
    // Память пространства живёт в той же папке, что состояние комнат — своим файлом на комнату.
    this.memory = stateDir ? new Memory(stateDir) : null;
    this.agents = new Map();
    this.syncAgents();
    this.rooms = new Map(); // room -> { autoTurns, paused, mode, step, jobs, running }
    this.saving = new Map(); // room -> таймер отложенной записи
  }

  /**
   * Отложенная запись состояния: за один ход оно меняется несколько раз,
   * а на диск должно лечь один.
   */
  save(room) {
    if (!this.stateDir) return;
    clearTimeout(this.saving.get(room));
    this.saving.set(room, setTimeout(() => this.flush(room), 200));
  }

  flush(room) {
    if (!this.stateDir) return;
    clearTimeout(this.saving.get(room));
    this.saving.delete(room);
    const st = this.state(room);
    const seen = {};
    const sessions = {};
    const weights = {};
    for (const [name, agent] of this.agents) {
      const at = agent.lastSeen.get(room);
      if (at !== undefined) seen[name] = at;
      const w = agent.weight?.get(room);
      if (w) weights[name] = w;
      const sid = agent.impl.session?.(room);
      if (sid) sessions[name] = sid;
    }
    try {
      writeState(this.stateDir, room, {
        mode: st.mode, step: st.step, run: st.run, pending: st.pending,
        upto: st.upto, paused: st.paused, autoTurns: st.autoTurns, closed: st.closed, epoch: st.epoch,
        off: st.off, offBefore: st.offBefore, archiveUpto: st.archiveUpto,
        topic: st.topic, doing: st.doing, topicAt: st.topicAt, doingAt: st.doingAt, seen, sessions,
        // Вес сессий: без него после перезапуска первый ход каждого участника снова идёт
        // на полном контексте — порог узнаётся только из ответа движка.
        weights,
      });
    } catch (e) {
      this.log.error(e);
    }
  }

  /**
   * Очередь на комнату, а не одна на всех: медленный участник в одной комнате
   * не должен держать остальные. Задача — функция, возвращающая обещание.
   */
  enqueue(room, job) {
    const st = this.state(room);
    st.jobs.push(job);
    this.drain(room);
  }

  async drain(room) {
    const st = this.state(room);
    if (st.running) return;
    st.running = true;
    try {
      while (st.jobs.length) {
        const job = st.jobs.shift();
        try { await job(); } catch (e) { this.log.error(e); }
      }
    } finally {
      st.running = false;
    }
  }

  /**
   * Снять то, что ещё не началось. Человек написал — значит всё, что стояло
   * в очереди, отвечает на позавчерашнее состояние разговора. Начатый ход
   * не трогаем: он уже оплачен и договорит.
   */
  dropPending(room) {
    this.state(room).jobs.length = 0;
  }

  get names() { return [...this.agents.keys()]; }

  /**
   * Кого тема задела сильнее прочих. Роль объявляет свою зону интереса полями `on` и `off`:
   * по словам из `on` участник вступает сам, без обращения, а слово из `off` его удерживает —
   * Дизайнеру нечего сказать про деплой, даже если там мелькнуло слово «выглядит».
   *
   * Совпадение считаем по целому слову: `код` не должен срабатывать на «кодекс». Границу
   * пишем руками, потому что \b в JS знает только латиницу и на кириллице врёт.
   */
  /**
   * Кого задела тема. Считаем совпадения со словами зоны интереса роли (`on` в файле роли),
   * зона `off` — вето: Академик про отступы не говорит, даже если рядом стоит «проверить».
   * Возвращает имена по убыванию счёта — первым тот, кого тема задела сильнее всех.
   */
  /** Слово из зоны `off` роли: участнику в этом разговоре нечего сказать. */
  mutes(name, text) {
    const t = String(text ?? '');
    return roleOf(this.roster[name]).off.some((w) => {
      const safe = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^\\p{L}\\p{N}])${safe}($|[^\\p{L}\\p{N}])`, 'iu').test(t);
    });
  }

  drawn(room, text, already = [], limit = 2) {
    const t = String(text ?? '');
    // Порог растёт с длиной: в коротком вопросе одно слово из зоны — это и есть тема,
    // а в статье на три экрана случайное «выглядит» найдётся всегда, и по нему
    // отвечать бросался Дизайнер. Чем длиннее текст, тем больше попаданий нужно.
    const need = 1 + Math.floor(t.length / 1200);
    const hit = (word) => {
      const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^\\p{L}\\p{N}])${safe}($|[^\\p{L}\\p{N}])`, 'iu').test(t);
    };
    const scored = [];
    for (const name of this.here(room)) {
      if (already.includes(name)) continue;
      const role = roleOf(this.roster[name]);
      if (role.off.some(hit)) continue;
      const score = role.on.filter(hit).length;
      if (score >= need) scored.push({ name, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.name);
  }

  /** Кто участвует в этой комнате: состав минус выключенные и теневой найм.
   * Архивариуса не зовут в разговор — ни тегом мимо цели, ни как дежурного, ни по теме:
   * его работа — свёртка по вызову оркестратора, не ответ собеседнику. */
  here(room) {
    const st = this.state(room);
    return this.names.filter((n) => !st.off.includes(n)
      && !this.limited(n)
      && (this.roster[n]?.role ?? '').toLowerCase() !== 'архивариус'
      // Участник, привязанный к режиму, вне его не существует: не отвечает, не занимает
      // место в составе и не светится в списках. Включается вместе с режимом.
      && this.own(n, st.mode));
  }

  /** До какого мгновения участника не зовём: он упёрся в лимит подписки. 0 — зовём. */
  limited(name) {
    const until = this.agents.get(name)?.limitedUntil ?? 0;
    return until > Date.now() ? until : 0;
  }

  /**
   * Участник упёрся в лимит — вместе с ним отходят все, кто сидит на том же движке
   * и той же модели: лимит у них общий, и каждый следующий принёс бы ту же ошибку.
   */
  limit(name) {
    const cfg = this.roster[name] ?? {};
    const until = Date.now() + (this.config.limitCooldownMs ?? LIMIT_COOLDOWN_MS);
    const same = (a) => (a.kind ?? '') === (cfg.kind ?? '') && (a.model ?? '') === (cfg.model ?? '');
    const hit = [];
    for (const [n, agent] of this.agents) {
      if (n !== name && !same(agent.cfg)) continue;
      agent.limitedUntil = until;
      hit.push(n);
    }
    return { until, names: hit };
  }

  /** Начать сессию участника в комнате заново: вместе с ней уходит и её вес. */
  forget(name, room) {
    const agent = this.agents.get(name);
    if (!agent) return;
    agent.impl.reset(room);
    agent.weight?.delete(room);
  }

  /**
   * С чем участник начинает новую сессию: хвост ленты подряд, вместе с его собственными
   * репликами — прежняя сессия помнила их сама, новая узнаёт только отсюда. Всё, что старше,
   * приходит памятью пространства в системном промпте. Барьер шага вслепую действует и здесь.
   */
  tailFor(room, upto) {
    let tail = this.store.load(room).filter((m) => m.kind === 'message' || m.kind === 'mode');
    if (upto) tail = tail.filter((m) => m.seq <= upto);
    tail = tail.slice(-this.config.catchUp);
    let chars = tail.reduce((n, m) => n + String(m.text ?? '').length, 0);
    // Режем с головы, но пять последних реплик оставляем при любом размере: это и есть
    // то, на что участнику сейчас отвечать.
    while (tail.length > 5 && chars > TAIL_CHARS) chars -= String(tail.shift().text ?? '').length;
    return tail;
  }

  /** Свой ли режим у этого участника: не привязан ни к какому — свой всегда. */
  own(name, mode) {
    const his = modeOfName(name);
    return !his || his === mode;
  }

  /**
   * Файл из рабочей папки как вложение к реплике. Путь относительный и наружу из папки
   * не выпускается: реплика участника — это команда, и она не должна уметь приложить
   * к разговору что угодно с диска.
   */
  attach(rel) {
    const base = path.resolve(this.config.workdir ?? '.');
    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep)) return null;
    let stat;
    try { stat = fs.statSync(file); } catch { return null; }
    if (!stat.isFile()) return null;
    const from = path.relative(base, file);
    return {
      name: path.basename(file),
      size: stat.size,
      url: `/workdir/${from.split(path.sep).map(encodeURIComponent).join('/')}`,
      path: from,
    };
  }

  /**
   * Кого можно разбудить в свободном разговоре. Ведущий сюда не входит: его работа —
   * устройство разговора, а не участие в нём, и за день это дало 63 реплики, из которых
   * 45 были «подтверди». В режимах его зовут шаги, в разговоре — только тег.
   */
  talkers(room) {
    return this.here(room).filter((n) => roleOf(this.roster[n]).chats);
  }

  /**
   * Кто уже передал ход человеку и ответа не получил. Такой участник повторяться не должен:
   * его последняя реплика адресована человеку, а человек с тех пор ничего не писал.
   * Тег от собеседника его будит — значит к нему обратились по делу, а не он сам себя.
   */
  awaiting(room) {
    const out = new Set();
    const user = this.config.user;
    for (const m of this.store.load(room)) {
      if (m.kind !== 'message') continue;
      // Человек заговорил — ожидание снято со всех разом: ответ пришёл в комнату.
      if (m.from === user) out.clear();
      else if ((m.mentions ?? []).includes(user)) out.add(m.from);
      else out.delete(m.from);
    }
    return [...out];
  }

  /**
   * Кого дольше всех не было слышно. Дежурный, назначенный ролью, отвечает на всё подряд
   * независимо от темы: сначала так вёл себя Продюсер, потом Скептик — за час тринадцать
   * реплик из пятидесяти, пока Креатор и Дизайнер молчали. По Woolley равенство реплик
   * предсказывает результат группы лучше, чем чей-либо интеллект, поэтому очередь
   * достаётся тому, кто говорил меньше всех в последних репликах ленты.
   */
  quietest(room, pool) {
    const here = pool.filter((n) => this.agents.has(n));
    if (here.length < 2) return here;
    const tail = this.store.load(room).filter((m) => m.kind === 'message').slice(-30);
    const said = new Map(here.map((n) => [n, 0]));
    const last = new Map(here.map((n) => [n, -1]));
    tail.forEach((m, i) => {
      if (!said.has(m.from)) return;
      said.set(m.from, said.get(m.from) + 1);
      last.set(m.from, i);
    });
    return [here.slice().sort((a, b) => said.get(a) - said.get(b) || last.get(a) - last.get(b))[0]];
  }

  /** Включить или выключить участника в комнате. */
  toggle(room, name, on) {
    const st = this.state(room);
    if (!this.agents.has(name)) throw new Error(`в пространстве нет @${name}`);
    st.off = on ? st.off.filter((n) => n !== name) : [...new Set([...st.off, name])];
    this.save(room);
    return this.here(room);
  }
  get roster() {
    return Object.fromEntries([...this.agents].map(([n, a]) => [n, a.cfg]));
  }

  state(room) {
    if (!this.rooms.has(room)) {
      const kept = this.stateDir ? readState(this.stateDir, room) : null;
      this.rooms.set(room, {
        autoTurns: kept?.autoTurns ?? 0,
        // Ход уже вернули человеку: второй раз подряд возвращать нечего.
        closed: kept?.closed ?? false,
        paused: kept?.paused ?? false,
        jobs: [],
        running: false,
        // Номер поколения ленты: растёт на очистке. Ответ, посчитанный до неё,
        // отвечает разговору, которого больше нет, и в новую ленту не попадает.
        epoch: kept?.epoch ?? 0,
        // Режим: имя, шаг, номер запуска, кто на шаге ещё не ответил и отметка барьера.
        mode: kept?.mode ?? null,
        step: kept?.step ?? 0,
        run: kept?.run ?? 0,
        pending: kept?.pending ?? [],
        upto: kept?.upto ?? 0,
        // На каком шаге ведущий уже отвечал человеку вне очереди. Живёт только пока
        // идёт шаг, поэтому на диск не едет: перезапуск стоит одной лишней реплики.
        asideOn: '',
        // Кого в этой комнате выключили. Участник остаётся в составе — он просто
        // не отвечает и не показывается здесь, а в других комнатах работает как был.
        off: kept?.off ?? [],
        // Состав до режима: его возвращает выход из режима.
        offBefore: kept?.offBefore ?? null,
        // Курсор свёртки памяти: свой, не agent.lastSeen — непустой diff не решён до клика
        // человека, а lastSeen на архивных ходах вообще не обновляется.
        archiveUpto: kept?.archiveUpto ?? 0,
        // Метка темы в знаке: одно слово о том, чем комната занята. Меняется не по счётчику
        // реплик, а когда разговор действительно ушёл в другое.
        topic: kept?.topic ?? '',
        // Чем заняты: левая половина знака вне режима. В режиме её держит сам режим.
        doing: kept?.doing ?? '',
        // На какой реплике действие сменилось в прошлый раз — отсюда считается выдержка.
        doingAt: kept?.doingAt ?? 0,
        // Отложенная свёртка: её сдвигает каждая новая реплика. Живёт в процессе,
        // на диск не едет — после перезапуска срок отсчитывается заново.
        foldTimer: null,
        topicAt: kept?.topicAt ?? 0,
      });
      // Участники возвращают себе прочитанное и свои сессии: иначе после перезапуска
      // они читают ленту заново и отвечают уже отвеченное.
      for (const [name, agent] of this.agents) {
        if (kept?.seen?.[name] !== undefined) agent.lastSeen.set(room, kept.seen[name]);
        if (kept?.sessions?.[name]) agent.impl.adopt?.(room, kept.sessions[name]);
        if (kept?.weights?.[name]) agent.weight?.set(room, kept.weights[name]);
      }
    }
    return this.rooms.get(room);
  }

  /** Состояние комнаты для интерфейса. Очередь и номера запусков наружу не отдаём. */
  view(room) {
    const st = this.state(room);
    const { autoTurns, paused } = st;
    // Занята ли комната: кто-то отвечает или стоит в очереди. Без этого по экрану
    // не отличить «сейчас ответят» от «всё, ход за вами» — а это разные вещи,
    // и в свободном разговоре, где никто никого не тегает, других признаков нет.
    const busy = st.running || st.jobs.length > 0 || [...this.agents.values()].some((a) => a.busy);
    const thinking = {};
    for (const [name, a] of this.agents) {
      if (a.busy && a.busyIn === room) thinking[name] = a.busySince ?? Date.now();
    }
    // Кто упёрся в лимит и до какого мгновения: без этого замолчавшая команда выглядит
    // так же, как думающая, и человек ждёт ответа, которого не будет.
    const limited = {};
    for (const name of this.agents.keys()) {
      const until = this.limited(name);
      if (until) limited[name] = until;
    }
    return { autoTurns, paused, busy, thinking, limited, modeState: this.modeState(room) };
  }

  post(room, { from, text, kind = 'message', meta, files, replyTo, side }) {
    // Пока идёт режим с персонами, «@Крош» — такое же обращение, как «@Креатор»:
    // человек зовёт того, кого видит в ленте, а не того, кто записан в составе.
    const alias = this.aliases(room);
    const known = [...this.names, ...alias.keys(), this.config.user];
    const msg = this.store.append(room, {
      from,
      text,
      kind,
      meta,
      files,
      replyTo,
      // Сторона остаётся в самой реплике, а не считается по нынешнему режиму: спор
      // читают и через день, когда режим давно кончился, — и тогда по ленте всё равно
      // должно быть видно, кто был за, кто против и кто судил.
      side,
      mentions: parseMentions(text, known, from === this.config.user)
        .map((n) => alias.get(n) ?? n),
    });
    // Разговор идёт — свёртка отодвигается.
    this.scheduleFold(room);

    if (from === this.config.user) {
      // Человек вмешался: счётчик автоходов обнуляется, пауза снимается, а очередь
      // ходов, собранная до его реплики, отменяется — иначе команда ещё несколько
      // минут отвечает на старое, и человеку кажется, что его не слышат.
      const st = this.state(room);
      const wasPaused = st.paused;
      // Вопрос человека открывает счёт: сколько ходов и токенов уйдёт на то, чтобы
      // вернуть ему ход. Пока счёт открыт, новая его реплика счёт не сбрасывает.
      rounds.open(st, msg.seq, st.mode ?? '');
      st.autoTurns = 0;
      st.paused = false;
      st.closed = false;
      // В режиме очередь — это его шаги: сняв её, мы бы остановили режим навсегда.
      if (!st.mode) this.dropPending(room);
      else if (wasPaused) this.runStep(room, st.run);
    }
    // Метку темы проверяем на реплике человека — он чаще всего и сворачивает разговор
    // в сторону — и на каждом пятнадцатом сообщении: участники умеют уехать в другое
    // и сами, за два часа без единой вашей реплики. Проверка не значит смену: вопрос
    // модели поставлен «та же или нет», и по умолчанию она отвечает «та же».
    if (kind === 'message') {
      const st = this.state(room);
      const far = msg.seq - (st.topicAt ?? 0) >= 15;
      if (from === this.config.user || far) this.retopic(room).catch(() => {});
    }
    if (kind === 'message') this.dispatch(room, msg);
    this.save(room);
    return msg;
  }

  /**
   * Человек поправил свою реплику. Правка никого не будит: опечатка не повод для нового хода.
   * Кто успел прочесть старый текст, получит её вместе со следующей дельтой.
   */
  edit(room, seq, text) {
    const target = this.store.load(room).find((m) => m.seq === seq);
    if (target?.from !== this.config.user) throw new Error('править можно только свою реплику');
    const known = [...this.names, this.config.user];
    return this.store.edit(room, seq, text, { mentions: parseMentions(text, known, true) });
  }

  /**
   * Человек подтвердил предложение архивариуса: применяем diff к памяти пространства
   * и отмечаем предложение решённым. Без confirmMemory diff остаётся только текстом
   * в ленте — commit() в память его сам не кладёт.
   */
  confirmMemory(room, seq) {
    if (!this.memory) throw new Error('память не подключена');
    const msg = this.store.load(room).find((m) => m.seq === seq && m.kind === 'memory-proposal');
    if (!msg) throw new Error('такого предложения нет');
    // Проверка статуса — до commit(), не после: resolveMemory ниже её тоже делает, но к этому
    // моменту второй клик уже применил бы diff второй раз — 'добавить' в commit() ничем
    // не защищено от повтора и тихо родило бы запись-близнеца.
    if (msg.status && msg.status !== 'ожидает') throw new Error('предложение уже решено');
    const { conflicts } = this.memory.commit(room, msg.diff ?? [], msg.from);
    // Другое висящее предложение уже поменяло ту же запись первым: то, что не применилось,
    // не пропадает молча — видно, что именно и почему разошлось со вторым кликом.
    if (conflicts.length) {
      this.store.append(room, {
        from: msg.from,
        kind: 'error',
        text: `${conflicts.length} правк${conflicts.length === 1 ? 'а' : 'и'} в этом предложении устарели `
          + `— запись, на которую они ссылались, уже заменена или отменена другим предложением.`,
        mentions: [],
      });
    }
    // Курсор свёртки продвигаем только теперь — на подтверждении, не на создании предложения:
    // обрыв на неподтверждённом diff не должен терять его навсегда.
    const st = this.state(room);
    if (msg.upto) st.archiveUpto = Math.max(st.archiveUpto ?? 0, msg.upto);
    this.save(room);
    // Часть diff'а устарела (conflicts) — статус так и говорит, а не молчит под одной
    // и той же надписью «принято»: карточка после клика не должна выглядеть одинаково
    // при полном и частичном применении.
    return this.store.resolveMemory(room, seq, conflicts.length ? 'принято частично' : 'принято');
  }

  /**
   * Человек отклонил предложение: курсор свёртки всё равно продвигается — как если бы
   * diff пришёл пустым, только ничего не коммитится. Это «здесь действительно нечего
   * записывать». Второй смысл отказа — «свёртка соврала, пересверни этот же кусок» —
   * требует курсор НЕ двигать, а это отдельное действие; его нет ни здесь, ни в интерфейсе.
   */
  rejectMemory(room, seq) {
    if (!this.memory) throw new Error('память не подключена');
    const msg = this.store.load(room).find((m) => m.seq === seq && m.kind === 'memory-proposal');
    if (!msg) throw new Error('такого предложения нет');
    if (msg.status && msg.status !== 'ожидает') throw new Error('предложение уже решено');
    const st = this.state(room);
    if (msg.upto) st.archiveUpto = Math.max(st.archiveUpto ?? 0, msg.upto);
    this.save(room);
    return this.store.resolveMemory(room, seq, 'отклонено');
  }

  /**
   * Запустить режим: участники идут по шагам, а не отвечают вразнобой.
   * Главное здесь — шаг с `hear: нет`: все отвечают на одну и ту же ленту, не видя
   * ответов друг друга. Иначе первый ответивший ставит якорь и остальные его обслуживают.
   */
  startMode(room, name) {
    const mode = loadMode(name);
    const st = this.state(room);
    const faces = this.personas(room);
    // Режим задаёт состав: остаются те, кого зовут его шаги. Считаем по всей команде,
    // а не по нынешнему присутствию, иначе выключенный однажды не вернётся никогда.
    // Что было до режима — помним: выход из него возвращает ваш состав, а не «всех подряд».
    if (!st.mode) st.offBefore = [...st.off];
    st.off = this.names.filter((n) => !this.cast(mode).includes(n));
    // Новый запуск — новый номер. Цепочка прежнего запуска, дожив до конца своего хода,
    // увидит чужой номер и ничего не сдвинет: иначе перезапуск посреди шага глотает шаги.
    st.run += 1;
    st.mode = mode.name;
    st.step = -1;
    st.pending = [];
    st.paused = false;
    st.autoTurns = 0;
    this.dropPending(room);

    // Режим без регламента шагов не двигает: он меняет не порядок ходов, а то, кем
    // участники в нём выходят. Дальше разговор идёт сам, как в открытом.
    // В пустой комнате режим ждёт: шаги нужны разговору о чём-то, а не самим себе.
    // Первая реплика человека и есть тема — она же и запускает первый шаг.
    if (mode.talk) st.step = 0;
    else if (this.store.load(room).some((m) => m.kind === 'message')) this.nextStep(room);
    this.reface(room, faces);
    this.save(room);
    return this.modeState(room);
  }

  stopMode(room) {
    const st = this.state(room);
    const faces = this.personas(room);
    rounds.close(st);
    this.save(room);
    st.run += 1;
    st.mode = null;
    st.step = 0;
    st.pending = [];
    // Возвращаем тот состав, что был до режима. Раньше здесь стоял пустой список —
    // и конец режима включал всех подряд, стирая то, кого человек выключил руками.
    st.off = st.offBefore ? [...st.offBefore] : [];
    st.offBefore = null;
    this.reface(room, faces);
    // Сброшенные сессии — на диск сразу: перезапуск сервера иначе вернёт участникам
    // память, в которой они ещё в чужих именах.
    this.save(room);
    return this.modeState(room);
  }

  /**
   * Расстановка: кто в режиме за что, именами и в одну строку. Режим объявляет стороны
   * ролями — здесь они превращаются в ников этой комнаты, потому что спорят не роли,
   * а @Скептик и @Креатор.
   */
  lineup(room, mode) {
    const here = this.here(room);
    const rows = (mode.sides ?? []).map((side) => {
      const names = here.filter((n) => side.roles.includes((this.roster[n]?.role ?? '').toLowerCase()));
      return names.length ? `${side.label} — ${names.map((n) => `@${n}`).join(', ')}` : '';
    }).filter(Boolean);
    return rows.join('. ');
  }

  /**
   * Переодевание: кто вышел из своего имени или вернулся в него. Сессию таким участникам
   * начинаем заново — иначе Инженер, полдня проживший Пином, продолжает звать @Кроша
   * и после того, как режим выключили: в его сессии те имена, а не эти, и строка
   * в промпте против целого разговора не весит.
   */
  reface(room, before) {
    const after = this.personas(room);
    for (const name of this.names) {
      const was = before?.get(name)?.name ?? '';
      const now = after?.get(name)?.name ?? '';
      if (was === now) continue;
      this.forget(name, room);
      this.agents.get(name)?.lastSeen.set(room, this.store.load(room).at(-1)?.seq ?? 0);
    }
  }

  /**
   * Кем участники выходят в этом режиме: ник → персона. Сторона режима с именем, под которым
   * есть файл амплуа, — это не подпись, а другой человек: имя, знак, цвет и голос. Роль
   * при этом не меняется, иначе от смены имени ломались бы режимы, полюса и домены.
   */
  personas(room) {
    const st = this.state(room);
    if (!st.mode) return null;
    const sides = loadMode(st.mode).sides ?? [];
    if (!sides.length) return null;
    const out = new Map();
    const taken = new Set();
    // Голос берём из файла амплуа с тем же именем. Нет файла — это не персона, а сторона:
    // «Против» — место в споре, а не другой человек.
    const wear = (name, side) => {
      const voice = loadArchetype(side.label)?.voice;
      if (!voice) return;
      taken.add(side.label);
      out.set(name, {
        name: side.label, labelEn: side.labelEn, icon: side.icon, color: side.color, voice,
      });
    };

    // Сначала по нику: участник, которого и зовут Барашем, выходит Барашем, а не тем,
    // кого сторона нашла бы по его роли. Без этого запасной участник на ту же роль
    // получал чужое имя — два дизайнера в комнате выходили одной Нюшей.
    const here = this.here(room);
    for (const name of here) {
      const side = sides.find((x) => x.label.toLowerCase() === name.toLowerCase());
      if (side) wear(name, side);
    }
    // Остальным — по роли, и только те стороны, которые ещё никто не занял по нику.
    for (const name of here) {
      if (out.has(name)) continue;
      const role = (this.roster[name]?.role ?? '').toLowerCase();
      const side = sides.find((x) => !taken.has(x.label) && x.roles.includes(role));
      if (side) wear(name, side);
    }
    return out.size ? out : null;
  }

  /**
   * Имя персонажа — такое же обращение, как ник: человек пишет «@Крош», а не «@Креатор».
   * Возвращает соответствие «как назвали → кого будить».
   */
  aliases(room) {
    const map = new Map();
    for (const [nick, p] of this.personas(room) ?? []) {
      if (p.name && p.name.toLowerCase() !== nick.toLowerCase()) map.set(p.name, nick);
    }
    return map;
  }

  /**
   * Ведущий режима — тот, кто в одиночку говорит на его первом шаге; если шаг зовёт
   * многих, ведёт продюсер. Нужен тому, кому режим не отвёл слова: человеку, который
   * написал посреди шага, отвечает ведущий, а не все подряд.
   */
  host(room) {
    const st = this.state(room);
    if (!st.mode) return null;
    const mode = loadMode(st.mode);
    const first = stepTargets(mode.steps[0], this.here(room), this.roster);
    if (first.length === 1) return first[0];
    return this.here(room).find((n) => (this.roster[n]?.role ?? '').toLowerCase() === 'продюсер') ?? null;
  }

  /**
   * Ход ведущего вне очереди: ответить человеку, который написал посреди шага. Ответ
   * короткий нарочно — это реплика распорядителя, а не ещё одно мнение в споре.
   */
  aside(room, mode, host, step) {
    const st = this.state(room);
    // Весь план режима: без него ведущий сочинял, на каком шаге спросят человека,
    // и отправлял его ждать шага, на котором тот уже стоял.
    const plan = mode.steps
      .map((s, i) => `${i + 1} «${s.name}»${s.until === 'человек' ? ' — здесь ждут человека' : ''}`)
      .join(', ');
    return {
      name: 'вне очереди',
      hear: true,
      aside: true,
      until: 'все ответят',
      // Ведущий и здесь ведущий: его реплика вне очереди — распоряжение, и в ленте
      // она подписана так же, как его слово на шаге.
      side: sideOf(mode, this.roster[host]?.role),
      lineup: this.lineup(room, mode),
      prompt: `Ты ведёшь режим «${mode.title}». Его шаги: ${plan}. Сейчас идёт шаг ${st.step + 1}, `
        + `«${step?.name ?? ''}», и @${this.config.user} написал посреди него. Когда дойдёт очередь `
        + 'до его слова, не придумывай — смотри по этому списку. '
        + 'Ответь ему одной строкой, '
        + 'ничего не пересказывая:\n'
        + '— он про то же, что идёт сейчас, — скажи, на каком мы шаге и когда дойдём до его слова;\n'
        + '— он меняет предмет разговора — начни строку словом «Заново» и назови новый предмет: '
        + 'режим пойдёт с первого шага, и тезис ты сформулируешь там.\n'
        + 'Больше ничего не пиши и никого не зови.',
    };
  }

  /**
   * Начать режим заново — с первого шага. Человек посреди спора сменил предмет: доспорить
   * прежний тезис ему уже незачем, а другого способа переназначить тезис у режима нет.
   */
  restart(room) {
    const st = this.state(room);
    if (!st.mode) return;
    st.run += 1;
    st.step = -1;
    st.pending = [];
    this.dropPending(room);
    this.nextStep(room);
    this.save(room);
  }

  /** Кого зовут шаги режима: состав, который он собой приводит. */
  cast(mode) {
    return [...new Set(mode.steps.flatMap((st) => stepTargets(st, this.names, this.roster)))];
  }

  modeState(room) {
    const st = this.state(room);
    if (!st.mode) return null;
    const mode = loadMode(st.mode);
    const step = mode.steps[st.step];
    return {
      name: mode.name,
      title: mode.title,
      titleEn: mode.titleEn,
      slug: mode.slug,
      short: mode.short,
      shortEn: mode.shortEn,
      step: st.step + 1,
      steps: mode.talk ? 0 : mode.steps.length,
      // У режима без регламента шага нет — и в строке управления ему нечего показывать.
      stepName: mode.talk ? '' : (step?.name ?? ''),
      // Кого шаг зовёт и кого ещё не дождался. Клиенту это нужно, чтобы «ждёт» и «ответил»
      // в шапке были настоящим состоянием оркестрации, а не догадкой по последней реплике.
      // Состав считаем заново, а не храним: он однозначно выводится из шага и присутствия.
      cast: step ? stepTargets(step, this.here(room), this.roster) : [],
      pending: [...st.pending],
      // Кем участники выходят в этом режиме: клиенту это нужно, чтобы имя в ленте,
      // цвет обращения и подсказка «@» показывали одного и того же человека.
      personas: Object.fromEntries([...(this.personas(room) ?? [])]
        .map(([nick, p]) => [nick, { name: p.name, labelEn: p.labelEn, icon: p.icon, color: p.color }])),
      // Пока шаг не начался, ждём человека: без темы режиму не с чем работать.
      hear: step?.hear !== false,
      waitingUser: !mode.talk && (st.step < 0 || step?.until === 'человек'),
    };
  }

  /** Перейти к следующему шагу режима и позвать тех, кто на нём говорит. */
  nextStep(room) {
    const st = this.state(room);
    if (!st.mode) return;

    const mode = loadMode(st.mode);
    st.step += 1;
    const step = mode.steps[st.step];

    if (!step) {
      const cast = [...new Set(mode.steps.flatMap((st) => stepTargets(st, this.here(room), this.roster)))];
      const closer = cast.find((n) => (this.roster[n]?.role ?? '').toLowerCase() === 'продюсер')
        ?? stepTargets(mode.steps.at(-1), this.here(room), this.roster).at(-1);
      this.stopMode(room);
      if (closer) {
        this.enqueue(room, () => this.turn(room, closer, {
          step: {
            name: 'итог',
            hear: true,
            until: 'человек',
            prompt: `Режим «${mode.title}» закончен. Одной-двумя фразами скажи, к чему пришли `
              + `и какой выбор остаётся за человеком. Обратись к @${this.config.user} по имени.`,
          },
        }));
      }
      return;
    }

    st.pending = stepTargets(step, this.here(room), this.roster);
    if (!st.pending.length) return this.nextStep(room);

    // Шаги лента не комментирует: всё, что нужно сказать, участники говорят сами,
    // а где мы внутри режима — видно в строке управления. Единственный служебный след
    // в разговоре — смена режима, и её пишет сервер по действию человека.

    // Барьер шага вслепую: все читают ленту до одной и той же отметки. Отметку храним
    // с шагом — после паузы опоздавшие дочитают до неё же, а не до чужих ответов.
    st.upto = this.store.load(room).at(-1)?.seq ?? 0;
    this.runStep(room, st.run);
  }

  /**
   * Спросить тех, кто на шаге ещё не ответил. Шаг — задача в очереди комнаты, поэтому он
   * не стартует поверх чужого хода и занятый участник не выпадает молча. Пауза шаг
   * замораживает: кто уже пишет — договорит, остальных спросим этим же методом после неё.
   * Счётчик ходов подряд здесь не работает намеренно: режим конечен, и его запустил человек.
   */
  runStep(room, run) {
    this.enqueue(room, async () => {
      const st = this.state(room);
      const live = () => st.run === run && st.mode && !st.paused;
      if (!live()) return;

      const mode = loadMode(st.mode);
      const step = mode.steps[st.step];
      // Кто в этом режиме за что. Считаем один раз на шаг: состав внутри шага не меняется,
      // а строка нужна каждому — и тому, кто спорит, и тем, кто судит.
      const lineup = this.lineup(room, mode);
      // На шаге со слухом барьера нет: каждый следующий видит ответы предыдущих.
      const ctx = step.hear ? { step } : { step, upto: st.upto };
      const ask = async (name) => {
        if (!live()) return;
        // Своя сторона — у каждого своя, поэтому шаг клонируем на участника.
        const side = sideOf(mode, this.roster[name]?.role);
        const mine = lineup ? { ...ctx, step: { ...step, lineup, side } } : ctx;
        const asked = await this.turn(room, name, mine);
        if (asked && st.run === run) st.pending = st.pending.filter((n) => n !== name);
        // Шаг двигается — состояние на диск: перезапуск должен застать его здесь же.
        this.save(room);
      };

      if (step.hear) for (const name of [...st.pending]) await ask(name);
      else await Promise.all(st.pending.map(ask));

      if (!live() || st.pending.length) return;
      if (step.until !== 'человек') this.nextStep(room);
      else this.save(room);
    });
  }

  /**
   * Человек написал тому, кто упёрся в лимит, или всей команде, которая упёрлась целиком.
   * Молчание в ответ неотличимо от «думают», поэтому говорим прямо — но один раз на каждый
   * срок: вторая такая же строка под каждой репликой и была бы той стеной, от которой ушли.
   */
  limitNotice(room, msg) {
    const st = this.state(room);
    const present = this.names.filter((n) => !st.off.includes(n) && this.own(n, st.mode)
      && (this.roster[n]?.role ?? '').toLowerCase() !== 'архивариус');
    const down = present.filter((n) => this.limited(n));
    if (!down.length) return;
    const asked = (msg.mentions ?? []).filter((n) => down.includes(n));
    const all = down.length === present.length;
    if (!asked.length && !all) return;
    const until = Math.max(...down.map((n) => this.limited(n)));
    const mark = `${all ? '*' : asked.join(',')}:${until}`;
    if (st.limitNoticed === mark) return;
    st.limitNoticed = mark;
    const at = new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    this.store.append(room, {
      from: 'system',
      kind: 'system',
      text: all
        ? `Вся команда упёрлась в лимит подписки и до ${at} не отвечает. Ваша реплика в ленте — её прочтут первым же ходом`
        : `${asked.map((n) => `@${n}`).join(', ')} до ${at} не отвечает: лимит подписки. Ответить могут остальные`,
      mentions: [],
    });
  }

  dispatch(room, msg) {
    const st = this.state(room);
    if (st.paused) return;
    if (msg.from === this.config.user) this.limitNotice(room, msg);

    // В режиме ходами распоряжается режим. Человек вмешивается репликой: с тегом — это
    // разговор, адресат ответит, как только шаг отпустит очередь, сам шаг стоит на месте;
    // без тега — закрывает шаг, если тот ждёт человека. Реплики участников никого не будят.
    if (st.mode && !loadMode(st.mode).talk) {
      if (msg.from !== this.config.user) return;
      // Режим ждал темы — она появилась.
      if (st.step < 0) return this.nextStep(room);
      const asked = resolveTargets(msg, this.here(room), this.store.load(room));
      if (asked.length) {
        for (const name of asked) this.enqueue(room, () => this.turn(room, name));
        return;
      }
      const mode = loadMode(st.mode);
      const step = mode.steps[st.step];
      // Шаг, который ждёт человека, ждёт именно этой реплики. Все ответили — она его
      // закрывает; кто-то ещё пишет — она доедет к нему дельтой. Ведущего здесь не зовём
      // ни в каком случае: на шаге «Вопросы» ему отвечали «твоё слово будет позже»,
      // хотя весь шаг и стоял ради его слова.
      if (step?.until === 'человек') {
        if (!st.pending.length) this.nextStep(room);
        return;
      }

      // Реплика человека посреди шага раньше падала на пол: шаг её не ждёт, а будить
      // по ней никого не разрешено. Так и вышло, что человек попросил спорить о другом,
      // а команда молча доспорила прежний тезис до конца. Теперь ему отвечает ведущий —
      // одной строкой: на чём мы и его ли это круг. Один ответ на шаг: человек пишет
      // подряд, а три одинаковых «мы на шаге два» — то, от чего мы уходили.
      const mark = `${st.run}:${st.step}`;
      if (st.asideOn === mark) return;
      const host = this.host(room);
      if (!host || host === msg.from) return;
      st.asideOn = mark;
      this.enqueue(room, () => this.turn(room, host, { step: this.aside(room, mode, host, step) }));
      return;
    }

    // Вопрос затянулся, а режим не включён: зовём Ведущего назвать подходящий. Изнутри
    // разговора этого не замечает никто — человек сидит в нём же, а у участников нет вида
    // сверху: за весь вчерашний день режим включался один раз на одиннадцать минут из
    // двухсот шестнадцати. Зовём один раз за вопрос: напоминать дважды — то, от чего
    // мы только что ушли.
    const LONG = 12;
    if (!st.mode && st.round && st.round.turns >= LONG && !st.round.nudged) {
      st.round.nudged = true;
      const host = this.here(room)
        .find((n) => (this.roster[n]?.role ?? '').toLowerCase() === 'продюсер');
      if (host) this.enqueue(room, () => this.turn(room, host, { step: this.pickMode(st.round.turns) }));
    }

    let targets = resolveTargets(msg, this.here(room), this.store.load(room));
    // Кто уже обратился к человеку и не дождался ответа — тот ход передал и говорить
    // ему больше нечего. Без этого Продюсер за один разговор трижды подряд напоминал
    // об одном и том же: «жду три ответа», «нужно твоё да», «подтверди список».
    const waiting = this.awaiting(room);

    if (!targets.length) {
      if (msg.from === this.config.user) {
        // Человек написал без тега — отвечают дежурные, по очереди. Очередь сериализует
        // вызовы, поэтому каждый следующий видит в своей дельте реплики предыдущих.
        // Кто отвечает человеку без тега — это правило режима «Открытый»: его
        // единственный шаг и есть «кто дежурит». Настройка живёт в одном месте
        // с остальными режимами, а не отдельным полем конфига.
        // Отвечают дежурные режима «Открытый» — пара, уместная на любой теме, — и плюс
        // один, чья это зона интереса. Не вместо: одно совпадение не делает разговор
        // чужим, оно только добавляет к нему того, кто в нём разбирается.
        // Человек ответил — ожидание снято для всех, будить можно кого угодно.
        const talk = this.talkers(room);
        const pool = this.duty(room).filter((n) => this.agents.has(n) && talk.includes(n));
        const here = pool.length ? pool : talk;
        // Сначала тема: отвечает тот, чья она. Постоянного дежурного нет — он отвечал
        // на всё подряд независимо от темы, и разговор про выгорание доставался Инженеру.
        targets = this.drawn(room, msg.text, [], 2);
        if (!targets.length) {
          // Тема ничья — разговор продолжает тот, с кем человек и разговаривал.
          // Но не бесконечно: четыре реплики подряд от одного — это уже не разговор,
          // а монолог, и ход уходит тому, кого дольше всех не было слышно (Woolley:
          // равенство реплик предсказывает результат группы лучше любого интеллекта).
          const said = this.store.load(room)
            .filter((m) => m.kind === 'message' && m.from !== this.config.user)
            .map((m) => m.from);
          const prev = said.at(-1);
          let streak = 0;
          for (let i = said.length - 1; i >= 0 && said[i] === prev; i -= 1) streak += 1;
          const goes = prev && here.includes(prev) && streak < 4 && !this.mutes(prev, msg.text);
          targets = goes ? [prev] : this.quietest(room, here.filter((n) => !this.mutes(n, msg.text)));
        }
      } else if (this.config.freeTalk !== false) {
        // Участник ответил, никого не назвав. Разговор продолжается только там, где он
        // и был разговором: предыдущий говорил именно с ним — тегнул его или отвечал
        // на его реплику. Двое, ответившие человеку один за другим, друг с другом
        // не говорили, и будить друг друга им незачем: это и был тот курятник,
        // где на один вопрос прилетает десять реплик по кругу.
        const prev = this.store.load(room)
          .filter((m) => m.seq < msg.seq && m.kind === 'message' && m.from !== msg.from)
          .at(-1);
        const toMe = prev && ((prev.mentions ?? []).includes(msg.from) || msg.replyTo === prev.seq);
        if (toMe && this.agents.has(prev.from) && !waiting.includes(prev.from)) targets = [prev.from];
      }
    }
    // Цепочка упёрлась: продолжать не с кем, а человека никто не позвал. Раньше здесь
    // наступала тишина — по экрану не отличить «сейчас ответят» от «всё, дальше вы».
    // Ход возвращает участник словами, а не интерфейс подписью: кто-то один говорит,
    // что от человека нужно.
    if (!targets.length) {
      // Только в свободном разговоре: в режиме ходами распоряжается он, а с выключенным
      // freeTalk тишина после ответа — это и есть договорённость «дальше ждём человека».
      const free = !st.mode && this.config.freeTalk !== false;
      if (free && msg.from !== this.config.user && !st.closed) this.handBack(room);
      // И то же для работы: разговор встал, а с прошлого захода Сборщика накопился
      // десяток реплик — значит есть что свести в вещь. Он смотрит сам, а не ждёт
      // слова «собери»: продюсер, которого вызывают заклинанием, — это команда, а не роль.
      this.assemble(room);
      return;
    }

    if (msg.from !== this.config.user) {
      if (st.autoTurns >= this.config.maxAutoTurns) {
        st.paused = true;
        this.store.append(room, {
          from: 'system',
          kind: 'system',
          text: `@${this.config.user}, пауза: ${this.config.maxAutoTurns} ходов подряд без вас. Разговор продолжится с вашей реплики`,
          mentions: [this.config.user],
        });
        return;
      }
      st.autoTurns += 1;
    }

    // Отвечают по очереди, и каждый следующий видит ответ предыдущего. Без пометки
    // «до тебя уже ответили» второй и третий пишут свой полный список того же самого —
    // человек получает три ответа вместо одного и разбирается в них сам.
    targets.forEach((name, i) => {
      this.enqueue(room, () => this.turn(room, name, { after: i > 0 }));
    });
  }

  async turn(room, name, ctx = {}) {
    const agent = this.agents.get(name);
    if (!agent) return false;

    // Участник один на все комнаты. Занят в соседней — ждём своей очереди к нему,
    // а не теряем ход: снаружи это выглядело бы как «сам решил промолчать».
    const before = agent.tail ?? Promise.resolve();
    let release;
    agent.tail = new Promise((r) => { release = r; });
    await before;
    try {
      return await this.speakTurn(room, name, agent, ctx);
    } finally {
      release();
    }
  }

  /** Сам ход. Возвращает true, если участника действительно спросили. */
  async speakTurn(room, name, agent, ctx) {
    if (this.state(room).paused) return false;
    // Ход поставили в очередь до того, как сосед по модели упёрся в лимит. Считаем
    // участника спрошенным: шаг режима не должен ждать того, кто сегодня не ответит.
    if (this.limited(name)) return true;
    const epoch = this.state(room).epoch;

    // У свёртки свой курсор — ctx.since (он же st.archiveUpto), не agent.lastSeen: непустой
    // diff не решён до клика человека, и до решения архивариус ничего не «прочитал» в смысле
    // обычного хода — lastSeen на архивных ходах вообще не обновляется (см. ветку ctx.archive ниже).
    const seen = ctx.archive ? (ctx.since ?? 0) : agent.lastSeen.get(room);
    // memory-proposal и memory-resolved — не реплики: у них нет текста, и участнику отвечать
    // на diff нечем, это дело человека и клика, а не разговора.
    let delta = this.store.since(room, seen ?? 0)
      .filter((m) => m.from !== name && !['system', 'skip', 'memory-proposal', 'memory-resolved'].includes(m.kind));

    // На шаге без слуха все читают ленту до одной и той же отметки: ответы соседей,
    // появившиеся пока участник думал, в его дельту не попадают.
    if (ctx.upto) delta = delta.filter((m) => m.seq <= ctx.upto);
    // Правка реплики, которая и так едет в этой дельте уже исправленной, — лишняя строка.
    const fresh = new Set(delta.filter((m) => m.kind === 'message').map((m) => m.seq));
    delta = delta.filter((m) => m.kind !== 'edit' || !fresh.has(m.target));
    // Одной правки мало, чтобы дать ход: она доедет вместе со следующей репликой.
    if (!delta.some((m) => m.kind !== 'edit') && !ctx.step) return false;

    // Участник, которого позвали в разговор на середине, получает хвост ленты,
    // а не всю историю: иначе первая же его реплика стоит как весь предыдущий тред.
    // `anew` — в этой сессии у него нет прошлого, и промпт хода должен сказать об этом:
    // общее правило «ранние сообщения ты уже читал» здесь неправда.
    let anew = false;
    if (seen === undefined && delta.length > this.config.catchUp) {
      delta = delta.slice(-this.config.catchUp);
      anew = true;
    }

    // Сессия перевалила порог — начинаем её заново. Движок продолжает сессию целиком,
    // и каждый ход читает всё, что в ней накопилось: к вечеру «ок» стоил полмиллиона токенов
    // и полминуты ожидания, а голос участника тонул в четырёхстах тысячах чужого текста.
    // Рвём здесь, перед ходом, а не после прошлого: так сброс не случается впустую.
    const limit = this.config.rotateAt ?? DEFAULTS.rotateAt;
    const rotated = limit > 0 && (agent.weight?.get(room) ?? 0) > limit;
    if (rotated) {
      this.forget(name, room);
      // Архивариусу хвост не нужен: живую память и свой кусок ленты он получает каждый раз.
      if (!ctx.archive) {
        delta = this.tailFor(room, ctx.upto);
        anew = true;
      }
    }

    agent.busy = true;
    // Где и с какого мгновения участник занят: перезагрузив страницу, клиент узнаёт
    // «кто сейчас думает» только из живых событий, а их он пропустил. Отдаём это
    // состоянием комнаты — вместе с началом хода, иначе таймер начинает счёт заново
    // и десятая минута показывается как первая секунда.
    agent.busyIn = room;
    const started = Date.now();
    agent.busySince = started;
    this.emitStatus(room, name, 'thinking');

    try {
      // Кем участник выходит в этом режиме: другое имя, другой голос — и остальные
      // для него тоже под своими именами, иначе он зовёт @Скептика, а в ленте Совунья.
      const cast = this.personas(room);
      const mine = cast?.get(name);
      const persona = mine
        ? { ...mine, others: Object.fromEntries([...cast].map(([n, p]) => [n, p.name])) }
        : null;

      const res = await agent.impl.speak({
        room,
        delta,
        history: this.store.load(room),
        step: ctx.step,
        ctx: {
          me: name,
          persona,
          // Режим без регламента — это трёп, и промпт у него свой: рабочие правила
          // там душат голос персонажа, ради которого режим и включали.
          talk: !!(this.state(room).mode && loadMode(this.state(room).mode).talk),
          roster: this.roster,
          user: this.config.user,
          workdir: this.config.workdir,
          laws: this.config.laws,
          memory: this.memory?.brief(room) ?? '',
          after: ctx.after,
          anew,
        },
      });

      // Пока участник думал, ленту могли очистить: его ответ уже не к чему приложить.
      if (this.state(room).epoch !== epoch) return false;

      if (res.error) {
        // Ход не состоялся — прочитанным ничего не считаем: эту же дельту участник
        // получит в следующий раз, а не потеряет вместе с ошибкой.
        let text = res.error;
        // На шаге вслепую в лимит упираются трое разом: первый уже сказал об этом
        // за всю группу, остальным повторять нечего.
        if (saysLimit(res.error) && this.limited(name)) return true;
        if (saysLimit(res.error)) {
          const { until, names } = this.limit(name);
          const at = new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          const who = names.map((n) => `@${n}`).join(', ');
          // Говорим, что произойдёт: кого не зовём и когда попробуем снова. Сам текст
          // движка оставляем — в нём время, когда лимит вернётся на самом деле.
          text = `${res.error}\nЛимит подписки: ${who} до ${at} не отвечают, потом попробуем снова.`;
        }
        this.store.append(room, {
          from: name,
          kind: 'error',
          text,
          mentions: [],
        });
        return true;
      }

      // Сколько теперь весит сессия: по этому числу следующий ход решит, не пора ли её сменить.
      const weight = weigh(res.meta);
      if (weight) agent.weight?.set(room, weight);
      // Сброс остаётся в расходе хода: по ленте видно, где сессия началась заново.
      if (rotated) res.meta = { ...res.meta, rotated: true };

      // Свёртка памяти — не реплика в разговоре: архивариуса читает код, не собеседники.
      // Его ответ не идёт в ленту текстом, а разбирается в diff и ложится предложением.
      if (ctx.archive) {
        const diff = parseArchiveDiff(res.text);
        if (diff === null) {
          this.store.append(room, {
            from: name,
            kind: 'error',
            text: `свёртка ответила не json-ом: ${String(res.text ?? '').trim().slice(0, 200)}`,
            mentions: [],
          });
          return true;
        }
        if (!diff.length) {
          // Нечего записывать — не решение человека, курсор двигаем сразу: иначе пустой
          // кусок сжигает MAX_BATCHES на каждом запуске и никогда не будет пройден.
          this.state(room).archiveUpto = ctx.upto;
          this.save(room);
          return true;
        }
        // Есть что предложить — курсор стоит до решения человека: confirmMemory/rejectMemory
        // сами двигают его дальше. Обрыв на неподтверждённом diff теперь не теряет его —
        // просто оставляет комнату без новой памяти, пока предложение висит.
        this.store.append(room, {
          from: name, kind: 'memory-proposal', diff, upto: ctx.upto, status: 'ожидает',
          mentions: [this.config.user],
        });
        return true;
      }

      // Прочитано то, что участнику реально отправили, а не всё, что успело появиться
      // в ленте, пока он думал: иначе реплика, пришедшая посреди хода, до него не дойдёт.
      agent.lastSeen.set(room, ctx.upto ?? delta.at(-1)?.seq ?? seen ?? 0);

      let text = (res.text ?? '').trim();
      if (!text || SKIP.test(text)) {
        // Промолчать — тоже ход: движок прочёл ту же ленту и стоил столько же, сколько
        // реплика. Раньше он не оставлял следа нигде, и ни цену вопроса, ни то, как часто
        // участника будят зря, по ленте было не посчитать. В разговор отметка не идёт:
        // собеседникам её не показывают, на экране её нет.
        rounds.count(this.state(room), res.meta);
        this.store.append(room, {
          from: name,
          kind: 'skip',
          text: '',
          mentions: [],
          meta: { ...res.meta, elapsedMs: Date.now() - started },
        });
        this.emitStatus(room, name, 'skipped');
        return true;
      }

      // «файл: путь» отдельной строкой — способ участника приложить к реплике то,
      // что он сделал. Иначе на просьбу «дай файл» он вставляет в чат всю статью:
      // приложить ему нечем, а отказать он не может.
      const files = [];
      text = text.replace(/^[ \t]*файл:[ \t]*(.+)$/gim, (whole, rel) => {
        const found = this.attach(String(rel).trim());
        if (!found) return whole;
        files.push(found);
        return '';
      }).replace(/\n{3,}/g, '\n\n').trim();

      // Ход состоялся — он засчитывается в цену вопроса: ходы и токены до того,
      // как ход вернётся к человеку.
      rounds.count(this.state(room), res.meta);
      const posted = this.post(room, {
        from: name,
        text,
        files,
        // В реплику кладём подпись, знак и цвет, но не список ролей: он живёт в файле
        // режима, а в ленте повторялся бы в каждой строке. Персона сильнее стороны:
        // под ней участник выходит целиком, а не только помечен.
        side: persona
          ? {
            label: persona.name,
            labelEn: persona.labelEn,
            icon: persona.icon,
            color: persona.color,
            // Персона — это имя, а не пометка: в ленте она встаёт вместо ника, а не рядом.
            persona: true,
          }
          : (ctx.step?.side
            ? { label: ctx.step.side.label, labelEn: ctx.step.side.labelEn, icon: ctx.step.side.icon }
            : undefined),
        meta: { ...res.meta, elapsedMs: Date.now() - started },
      });

      // Ведущему дано право начать спор заново: человек сменил предмет посреди шага,
      // и единственный, кто может это признать вслух и переназначить тезис, — он.
      if (ctx.step?.aside && saysRestart(posted.text)) this.restart(room);
      return true;
    } finally {
      agent.busy = false;
      this.emitStatus(room, name, 'idle');
    }
  }

  /**
   * Прогнать свёртку памяти от её курсора до конца ленты, порциями по 50. Делает её
   * теневой найм — участник с ролью «архивариус», исключённый из here()/duty()/drawn():
   * не отвечает в общем разговоре, не в списке дежурных, не подсвечивается темой. Курсор —
   * свой, st.archiveUpto, не agent.lastSeen: непустой diff не решён до клика человека,
   * а agent.lastSeen — это то, что участник «прочитал», и до решения свёртка ничего
   * не прочитала, она только предложила.
   */
  /**
   * Отложить свёртку до тишины. Каждая новая реплика сдвигает срок: пока идёт разговор,
   * архивариус молчит. Таймер не держит процесс — он про удобство, а не про работу.
   */
  scheduleFold(room) {
    if (!this.memory) return;
    const st = this.state(room);
    clearTimeout(st.foldTimer);
    st.foldTimer = setTimeout(() => {
      if (this.store.since(room, st.archiveUpto ?? 0).length < FOLD_AFTER) return;
      this.enqueue(room, () => this.archive(room));
      // Срок задаётся конфигом только ради тестов: ждать в них десять минут нечестно
      // по отношению к тому, кто эти тесты запускает.
    }, this.config.foldIdleMs ?? FOLD_IDLE_MS);
    st.foldTimer.unref?.();
  }

  async archive(room) {
    if (!this.memory) return;
    const name = this.names.find((n) => (this.roster[n]?.role ?? '').toLowerCase() === 'архивариус');
    if (!name) return;
    const st = this.state(room);

    // Пока по какому-то куску висит непринятое предложение, курсор за него не заходит
    // (см. ctx.archive в speakTurn) — новый запуск свёртки застал бы тот же диапазон
    // и предложил бы по нему второе решение на то же самое. Сначала человек — потом дальше.
    const hanging = this.store.load(room).some((m) => m.kind === 'memory-proposal' && (!m.status || m.status === 'ожидает'));
    if (hanging) return;

    const BATCH = 50;
    // Предохранитель: огромный хвост после долгого обрыва сворачиваем несколькими вызовами
    // за один запуск, но не бесконечно — иначе один старт молча сжигает бюджет на день вперёд.
    const MAX_BATCHES = 5;
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      // На нераскрытом слепом шаге дальше барьера st.upto не ходим: участник, который ещё
      // не ответил, не должен встретить чужой ответ в brief() раньше, чем увидел бы его
      // в самой ленте — барьер, который существует ровно для этого, иначе обходится памятью.
      // Читаем режим заново на каждой порции: пока свёртка ждёт модель, человек мог начать
      // новый режим, и застывший потолок с прошлой итерации свёртке об этом не сказал бы.
      const modeStep = st.mode ? loadMode(st.mode).steps[st.step] : null;
      const ceiling = modeStep?.hear === false ? st.upto : Infinity;

      const cursor = st.archiveUpto ?? 0;
      const pending = this.store.since(room, cursor).filter((m) => m.kind === 'message' && m.seq <= ceiling);
      if (!pending.length) return;
      const chunk = pending.slice(0, BATCH);
      const upto = chunk.at(-1).seq;
      const live = this.memory.forArchivist(room);
      const step = {
        name: 'свёртка',
        hear: true,
        prompt: 'На этот ход — не твоя обычная роль: сверни кусок ленты в память пространства. '
          + 'Ниже — что в памяти уже живо, с id: не повторяй то, что там уже верно сказано.\n\n'
          + `ЖИВАЯ ПАМЯТЬ:\n${live.length ? JSON.stringify(live) : '(пусто)'}\n\n`
          + 'Ответь ровно одним блоком ```json``` — массивом изменений {action, kind, text, id}, '
          + 'без текста вне него. Нечего менять — пустой массив [].',
      };
      const asked = await this.turn(room, name, { archive: true, since: cursor, upto, step });
      // Ошибка или плохой json не двигают курсор (см. ветку ctx.archive выше) — тот же
      // кусок повторился бы до конца MAX_BATCHES ценой ещё четырёх таких же неудач.
      if (!asked || this.state(room).archiveUpto === cursor) return;
    }
  }

  /**
   * Два слова для знака: чем заняты и над чем. Спрашиваем не «какая тема», а «та же или
   * нет»: вопрос «назови тему» модель отвечает каждый раз новыми словами, и метка дёргается
   * на каждой реплике, хотя разговор тот же. Здесь ответ по умолчанию — «та же», и метка
   * меняется, только когда разговор действительно ушёл в другое.
   *
   * Зовём на реплике человека: участники развивают начатое, а сворачивает в сторону обычно он.
   * Вызов дешёвый и одноразовый — своим адаптером на быстрой модели, без сессии и без следа
   * в ленте.
   */
  async retopic(room) {
    // Метку некуда положить без состояния на диске — значит и считать нечего.
    if (!this.stateDir) return;
    const st = this.state(room);
    if (st.topicBusy) return;
    const tail = this.store.load(room).filter((m) => m.kind === 'message').slice(-14);
    if (tail.length < 2) return;

    st.topicBusy = true;
    // Отметку ставим до вызова: иначе на каждом следующем сообщении, пока модель думает,
    // проверка запускалась бы заново.
    const upto = this.store.load(room).at(-1)?.seq ?? 0;
    st.topicAt = upto;
    try {
      const probe = this.build('claude', {
        kind: 'claude', model: 'haiku', lean: true, skills: [], timeoutMs: 60000,
      });
      const now = `${st.doing || 'open'}(${st.topic || '—'})`;
      const res = await probe.speak({
        room,
        delta: tail,
        history: tail,
        step: {
          name: 'знак',
          hear: true,
          prompt: 'На этот ход ты не участник разговора и в чат не отвечаешь. Нужно два слова.\n\n'
            + `Знак комнаты сейчас: ${now}. Слева — чем заняты, в скобках — над чем. `
            + 'Прочитай реплики и реши, изменилось ли то или другое.\n\n'
            + 'Первое слово — ДЕЙСТВИЕ: что в разговоре делают. validation, research, planning, '
            + 'writing, debugging, pricing.\n'
            + 'Второе слово — ПРЕДМЕТ: о чём говорят. article, memory, onboarding. Если всё '
            + 'крутится вокруг одной вещи, которую принёс человек, — назови эту вещь.\n\n'
            + 'Ответь ровно двумя словами через пробел, без точки и пояснений. Каждое — '
            + 'латиницей, строчными, до четырнадцати знаков, без пробелов и дефисов.\n\n'
            + 'По умолчанию оба слова — same. Слово меняется, только если сменилось само '
            + 'занятие или сам предмет, а не их название. review → editing, research → '
            + 'analysis, writing → drafting, pricing → costing — это одно и то же другими '
            + 'словами: отвечай same. И не называй приём вместо работы: пока правят статью, '
            + 'это не debugging, чем бы там ни чинили абзацы. Менять стоит, когда взялись '
            + 'за другое: '
            + 'правили текст — стали считать деньги; спорили о замысле — стали писать код. '
            + 'Знак должен простоять весь разговор; смена слова на синоним обесценивает его '
            + 'так же, как если бы он не менялся вовсе. Сомневаешься — same.',
        },
        ctx: {
          me: 'знак',
          roster: this.roster,
          user: this.config.user,
          workdir: this.config.workdir,
          laws: '',
        },
      });

      const ok = (w) => /^[a-z][a-z0-9_]{0,13}$/.test(w) && w !== 'same';
      const [act, subj] = String(res?.text ?? '').trim().toLowerCase().split(/\s+/);
      let doing = ok(act) && act !== st.doing ? act : null;
      const topic = ok(subj) && subj !== st.topic ? subj : null;
      // Выдержка на левой половине. Предмет разговора меняется редко и защищает себя сам,
      // а действие пробник переписывает охотно: review на editing, editing на debugging —
      // разговор тот же, слово третье. Меняем его либо вместе с предметом, либо не чаще
      // чем раз в STEADY реплик: знак должен стоять, иначе он ничего не значит.
      const STEADY = 25;
      if (doing && !topic && st.doing && upto - (st.doingAt ?? 0) < STEADY) doing = null;
      if (!doing && !topic) return;
      if (doing) {
        st.doing = doing;
        st.doingAt = upto;
      }
      if (topic) st.topic = topic;
      this.save(room);
      this.store.listeners.forEach((fn) => {
        try {
          fn({ kind: 'topic', room, topic: st.topic, doing: st.doing, ts: Date.now() });
        } catch { /* ignore */ }
      });
    } catch (e) {
      this.log.error(e);
    } finally {
      st.topicBusy = false;
    }
  }

  /**
   * Вернуть ход человеку. Зовём одного — продюсера, если он в комнате, иначе первого
   * дежурного: возвращать ход хором незачем. Отметку ставим до вызова, иначе ответ
   * закрывающего сам упрётся в ту же ветку и позовёт следующего по кругу.
   */
  handBack(room) {
    // Кто уже позвал человека и ждёт — тот ход и вернул. Звать его второй раз значит
    // напомнить о том же самом ещё раз, а человек и так знает, что очередь за ним.
    const waiting = this.awaiting(room);
    if (waiting.length) return;
    // Ход возвращает тот, кто в разговоре и был: ведущего для этого не зовут — он и так
    // приходил на каждую паузу, и получалось «подтверди» вместо разговора.
    const here = this.talkers(room);
    const name = this.quietest(room, here)[0] ?? here[0];
    if (!name) return;
    const st = this.state(room);
    st.closed = true;
    rounds.close(st);
    this.enqueue(room, () => this.turn(room, name, {
      step: {
        name: 'ход человека',
        hear: true,
        prompt: `Разговор упёрся: добавить больше нечего, а решение за человеком. Одной фразой `
          + `скажи @${this.config.user}, что от него сейчас нужно — решение, запуск, факт, выбор `
          + `из двух. Без пересказа сказанного и без благодарностей.`,
      },
    }));
  }

  emitStatus(room, name, status) {
    this.store.listeners.forEach((fn) => {
      try { fn({ kind: 'status', room, from: name, status, ts: Date.now() }); } catch { /* ignore */ }
    });
  }

  /**
   * Свести состав участников с конфигом. Существующего трогаем, только если его настройки
   * изменились: пересборка стирает сессию, а с ней и то, что участник помнит из разговора.
   */
  syncAgents() {
    const wanted = this.config.agents ?? {};
    for (const [name, cfg] of Object.entries(wanted)) {
      const cur = this.agents.get(name);
      if (cur && JSON.stringify(cur.cfg) === JSON.stringify(cfg)) continue;
      // Сессию держит адаптер движка. Пересобираем его при смене движка — и при смене умений:
      // участник, которому не давали искать в сети, успел сказать об этом в своей сессии,
      // и дальше верит себе, а не системному промпту. Выдали поиск — он продолжает отвечать
      // «мне не разрешено», пока сессия помнит прежние правила. Цвет, иконка, характер
      // и промпт читаются из cfg на каждом ходу, стирать ради них память незачем.
      const same = (a, b) => JSON.stringify(skillsOf(a)) === JSON.stringify(skillsOf(b));
      if (cur && (cur.cfg.kind ?? name) === (cfg.kind ?? name) && same(cur.cfg, cfg)) {
        cur.cfg = cfg;
        cur.impl.cfg = cfg;
        continue;
      }
      this.agents.set(name, {
        cfg,
        impl: this.build(name, cfg),
        busy: false,
        // Заново нанятый начинает читать ленту с хвоста, а не с начала времён.
        lastSeen: cur?.lastSeen ?? new Map(),
        // Вес сессии по комнатам. Адаптер новый — сессии новые, и вес у них нулевой.
        weight: new Map(),
      });
    }
    for (const name of [...this.agents.keys()]) {
      if (!wanted[name]) this.agents.delete(name);
    }
  }

  /** Применить настройки из интерфейса. Возвращает то, что реально стало. */
  /** Дежурные: «кто говорит» на шаге режима «Открытый». */
  /**
   * Шаг «назови режим». Даём Ведущему список режимов с тем, для чего каждый годится,
   * и право промолчать: разговор, который идёт нормально, ломать незачем.
   */
  pickMode(turns) {
    const list = listModes()
      .filter((m) => m.name !== BUILTIN)
      .map((m) => `  ${m.short || m.title} — ${m.for}`)
      .join('\n');
    return {
      name: 'режим',
      hear: true,
      until: 'человек',
      prompt: `Вопрос идёт уже ${turns} ходов и не закрылся. Посмотри со стороны: разговор `
        + 'движется или ходит по кругу?\n\nЕсли ходит — назови режим, который тут подошёл бы, '
        + 'и одной фразой скажи, что он даёт именно сейчас. Спор не пересказывай.\n\n'
        + `Режимы:\n${list}\n\nЕсли разговор идёт нормально и режим не нужен — ответь [skip] `
        + 'и ничего больше.',
    };
  }

  /**
   * Позвать Прораба посмотреть, не потерялось ли что. Условие — не слово в реплике, а сколько
   * реплик прошло с его прошлого захода: обещания и невнесённые решения копятся сами, и заметить
   * их может только тот, кто смотрит на работу целиком. Право промолчать у него есть.
   */
  assemble(room) {
    const name = this.here(room)
      .find((n) => (this.roster[n]?.role ?? '').toLowerCase() === 'продюсер');
    if (!name || this.state(room).mode) return;
    // Он уже обратился к человеку и ответа не получил — ход у человека, и «хвост»,
    // который он найдёт, будет тем же самым вопросом в третий раз.
    if (this.awaiting(room).length) return;
    const feed = this.store.load(room).filter((m) => m.kind === 'message');
    let since = 0;
    for (let i = feed.length - 1; i >= 0 && feed[i].from !== name; i -= 1) since += 1;
    if (since < ASSEMBLE_AFTER) return;
    // Человек работает над чем-то прямо сейчас — не время нести список висяков
    // за прошлые часы. Список приходит, когда работа встала, а не когда она идёт:
    // иначе он подменяет собой предмет разговора, и команда уходит разбирать его,
    // а не то, что человек принёс минуту назад.
    const last = feed.at(-1);
    if (last && last.from === this.config.user) return;
    const mine = feed.filter((m) => m.from === this.config.user).at(-1);
    if (mine && feed.length - feed.indexOf(mine) <= ASSEMBLE_AFTER) return;
    this.enqueue(room, () => this.turn(room, name, {
      step: {
        name: 'хвосты',
        hear: true,
        until: 'человек',
        prompt: 'Разговор встал. Пройди по тому, что было с твоего прошлого захода, и найди '
          + 'потерянное: кто что обещал и не сделал, какое решение приняли и не внесли, какой '
          + 'вопрос задали друг другу и оставили без ответа.\n\nВопрос, который уже задан '
          + 'человеку и ждёт его, — не хвост, а его ход: повторять его нельзя. Чужой вопрос '
          + 'своими словами тоже не пересказывай — он в ленте и его видно.\n\nНазови найденное '
          + 'списком и тегни тех, чьё это. Спор не пересказывай, подтверждений не проси.\n\n'
          + 'Всё закрыто и ничего не потерялось — ответь [skip] и ничего больше.',
      },
    }));
  }

  duty(room) {
    const names = room ? this.here(room) : this.names;
    const step = loadMode(BUILTIN).steps[0];
    return step ? stepTargets(step, names, this.roster) : [...names];
  }

  reconfigure(patch) {
    const next = { ...this.config, ...patch };
    if (patch.agents) next.agents = patch.agents;

    next.maxAutoTurns = clamp(next.maxAutoTurns, 1, 100, this.config.maxAutoTurns);
    next.catchUp = clamp(next.catchUp, 1, 500, this.config.catchUp);
    next.freeTalk = next.freeTalk !== false;
    next.rotateAt = clamp(next.rotateAt, 0, 2_000_000, this.config.rotateAt ?? DEFAULTS.rotateAt);

    this.config = next;
    this.syncAgents();
    return this.config;
  }

  pause(room, on = true) {
    const st = this.state(room);
    if (on) rounds.close(st);
    st.paused = on;
    if (!on) st.autoTurns = 0;
    this.store.append(room, {
      from: 'system',
      kind: 'system',
      // Пометка в ленте говорит, что произойдёт и что делать: «поставлено на паузу»
      // сообщает о себе, а не человеку, и не отвечает на вопрос «и что теперь».
      text: on
        ? 'Пауза. Начатые ответы допишутся, а разговор продолжится с вашей реплики'
        : 'Продолжаем',
      mentions: [],
    });
    // Пауза, пришедшая между сообщением и вызовом, съедала обращение: адресат его так и
    // не получал. Снимая паузу, поднимаем последнюю реплику и доигрываем её.
    if (!on) {
      if (st.mode) this.runStep(room, st.run);
      else this.resume(room);
    }
    this.save(room);
    return st;
  }

  /**
   * Поднять то, что оборвалось на середине. Шаг режима живёт в очереди процесса, а очередь
   * перезапуск не переживает: на диске остаётся «ждём троих», и не зовёт их больше никто —
   * со стороны это выглядит как «разговор просто оборвался». Свободный разговор не поднимаем:
   * там следующий ход и так за человеком.
   */
  resumeAll() {
    const woken = [];
    for (const room of this.store.listRooms()) {
      if (!this.stateDir || !readState(this.stateDir, room)) continue;
      // Обрыв мог случиться и без незакрытого режима — свёртку подтягиваем всегда.
      // Но не сразу: курсор помнит, докуда дошёл, а человек, перезапустивший сервер,
      // не должен получать карточку памяти как приветствие.
      this.scheduleFold(room);
      const st = this.state(room);
      if (st.paused || !st.mode || !st.pending.length) continue;
      this.runStep(room, st.run);
      woken.push({ room, mode: st.mode, step: st.step + 1, pending: [...st.pending] });
    }
    return woken;
  }

  /**
   * Разбудить тех, к кому обратились, пока разговор стоял: после паузы или перезапуска.
   * Заодно пересчитываем упоминания — состав участников мог смениться уже после записи.
   */
  resume(room) {
    const last = this.store.load(room).filter((m) => m.kind === 'message').at(-1);
    if (!last) return;

    const known = [...this.names, this.config.user];
    last.mentions = parseMentions(last.text, known, last.from === this.config.user);

    // Если после этой реплики уже кто-то отвечал, догонять нечего.
    const answered = [...this.agents.values()].some((a) => (a.lastSeen.get(room) ?? 0) >= last.seq);
    if (!answered) this.dispatch(room, last);
  }

  /**
   * Очистить ленту и всё, что на неё опирается. Состояние комнаты правим на месте,
   * а не заводим заново: работающий обход очереди держит ссылку на прежний объект
   * и иначе продолжил бы писать в уже очищенную комнату.
   */
  clearRoom(room) {
    const st = this.state(room);
    st.jobs.length = 0;
    st.epoch += 1;
    st.autoTurns = 0;
    st.paused = false;
    st.mode = null;
    st.step = 0;
    // Лента нумеруется заново с 1 — курсор свёртки, оставшийся большим, замолчал бы
    // до тех пор, пока новая лента не дорастёт до старого номера.
    st.archiveUpto = 0;
    // Знак пустой комнаты — open(space), а не то, чем в ней занимались вчера: лента
    // очищена, разговора нет, и «writing(round)» в шапке описывает то, чего больше нет.
    st.topic = '';
    st.doing = '';
    st.topicAt = 0;
    st.doingAt = 0;

    this.store.clear(room);
    for (const [, agent] of this.agents) {
      agent.impl.reset(room);
      agent.weight?.delete(room);
      agent.lastSeen.delete(room);
    }
    // Комнаты больше нет — и состояния её тоже.
    if (this.stateDir) dropState(this.stateDir, room);
  }

  /** Сбросить контекст агентов в комнате: следующая реплика начнёт новую сессию. */
  reset(room) {
    // Ходы, собранные до сброса, опираются на память, которой уже нет.
    this.dropPending(room);
    for (const [, agent] of this.agents) {
      agent.impl.reset(room);
      agent.weight?.delete(room);
      agent.lastSeen.set(room, this.store.load(room).at(-1)?.seq ?? 0);
    }
    const st = this.state(room);
    st.autoTurns = 0;
    st.paused = false;
    this.store.append(room, {
      from: 'system',
      kind: 'system',
      text: 'Контекст агентов сброшен — дальше они читают ленту с чистого листа.',
      mentions: [],
    });
  }
}
