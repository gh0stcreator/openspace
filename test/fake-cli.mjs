#!/usr/bin/env node
/**
 * Подставной движок вместо claude и codex: записывает, с какими флагами его позвали,
 * и печатает заранее заданный ответ. Так проверяется граница с чужим CLI —
 * сборка командной строки и разбор вывода, — не тратя ни одного токена.
 *
 * Поведением управляют переменные окружения:
 *   FAKE_ARGV_OUT  — файл, куда сложить argv и stdin
 *   FAKE_MODE      — ok | error | garbage | empty
 *   FAKE_SESSION   — идентификатор сессии в ответе
 *   FAKE_EXIT      — код возврата
 *   FAKE_OUT_FLAG  — имя флага, после которого идёт путь для текста ответа (codex)
 */
import fs from 'node:fs';

const argv = process.argv.slice(2);
const mode = process.env.FAKE_MODE ?? 'ok';
const session = process.env.FAKE_SESSION ?? 'сессия-1';

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  if (process.env.FAKE_ARGV_OUT) {
    fs.appendFileSync(process.env.FAKE_ARGV_OUT, JSON.stringify({ argv, input }) + '\n');
  }

  const delay = Number(process.env.FAKE_DELAY ?? 0);
  if (delay) { setTimeout(() => process.exit(0), delay); return; }

  // Codex пишет текст ответа в файл из -o, а в stdout отдаёт поток событий.
  const outFlag = process.env.FAKE_OUT_FLAG;
  if (outFlag && argv.includes(outFlag)) {
    const file = argv[argv.indexOf(outFlag) + 1];
    if (mode === 'ok') fs.writeFileSync(file, 'ответ из файла');
    process.stdout.write(
      [
        JSON.stringify({ type: 'thread.started', thread_id: session }),
        'шум, который не json',
        ...(mode === 'ok'
          ? [JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ответ из потока' } })]
          : [JSON.stringify({ type: 'item.completed', item: { type: 'error', message: 'движок сдался' } })]),
        JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } }),
      ].join('\n') + '\n'
    );
    process.exit(Number(process.env.FAKE_EXIT ?? 0));
  }

  if (mode === 'garbage') process.stdout.write('не json вовсе\n');
  else if (mode === 'error') {
    process.stdout.write(JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: '', session_id: session }));
  } else if (mode === 'empty') {
    process.stdout.write(JSON.stringify({ is_error: false, result: '   ', session_id: session }));
  } else {
    process.stdout.write(JSON.stringify({
      is_error: false,
      result: 'ответ участника',
      session_id: session,
      total_cost_usd: 0.12,
      duration_ms: 42,
      num_turns: 3,
      usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 10, output_tokens: 5 },
    }));
  }
  process.exit(Number(process.env.FAKE_EXIT ?? 0));
});
