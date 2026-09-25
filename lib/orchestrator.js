import fs from 'node:fs';
import path from 'node:path';
import { ask, askAs, buildAgent } from './agents.js';
import { dropState, readState, writeState } from './state.js';
import { parseMentions, resolveTargets } from './mentions.js';
import { roleOf } from './roles.js';
import { listSpaces, loadSpace, meetings, pick, sideOf, tuneOf } from './spaces.js';
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
const LIMIT = /(hit your|reached your|usage|rate)[^.]{0,40}limit/i;

/** Сказал ли движок, что упёрся в лимит. Отдельной функцией — потому что проверяется тестом. */
export const saysLimit = (text) => LIMIT.test(String(text ?? ''));

// Когда лимит вернётся, движок пишет словами и в своём поясе — разбирать это ненадёжно.
// Поэтому просто не зовём четверть часа и пробуем снова: отказ по лимиту ничего не стоит.
const LIMIT_COOLDOWN_MS = 15 * 60_000;

/**
 * Движок разлогинен. Самый частый отказ в продукте — и до сих пор он приезжал в ленту
 * как есть: «Failed to authenticate: OAuth session expired and could not be refreshed»,
 * по-английски, в терминах OAuth, без единого слова о том, что с этим делать. Шесть
 * участников из восьми отвечали этой строкой, и по ней нельзя было понять даже того,
 * что чинится она одной командой в терминале.
 */
const AUTH = /(failed to authenticate|oauth session expired|please run\s*\/login|invalid api key|api key not found|not logged in|unauthorized)/i;

/** Сказал ли движок, что его не пускают. Отдельной функцией — потому что проверяется тестом. */
export const saysAuth = (text) => AUTH.test(String(text ?? ''));

// Вход руками занимает минуту, а зовём мы участника на каждую реплику. Пять минут тишины —
// чтобы комната не заполнилась одной и той же ошибкой, пока человек ходит логиниться.
const AUTH_COOLDOWN_MS = 5 * 60_000;

/** Как войти в этот движок. Команда — половина пользы от всего сообщения. */
const LOGIN = { codex: 'codex login', claude: 'claude auth login' };

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

/** «один голос», «два голоса», «пять голосов» — в итоге голосования иначе режет глаз. */
const plural = (n) => {
  const ten = n % 100;
  if (ten >= 11 && ten <= 14) return 'голосов';
  const one = n % 10;
  if (one === 1) return 'голос';
  if (one >= 2 && one <= 4) return 'голоса';
  return 'голосов';
};

// Сколько реплик свободного разговора копится до свёртки. Свёртка — отдельный вызов
// движка, поэтому запускать её на каждой паузе дорого, а не запускать вовсе — значит
// терять всё, что в разговоре поняли.
/** Режим без регламента — это разговор: ходы в нём идут как в открытой комнате. */
const chatty = (room) => !!loadSpace(room).talk;

// Балл, с которого мысль просится вслух, и сколько реплик она ещё уместна, если ход
// ушёл другому. Пороги по Inner Thoughts: средняя настройка лучше и болтуна, и молчуна.
// Пороги живут в настрое места (lib/modes.js): болтовне, разгону идей и рабочей встрече
// нужна разная готовность открыть рот. Здесь — то, что от места не зависит.
const HOLD_AT = 3;     // мысль есть, но и без неё обойдутся: в голову, не вслух
const HELD_FOR = 6;    // сколько реплик непроизнесённая мысль ещё уместна
const QUIET = 1.02;    // надбавка за молчание: столько к баллу за каждую чужую реплику подряд
const MINDS = 3;       // сколько невысказанного участник носит в себе: дальше это дневник
const OWN_MINDS = 2;   // скольким мысль пишет их собственная голова, а не общая

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
      // Уровень нормализуем так же жёстко, как вид: третьего уровня модель придумать
      // не должна, а по умолчанию запись — деталь своей комнаты.
      level: ch.level === 'главное' ? 'главное' : 'деталь',
    }))
    .filter((ch) => ch.action === 'отменить' || ch.text);
}

/**
 * Событийный цикл: сообщение с тегом будит адресата, его ответ будит следующего.
 * Агент никогда не опрашивает ленту сам — его вызывают, и только на дельту.
 */
/**
 * Скрытое мышление: строка «[про себя] …» в конце реплики. Отрезаем её от текста
 * до того, как он станет репликой: в ленту она не попадает, собеседникам не достаётся
 * и в промпт к ним не едет — вернётся только к автору, на его следующем ходу.
 *
 * Держится это на одном отрезании, а не на честном слове модели: строка уходит из текста
 * раньше, чем текст вообще становится сообщением, — и утечь ей потом уже неоткуда.
 */
export function aside(text) {
  const kept = [];
  const said = String(text ?? '')
    .replace(/^[ \t]*[[(]про себя[\])]\s*:?\s*(.*)$/gim, (_, line) => {
      const one = String(line).trim().slice(0, 200);
      if (one) kept.push(one);
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: said, aside: kept.join(' ').trim() };
}

/**
 * Уверенность из реплики: «уверенность: 60%». Число — вероятность, которую участник
 * сам назначает своему решению, и смысл в том, как оно меняется от цикла к циклу,
 * а не в том, какое оно.
 */
export function sure(text) {
  const m = String(text ?? '').match(/уверенност[ьи]\s*:?\s*(\d{1,3})\s*%?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/**
 * Как менялась уверенность за протокол — и один настоящий счёт поверх неё.
 *
 * «Моё решение лучшее в комнате» — события взаимоисключающие: лучшим окажется одно.
 * Значит, сумма уверенностей всех участников не может быть больше ста: это не строгость
 * ради строгости, а то самое условие, из-за которого последовательность убеждений
 * ведёт себя как мартингал. Информация перераспределяет вероятность между участниками,
 * но не добавляет её в комнату: если после встреч каждый уверен в себе сильнее, чем был,
 * комната не узнала ничего — она просто окопалась.
 *
 * Поэтому считаем две вещи: сумму в начале и сумму в конце. Выросла — это якорение,
 * и мы говорим об этом вслух. И отдельно — кто не сдвинул число ни разу: встречи
 * для него не значили ничего.
 */
export function drift(sures) {
  const rows = [...sures].filter(([, xs]) => xs?.length);
  if (rows.length < 2) return '';
  const first = rows.reduce((s, [, xs]) => s + xs[0], 0);
  const last = rows.reduce((s, [, xs]) => s + xs.at(-1), 0);
  // Подряд идущие одинаковые числа сливаем в одно: «60 → 60 → 45» читается как путь,
  // которого не было. А вот возврат к прежнему числу — это путь, и его оставляем.
  const path = rows.map(([n, xs]) => `@${n}: ${xs.filter((x, i) => i === 0 || x !== xs[i - 1]).join(' → ')}%`);
  const stuck = rows.filter(([, xs]) => xs.length > 1 && new Set(xs).size === 1).map(([n]) => `@${n}`);
  return [
    `Уверенность: ${path.join('; ')}.`,
    `Сумма была ${first}%, стала ${last}%.`,
    last > first
      ? 'Лучшим окажется одно решение, поэтому больше ста в сумме быть не может. '
        + 'Уверенности в комнате стало больше, чем было: встречи никого не сдвинули, '
        + 'каждый после них окопался в своём.'
      : (last > 100
        ? 'Сумма не выросла, но ста всё ещё больше: кто-то держит число выше, '
          + `чем стоило бы при ${rows.length} решениях на столе.`
        : 'Сумма не выросла: встречи забрали уверенность у тех, кому было чем её сбить.'),
    stuck.length
      ? `Не сдвинул число ни разу: ${stuck.join(', ')} — для ${stuck.length > 1 ? 'них' : 'него'} встречи `
        + 'ничего не изменили, и это либо твёрдость, либо глухота.'
      : '',
  ].filter(Boolean).join(' ');
}

/**
 * Счёт с поправкой на уверенность — то, ради чего число вообще называют.
 *
 * Голоса говорят, чьё решение сильнее по мнению соседей; уверенность — насколько сам
 * автор готов за него отвечать. Складывать их в лоб нельзя: модели переуверены, и тот,
 * кто написал «95%», перевесил бы всю комнату. Поэтому уверенности сперва нормируются —
 * каждая делится на общую сумму, — и число перестаёт быть самооценкой, становясь долей.
 * Сказать «я уверен на 95» в одиночку больше нельзя: это утверждение о себе относительно
 * остальных, и если так скажут все, нормировка вернёт всех к равенству.
 *
 * Голоса весят вдвое: их подают четверо и про чужое, а число — одно и про своё.
 */
export function weighVotes(rows, sures) {
  const totalVotes = rows.reduce((s, r) => s + r.votes, 0);
  if (!totalVotes) return [];
  const own = new Map(sures.filter(([, xs]) => xs?.length).map(([n, xs]) => [n, xs.at(-1)]));
  const totalSure = [...own.values()].reduce((s, x) => s + x, 0);
  // Чисел нет — поправлять нечего, и врать про поправку тем более: пусть решают голоса.
  if (!totalSure) return [];
  const raw = rows.map((r) => ({
    name: r.name,
    score: 2 * (r.votes / totalVotes) + ((own.get(r.name) ?? 0) / totalSure),
  }));
  const sum = raw.reduce((s, r) => s + r.score, 0);
  return raw
    .map((r) => ({ name: r.name, share: Math.round((r.score / sum) * 100) }))
    .sort((a, b) => b.share - a.share);
}

/**
 * Разбор бюллетеня. Участник называет две чужие позиции, которые считает сильнейшими,
 * и отдельно — кого, по его мнению, выберут остальные. Прогноз нужен не ради статистики:
 * идея, за которую многие проголосовали втайне, ожидая, что другие её не выберут, —
 * это и есть находка, которую обычное голосование съедает первой.
 */
export function parseVote(text, names) {
  const find = (line) => names.filter((n) => new RegExp(`(^|[^\\p{L}])${n}([^\\p{L}]|$)`, 'iu').test(line));
  const row = (key) => String(text ?? '').split('\n').find((l) => new RegExp(`^\\s*${key}`, 'i').test(l)) ?? '';
  return {
    for: find(row('за')).slice(0, 2),
    guess: find(row('прогноз')).slice(0, 1),
    why: (String(text ?? '').split('\n').find((l) => /^\s*почему/i.test(l)) ?? '')
      .replace(/^\s*почему\s*:?\s*/i, '').trim(),
  };
}

/**
 * Итог голосования. Порядок — по числу голосов; отдельной строкой те, кого выбрали
 * чаще, чем ожидали: расхождение голоса с прогнозом и есть самое интересное в этой
 * комнате. Победителя не объявляем: решает человек, а не счёт.
 */
export function tallyVotes(ballots) {
  const votes = new Map();
  const guessed = new Map();
  for (const [, b] of ballots) {
    for (const n of b.for) votes.set(n, (votes.get(n) ?? 0) + 1);
    for (const n of b.guess) guessed.set(n, (guessed.get(n) ?? 0) + 1);
  }
  const names = [...new Set([...votes.keys(), ...guessed.keys()])];
  return names
    .map((name) => ({
      name,
      votes: votes.get(name) ?? 0,
      guessed: guessed.get(name) ?? 0,
      surprise: (votes.get(name) ?? 0) - (guessed.get(name) ?? 0),
    }))
    .sort((a, b) => b.votes - a.votes || b.surprise - a.surprise);
}

export class Orchestrator {
  constructor({ store, config, log = console, build = buildAgent, stateDir = null, think = ask, thinkAs = askAs }) {
    this.store = store;
    this.config = config;
    this.log = log;
    // Фабрика адаптеров — параметром: тесты подставляют заглушки вместо claude и codex.
    this.build = build;
    // Короткий вопрос движку: им пространство решает за себя — кого задело, что повторилось.
    // Тоже параметром и по той же причине: тест не должен ходить в сеть и платить за это.
    this.think = think;
    // Вопрос движку конкретного участника, мимо его сессии. Тоже параметром и по той же
    // причине, что и think: тест не должен поднимать настоящий claude и платить за это.
    this.thinkAs = thinkAs;
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
        blind: st.blind, circleAt: st.circleAt, act: st.act, cycle: st.cycle, cycles: st.cycles,
        run: st.run, pending: st.pending,
        upto: st.upto, paused: st.paused, autoTurns: st.autoTurns, closed: st.closed, epoch: st.epoch,
        off: st.off, offBefore: st.offBefore, archiveUpto: st.archiveUpto, minds: st.minds,
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

  /**
   * Кого задела реплика. Слова из зоны роли ловят тему, а не смысл: «а он-то поймёт?» —
   * это про Заступника, хотя ни одного его слова там нет. Спрашиваем дешёвую модель,
   * показав ей, к чему каждый неравнодушен и зачем вообще открывает рот: человек
   * вступает в разговор не потому, что прозвучало слово, а потому, что задело —
   * или потому, что хочется выпендриться перед тем, кто рядом.
   *
   * Молчание — нормальный ответ: «никого» значит, что никто и не придёт. Движок не
   * ответил или ответил ерундой — падаем на слова: грубая зацепка лучше, чем пауза.
   */
  /**
   * Что в слепом круге сказано дважды. Спрашиваем не «какие позиции одинаковые» — на такой
   * вопрос модель склеивает всё, что про одно и то же, — а тезис каждого по отдельности,
   * и только потом просим отметить те, что совпали по сути.
   *
   * Зачем: однородные агенты сходятся к одному ответу сами по себе, и слепой круг от этого
   * не спасает — он лишь прячет совпадение до момента, когда обсуждать уже нечего
   * (diversity collapse). Возвращённый ход тому, кто повторился, поднимает разброс
   * стартовых позиций — то же, что Diversity-aware Initialization делает пулом кандидатов,
   * только без второго прогона всей группы.
   */
  async echo(room, names) {
    const said = [];
    for (const name of names) {
      const mine = this.store.load(room).findLast((m) => m.kind === 'message' && m.from === name);
      if (mine?.text) said.push({ name, text: mine.text });
    }
    if (said.length < 3) return [];
    const answer = await this.think(`Люди высказались, не видя ответов друг друга:\n\n`
      + `${said.map((m) => `@${m.name}: ${String(m.text).slice(0, 700)}`).join('\n\n')}\n\n`
      + `Сначала на каждого — строка «Ник | тезис»: что именно он утверждает, одной фразой `
      + `и своими словами. Тезис — это утверждение, с которым можно не согласиться, а не тема.\n\n`
      + `Последней строкой: «Повторы: ник — чей тезис он повторил». Только те, чьи тезисы `
      + `совпадают по сути, а не просто сказаны об одном предмете: два разных довода на одну `
      + `тему — это не повтор. Никто не повторился — напиши «Повторы: нет».`,
    { cwd: this.config.workdir });
    const line = String(answer ?? '').split('\n').find((l) => /^повторы:/i.test(l.trim()));
    if (!line || /нет\s*$/i.test(line)) return [];
    const out = [];
    for (const part of line.replace(/^[^:]*:/, '').split(',')) {
      const m = part.trim().match(/^@?([^\s—-]+)\s*[—–-]\s*@?(.+)$/);
      if (!m) continue;
      const who = names.find((n) => n.toLowerCase() === m[1].trim().toLowerCase());
      const whom = said.find((x) => x.name.toLowerCase() === m[2].trim().toLowerCase());
      if (who && whom && who !== whom.name && !out.some(([n]) => n === who)) {
        out.push([who, String(whom.text).slice(0, 200)]);
      }
    }
    return out;
  }

  /**
   * Мысли участников об услышанном. Человек вступает в разговор не тогда, когда прозвучало
   * его слово, а когда его задело: по Inner Thoughts (CHI 2025) оценка собственной мотивации
   * даёт разговор живее и связнее, чем угадывание следующего говорящего. Спрашиваем дешёвую
   * модель: у каждого — мысль от первого лица и балл, насколько ему хочется её сказать.
   *
   * Балл решает судьбу мысли: высокий — говорит сейчас, средний — мысль остаётся в голове
   * и приезжает на его следующем ходу, низкий — забывается. Мысль, которой не дали ход,
   * и есть то, чего у нас не было: без неё каждая реплика — отклик на последнее сообщение,
   * и никто ничего не носит в себе.
   */
  async thoughts(room, text, exclude = []) {
    const pool = this.talkers(room).filter((n) => !exclude.includes(n));
    if (!pool.length || !String(text ?? '').trim()) return [];
    const cast = this.personas(room);
    const face = (n) => cast?.get(n)?.name ?? n;
    const held = this.state(room).held ?? {};
    const card = (n) => {
      const a = loadArchetype(face(n));
      const role = roleOf(this.roster[n]);
      const cares = a?.cares || role.on.join(', ') || role.brief;
      const motive = a?.motive ? ` Влезает в разговор, чтобы ${a.motive}` : '';
      // Мысль не стоит на месте: услышав новое, человек не повторяет прежнюю, а
      // доворачивает её. «Я на выходных песни писал» после разговора про инструменты
      // становится «а Дейзи-то пишет песни?» — и только потом, после её ответа,
      // возвращается к себе.
      const mind = held[n]?.thought ? ` В голове уже лежит: «${held[n].thought}»` : '';
      // Невысказанное прошлых ходов — часть того, задело его сейчас или нет: человек,
      // смолчавший дважды об одном и том же, на третий раз говорит.
      const kept = this.minds(room, n).at(-1);
      const quiet = kept ? ` При себе оставил: «${kept}»` : '';
      return `- @${face(n)}: ${cares}.${motive}${mind}${quiet}`;
    };
    const answer = await this.think(`В разговоре прозвучало:\n«${String(text).slice(0, 1200)}»\n\n`
      + `Вот кто это слышал:\n${pool.map(card).join('\n')}\n\n`
      + `Здесь смотрят на ${tuneOf(loadSpace(room)).criteria}.\n\n`
      + `На каждого — одна строка: «Ник | за | против | балл | мысль».\n`
      + `за — почему ему сейчас хочется это сказать, до восьми слов;\n`
      + `против — почему сейчас лучше промолчать, до восьми слов;\n`
      + `балл — 1–5, после того как взвесил обе стороны, а не до;\n`
      + `мысль — от первого лица, до ста знаков, та самая, что мелькнула бы в голове.\n\n`
      + `Шкала балла: 5 — молчать невозможно, это прямо про него или прямо неверно; `
      + `4 — есть что добавить по делу; 3 — мысль есть, но и без неё обойдутся; `
      + `2 — так, отметил про себя; 1 — мимо, сказать нечего.\n\n`
      + `Причину промолчать ищи всерьёз, а не для галочки: без неё все баллы выходят `
      + `завышенными. Большинству ставь 1 или 2 — в живом разговоре на каждую реплику `
      + `отзываются один-двое, а не все, и пятёрка тут редкость. У кого в голове уже лежит `
      + `мысль — не повторяй её слово в слово: доверни с учётом услышанного или замени, `
      + `если разговор ушёл. Ничего, кроме строк, не пиши.`,
    { cwd: this.config.workdir });
    if (!answer) return this.drawn(room, text, exclude, 1).map((name) => ({ name, score: 4, thought: '' }));
    const out = [];
    for (const line of answer.split('\n')) {
      // Ник, довод за, довод против, балл, мысль. Доводы нужны не нам, а модели:
      // написанный контраргумент удерживает её от того, чтобы всем раздать четвёрки.
      // Балл берём любым целым и зажимаем в шкалу: модель иногда отвечает «-9», имея
      // в виду «молчать», и строгая единица-пятёрка молча выбрасывала таких из разбора.
      // Выбросить всех — значит остаться без мыслей вовсе, и опять без единого слова.
      const m = line.match(/^\s*@?([^|]+?)\s*\|[^|]*\|[^|]*\|\s*(-?\d+)\s*\|\s*(.*)$/);
      if (!m) continue;
      const who = pool.find((n) => face(n).toLowerCase() === m[1].trim().toLowerCase());
      if (who && !out.some((x) => x.name === who)) {
        out.push({ name: who, score: Math.min(5, Math.max(1, Number(m[2]))), thought: m[3].trim() });
      }
    }
    // Кому дать подумать своей головой: тем, чья мысль и так не пропадёт, и не больше
    // двух разом. Ноль в настройке выключает это совсем — тогда думает одна общая голова,
    // как было раньше: дешевле, быстрее и площе.
    const howMany = this.config.ownMinds ?? OWN_MINDS;
    const close = [...out].sort((a, b) => b.score - a.score)
      .filter((m) => m.score >= HOLD_AT).slice(0, howMany);
    await Promise.all(close.map(async (m) => {
      try {
        const own = await this.ownMind(room, m.name, text, m.thought);
        // Своя голова сильнее общей: она знает голос, роль и то, чем этот человек живёт.
        // Не ответила или ответила не по форме — остаёмся с тем, что было.
        if (own) { m.score = own.score; m.thought = own.thought || m.thought; }
      } catch (e) { this.log.error(e); }
    }));

    // Поправка на молчание: чем дольше человека не было слышно, тем сильнее хочется
    // вставить слово. У них это множитель 1.02 на шаг, у нас шаг — реплика в ленте.
    const tail = this.store.load(room).filter((m) => m.kind === 'message').slice(-30);
    for (const m of out) {
      const last = tail.findLastIndex((x) => x.from === m.name);
      const quiet = last < 0 ? tail.length : tail.length - 1 - last;
      m.score *= QUIET ** quiet;
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /**
   * Кто из них говорит вслух. Мысль выше порога просится сама; мысль пониже остаётся
   * в голове и ждёт своего хода; остальное забывается. Плюс искра: когда сильных мыслей
   * нет вовсе, изредка отзывается тот, у кого мысль была хоть какая-то, — живой разговор
   * состоит не только из важного, и комната, которая молчит на всё не-важное, мертва.
   */
  speaks(room, mind, floor) {
    const tune = tuneOf(loadSpace(room));
    const say = floor ?? tune.reply;
    const loud = mind.filter((m) => m.score >= say).slice(0, 2);
    const rest = mind.filter((m) => !loud.includes(m) && m.score >= HOLD_AT);
    for (const m of rest) this.hold(room, m.name, m.thought);
    if (loud.length) {
      for (const m of loud) this.hold(room, m.name, m.thought);
      return loud.map((m) => m.name);
    }
    // Искра — только в своём разговоре. Влезать в чужой по случайности нельзя: там порог
    // поднят как раз затем, чтобы перебивали с мыслью, а не от избытка жизни.
    const spark = rest[0];
    if (spark && floor === undefined && Math.random() < tune.spontaneity) return [spark.name];
    return [];
  }

  /**
   * Кто видел этот кусок ленты. Не состав комнаты и не `here()`: упёршийся в лимит
   * ленту читал, просто сегодня не отвечает, а включённый, но ни разу не разбуженный
   * за сорок реплик, разговора не видел. Человек в списке всегда: он читает глазами,
   * и `lastSeen` про него ничего не знает.
   */
  saw(room, cursor) {
    const st = this.state(room);
    const lives = pick(loadSpace(room).cast, this.names, this.roster);
    return [this.config.user, ...lives.filter((n) => !st.off.includes(n)
      && (this.roster[n]?.role ?? '').toLowerCase() !== 'архивариус'
      && (this.agents.get(n)?.lastSeen.get(room) ?? -1) >= cursor)];
  }

  /** Последняя реплика участника в комнате: на неё могли ответить щелчком, а это тоже обращение. */
  mine(room, name) {
    return this.store.load(room).findLast((m) => m.from === name && m.kind === 'message')?.seq ?? -1;
  }

  /**
   * Мысль, которой не дали ход. Лежит до следующего хода этого участника и уходит вместе
   * с ним: непроизнесённое устаревает быстро, и «я, кстати, хотел сказать» через двадцать
   * реплик — это не память, а глухота.
   */
  hold(room, name, thought) {
    if (!thought) return;
    const st = this.state(room);
    st.held = { ...(st.held ?? {}), [name]: { thought, at: this.store.tail(room, 1)[0]?.seq ?? 0 } };
    this.save(room);
  }

  /**
   * Своя мысль своей головой. Общий вызов выше дёшев и хорош для отбора — кого задело,
   * кого нет, — но мысли он пишет все восемь одной моделью, и выходят они похожими
   * сильнее, чем если бы их думали врозь. Это эхо-камера в устройстве, а не в разговоре:
   * проверка на повтор её не видит, потому что смотрит на сказанное, а не на задуманное.
   *
   * Поэтому тем, чья мысль и так не пропадёт, даём подумать самим — их движком и их
   * моделью, мимо их сессии: для участника этого вопроса не существует, в истории
   * разговора его нет и хода он на него не тратит. Остальным своя голова не нужна:
   * их мысль всё равно забудется, а вызов стоит денег и секунд.
   */
  async ownMind(room, name, text, seed) {
    const cfg = this.roster[name];
    if (!cfg) return null;
    const face = this.personas(room)?.get(name)?.name ?? name;
    const voice = loadArchetype(face)?.voice ?? '';
    const role = roleOf(cfg);
    // Шаг «Поиск» из Inner Thoughts: мысль формируется не в пустоте. Раньше память
    // приезжала позже — уже в промпт хода, — и выходило, что вспоминает участник только
    // после того, как решил говорить. Задевает же его как раз то, что противоречит
    // тому, что он помнит. Берём короткую выдержку: это мысль, а не доклад.
    const know = this.memory?.brief(room, {
      me: name,
      tail: String(text).slice(0, 1200),
      seq: this.store.tail(room, 1)[0]?.seq ?? 0,
      limit: 1200,
    })?.text ?? '';
    const answer = await this.thinkAs(cfg, `Ты — @${face}. ${role.brief}\n`
      + (voice ? `Говоришь ты так: ${voice}\n` : '')
      + (know ? `\nТы это помнишь:\n${know}\n` : '')
      + `\nВ разговоре прозвучало:\n«${String(text).slice(0, 1200)}»\n\n`
      + (seed ? `Первое, что мелькнуло: «${seed}». Согласен — оставь, не согласен — напиши своё.\n` : '')
      + `Здесь смотрят на ${tuneOf(loadSpace(room)).criteria}.\n\n`
      + `Ответь ровно одной строкой: «балл | мысль».\n`
      + `балл — 1–5, насколько трудно тебе сейчас промолчать: 5 — невозможно, это прямо `
      + `про тебя или прямо неверно; 3 — мысль есть, но и без неё обойдутся; 1 — сказать нечего.\n`
      + `мысль — от первого лица, до ста знаков, та самая, что мелькнула бы у тебя в голове, `
      + `а не то, что ты сказал бы вслух.\n`
      + `Ничего, кроме этой строки, не пиши.`,
    { cwd: this.config.workdir, timeoutMs: 60_000 });
    const m = String(answer ?? '').match(/([1-5])\s*\|\s*(.+)/);
    return m ? { score: Number(m[1]), thought: m[2].trim() } : null;
  }

  /**
   * Скрытое мышление. Держим три последние невысказанные строки участника: дальше
   * это уже не то, с чем он остался, а дневник, и в промпте он начинает его пересказывать.
   * Лежит в состоянии комнаты, наружу не отдаётся ни в ленту, ни клиенту.
   */
  mind(room, name, line) {
    if (!line) return;
    const st = this.state(room);
    const at = this.store.tail(room, 1)[0]?.seq ?? 0;
    st.minds = { ...(st.minds ?? {}), [name]: [...(st.minds?.[name] ?? []), { text: line, at }].slice(-MINDS) };
    this.save(room);
  }

  /** Своё невысказанное — только своё. Чужое сюда не попадает никогда и ничем. */
  minds(room, name) {
    return (this.state(room).minds?.[name] ?? []).map((m) => m.text);
  }

  /** Забрать мысль из головы: она либо прозвучит сейчас, либо протухла. */
  take(room, name) {
    const st = this.state(room);
    const held = st.held?.[name];
    if (!held) return null;
    delete st.held[name];
    this.save(room);
    const now = this.store.tail(room, 1)[0]?.seq ?? 0;
    return now - held.at > HELD_FOR ? null : held.thought;
  }

  /** Кто участвует в этой комнате: состав минус выключенные и теневой найм.
   * Архивариуса не зовут в разговор — ни тегом мимо цели, ни как дежурного, ни по теме:
   * его работа — свёртка по вызову оркестратора, не ответ собеседнику. */
  /** Кто участвует в этой комнате: её состав минус выключенные, минус теневой найм.
   * Архивариуса не зовут в разговор — ни тегом мимо цели, ни как дежурного, ни по теме:
   * его работа — свёртка по вызову оркестратора, не ответ собеседнику. */
  here(room) {
    const st = this.state(room);
    const lives = pick(loadSpace(room).cast, this.names, this.roster);
    return lives.filter((n) => !st.off.includes(n)
      && !this.limited(n)
      && (this.roster[n]?.role ?? '').toLowerCase() !== 'архивариус');
  }

  limited(name) {
    const until = this.agents.get(name)?.limitedUntil ?? 0;
    return until > Date.now() ? until : 0;
  }

  /**
   * Участник упёрся в лимит — вместе с ним отходят все, кто сидит на том же движке
   * и той же модели: лимит у них общий, и каждый следующий принёс бы ту же ошибку.
   */
  limit(name, ms = null) {
    const cfg = this.roster[name] ?? {};
    const until = Date.now() + (ms ?? this.config.limitCooldownMs ?? LIMIT_COOLDOWN_MS);
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
  /**
   * Видна ли реплика этому участнику. Обычная — всем; реплика со списком `only` — только
   * тем, кто в нём. Человек видит всё всегда: он хозяин комнаты, а не её участник.
   *
   * Нужно там, где разговор идёт не при всех: парная встреча в чёрной комнате бессмысленна,
   * если её читают остальные четверо — они получат чужую идею раньше, чем встретятся с ней
   * сами, и вся затея с постепенным раскрытием превращается в обычное общее вскрытие.
   */
  visible(msg, name) {
    return !msg.only?.length || msg.only.includes(name);
  }

  tailFor(room, upto, name) {
    let tail = this.store.load(room)
      .filter((m) => (m.kind === 'message' || m.kind === 'mode') && this.visible(m, name));
    if (upto) tail = tail.filter((m) => m.seq <= upto);
    tail = tail.slice(-this.config.catchUp);
    let chars = tail.reduce((n, m) => n + String(m.text ?? '').length, 0);
    // Режем с головы, но пять последних реплик оставляем при любом размере: это и есть
    // то, на что участнику сейчас отвечать.
    while (tail.length > 5 && chars > TAIL_CHARS) chars -= String(tail.shift().text ?? '').length;
    return tail;
  }

  /** Свой ли режим у этого участника: не привязан ни к какому — свой всегда. */
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
        // Круг: идёт ли он сейчас, номер запуска, кто ещё не ответил и отметка барьера.
        // Барьер — та отметка, до которой читают ленту все, кто отвечает вслепую.
        blind: kept?.blind ?? false,
        // На какой реплике заводился прошлый круг: по ней видно, что на него ответили,
        // и можно заводить следующий.
        circleAt: kept?.circleAt ?? 0,
        // Комната встреч: какая фаза идёт и какой цикл из скольких.
        act: kept?.act ?? '',
        cycle: kept?.cycle ?? 0,
        cycles: kept?.cycles ?? 0,
        run: kept?.run ?? 0,
        pending: kept?.pending ?? [],
        upto: kept?.upto ?? 0,
        // Кого в этой комнате выключили. Участник остаётся в составе — он просто
        // не отвечает и не показывается здесь, а в других комнатах работает как был.
        off: kept?.off ?? [],
        // Курсор свёртки памяти: свой, не agent.lastSeen — непустой diff не решён до клика
        // человека, а lastSeen на архивных ходах вообще не обновляется.
        archiveUpto: kept?.archiveUpto ?? 0,
        // Невысказанное: у каждого своё и только своё. Переживает перезапуск —
        // иначе перезагруженный сервер стирает всем то, с чем они остались,
        // а это ровно та часть разговора, которой в ленте нет.
        minds: kept?.minds ?? {},
        // Метка темы в знаке: одно слово о том, чем комната занята. Меняется не по счётчику
        // реплик, а когда разговор действительно ушёл в другое.
        topic: kept?.topic ?? '',
        // Чем заняты. Левую половину знака держит комната, поэтому слово нужно только
        // в общей: там работы нет, и знак показывает, о чём вообще речь.
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
    return { autoTurns, paused, busy, thinking, limited, modeState: this.circleState(room) };
  }

  post(room, { from, text, kind = 'message', meta, files, replyTo, side, only }) {
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
      // Должность остаётся в самой реплике, а не считается по нынешней комнате: спор
      // читают и через день, и тогда по ленте всё равно должно быть видно, кто был
      // за, кто против и кто судил.
      side,
      // Кому реплика видна. Пусто — всем; список — разговор не при всех, и он
      // остаётся таким навсегда: видимость — свойство сказанного, а не настроек.
      only,
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
      rounds.open(st, msg.seq, room);
      st.autoTurns = 0;
      st.paused = false;
      st.closed = false;
      // В режиме очередь — это его шаги: сняв её, мы бы остановили режим навсегда.
      if (!st.blind) this.dropPending(room);
      else if (wasPaused) this.runCircle(room, st.run);
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
    if (kind === 'message') this.dispatch(room, msg).catch((e) => this.log.error(e));
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
    const { conflicts } = this.memory.commit(room, msg.diff ?? [], msg.from, {
      where: room,
      // Старые предложения присутствия не знают: пусто — значит видели все, как было
      // до этой правки. Иначе команда разом «забыла» бы собственные решения.
      saw: msg.saw ?? null,
      span: [msg.since ?? 0, msg.upto ?? 0],
    });
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
  /**
   * Расстановка: кто в комнате за что, именами и в одну строку. Комната объявляет
   * должности ролями — здесь они превращаются в ников, потому что спорят не роли,
   * а @Скептик и @Креатор.
   */
  lineup(room, space) {
    const here = this.here(room);
    const rows = (space.sides ?? []).map((side) => {
      const names = here.filter((n) => side.roles.includes((this.roster[n]?.role ?? '').toLowerCase()));
      return names.length ? `${side.label} — ${names.map((n) => `@${n}`).join(', ')}` : '';
    }).filter(Boolean);
    return rows.join('. ');
  }

  /**
   * Кем участники выходят в этом режиме: ник → персона. Сторона режима с именем, под которым
   * есть файл амплуа, — это не подпись, а другой человек: имя, знак, цвет и голос. Роль
   * при этом не меняется, иначе от смены имени ломались бы режимы, полюса и домены.
   */
  personas(room) {
    const st = this.state(room);
    const sides = loadSpace(room).sides ?? [];
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
  /** Состояние круга для интерфейса: кого он зовёт и кого ещё не дождался. */
  circleState(room) {
    const space = loadSpace(room);
    const st = this.state(room);
    return {
      name: space.name,
      title: space.title,
      titleEn: space.titleEn,
      slug: space.slug,
      short: space.short,
      shortEn: space.shortEn,
      color: space.color,
      icon: space.icon,
      // Кто здесь живёт и кого круг ещё не дождался. Клиенту это нужно, чтобы «ждёт»
      // и «ответил» в шапке были настоящим состоянием, а не догадкой по последней реплике.
      cast: this.here(room),
      pending: [...st.pending],
      // Идёт ли круг: пока идёт, участники отвечают, не видя друг друга.
      blind: !!st.blind,
      // Где мы в комнате встреч: фаза и номер цикла. Пусто — обычная комната.
      act: st.act ?? '',
      cycle: st.cycle ?? 0,
      cycles: st.cycles ?? 0,
      // Кем участники выходят в этой комнате: клиенту это нужно, чтобы имя в ленте,
      // цвет обращения и подсказка «@» показывали одного и того же человека.
      personas: Object.fromEntries([...(this.personas(room) ?? [])]
        .map(([nick, p]) => [nick, { name: p.name, labelEn: p.labelEn, icon: p.icon, color: p.color }])),
    };
  }

  /**
   * Новый ли это вопрос или уточнение к тому, что уже обсуждали. Первая реплика в комнате —
   * всегда новый вопрос, спрашивать не о чем. Дальше решает смысл: по счётчику реплик
   * «а что тогда с лимитом» ничем не отличается от «теперь разберём другое», а по смыслу
   * это разные вещи, и цена ошибки — четыре хода вслепую не о том.
   */
  async anew(room, msg) {
    const feed = this.store.load(room).filter((m) => m.kind === 'message');
    const before = feed.filter((m) => m.seq < msg.seq);
    if (!before.length) return true;
    const tail = before.slice(-6).map((m) => `@${m.from}: ${String(m.text).slice(0, 300)}`).join('\n\n');
    const answer = await this.think(`Вот конец разговора:\n\n${tail}\n\n`
      + `А это новая реплика человека:\n«${String(msg.text).slice(0, 600)}»\n\n`
      + `Он начал новую тему или продолжает ту же? Уточнение, возражение, «а что если», `
      + `ответ на чей-то вопрос — это продолжение. Новая тема — когда о прежнем речи `
      + `больше нет.\n\nОтветь одним словом: «новая» или «продолжение».`,
    { cwd: this.config.workdir });
    return /новая/i.test(String(answer ?? ''));
  }

  /**
   * Первый круг: все отвечают на вопрос человека, не видя чужих ответов. Однородные
   * участники сходятся к одному ответу сами по себе, и первый, кто заговорил, тянет
   * за собой остальных — слепой круг это отменяет, и по литературе это единственный
   * приём, который сам по себе делает группу умнее людей в ней.
   *
   * Заводится сам, по вопросу человека, и кончается сам, когда все ответили. Шага
   * в интерфейсе нет: человек видит строку «отвечают, не видя друг друга» и гаснущие
   * аватарки тех, кого ещё ждут.
   */
  circle(room) {
    const space = loadSpace(room);
    const st = this.state(room);
    const cast = this.here(room);
    // Круг вдвоём — уже круг: третьего могло не стать из-за лимита подписки или
    // тумблера, и молчать об этом хуже, чем ответить вдвоём. Про упёршихся в лимит
    // человеку скажет отдельная строка, она пишется на ту же его реплику.
    if (!space.circle || cast.length < 2) return false;

    // Новый круг — новый номер. Цепочка прежнего, дожив до конца своего хода, увидит
    // чужой номер и ничего не сдвинет.
    st.run += 1;
    st.blind = true;
    st.circleAt = this.store.load(room).at(-1)?.seq ?? 0;
    st.pending = cast;
    st.autoTurns = 0;
    // Барьер: все читают ленту до одной и той же отметки. После паузы опоздавшие
    // дочитают до неё же, а не до чужих ответов.
    st.upto = this.store.load(room).at(-1)?.seq ?? 0;
    this.dropPending(room);
    this.runCircle(room, st.run);
    this.save(room);
    return true;
  }

  /**
   * Комната встреч. Сначала каждый думает сам — это круг, он прошёл до сюда. Дальше
   * решения открываются не всем сразу, а через серию встреч один на один: пара вскрывает
   * позиции, спорит, расходится, и каждый переписывает своё в одиночку. Так до тех пор,
   * пока каждый не увидит каждого — или пока встречи не перестанут менять позиции.
   *
   * Смысл в том, что общего вскрытия нет до самого конца. Идея расходится по комнате
   * шаг за шагом, и у участника никогда нет вида сверху: до встречи с автором он знает
   * его мысль только по следам, которые донесли соседи. Это дороже общего обсуждения,
   * но и схлопывания в одну позицию здесь не происходит: сходиться попросту не с кем.
   */
  async protocol(room) {
    const space = loadSpace(room);
    const st = this.state(room);
    const run = st.run;
    const epoch = st.epoch;
    const live = () => st.run === run && st.epoch === epoch && !st.paused;
    const cast = this.here(room);
    // Вдвоём встречаться не с кем: это обычный разговор, а не распространение идей.
    if (!space.meet || cast.length < 3) return;

    const plan = meetings(cast);
    st.act = 'встречи';
    st.cycles = plan.length;
    this.save(room);

    for (const [i, pairs] of plan.entries()) {
      if (!live()) return this.close(room);
      st.cycle = i + 1;
      this.save(room);
      this.mark(room, `Цикл ${i + 1} из ${plan.length}: ${pairs.map(([a, b]) => `@${a} ↔ @${b}`).join(', ')}`);
      // Пары говорят одновременно и друг друга не слышат.
      await Promise.all(pairs.map(([a, b]) => this.meet(room, space, a, b)));
      if (!live()) return this.close(room);

      // После встречи каждый уходит и переписывает своё. Ответа пары не существует:
      // две головы важнее одного общего вывода, ради этого всё и затевалось.
      await Promise.all(cast.map((n) => this.turn(room, n, {
        step: { name: 'пересборка', hear: false, prompt: space.rework },
        only: [n],
      })));
      if (!live()) return this.close(room);

      // Встречи перестали менять позиции — дальше круговой турнир только жжёт деньги.
      if (i < plan.length - 1 && await this.settled(room, cast)) {
        this.mark(room, 'Позиции перестали меняться — встречи закончены досрочно');
        break;
      }
    }

    if (!live()) return this.close(room);

    // Единственное общее вскрытие за всю комнату — и оно в самом конце.
    st.act = 'защита';
    this.save(room);
    this.mark(room, 'Защита: каждый показывает, к чему пришёл');
    const show = cast.map((n) => this.own(room, n)).filter(Boolean);
    for (const n of cast) {
      if (!live()) return this.close(room);
      await this.turn(room, n, { step: { name: 'защита', hear: true, prompt: space.defend }, show });
    }

    if (!live()) return this.close(room);

    // Оценка вслепую и одновременно: голос, поданный на глазах у других, сползает
    // к первому поданному, и вместо оценки идей выходит оценка того, кто заговорил раньше.
    st.act = 'оценка';
    st.upto = this.store.tail(room, 1)[0]?.seq ?? 0;
    this.save(room);
    await Promise.all(cast.map((n) => this.turn(room, n, {
      step: { name: 'оценка', hear: false, prompt: space.vote },
      upto: st.upto,
      only: [n],
    })));
    if (live()) this.tally(room, cast);
    this.close(room);
  }

  /**
   * Свести бюллетени и положить итог в ленту. Пишет его пространство, а не участник:
   * это арифметика, и голос ей не нужен. Победителя не называем — в каноне решает человек,
   * и комната, которая объявляет победителя, начинает решать за него.
   */
  tally(room, cast) {
    const feed = this.store.load(room);
    const ballots = cast
      .map((n) => [n, feed.findLast((m) => m.from === n && m.kind === 'message' && m.only?.length)])
      .filter(([, m]) => m)
      // Своя позиция в свой бюллетень не идёт: за себя не голосуют.
      .map(([n, m]) => {
        const v = parseVote(m.text, cast.filter((x) => x !== n));
        return [n, { ...v, for: v.for.filter((x) => x !== n), guess: v.guess.filter((x) => x !== n) }];
      });
    if (!ballots.length) return;

    const rows = tallyVotes(ballots);
    if (!rows.length) return;

    // Как менялась уверенность за всю комнату: от первого решения вслепую до защиты.
    // Считаем по ленте, а не по отдельному счётчику — число стоит в самих репликах,
    // и вторая его копия рано или поздно разойдётся с первой.
    const since = this.state(room).circleAt ?? 0;
    const sures = cast.map((n) => [n, feed
      .filter((m) => m.from === n && m.kind === 'message' && m.seq > since)
      .map((m) => sure(m.text))
      .filter((x) => x !== null)]);
    const path = drift(sures);
    const weighed = weighVotes(rows, sures);
    const line = (r) => `@${r.name} — ${r.votes} ${plural(r.votes)}`
      + (r.surprise > 0 ? `, а ждали ${r.guessed}` : '');
    const surprise = rows.filter((r) => r.surprise > 0);
    const why = ballots
      .map(([who, b]) => (b.why ? `@${who}: ${b.why}` : ''))
      .filter(Boolean);

    this.store.append(room, {
      from: 'system',
      kind: 'system',
      text: [
        `Голоса: ${rows.map(line).join('; ')}.`,
        surprise.length
          ? `Выбрали чаще, чем ожидали: ${surprise.map((r) => `@${r.name}`).join(', ')} — `
            + 'это те решения, которые каждый счёл сильными, думая, что остальные их не выберут.'
          : 'Никого не выбрали неожиданно: голоса совпали с прогнозами.',
        why.length ? why.join('\n') : '',
        weighed.length
          ? `С поправкой на уверенность: ${weighed.map((r) => `@${r.name} — ${r.share}%`).join('; ')}. `
            + 'Числа нормированы, и голоса весят вдвое против собственного числа: '
            + 'уверенность здесь доля, а не самооценка.'
          : '',
        path,
        `@${this.config.user}, счёт совещательный: выбирать вам.`,
      ].filter(Boolean).join('\n\n'),
      mentions: [this.config.user],
    });
  }

  /** Служебная отметка о ходе комнаты: человеку видно, где он сейчас в протоколе. */
  mark(room, text) {
    this.store.append(room, { from: 'system', kind: 'system', text, mentions: [] });
  }

  /** Последняя собственная реплика участника: она и есть его нынешняя позиция. */
  own(room, name) {
    return this.store.load(room).findLast((m) => m.from === name && m.kind === 'message')?.seq;
  }

  /** Конец протокола: фазы больше нет, ход у человека. */
  close(room) {
    const st = this.state(room);
    st.act = '';
    st.cycle = 0;
    this.save(room);
  }

  /**
   * Одна встреча. Пара вскрывает друг другу позиции — их до сих пор не видел никто,
   * кроме человека, — и говорит наедине: по две реплики с каждой стороны. Остальным
   * этот разговор не виден, и дальше он существует для них только в том, что каждый
   * из двоих напишет после него сам.
   */
  async meet(room, space, a, b) {
    const show = [this.own(room, a), this.own(room, b)].filter(Boolean);
    const say = (me, other) => ({
      name: 'встреча',
      hear: true,
      prompt: String(space.meet ?? '').replaceAll('@ДРУГОЙ@', `@${other}`),
    });
    for (let i = 0; i < 2; i += 1) {
      await this.turn(room, a, { step: say(a, b), only: [a, b], show });
      await this.turn(room, b, { step: say(b, a), only: [a, b], show });
    }
  }

  /**
   * Перестали ли встречи менять позиции. Сравниваем последнюю пересборку каждого с его же
   * предыдущей: если почти никто не сдвинулся, следующий цикл ничего не добавит, а стоит
   * как все прежние. Дешёвый вопрос движку — тот же, что ловит повторы в круге.
   */
  async settled(room, cast) {
    const moved = [];
    for (const name of cast) {
      const mine = this.store.load(room).filter((m) => m.from === name && m.kind === 'message');
      if (mine.length < 2) return false;
      const [was, now] = mine.slice(-2);
      const answer = await this.think(`Человек переписал свою позицию после разговора.\n\n`
        + `Было:\n«${String(was.text).slice(0, 700)}»\n\nСтало:\n«${String(now.text).slice(0, 700)}»\n\n`
        + `Изменилась ли позиция по сути — появилось ли новое соображение, ушло ли прежнее, `
        + `сместился ли вывод? Переписанное теми же словами и уточнение формулировки — `
        + `это «нет».\n\nОтветь одним словом: «да» или «нет».`, { cwd: this.config.workdir });
      moved.push(/да/i.test(String(answer ?? '')));
    }
    // Сдвинулся один из всех — это шум, а не работа цикла.
    return moved.filter(Boolean).length <= 1;
  }

  /**
   * Спросить тех, кто в круге ещё не ответил. Круг — задача в очереди комнаты, поэтому
   * он не стартует поверх чужого хода и занятый участник не выпадает молча. Пауза круг
   * замораживает: кто уже пишет — договорит, остальных спросим этим же методом после неё.
   */
  runCircle(room, run) {
    this.enqueue(room, async () => {
      const st = this.state(room);
      const live = () => st.run === run && st.blind && !st.paused;
      if (!live()) return;

      const space = loadSpace(room);
      const step = { name: 'круг', hear: false, prompt: space.circle };
      // Кто в этой комнате за что. Считаем один раз на круг: состав внутри него не меняется.
      const lineup = this.lineup(room, space);
      const ctx = { step, upto: st.upto };
      const ask = async (name, extra = '') => {
        if (!live()) return;
        // Своя должность — у каждого своя, поэтому задание клонируем на участника.
        const side = sideOf(space, this.roster[name]?.role);
        const own = extra ? { ...step, prompt: `${step.prompt}${extra}` } : step;
        const mine = lineup ? { ...ctx, step: { ...own, lineup, side } } : { ...ctx, step: own };
        // В комнате встреч первый ответ не видит никто, кроме человека: решения там
        // открываются через встречи, а не сразу всем. В обычной комнате круг общий.
        if (space.meet) mine.only = [name];
        const asked = await this.turn(room, name, mine);
        if (asked && st.run === run) st.pending = st.pending.filter((n) => n !== name);
        // Круг двигается — состояние на диск: перезапуск должен застать его здесь же.
        this.save(room);
      };

      const crowd = [...st.pending];
      await Promise.all(crowd.map(ask));
      if (!live() || st.pending.length) return;

      // Круг мог схлопнуться: писали не глядя друг на друга, а вышло одно и то же разными
      // словами. Дальше спорить не о чем — обсуждение начнётся с одной позиции,
      // размноженной на всех. Тем, кто повторился, возвращаем ход.
      if (crowd.length > 2) {
        const again = await this.echo(room, crowd);
        if (!live()) return;
        for (const [name, same] of again) {
          const say = `\n\nТвою мысль уже сказал другой: «${same}». Она не твоя и не новая. `
            + 'Дай вместо неё другую — ту, которой ни у кого нет. Не спорь с ним и не поправляй '
            + 'его: в этом круге ценно расхождение, а не согласие.';
          st.pending = [name];
          await ask(name, say);
        }
        if (!live() || st.pending.length) return;
      }

      // Круг кончился сам. Дальше разговор идёт обычным путём, а ход — у человека:
      // перед ним несколько независимых позиций, ради этого круг и заводился.
      st.blind = false;
      this.save(room);

      // Кроме комнаты встреч: там круг — только начало, дальше позиции расходятся
      // по комнате через разговоры один на один.
      if (space.meet) await this.protocol(room);
    });
  }

  limitNotice(room, msg) {
    const st = this.state(room);
    const present = pick(loadSpace(room).cast, this.names, this.roster).filter((n) => !st.off.includes(n)
      && (this.roster[n]?.role ?? '').toLowerCase() !== 'архивариус');
    const down = present.filter((n) => this.limited(n));
    if (!down.length) return;
    const asked = (msg.mentions ?? []).filter((n) => down.includes(n));
    const all = down.length === present.length;
    // Молчать стоит только о том, кого и не звали. В комнате с кругом зовут всех разом,
    // поэтому выпавший из-за лимита меняет сам разговор: круг пройдёт без него.
    const circling = !!loadSpace(room).circle && msg.from === this.config.user
      && !(msg.mentions ?? []).length;
    if (!asked.length && !all && !circling) return;
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
        : `${(asked.length ? asked : down).map((n) => `@${n}`).join(', ')} до ${at} не отвечает: лимит подписки. Ответить могут остальные`,
      mentions: [],
    });
  }

  async dispatch(room, msg) {
    const st = this.state(room);
    if (st.paused) return;
    if (msg.from === this.config.user) this.limitNotice(room, msg);

    // Круг идёт — ходами распоряжается он: будить по репликам некого, все и так пишут.
    // Реплика человека посреди круга ложится в ленту и доедет дельтой тем, кто ещё
    // не ответил; барьер отрежет её от тех, кто уже пишет.
    if (st.blind) return;

    let targets = resolveTargets(msg, this.here(room), this.store.load(room));
    // Кто уже обратился к человеку и не дождался ответа — тот ход передал и говорить
    // ему больше нечего. Без этого Продюсер за один разговор трижды подряд напоминал
    // об одном и том же: «жду три ответа», «нужно твоё да», «подтверди список».
    const waiting = this.awaiting(room);

    if (!targets.length) {
      if (msg.from === this.config.user) {
        // Вопрос без адресата в комнате, где заведён круг, — отвечают все и не видя
        // друг друга. Человеку не надо ничего включать: круг и есть то, как эта комната
        // работает. Но только на новый вопрос: «а что тогда с лимитом» — это продолжение
        // той же мысли, и гонять по такому уточнению всех вслепую значит превратить
        // комнату в анкету. Новый он или нет — решает смысл, а не счётчик реплик,
        // поэтому спрашиваем дешёвую модель. Не ответила — круга не будет: пропущенный
        // круг это обычный разговор, а лишний стоит четырёх ходов.
        if (loadSpace(room).circle && await this.anew(room, msg)) {
          if (this.circle(room)) return;
        }

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
        // В разговоре отвечает не один. Трёп держится на том, что реплики отскакивают
        // друг от друга: один точный ответ закрывает вопрос, а вместе с ним и разговор.
        // Тема даёт первых, дальше добираем теми, кого дольше всех не было слышно.
        const chat = chatty(room);
        targets = this.drawn(room, msg.text, [], chat ? 3 : 2);
        if (chat) {
          while (targets.length < 3) {
            const [next] = this.quietest(room, here.filter((n) => !targets.includes(n)));
            if (!next) break;
            targets = [...targets, next];
          }
        }
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
        // В разговорном режиме реплика в воздух — тоже ход: за столом на неё отзовётся
        // тот, кто дольше всех молчал. В рабочем так нельзя — это и есть тот курятник,
        // где на один вопрос прилетает десять реплик по кругу. И не бесконечно: после
        // трёх ходов подряд без человека разговор идёт уже без него — и уезжает
        // тем дальше, чем дольше его никто не держит за землю.
        const CHATTY = 3;
        if (!targets.length && chatty(room) && st.autoTurns < CHATTY) {
          // Отзывается тот, кого реплика задела, а не тот, кто дольше молчал: очередь
          // даёт слово тому, кому нечего сказать, и разговор превращается в дежурство.
          // Не задело никого — цепочка кончилась, и ход вернётся человеку.
          const mind = await this.thoughts(room, msg.text, [msg.from, ...waiting]);
          targets = this.speaks(room, mind);
        }
      }
    }
    // Цепочка упёрлась: продолжать не с кем, а человека никто не позвал. Раньше здесь
    // наступала тишина — по экрану не отличить «сейчас ответят» от «всё, дальше вы».
    // Ход возвращает участник словами, а не интерфейс подписью: кто-то один говорит,
    // что от человека нужно.
    if (!targets.length) {
      // Только в свободном разговоре: в режиме ходами распоряжается он, а с выключенным
      // freeTalk тишина после ответа — это и есть договорённость «дальше ждём человека».
      // Разговорный режим — та же открытая комната, просто с лицами: ходами в нём
      // никто не распоряжается, и молчание в конце цепочки выглядит так же, как
      // «сейчас ответят». Человек спрашивал — ему и отвечать последним словом.
      const free = this.config.freeTalk !== false;
      if (free && msg.from !== this.config.user && !st.closed) this.handBack(room);
      // И то же для работы: разговор встал, а с прошлого захода Сборщика накопился
      // десяток реплик — значит есть что свести в вещь. Он смотрит сам, а не ждёт
      // слова «собери»: продюсер, которого вызывают заклинанием, — это команда, а не роль.
      this.assemble(room);
      return;
    }

    // Втроём разговор держится сам, и остальные не просыпаются вовсе: цепочка идёт
    // по тегам между теми же тремя. К отвечающему добавляется тот, чью зону задела
    // сама реплика, — и только он: будить молчуна по очереди значит получить реплику
    // ни о чём, а человек за неё платит как за любую другую. Не задело никого —
    // никто и не приходит.
    if (chatty(room) && targets.length) {
      const said = this.store.load(room);
      const from = said.findLast((m) => m.from === this.config.user)?.seq ?? 0;
      const spoke = said.filter((m) => m.seq > from && m.kind === 'message').map((m) => m.from);
      const skip = [...new Set([...spoke, ...targets, msg.from])];
      // Ответа не ждём: спросить движок дороже по времени, чем сам ход, и разговор
      // вставал бы на полминуты перед каждой репликой. Очередь комнаты держит порядок —
      // задетый встанет в неё следом за теми, кто отвечает сейчас.
      this.thoughts(room, msg.text, skip)
        .then((mind) => {
          // Реплика адресована другому, поэтому влезть можно только с мыслью, которую
          // невозможно не сказать: порог здесь выше обычного. Остальные мысли остаются
          // в головах и приедут на своих ходах.
          const [top] = this.speaks(room, mind, tuneOf(loadSpace(room)).intervene);
          if (top) this.enqueue(room, () => this.turn(room, top, { after: true }));
        })
        .catch((e) => this.log.error(e));
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
      .filter((m) => m.from !== name && !['system', 'skip', 'memory-proposal', 'memory-resolved'].includes(m.kind))
      // Разговор не при всех: чужая пара в дельту не попадает. Исключение — то,
      // что этому ходу показывают нарочно: встреча начинается с того, что пара
      // вскрывает друг другу позиции, написанные до того втайне.
      .filter((m) => this.visible(m, name) || ctx.show?.includes(m.seq));

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
        delta = this.tailFor(room, ctx.upto, name);
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
        // История для цитат: тоже только то, что этот участник мог видеть.
        history: this.store.load(room).filter((m) => this.visible(m, name)),
        step: ctx.step,
        ctx: {
          me: name,
          persona,
          // Мысль, которую он придумал раньше, но сказать не успел: ход ушёл другому.
          // Забираем из головы — прозвучит сейчас или не прозвучит вовсе.
          thought: this.take(room, name),
          // То, что он оставил при себе на прошлых ходах. Едет только в его собственный
          // промпт: это и есть вся защита скрытого мышления, другой не требуется.
          minds: this.minds(room, name),
          // Прямой вопрос — обязательство ответить: в разговоре людей первая часть
          // смежной пары закрывается второй, и следующий ход принадлежит адресату.
          // Без этого вопрос тонет: отвечающий говорит о своём и темы не меняет.
          asked: delta.some((m) => m.from !== name
            && /[?？]/.test(String(m.text ?? ''))
            && ((m.mentions ?? []).includes(name) || m.replyTo === this.mine(room, name))),
          // Режим без регламента — это трёп, и промпт у него свой: рабочие правила
          // там душат голос персонажа, ради которого режим и включали.
          talk: chatty(room),
          roster: this.roster,
          user: this.config.user,
          workdir: this.config.workdir,
          // Законы пространства плюс уклад комнаты: общее правило и то, как здесь принято.
          laws: [this.config.laws, loadSpace(room).laws].map((x) => String(x ?? '').trim())
            .filter(Boolean).join('\n\n'),
          // Память своя у каждого: что он видел сам — с подробностями, чего не видел —
          // со слов и с пометкой. Свёртке память не даём: архивариус и так получает её
          // в самом шаге, а две копии в одном промпте начинают спорить.
          memory: ctx.archive ? { text: '', told: false } : (this.memory?.brief(room, {
            me: name,
            // Хвост режем по тому же барьеру, что и дельту: иначе на круге подбор записей
            // считался бы по чужим ответам, которых участник ещё не видел.
            tail: delta.map((m) => m.text).join(' ').slice(0, 2000),
            seq: this.store.tail(room, 1)[0]?.seq ?? 0,
          }) ?? { text: '', told: false }),
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
        // Движок не пускает — это не реплика участника и не его беда: чинит человек,
        // одной командой. Английский текст движка не оставляем вовсе: в нём нет ничего,
        // кроме слова OAuth, а место в ленте он занимает как реплика.
        if (saysAuth(res.error) && this.limited(name)) return true;
        if (saysAuth(res.error)) {
          const engine = String(this.roster[name]?.kind ?? '').trim();
          const { names } = this.limit(name, AUTH_COOLDOWN_MS);
          const who = names.map((n) => `@${n}`).join(', ');
          const how = LOGIN[engine];
          text = [
            `Движок ${engine || 'участника'} разлогинен и поэтому молчит.`,
            how ? `Войти: ${how} — в терминале, руками.` : 'Нужно войти в движок заново.',
            `Пока этого нет, не отвечают: ${who}.`,
          ].join('\n');
        }
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
          // Кто при этом был — считаем сейчас, а не на клике: карточка может провисеть
          // сутки, и за это время человек выключит половину комнаты. Присутствие — факт
          // прошлого, а не нынешнего состава.
          saw: this.saw(room, this.state(room).archiveUpto ?? 0),
          since: this.state(room).archiveUpto ?? 0,
          mentions: [this.config.user],
        });
        return true;
      }

      // Прочитано то, что участнику реально отправили, а не всё, что успело появиться
      // в ленте, пока он думал: иначе реплика, пришедшая посреди хода, до него не дойдёт.
      agent.lastSeen.set(room, ctx.upto ?? delta.at(-1)?.seq ?? seen ?? 0);

      // Скрытое мышление: строку «[про себя] …» отрезаем раньше, чем текст станет
      // репликой. Сказать вслух было нечего, а при себе осталось — ход всё равно
      // не пустой: мысль ляжет в голову и вернётся к нему одному.
      const { text: aloud, aside: kept } = aside(res.text ?? '');
      if (kept) this.mind(room, name, kept);
      let text = aloud;
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
        // Кому эта реплика видна. Пусто — всем; список — разговор не при всех.
        only: ctx.only,
        meta: { ...res.meta, elapsedMs: Date.now() - started },
      });
      void posted;
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
      const ceiling = st.blind ? st.upto : Infinity;

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
    const st = this.state(room);
    // В разговоре слово человеку возвращает тот, кто в нём и был: молчавшему весь
    // разговор нечего сказать о том, к чему пришли, — выйдет дежурная фраза.
    // Но не тот, кто говорил последним: два хода подряд от одного — это монолог.
    const spoke = chatty(room)
      ? [...new Set(this.store.load(room).filter((m) => m.kind === 'message'
        && here.includes(m.from)).map((m) => m.from))].reverse().slice(1)
      : [];
    const name = spoke[0] ?? this.quietest(room, here)[0] ?? here[0];
    if (!name) return;
    st.closed = true;
    rounds.close(st);
    this.enqueue(room, () => this.turn(room, name, {
      step: {
        name: 'ход человека',
        hear: true,
        prompt: chatty(room)
          // В разговоре человек не «владелец задачи», у которого что-то требуют: он
          // спросил и слушал, как вы это крутите. Последнее слово — ему, и сказать его
          // надо своим голосом, а не протоколом совещания.
          ? `Разговор выдохся. Спрашивал @${this.config.user} — ему и последнее слово: одной `
            + `фразой и своими словами скажи, к чему вы тут пришли и что теперь за ним. `
            + `Разговор не пересказывай, за внимание не благодари.`
          : `Разговор упёрся: добавить больше нечего, а решение за человеком. Одной фразой `
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
    // Дежурные — поле комнаты; пусто — отвечает весь её состав.
    const space = loadSpace(room ?? '');
    return space.duty ? pick(space.duty, names, this.roster) : [...names];
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
      if (st.blind) this.runCircle(room, st.run);
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
      if (st.paused || !st.blind || !st.pending.length) continue;
      this.runCircle(room, st.run);
      woken.push({ room, pending: [...st.pending] });
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
    if (!answered) this.dispatch(room, last).catch((e) => this.log.error(e));
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
    st.blind = false;
    // Лента нумеруется заново с 1 — курсор свёртки, оставшийся большим, замолчал бы
    // до тех пор, пока новая лента не дорастёт до старого номера.
    st.archiveUpto = 0;
    // Знак пустой комнаты — open(space), а не то, чем в ней занимались вчера: лента
    // очищена, разговора нет, и «writing(round)» в шапке описывает то, чего больше нет.
    st.topic = '';
    st.doing = '';
    st.topicAt = 0;
    st.doingAt = 0;
    // Невысказанное — часть очищенного разговора, а не отдельное имущество участника:
    // оставить его — значит на первом же ходу в пустой комнате припомнить то, чего
    // в ней никто не говорил.
    st.minds = {};
    st.held = {};

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
