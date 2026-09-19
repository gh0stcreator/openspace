import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { systemPrompt, turnPrompt } from './prompt.js';

/**
 * Адаптеры к headless-режимам CLI. Каждый агент — короткоживущий процесс:
 * позвали, получили реплику, процесс умер. Непрерывность даёт resume по session id,
 * поэтому в промпт уходит только дельта, а не вся лента.
 */

/**
 * Уровни доступа. Смысл одинаков для обоих движков, иначе участники на разных
 * движках получают разные права при одной и той же настройке:
 *   safe — читает и правит файлы в рабочей папке, произвольных команд не запускает;
 *   full — плюс команды.
 */
const TRUST = {
  safe: {
    claude: ['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep,NotebookEdit'],
    codex: ['-s', 'workspace-write', '-c', 'shell_environment_policy.inherit=none'],
  },
  full: {
    claude: ['--dangerously-skip-permissions'],
    codex: ['-s', 'danger-full-access'],
  },
};

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
      ...(TRUST[this.cfg.trust ?? 'safe'].claude),
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
    if (parsed.is_error) return { error: String(parsed.result ?? 'ошибка').slice(0, 400) };

    const u = parsed.usage ?? {};
    return {
      text: String(parsed.result ?? '').trim(),
      meta: {
        // total_cost_usd — расчёт по API-тарифу. На OAuth-подписке это не списание,
        // а мера нагрузки: во сколько обошёлся бы тот же вызов по счётчику.
        costUsd: parsed.total_cost_usd,
        durationMs: parsed.duration_ms,
        sessionId: parsed.session_id,
        usage: {
          input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          cached_input_tokens: u.cache_read_input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
        },
      },
    };
  }

  reset(room) { this.sessions.delete(room); }
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
      ...(TRUST[this.cfg.trust ?? 'safe'].codex),
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

    const parsed = parseCodexStream(res.stdout);
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
}

/**
 * codex exec --json отдаёт JSONL, вперемешку с логами трейсинга в том же потоке.
 * Текст ответа надёжнее читать из --output-last-message; отсюда берём id треда,
 * расход токенов и ошибки, а разбор текста держим как запасной путь.
 */
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
