import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { systemPrompt, turnPrompt } from './prompt.js';
import { skillsOf, limits } from './skills.js';

/**
 * Адаптеры к headless-режимам CLI. Каждый агент — короткоживущий процесс:
 * позвали, получили реплику, процесс умер. Непрерывность даёт resume по session id,
 * поэтому в промпт уходит только дельта, а не вся лента.
 */


// Сервер могут запустить из окружения с урезанным PATH (launchd, IDE, панель превью),
// а claude и codex лежат в пользовательских префиксах.
const PATH_EXTRA = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.bun', 'bin'),
];

function fatPath() {
  const seen = new Set((process.env.PATH ?? '').split(':').filter(Boolean));
  for (const p of PATH_EXTRA) seen.add(p);
  return [...seen].join(':');
}

/**
 * Экономный режим. Собеседнику в чате не нужны ни MCP-серверы, ни плагины, ни скиллы —
 * их описания едут в каждый запрос и составляют львиную долю счёта.
 * Замеры на этой машине, одна и та же реплика:
 *   Claude как есть $0.49 → без MCP $0.18 → без MCP и пользовательских настроек $0.08.
 * Отключается через "lean": false у агента.
 */
const LEAN = {
  claude: (cfg) => [
    '--strict-mcp-config', // без --mcp-config это значит «ни одного MCP-сервера»
    '--setting-sources', cfg.settingSources ?? 'project', // CLAUDE.md проекта остаётся, плагины и скиллы — нет
  ],
  codex: (cfg) => [
    '--ignore-user-config', // не поднимать MCP-серверы из ~/.codex/config.toml; авторизация не затрагивается
    '--ignore-rules',
    ...(cfg.reasoningEffort ? ['-c', `model_reasoning_effort="${cfg.reasoningEffort}"`] : []),
  ],
};

function run(cmd, args, { cwd, input, timeoutMs, env }) {
  if (process.env.SPACE_DEBUG) {
    // Промпты длинные — печатаем только флаги, чтобы видеть, что реально долетело до CLI.
    const flags = args.filter((a, i) => a.startsWith('-') || (args[i - 1] ?? '').startsWith('--setting') || (args[i - 1] ?? '') === '--model');
    console.error(`[${cmd}] ${flags.join(' ')}`);
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PATH: fatPath(), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Движок не нашёл сессию, которую мы помним. Так бывает после чистки его собственного
 * хранилища, обновления CLI или переезда рабочей папки: id у нас есть, а продолжать
 * нечего. Ход при этом терялся молча — участник «отвечал пустым», и человек видел
 * в ленте ошибку вместо реплики. Правильное поведение — забыть сессию и сказать
 * заново, с чистого листа: память разговора всё равно едет дельтой.
 */
const LOST = /no rollout found|session .*not found|thread\/resume|--resume.*(not found|invalid)|no conversation found/i;

class ClaudeAgent {
  constructor(cfg) {
    this.cfg = cfg;
    this.sessions = new Map(); // room -> session id
  }

  async speak({ room, delta, history, step, ctx }) {
    const sid = this.sessions.get(room);
    const args = [
      '-p',
      '--output-format', 'json',
      '--append-system-prompt', systemPrompt({ ...ctx, room }),
      '--add-dir', ctx.workdir,
      ...limits('claude', skillsOf(this.cfg)),
      ...(this.cfg.model ? ['--model', this.cfg.model] : []),
      ...(this.cfg.lean === false ? [] : LEAN.claude(this.cfg)),
      ...(this.cfg.extraArgs ?? []),
      ...(sid ? ['--resume', sid] : ['--session-id', randomUUID()]),
    ];

    const res = await run(this.cfg.bin ?? 'claude', args, {
      cwd: ctx.workdir,
      input: turnPrompt({ delta, history, step, ...ctx }),
      timeoutMs: this.cfg.timeoutMs ?? 300000,
    });

    if (res.timedOut) return { error: 'не уложился в таймаут' };

    let parsed;
    try { parsed = JSON.parse(res.stdout); } catch {
      const tail = (res.stderr || res.stdout || '').trim().split('\n').slice(-4).join('\n');
      return { error: `не разобрал ответ (код ${res.code}): ${tail.slice(0, 400)}` };
    }

    if (parsed.session_id) this.sessions.set(room, parsed.session_id);
    if (sid && parsed.is_error && LOST.test(String(parsed.result ?? ''))) {
      // Сессии больше нет: забываем её и говорим заново, с чистого листа.
      this.sessions.delete(room);
      return this.speak({ room, delta, history, step, ctx });
    }
    if (parsed.is_error) {
      // При отказе по лимиту ходов CLI отдаёт is_error с пустым result. Пустая строка —
      // это ложь «ошибки нет»: ход теряется молча, как будто участник решил промолчать.
      const why = String(parsed.result || parsed.subtype || parsed.error || 'движок вернул ошибку');
      return { error: why.slice(0, 400) };
    }

    const u = parsed.usage ?? {};
    return {
      text: String(parsed.result ?? '').trim(),
      meta: {
        // total_cost_usd — расчёт по API-тарифу. На OAuth-подписке это не списание,
        // а мера нагрузки: во сколько обошёлся бы тот же вызов по счётчику.
        costUsd: parsed.total_cost_usd,
        durationMs: parsed.duration_ms,
        sessionId: parsed.session_id,
        // Сколько запросов к модели сделал агентный цикл внутри одного хода.
        // usage ниже — сумма по всем ним, и без этого числа её не разложить на вызовы.
        turns: parsed.num_turns,
        usage: {
          input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          cached_input_tokens: u.cache_read_input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
        },
      },
    };
  }

  reset(room) { this.sessions.delete(room); }

  /** Сессия движка в комнате: её сохраняют на диск и возвращают после перезапуска. */
  session(room) { return this.sessions.get(room) ?? null; }

  adopt(room, id) { if (id) this.sessions.set(room, id); }
}

class CodexAgent {
  constructor(cfg) {
    this.cfg = cfg;
    this.sessions = new Map();
  }

  async speak({ room, delta, history, step, ctx }) {
    // У codex exec нет --append-system-prompt, поэтому роль едет первым блоком промпта.
    const prompt = `${systemPrompt({ ...ctx, room })}\n\n====\n\n${turnPrompt({ delta, history, step, ...ctx })}`;
    const sid = this.sessions.get(room);
    // Имя случайное: на шаге вслепую два участника стартуют почти в одну миллисекунду.
    const outFile = path.join(os.tmpdir(), `openspace-${randomUUID()}.txt`);

    const opts = [
      '--skip-git-repo-check',
      '--json',
      '--cd', ctx.workdir,
      '-o', outFile,
      ...limits('codex', skillsOf(this.cfg)),
      ...(this.cfg.model ? ['-m', this.cfg.model] : []),
      ...(this.cfg.lean === false ? [] : LEAN.codex(this.cfg)),
      ...(this.cfg.extraArgs ?? []),
    ];
    // Подкоманда resume идёт после опций; '-' велит читать промпт из stdin.
    const args = sid ? ['exec', ...opts, 'resume', sid, '-'] : ['exec', ...opts, '-'];

    const res = await run(this.cfg.bin ?? 'codex', args, {
      cwd: ctx.workdir,
      input: prompt,
      timeoutMs: this.cfg.timeoutMs ?? 300000,
    });

    let parsed = parseCodexStream(res.stdout);
    // Сессии больше нет — начинаем новую и повторяем ход один раз.
    if (sid && !parsed.text && [...parsed.errors, res.stderr].some((e) => LOST.test(String(e ?? '')))) {
      this.sessions.delete(room);
      const again = await run(this.cfg.bin ?? 'codex', ['exec', ...opts, '-'], {
        cwd: ctx.workdir, input: prompt, timeoutMs: this.cfg.timeoutMs ?? 300000,
      });
      res.stdout = again.stdout;
      res.stderr = again.stderr;
      res.code = again.code;
      res.timedOut = again.timedOut;
      parsed = parseCodexStream(again.stdout);
    }
    if (parsed.threadId) this.sessions.set(room, parsed.threadId);

    let text = '';
    try { text = fs.readFileSync(outFile, 'utf8').trim(); } catch { text = parsed.text; }
    finally { fs.rm(outFile, { force: true }, () => {}); }

    if (res.timedOut) return { error: 'не уложился в таймаут' };
    if (!text) {
      const why = parsed.errors[0] ?? (res.stderr || '').trim().split('\n').filter(Boolean).slice(-2).join(' ');
      return { error: `пустой ответ (код ${res.code}): ${String(why).slice(0, 400)}` };
    }
    return { text, meta: { sessionId: parsed.threadId, usage: parsed.usage } };
  }

  reset(room) { this.sessions.delete(room); }

  /** Сессия движка в комнате: её сохраняют на диск и возвращают после перезапуска. */
  session(room) { return this.sessions.get(room) ?? null; }

  adopt(room, id) { if (id) this.sessions.set(room, id); }
}

/**
 * codex exec --json отдаёт JSONL, вперемешку с логами трейсинга в том же потоке.
 * Текст ответа надёжнее читать из --output-last-message; отсюда берём id треда,
 * расход токенов и ошибки, а разбор текста держим как запасной путь.
 */
/**
 * Короткий вопрос движку — без сессии, без роли и без истории. Нужен там, где решает
 * не участник, а само пространство: кого задела реплика. Дешёвая модель и ответ
 * в одно слово: такой вызов идёт на каждую реплику и стоить должен как запятая.
 */
export async function ask(input, { model = 'haiku', timeoutMs = 45_000, cwd } = {}) {
  const res = await run('claude', [
    '-p', '--output-format', 'json',
    '--model', model,
    '--strict-mcp-config',
    '--setting-sources', 'project',
  ], { cwd, input, timeoutMs });
  if (res.timedOut) return '';
  try {
    const parsed = JSON.parse(res.stdout);
    return parsed.is_error ? '' : String(parsed.result ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * Короткий вопрос движку самого участника, мимо его сессии.
 *
 * Пространство и раньше умело спрашивать движок за всех разом — дёшево и одной головой.
 * Но своя мысль должна быть написана своей моделью: восемь «внутренних мыслей», собранных
 * одним вызовом, выходят похожими сильнее, чем если бы их думали врозь, и это эхо-камера
 * на уровне устройства, а не разговора.
 *
 * Сессию участника не трогаем ни при каких условиях: для него этот вопрос не существует,
 * в истории разговора его нет, и ход он на него не тратит.
 */
export async function askAs(cfg, input, { timeoutMs = 60_000, cwd } = {}) {
  if ((cfg?.kind ?? 'claude') === 'codex') {
    const res = await run(cfg.bin ?? 'codex', [
      'exec',
      '--skip-git-repo-check',
      '--json',
      '--cd', cwd,
      ...LEAN.codex(cfg),
      ...(cfg.model ? ['-m', cfg.model] : []),
      '-',
    ], { cwd, input, timeoutMs });
    if (res.timedOut) return '';
    return String(parseCodexStream(res.stdout).text ?? '').trim();
  }
  // Модель участника, а не общая: разные головы — разные мысли, ради этого всё и затеяно.
  return ask(input, { model: cfg?.model || 'haiku', timeoutMs, cwd });
}

export function parseCodexStream(stdout) {
  let text = '';
  let threadId;
  let usage;
  const errors = [];

  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }

    if (ev.type === 'thread.started') threadId = ev.thread_id;
    else if (ev.type === 'turn.completed') usage = ev.usage;
    else if (ev.type === 'item.completed') {
      const item = ev.item ?? {};
      if (item.type === 'agent_message' && typeof item.text === 'string') text = item.text.trim();
      else if (item.type === 'error' && item.message) errors.push(item.message);
    }
  }

  return { text: text.trim(), threadId, usage, errors };
}

export function buildAgent(name, cfg) {
  const kind = cfg.kind ?? name;
  if (kind === 'claude') return new ClaudeAgent(cfg);
  if (kind === 'codex') return new CodexAgent(cfg);
  throw new Error(`неизвестный тип агента: ${kind}`);
}
