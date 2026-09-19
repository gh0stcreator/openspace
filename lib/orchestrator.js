import { buildAgent } from './agents.js';
import { parseMentions, resolveTargets } from './mentions.js';
import { loadMode, stepTargets } from './modes.js';

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
  constructor({ store, config, log = console }) {
    this.store = store;
    this.config = config;
    this.log = log;
    this.agents = new Map();
    this.syncAgents();
    this.rooms = new Map(); // room -> { autoTurns, paused }
    this.queue = Promise.resolve();
  }

  get names() { return [...this.agents.keys()]; }
  get roster() {
    return Object.fromEntries([...this.agents].map(([n, a]) => [n, a.cfg]));
  }

  state(room) {
    if (!this.rooms.has(room)) this.rooms.set(room, { autoTurns: 0, paused: false, mode: null, step: 0 });
    return this.rooms.get(room);
  }

  post(room, { from, text, kind = 'message', meta, files, replyTo }) {
    const known = [...this.names, this.config.human];
    const msg = this.store.append(room, {
      from,
      text,
      kind,
      meta,
      files,
      replyTo,
      mentions: parseMentions(text, known),
    });

    if (from === this.config.human) {
      // Человек вмешался — счётчик автоходов обнуляется, пауза снимается.
      const st = this.state(room);
      st.autoTurns = 0;
      st.paused = false;
    }
    if (kind === 'message') this.dispatch(room, msg);
    return msg;
  }

  /**
   * Запустить режим: участники идут по шагам, а не отвечают вразнобой.
   * Главное здесь — шаг с `hear: нет`: все отвечают на одну и ту же ленту, не видя
   * ответов друг друга. Иначе первый ответивший ставит якорь и остальные его обслуживают.
   */
  startMode(room, name) {
    const mode = loadMode(name);
    const st = this.state(room);
    st.mode = mode.name;
    st.step = -1;
    st.paused = false;
    st.autoTurns = 0;

    this.store.append(room, {
      from: 'system',
      kind: 'system',
      text: `Режим: ${mode.title}. Шагов: ${mode.steps.length}`,
      mentions: [],
    });
    this.nextStep(room);
    return this.modeState(room);
  }

  stopMode(room) {
    const st = this.state(room);
    if (st.mode) {
      this.store.append(room, {
        from: 'system',
        kind: 'system',
        text: `Режим ${loadMode(st.mode).title} закончен`,
        mentions: [],
      });
    }
    st.mode = null;
    st.step = 0;
    return this.modeState(room);
  }

  modeState(room) {
    const st = this.state(room);
    if (!st.mode) return null;
    const mode = loadMode(st.mode);
    const step = mode.steps[st.step];
    return {
      name: mode.name,
      title: mode.title,
      slug: mode.slug,
      short: mode.short,
      step: st.step + 1,
      steps: mode.steps.length,
      stepName: step?.name ?? '',
      waitingHuman: step?.until === 'человек',
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
      this.stopMode(room);
      this.store.append(room, {
        from: 'system',
        kind: 'system',
        text: `@${this.config.human}, круги пройдены — слово за тобой`,
        mentions: [this.config.human],
      });
      return;
    }

    const targets = stepTargets(step, this.names, this.roster);
    if (!targets.length) return this.nextStep(room);

    this.store.append(room, {
      from: 'system',
      kind: 'system',
      text: `${st.step + 1}/${mode.steps.length} · ${step.name}${
        step.hear ? '' : ' · отвечают не слыша друг друга'
      }`,
      mentions: [],
    });

    // Барьер: на шаге без слуха все читают одну и ту же ленту, а ответы копятся
    // и появляются вместе. На шаге со слухом идём по очереди, как в разговоре.
    const upto = this.store.load(room).at(-1)?.seq ?? 0;
    const turns = targets.map((name) => () => this.turn(room, name, { step, upto }));

    const run = step.hear
      ? turns.reduce((chain, t) => chain.then(t), Promise.resolve())
      : Promise.all(turns.map((t) => t()));

    this.queue = this.queue
      .then(() => run)
      .then(() => {
        if (step.until !== 'человек') this.nextStep(room);
      })
      .catch((e) => this.log.error(e));
  }

  dispatch(room, msg) {
    const st = this.state(room);
    if (st.paused) return;

    // В режиме ходом распоряжается сам режим; слово человека двигает шаг дальше.
    if (st.mode) {
      const step = loadMode(st.mode).steps[st.step];
      if (msg.from === this.config.human && step?.until === 'человек') this.nextStep(room);
      return;
    }

    let targets = resolveTargets(msg, this.names);

    if (!targets.length) {
      if (msg.from === this.config.human) {
        // Человек написал без тега — отвечают дежурные, по очереди. Очередь сериализует
        // вызовы, поэтому каждый следующий видит в своей дельте реплики предыдущих.
        const duty = (this.config.defaultResponders ?? []).filter((n) => this.agents.has(n));
        targets = duty.length ? duty : [this.names[0]].filter((n) => this.agents.has(n));
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

    if (msg.from !== this.config.human) {
      if (st.autoTurns >= this.config.maxAutoTurns) {
        st.paused = true;
        this.store.append(room, {
          from: 'system',
          kind: 'system',
          text: `Стоп: ${this.config.maxAutoTurns} ходов подряд без человека. @${this.config.human}, нужен твой ход — напиши что-нибудь, и обсуждение продолжится.`,
          mentions: [this.config.human],
        });
        return;
      }
      st.autoTurns += 1;
    }

    for (const name of targets) {
      this.queue = this.queue.then(() => this.turn(room, name)).catch((e) => this.log.error(e));
    }
  }

  async turn(room, name, ctx = {}) {
    const agent = this.agents.get(name);
    if (!agent || agent.busy) return;
    if (this.state(room).paused) return;

    const seen = agent.lastSeen.get(room);
    let delta = this.store.since(room, seen ?? 0).filter((m) => m.from !== name && m.kind !== 'system');

    // На шаге без слуха все читают ленту до одной и той же отметки: ответы соседей,
    // появившиеся пока участник думал, в его дельту не попадают.
    if (ctx.upto) delta = delta.filter((m) => m.seq <= ctx.upto);
    if (!delta.length && !ctx.step) return;

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
          human: this.config.human,
          workdir: this.config.workdir,
          goal: this.config.goal,
        },
      });

      agent.lastSeen.set(room, ctx.upto ?? this.store.load(room).at(-1)?.seq ?? seen ?? 0);

      if (res.error) {
        this.store.append(room, {
          from: name,
          kind: 'error',
          text: res.error,
          mentions: [],
        });
        return;
      }

      const text = (res.text ?? '').trim();
      if (!text || SKIP.test(text)) {
        this.emitStatus(room, name, 'skipped');
        return;
      }

      this.post(room, {
        from: name,
        text,
        meta: { ...res.meta, elapsedMs: Date.now() - started },
      });
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
      this.agents.set(name, {
        cfg,
        impl: buildAgent(name, cfg),
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
  reconfigure(patch) {
    const next = { ...this.config, ...patch };
    if (patch.agents) next.agents = patch.agents;

    next.maxAutoTurns = clamp(next.maxAutoTurns, 1, 100, this.config.maxAutoTurns);
    next.catchUp = clamp(next.catchUp, 1, 500, this.config.catchUp);
    next.defaultResponders = (Array.isArray(next.defaultResponders) ? next.defaultResponders : [])
      .filter((n) => next.agents[n]);
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
    if (!on) this.resume(room);
    return st;
  }

  /**
   * Разбудить тех, к кому обратились, пока разговор стоял: после паузы или перезапуска.
   * Заодно пересчитываем упоминания — состав участников мог смениться уже после записи.
   */
  resume(room) {
    const last = this.store.load(room).filter((m) => m.kind === 'message').at(-1);
    if (!last) return;

    const known = [...this.names, this.config.human];
    last.mentions = parseMentions(last.text, known);

    // Если после этой реплики уже кто-то отвечал, догонять нечего.
    const answered = [...this.agents.values()].some((a) => (a.lastSeen.get(room) ?? 0) >= last.seq);
    if (!answered) this.dispatch(room, last);
  }

  /** Очистить ленту и всё, что на неё опирается. */
  clearRoom(room) {
    this.store.clear(room);
    for (const [, agent] of this.agents) {
      agent.impl.reset(room);
      agent.lastSeen.delete(room);
    }
    this.rooms.delete(room);
  }

  /** Сбросить контекст агентов в комнате: следующая реплика начнёт новую сессию. */
  reset(room) {
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
