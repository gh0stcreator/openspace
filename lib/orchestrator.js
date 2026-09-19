import { buildAgent } from './agents.js';
import { dropState, readState, writeState } from './state.js';
import { parseMentions, resolveTargets } from './mentions.js';
import { roleOf } from './roles.js';
import { BUILTIN, loadMode, stepTargets } from './modes.js';

const SKIP = /^\[skip\]$/i;

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

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
    for (const [name, agent] of this.agents) {
      const at = agent.lastSeen.get(room);
      if (at !== undefined) seen[name] = at;
      const sid = agent.impl.session?.(room);
      if (sid) sessions[name] = sid;
    }
    try {
      writeState(this.stateDir, room, {
        mode: st.mode, step: st.step, run: st.run, pending: st.pending,
        upto: st.upto, paused: st.paused, autoTurns: st.autoTurns, epoch: st.epoch,
        off: st.off, seen, sessions,
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
   * Эстету нечего сказать про деплой, даже если там мелькнуло слово «выглядит».
   *
   * Совпадение считаем по целому слову: `код` не должен срабатывать на «кодекс». Границу
   * пишем руками, потому что \b в JS знает только латиницу и на кириллице врёт.
   */
  resonates(room, text, already) {
    const t = String(text ?? '');
    const hit = (word) => {
      const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^\\p{L}\\p{N}])${safe}($|[^\\p{L}\\p{N}])`, 'iu').test(t);
    };
    let best = null;
    let top = 0;
    for (const name of this.here(room)) {
      if (already.includes(name)) continue;
      const role = roleOf(this.roster[name]);
      if (role.off.some(hit)) continue;
      const score = role.on.filter(hit).length;
      if (score > top) { top = score; best = name; }
    }
    return best;
  }

  /** Кто участвует в этой комнате: состав минус выключенные. */
  here(room) {
    const off = this.state(room).off;
    return this.names.filter((n) => !off.includes(n));
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
        // Кого в этой комнате выключили. Участник остаётся в составе — он просто
        // не отвечает и не показывается здесь, а в других комнатах работает как был.
        off: kept?.off ?? [],
      });
      // Участники возвращают себе прочитанное и свои сессии: иначе после перезапуска
      // они читают ленту заново и отвечают уже отвеченное.
      for (const [name, agent] of this.agents) {
        if (kept?.seen?.[name] !== undefined) agent.lastSeen.set(room, kept.seen[name]);
        if (kept?.sessions?.[name]) agent.impl.adopt?.(room, kept.sessions[name]);
      }
    }
    return this.rooms.get(room);
  }

  /** Состояние комнаты для интерфейса. Очередь и номера запусков наружу не отдаём. */
  view(room) {
    const { autoTurns, paused } = this.state(room);
    return { autoTurns, paused, modeState: this.modeState(room) };
  }

  post(room, { from, text, kind = 'message', meta, files, replyTo }) {
    const known = [...this.names, this.config.user];
    const msg = this.store.append(room, {
      from,
      text,
      kind,
      meta,
      files,
      replyTo,
      mentions: parseMentions(text, known),
    });

    if (from === this.config.user) {
      // Человек вмешался: счётчик автоходов обнуляется, пауза снимается, а очередь
      // ходов, собранная до его реплики, отменяется — иначе команда ещё несколько
      // минут отвечает на старое, и человеку кажется, что его не слышат.
      const st = this.state(room);
      const wasPaused = st.paused;
      st.autoTurns = 0;
      st.paused = false;
      // В режиме очередь — это его шаги: сняв её, мы бы остановили режим навсегда.
      if (!st.mode) this.dropPending(room);
      else if (wasPaused) this.runStep(room, st.run);
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
    return this.store.edit(room, seq, text, { mentions: parseMentions(text, known) });
  }

  /**
   * Запустить режим: участники идут по шагам, а не отвечают вразнобой.
   * Главное здесь — шаг с `hear: нет`: все отвечают на одну и ту же ленту, не видя
   * ответов друг друга. Иначе первый ответивший ставит якорь и остальные его обслуживают.
   */
  startMode(room, name) {
    const mode = loadMode(name);
    const st = this.state(room);
    // Режим задаёт состав: остаются те, кого зовут его шаги. Считаем по всей команде,
    // а не по нынешнему присутствию, иначе выключенный однажды не вернётся никогда.
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

    // В пустой комнате режим ждёт: шаги нужны разговору о чём-то, а не самим себе.
    // Первая реплика человека и есть тема — она же и запускает первый шаг.
    if (this.store.load(room).some((m) => m.kind === 'message')) this.nextStep(room);
    this.save(room);
    return this.modeState(room);
  }

  stopMode(room) {
    const st = this.state(room);
    this.save(room);
    st.run += 1;
    st.mode = null;
    st.step = 0;
    st.pending = [];
    // Разговор без регламента — снова вся команда: там отвечает тот, кого позвали.
    st.off = [];
    return this.modeState(room);
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
      steps: mode.steps.length,
      stepName: step?.name ?? '',
      // Пока шаг не начался, ждём человека: без темы режиму не с чем работать.
      hear: step?.hear !== false,
      waitingUser: st.step < 0 || step?.until === 'человек',
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

      const step = loadMode(st.mode).steps[st.step];
      // На шаге со слухом барьера нет: каждый следующий видит ответы предыдущих.
      const ctx = step.hear ? { step } : { step, upto: st.upto };
      const ask = async (name) => {
        if (!live()) return;
        const asked = await this.turn(room, name, ctx);
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

  dispatch(room, msg) {
    const st = this.state(room);
    if (st.paused) return;

    // В режиме ходами распоряжается режим. Человек вмешивается репликой: с тегом — это
    // разговор, адресат ответит, как только шаг отпустит очередь, сам шаг стоит на месте;
    // без тега — закрывает шаг, если тот ждёт человека. Реплики участников никого не будят.
    if (st.mode) {
      if (msg.from !== this.config.user) return;
      // Режим ждал темы — она появилась.
      if (st.step < 0) return this.nextStep(room);
      const asked = resolveTargets(msg, this.here(room));
      if (asked.length) {
        for (const name of asked) this.enqueue(room, () => this.turn(room, name));
        return;
      }
      const step = loadMode(st.mode).steps[st.step];
      if (step?.until === 'человек' && !st.pending.length) this.nextStep(room);
      return;
    }

    let targets = resolveTargets(msg, this.here(room));

    if (!targets.length) {
      if (msg.from === this.config.user) {
        // Человек написал без тега — отвечают дежурные, по очереди. Очередь сериализует
        // вызовы, поэтому каждый следующий видит в своей дельте реплики предыдущих.
        // Кто отвечает человеку без тега — это правило режима «Открытый»: его
        // единственный шаг и есть «кто дежурит». Настройка живёт в одном месте
        // с остальными режимами, а не отдельным полем конфига.
        const duty = this.duty(room).filter((n) => this.agents.has(n));
        targets = duty.length ? duty : this.here(room).slice(0, 1);
        // Плюс один, кого тема задела сильнее прочих: разговор про вёрстку без Эстета —
        // это не разговор про вёрстку. Один, а не все совпавшие: дежурные и так отвечают,
        // а комната, где на каждую реплику высказываются шестеро, перестаёт быть разговором.
        const drawn = this.resonates(room, msg.text, targets);
        if (drawn) targets = [...targets, drawn];
      } else if (this.config.freeTalk !== false) {
        // Участник ответил, никого не назвав, — разговор продолжается с тем, кто говорил
        // до него. Так двое переговариваются свободно, но эхо не расходится на всю команду:
        // будится ровно один собеседник, а не все. Если до него говорил человек — тишина,
        // ход возвращается к человеку.
        const prev = this.store.load(room)
          .filter((m) => m.seq < msg.seq && m.kind === 'message' && m.from !== msg.from)
          .at(-1);
        if (prev && this.agents.has(prev.from)) targets = [prev.from];
      }
    }
    if (!targets.length) return;

    if (msg.from !== this.config.user) {
      if (st.autoTurns >= this.config.maxAutoTurns) {
        st.paused = true;
        this.store.append(room, {
          from: 'system',
          kind: 'system',
          text: `Стоп: ${this.config.maxAutoTurns} ходов подряд без человека. @${this.config.user}, нужен твой ход — напиши что-нибудь, и обсуждение продолжится.`,
          mentions: [this.config.user],
        });
        return;
      }
      st.autoTurns += 1;
    }

    for (const name of targets) {
      this.enqueue(room, () => this.turn(room, name));
    }
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
    const epoch = this.state(room).epoch;

    const seen = agent.lastSeen.get(room);
    let delta = this.store.since(room, seen ?? 0).filter((m) => m.from !== name && m.kind !== 'system');

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
    if (seen === undefined && delta.length > this.config.catchUp) {
      delta = delta.slice(-this.config.catchUp);
    }

    agent.busy = true;
    this.emitStatus(room, name, 'thinking');
    const started = Date.now();

    try {
      const res = await agent.impl.speak({
        room,
        delta,
        history: this.store.load(room),
        step: ctx.step,
        ctx: {
          me: name,
          roster: this.roster,
          user: this.config.user,
          workdir: this.config.workdir,
          laws: this.config.laws,
        },
      });

      // Пока участник думал, ленту могли очистить: его ответ уже не к чему приложить.
      if (this.state(room).epoch !== epoch) return false;

      if (res.error) {
        // Ход не состоялся — прочитанным ничего не считаем: эту же дельту участник
        // получит в следующий раз, а не потеряет вместе с ошибкой.
        this.store.append(room, {
          from: name,
          kind: 'error',
          text: res.error,
          mentions: [],
        });
        return true;
      }

      // Прочитано то, что участнику реально отправили, а не всё, что успело появиться
      // в ленте, пока он думал: иначе реплика, пришедшая посреди хода, до него не дойдёт.
      agent.lastSeen.set(room, ctx.upto ?? delta.at(-1)?.seq ?? seen ?? 0);

      const text = (res.text ?? '').trim();
      if (!text || SKIP.test(text)) {
        this.emitStatus(room, name, 'skipped');
        return true;
      }

      this.post(room, {
        from: name,
        text,
        meta: { ...res.meta, elapsedMs: Date.now() - started },
      });
      return true;
    } finally {
      agent.busy = false;
      this.emitStatus(room, name, 'idle');
    }
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
      // Сессию держит адаптер движка. Пересобираем его только при смене движка: цвет, иконка,
      // характер и промпт читаются из cfg на каждом ходу, стирать ради них память незачем.
      if (cur && (cur.cfg.kind ?? name) === (cfg.kind ?? name)) {
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
      });
    }
    for (const name of [...this.agents.keys()]) {
      if (!wanted[name]) this.agents.delete(name);
    }
  }

  /** Применить настройки из интерфейса. Возвращает то, что реально стало. */
  /** Дежурные: «кто говорит» на шаге режима «Открытый». */
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

    this.config = next;
    this.syncAgents();
    return this.config;
  }

  pause(room, on = true) {
    const st = this.state(room);
    st.paused = on;
    if (!on) st.autoTurns = 0;
    this.store.append(room, {
      from: 'system',
      kind: 'system',
      text: on ? 'Обсуждение поставлено на паузу.' : 'Продолжаем.',
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
    last.mentions = parseMentions(last.text, known);

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

    this.store.clear(room);
    for (const [, agent] of this.agents) {
      agent.impl.reset(room);
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
