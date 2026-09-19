/**
 * Граница с чужим CLI: как собирается командная строка и как разбирается ответ.
 * Движок подменён скриптом (`fake-cli.mjs`), поэтому тесты бесплатны, но проверяют
 * ровно то место, которое ломается молча, когда claude или codex меняют вывод.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { buildAgent } = await import('../lib/agents.js');

const FAKE = path.join(import.meta.dirname, 'fake-cli.mjs');
const ROOM = 'комната';

/** Один вызов подставного движка. Возвращает ответ и то, с чем его позвали. */
async function speak(cfg, env = {}, agent = null) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-cli-')), 'argv.jsonl');
  const before = { ...process.env };
  Object.assign(process.env, { FAKE_ARGV_OUT: log, ...env });
  try {
    const it = agent ?? buildAgent('участник', { bin: FAKE, ...cfg });
    const res = await it.speak({
      room: ROOM,
      delta: [{ seq: 1, from: 'Roman', text: 'привет', kind: 'message' }],
      history: [],
      ctx: { me: 'участник', roster: { участник: {} }, user: 'Roman', workdir: process.cwd(), goal: '' },
    });
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    return { res, argv: calls.at(-1).argv, input: calls.at(-1).input, agent: it };
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    Object.assign(process.env, before);
  }
}

const after = (argv, flag) => argv[argv.indexOf(flag) + 1];

test('claude: уровень доступа, модель и экономный режим доезжают до командной строки', async () => {
  const safe = await speak({ kind: 'claude', model: 'sonnet' });
  assert.equal(after(safe.argv, '--permission-mode'), 'acceptEdits');
  assert.equal(after(safe.argv, '--model'), 'sonnet');
  assert.ok(safe.argv.includes('--strict-mcp-config'), 'экономный режим не долетел');
  assert.ok(!safe.argv.includes('--dangerously-skip-permissions'));

  const full = await speak({ kind: 'claude', trust: 'full', lean: false, extraArgs: ['--max-turns', '6'] });
  assert.ok(full.argv.includes('--dangerously-skip-permissions'), 'полный доступ не долетел');
  assert.ok(!full.argv.includes('--strict-mcp-config'), 'lean:false не отключил экономию');
  assert.equal(after(full.argv, '--max-turns'), '6', 'extraArgs не долетели');
});

test('claude: первый ход заводит сессию, следующий продолжает её, сброс начинает новую', async () => {
  const first = await speak({ kind: 'claude' }, { FAKE_SESSION: 'с-1' });
  assert.ok(first.argv.includes('--session-id'), 'первый ход должен заводить сессию');
  assert.ok(!first.argv.includes('--resume'));

  const second = await speak({ kind: 'claude' }, { FAKE_SESSION: 'с-1' }, first.agent);
  assert.equal(after(second.argv, '--resume'), 'с-1', 'сессия не продолжилась');

  first.agent.reset(ROOM);
  const third = await speak({ kind: 'claude' }, { FAKE_SESSION: 'с-2' }, first.agent);
  assert.ok(third.argv.includes('--session-id'), 'после сброса должна начаться новая сессия');
});

test('claude: расход считается суммой трёх счётчиков, вызовы внутри хода видны', async () => {
  const { res } = await speak({ kind: 'claude' });
  assert.equal(res.text, 'ответ участника');
  assert.equal(res.meta.usage.input_tokens, 1010, 'вход = свежее + кэш-риды + запись кэша');
  assert.equal(res.meta.usage.cached_input_tokens, 900);
  assert.equal(res.meta.turns, 3, 'без числа обращений расход не разложить на вызовы');
  assert.equal(res.meta.costUsd, 0.12);
});

test('claude: сломанный вывод и ошибка движка становятся ошибкой хода, а не пустой репликой', async () => {
  const broken = await speak({ kind: 'claude' }, { FAKE_MODE: 'garbage', FAKE_EXIT: '1' });
  assert.ok(broken.res.error?.includes('не разобрал ответ'), 'мусор в stdout должен стать ошибкой');
  assert.equal(broken.res.text, undefined);

  // Отказ по лимиту ходов приходит с пустым result — и это самый коварный случай:
  // пустая строка выглядит как «ошибки нет», и ход пропадает молча.
  const failed = await speak({ kind: 'claude' }, { FAKE_MODE: 'error' });
  assert.ok(failed.res.error, 'is_error с пустым result должен стать ошибкой хода');
  assert.ok(failed.res.error.includes('error_max_turns'), 'причина отказа должна доехать до ленты');
});

test('claude: таймаут не превращается в ответ', async () => {
  const { res } = await speak({ kind: 'claude', timeoutMs: 100 }, { FAKE_DELAY: '3000' });
  assert.ok(res.error?.includes('таймаут'), `ждали таймаут, получили ${JSON.stringify(res)}`);
});

test('codex: подкоманда resume идёт после опций, текст берётся из файла', async () => {
  const env = { FAKE_OUT_FLAG: '-o', FAKE_SESSION: 'тред-1' };
  const first = await speak({ kind: 'codex' }, env);
  assert.equal(first.argv[0], 'exec');
  assert.ok(first.argv.includes('--skip-git-repo-check'));
  assert.equal(first.argv.at(-1), '-', 'промпт должен читаться из stdin');
  assert.ok(!first.argv.includes('resume'), 'первый ход не продолжает тред');
  assert.equal(first.res.text, 'ответ из файла');

  const second = await speak({ kind: 'codex' }, env, first.agent);
  const i = second.argv.indexOf('resume');
  assert.ok(i > 0, 'тред не продолжился');
  assert.equal(second.argv[i + 1], 'тред-1');
  assert.ok(second.argv.indexOf('-o') < i, 'подкоманда должна идти после опций');
});

test('codex: пустой ответ становится ошибкой с кодом возврата', async () => {
  const { res } = await speak({ kind: 'codex' }, { FAKE_OUT_FLAG: '-o', FAKE_MODE: 'empty', FAKE_EXIT: '3' });
  assert.ok(res.error?.includes('пустой ответ'));
  assert.ok(res.error.includes('3'), 'код возврата помогает понять, что случилось');
});
