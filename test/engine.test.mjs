/**
 * Движок на заглушках: ни одного вызова claude или codex, токены не тратятся.
 * Правило из AGENTS.md: меняешь то, кого и когда зовут, — пишешь тест сюда.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Режимы для тестов свои: рабочие файлы в modes/ правят по живым прогонам.
process.env.SPACE_MODES_DIR = path.join(import.meta.dirname, 'modes');
const { Orchestrator } = await import('../lib/orchestrator.js');
const { Store } = await import('../lib/store.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOM = 'r';

function setup(names, { delays = {}, fail = {}, dir = null, stateDir = null, roles = {}, freeTalk = false } = {}) {
  dir = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-test-'));
  const calls = [];
  const built = [];
  const build = (name) => {
    built.push(name);
    return {
      reset() {},
      async speak({ delta, step }) {
        calls.push({ who: name, step: step?.name ?? null, saw: delta.map((m) => m.seq) });
        await sleep(delays[name] ?? 20);
        if (fail[name]?.length) return { error: fail[name].shift() };
        return { text: `[${name}${step ? ' · ' + step.name : ''}]`, meta: {} };
      },
    };
  };
  const config = {
    user: 'Roman',
    agents: Object.fromEntries(names.map((n) => [n, { kind: 'claude', role: roles[n] ?? 'peer', color: 'blue' }])),
    maxAutoTurns: 50,
    catchUp: 50,
    freeTalk,
    workdir: dir,
  };
  const orch = new Orchestrator({
    store: new Store(dir), config, build, log: { error() {} }, stateDir,
  });
  return { orch, calls, built, config, dir };
}

/** Шаги режима в порядке появления, без повторов подряд и без закрывающего «итога». */
const order = (calls) =>
  calls.map((c) => c.step).filter((s, i, a) => s !== a[i - 1] && s !== 'итог');

test('реплика человека, пришедшая пока участник думает, до него доходит', async () => {
  const { orch, calls } = setup(['первый'], { delays: { первый: 80 } });
  orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(20);
  const second = orch.post(ROOM, { from: 'Roman', text: '@первый и ещё два' });
  await sleep(300);
  assert.ok(calls.some((c) => c.saw.includes(second.seq)), `вторую реплику никто не видел: ${JSON.stringify(calls)}`);
});

test('ход с ошибкой не съедает дельту: участник получит её снова', async () => {
  const { orch, calls } = setup(['первый'], { fail: { первый: ['таймаут'] } });
  const first = orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  orch.post(ROOM, { from: 'Roman', text: '@первый два' });
  await sleep(100);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].saw.includes(first.seq), 'реплика, на которой случилась ошибка, потеряна');
});

test('правка карточки не пересобирает участника, смена движка — пересобирает', () => {
  const { orch, built, config } = setup(['первый']);
  const before = orch.agents.get('первый').impl;

  orch.reconfigure({ agents: { первый: { ...config.agents.первый, color: 'red', manner: 'сухо' } } });
  assert.equal(orch.agents.get('первый').impl, before, 'сессия потеряна из-за цвета');
  assert.equal(orch.roster.первый.color, 'red', 'новые настройки не применились');

  orch.reconfigure({ agents: { первый: { ...config.agents.первый, kind: 'codex' } } });
  assert.notEqual(orch.agents.get('первый').impl, before);
  assert.deepEqual(built, ['первый', 'первый']);
});

test('шаг вслепую: участники не видят ответов друг друга, следующий шаг — видят', async () => {
  const { orch, calls } = setup(['первый', 'второй', 'третий'], { delays: { второй: 40, третий: 60 } });
  orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  orch.startMode(ROOM, 'проба');
  await sleep(900);
  const blind = calls.filter((c) => c.step === 'Б');
  const barrier = Math.max(...blind.flatMap((c) => c.saw));
  const answers = orch.store.load(ROOM).filter((m) => m.text.includes('· Б]')).map((m) => m.seq);
  assert.equal(blind.length, 3);
  assert.ok(answers.every((seq) => seq > barrier), 'ответ соседа попал в дельту шага вслепую');
  const open = calls.filter((c) => c.step === 'В');
  assert.ok(open.some((c) => answers.some((seq) => c.saw.includes(seq))), 'на шаге со слухом ответы соседей не видны');
  assert.deepEqual(order(calls), ['А', 'Б', 'В', 'Г']);
});

test('пауза замораживает шаг, после неё режим идёт дальше', async () => {
  const { orch, calls } = setup(['первый', 'второй'], { delays: { первый: 60 } });
  orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  orch.startMode(ROOM, 'проба');
  await sleep(20);
  orch.pause(ROOM, true);
  await sleep(300);
  assert.equal(orch.modeState(ROOM)?.step, 1, 'режим ушёл с первого шага, пока стояла пауза');
  orch.pause(ROOM, false);
  await sleep(900);
  assert.deepEqual(order(calls), ['А', 'Б', 'В', 'Г']);
});

test('перезапуск режима посреди шага не двигает шаги дважды', async () => {
  const { orch, calls } = setup(['первый', 'второй'], { delays: { второй: 120 } });
  orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  orch.startMode(ROOM, 'проба');
  await sleep(80); // идёт шаг Б
  const mark = calls.length;
  orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  orch.startMode(ROOM, 'проба');
  await sleep(1500);
  assert.deepEqual(order(calls.slice(mark)), ['А', 'Б', 'В', 'Г']);
});

test('занятый участник получает свой шаг, когда освободится', async () => {
  const { orch, calls } = setup(['первый', 'второй'], { delays: { первый: 150 } });
  orch.post(ROOM, { from: 'Roman', text: '@первый подумай подольше' });
  await sleep(30);
  orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  orch.startMode(ROOM, 'проба'); // шаг А — только @первый
  await sleep(1200);
  assert.ok(calls.some((c) => c.who === 'первый' && c.step === 'А'), 'шаг А прошёл без участника');
});

test('шаг со слухом: следующий видит ответ предыдущего на этом же шаге', async () => {
  const { orch, calls } = setup(['первый', 'второй']);
  orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  orch.startMode(ROOM, 'проба');
  await sleep(700);
  const [one, two] = calls.filter((c) => c.step === 'В');
  const answer = orch.store.load(ROOM).find((m) => m.from === one.who && m.text.includes('· В]'));
  assert.ok(two.saw.includes(answer.seq), 'второй на шаге В не увидел ответ первого');
});

test('человек в режиме: реплика с тегом — разговор, шаг стоит; без тега — закрывает шаг', async () => {
  const { orch, calls } = setup(['первый', 'второй']);
  orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  orch.startMode(ROOM, 'ожидание');
  // Режим приводит свой состав, а его шаги зовут только первого. Второго возвращаем
  // руками: разговор с тем, кого режим не звал, — это как раз то, что проверяем.
  orch.toggle(ROOM, 'второй', true);
  await sleep(150);
  assert.equal(orch.modeState(ROOM).step, 1);

  const ask = orch.post(ROOM, { from: 'Roman', text: '@второй, уточни' });
  await sleep(150);
  assert.equal(orch.modeState(ROOM).step, 1, 'реплика с тегом сдвинула шаг');
  assert.ok(calls.some((c) => c.who === 'второй' && c.step === null && c.saw.includes(ask.seq)), 'адресат не ответил');

  orch.post(ROOM, { from: 'Roman', text: 'идём дальше' });
  await sleep(200);
  assert.deepEqual(order(calls.filter((c) => c.step)), ['Вопрос', 'Итог']);
  assert.equal(orch.modeState(ROOM), null, 'режим не закончился');
});

test('остановленный режим не оживает: цепочка прежнего запуска ничего не двигает', async () => {
  const { orch, calls } = setup(['первый', 'второй'], { delays: { первый: 80 } });
  orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  orch.startMode(ROOM, 'проба');
  await sleep(20);
  orch.stopMode(ROOM);
  await sleep(500);
  assert.deepEqual(order(calls), ['А']);
  assert.equal(orch.modeState(ROOM), null);
});

test('кто может отвечать без тега — это «кто говорит» в файле режима «Открытый»', async () => {
  const { orch, calls } = setup(['первый', 'второй']);
  // Файл режима задаёт круг, из которого берут отвечающего; кого именно — решает
  // тема, а если она никого не зацепила, очередь у того, кого дольше не было слышно.
  assert.deepEqual(orch.duty().sort(), ['второй', 'первый']);
  orch.post(ROOM, { from: 'Roman', text: 'вопрос без тега' });
  await sleep(150);
  assert.equal(calls.length, 1, 'на реплику без тега отвечает один, а не все');
});

test('правка реплики: лента показывает новый текст, участник узнаёт о правке, файл — append-only', async () => {
  const { orch, calls, config } = setup(['первый']);
  const msg = orch.post(ROOM, { from: 'Roman', text: '@первый вынлядит грязно' });
  await sleep(80);

  const edit = orch.edit(ROOM, msg.seq, '@первый выглядит грязно');
  assert.equal(edit.kind, 'edit');
  assert.equal(orch.store.load(ROOM).find((m) => m.seq === msg.seq).text, '@первый выглядит грязно');
  await sleep(80);
  assert.equal(calls.length, 1, 'правка сама никого не будит');

  orch.post(ROOM, { from: 'Roman', text: '@первый и что думаешь?' });
  await sleep(80);
  assert.ok(calls[1].saw.includes(edit.seq), 'участник, читавший старый текст, не узнал о правке');

  // Перечитываем файл с нуля: правка должна пережить перезапуск, старая строка — остаться.
  const { Store } = await import('../lib/store.js');
  const fresh = new Store(config.workdir).load(ROOM);
  assert.equal(fresh.find((m) => m.seq === msg.seq).text, '@первый выглядит грязно');
  const raw = fs.readFileSync(path.join(config.workdir, `${ROOM}.jsonl`), 'utf8');
  assert.ok(raw.includes('вынлядит'), 'исходная строка пропала из файла');

  assert.throws(() => orch.edit(ROOM, 2, 'чужое'), /только свою/);
});

test('перезапуск: режим продолжается с того же шага, участники помнят прочитанное', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-state-'));
  // Участники отвечают медленно: к моменту снимка режим ещё на первом шаге.
  const first = setup(['первый', 'второй'], {
    dir, stateDir: dir, delays: { первый: 300, второй: 300 },
  });
  first.orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  first.orch.startMode(ROOM, 'проба');
  await sleep(60);
  first.orch.pause(ROOM, true);
  await sleep(400);
  first.orch.flush(ROOM);

  const before = first.orch.modeState(ROOM);
  const seenBefore = first.orch.agents.get('первый').lastSeen.get(ROOM);
  assert.ok(before, 'режим не запустился');

  // Новый процесс: та же папка, та же лента, ничего в памяти.
  const second = setup(['первый', 'второй'], { dir, stateDir: dir });
  const after = second.orch.modeState(ROOM);

  assert.equal(after?.name, before.name, 'режим не пережил перезапуск');
  assert.equal(after?.step, before.step, 'шаг сбился');
  assert.equal(second.orch.state(ROOM).paused, true, 'пауза забылась');
  assert.equal(second.orch.agents.get('первый').lastSeen.get(ROOM), seenBefore, 'прочитанное забылось');
});

test('режим заканчивает участник репликой, а не служебная строка', async () => {
  const { orch, calls } = setup(['первый', 'второй']);
  orch.post(ROOM, { from: 'Roman', text: 'тема' })
  orch.startMode(ROOM, 'проба');
  await sleep(1300);

  const feed = orch.store.load(ROOM);
  assert.equal(orch.modeState(ROOM), null, 'режим не закончился');
  assert.ok(!feed.some((m) => m.kind === 'system' && /слово за вами|круги/.test(m.text)), 'осталась служебная строка');

  const last = feed.at(-1);
  assert.equal(last.kind, 'message', 'последнее в ленте — не реплика');
  assert.equal(last.from, 'первый', 'итог подводит не тот, кто вёл режим');
  assert.equal(calls.at(-1).step, 'итог');
});

test('выключенный в комнате молчит, включённый снова отвечает', async () => {
  const { orch, calls } = setup(['первый', 'второй']);
  assert.deepEqual(orch.here(ROOM), ['первый', 'второй']);

  orch.toggle(ROOM, 'второй', false);
  assert.deepEqual(orch.here(ROOM), ['первый']);

  orch.post(ROOM, { from: 'Roman', text: '@второй отзовись' });
  await sleep(150);
  orch.post(ROOM, { from: 'Roman', text: 'и просто вопрос' });
  await sleep(150);
  assert.ok(!calls.some((c) => c.who === 'второй'), 'выключенный всё-таки ответил');

  orch.toggle(ROOM, 'второй', true);
  orch.post(ROOM, { from: 'Roman', text: '@второй теперь ты' });
  await sleep(150);
  assert.ok(calls.some((c) => c.who === 'второй'), 'включённый обратно молчит');
});

test('режим приводит свой состав, а без режима в комнате снова все', async () => {
  const { orch } = setup(['первый', 'второй']);
  assert.deepEqual(orch.here(ROOM), ['первый', 'второй']);

  // Шаги «Ожидания» зовут только первого — второму в этом режиме делать нечего.
  orch.startMode(ROOM, 'ожидание');
  assert.deepEqual(orch.here(ROOM), ['первый']);

  orch.stopMode(ROOM);
  assert.deepEqual(orch.here(ROOM), ['первый', 'второй'], 'разговор без режима идёт всей командой');
});

test('тему разбирает тот, чья это зона; без темы — кого дольше не слышно', async () => {
  const { orch, calls } = setup(['первый', 'второй'], { roles: { первый: 'дизайнер' } });

  // Тема дизайнерская — отвечает Дизайнер, и только он: вопрос в его домене.
  orch.post(ROOM, { from: 'Roman', text: 'посмотри, как выглядит вёрстка на этом экране' });
  await sleep(200);
  assert.ok(calls.some((c) => c.who === 'первый'), 'тема не разбудила того, чья это зона');

  // Чужая тема его не трогает: слово из `off` держит вернее, чем совпадение из `on`.
  // Раз тема не зацепила никого — очередь у того, кого дольше всех не было слышно.
  calls.length = 0;
  orch.post(ROOM, { from: 'Roman', text: 'база данных выглядит живой?' });
  await sleep(200);
  assert.ok(!calls.some((c) => c.who === 'первый'), 'вступил туда, где ему нечего сказать');
  assert.ok(calls.some((c) => c.who === 'второй'), 'очередь не досталась молчавшему');

  // Длинный текст: одно случайное слово из зоны — не повод звать. Статья на три экрана,
  // в которой один раз встретилось «выглядит», это не разговор про вёрстку.
  calls.length = 0;
  orch.post(ROOM, { from: 'Roman', text: `${'важный текст про статью. '.repeat(90)} выглядит так` });
  await sleep(200);
  assert.ok(!calls.some((c) => c.who === 'первый'), 'одно слово в простыне увело разговор');
});

test('перезапуск посреди шага: оборванный шаг доспрашивает тех, кто не успел', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-resume-'));
  // Первый отвечает медленно: к моменту «падения» шаг ещё ждёт его.
  const first = setup(['первый', 'второй'], { dir, stateDir: dir, delays: { первый: 400 } });
  first.orch.store.append(ROOM, { from: 'Roman', text: 'тема' });
  first.orch.startMode(ROOM, 'проба');
  await sleep(60);
  first.orch.flush(ROOM);
  assert.deepEqual(first.orch.state(ROOM).pending, ['первый'], 'шаг ждёт не того');

  // Новый процесс: очереди нет, на диске осталось «ждём первого».
  const second = setup(['первый', 'второй'], { dir, stateDir: dir });
  assert.deepEqual(second.orch.state(ROOM).pending, ['первый'], 'состояние не поднялось');
  assert.equal(second.calls.length, 0, 'кто-то заговорил сам по себе');

  const woken = second.orch.resumeAll();
  assert.equal(woken.length, 1, 'оборванный шаг не найден');
  await sleep(200);
  assert.ok(second.calls.some((c) => c.who === 'первый'), 'недоспрошенного так и не позвали');
});

test('выход из режима возвращает тот состав, что был до него', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-off-'));
  const { orch } = setup(['первый', 'второй'], { dir, stateDir: dir });

  // Человек убрал второго ещё до режима — это его решение, а не режима.
  orch.toggle(ROOM, 'второй', false);
  assert.deepEqual(orch.here(ROOM), ['первый']);

  orch.startMode(ROOM, 'проба');
  orch.stopMode(ROOM);
  assert.deepEqual(orch.here(ROOM), ['первый'], 'конец режима включил того, кого убрал человек');
});

test('цепочка не обрывается молча: ход возвращают человеку', async () => {
  const { orch, calls } = setup(['первый', 'второй'], { freeTalk: true });
  orch.post(ROOM, { from: 'Roman', text: 'начали' });
  await sleep(400);

  const closing = calls.filter((c) => c.step === 'ход человека');
  assert.equal(closing.length, 1, 'ход человеку не вернули или вернули хором');

  // Второй раз подряд возвращать нечего: иначе закрывающая реплика зовёт следующего по кругу.
  await sleep(300);
  assert.equal(calls.filter((c) => c.step === 'ход человека').length, 1, 'пошли по кругу');
});

test('долгий свободный разговор сворачивается в память, когда встал', async () => {
  // Память живёт рядом с состоянием комнат, поэтому свёртка есть только со stateDir.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-fold-'));
  const { orch, calls } = setup(['первый', 'архив'], {
    dir, stateDir: dir, roles: { архив: 'архивариус' }, freeTalk: true,
  });

  // Десяти реплик мало: свёртка — отдельный вызов движка, на каждой паузе она дорога.
  for (let i = 0; i < 10; i += 1) orch.store.append(ROOM, { from: 'Roman', text: `реплика ${i}` });
  orch.post(ROOM, { from: 'первый', text: 'и я так думаю' });
  await sleep(200);
  assert.ok(!calls.some((c) => c.step === 'свёртка'), 'свернули слишком рано');

  // Порог перейдён — на следующей остановке разговор ложится в память.
  for (let i = 0; i < 15; i += 1) orch.store.append(ROOM, { from: 'Roman', text: `ещё ${i}` });
  orch.post(ROOM, { from: 'первый', text: 'ну и ладно' });
  await sleep(300);
  assert.ok(calls.some((c) => c.step === 'свёртка'), 'разговор кончился, а в памяти пусто');
});

test('ответ на реплику — это обращение к её автору, а не к дежурным', async () => {
  const { orch, calls } = setup(['первый', 'второй']);

  const said = orch.store.append(ROOM, { from: 'первый', text: 'вот что я думаю', mentions: [] });
  // Человек щёлкнул по реплике @первого и ответил без тега. Дежурный тут ни при чём.
  orch.post(ROOM, { from: 'Roman', text: 'а если наоборот?', replyTo: said.seq });
  await sleep(200);
  assert.ok(calls.some((c) => c.who === 'первый'), 'автор реплики не услышал ответа на неё');
  assert.ok(!calls.some((c) => c.who === 'второй'), 'на личный ответ сбежались дежурные');
});

test('кто позвал человека и ждёт — второй раз не напоминает', async () => {
  const { orch, calls } = setup(['первый', 'второй'], { freeTalk: true });

  // @первый обратился к человеку: ход у человека, и @первому добавить нечего.
  orch.store.append(ROOM, { from: 'первый', text: 'Roman, нужен твой выбор', mentions: ['Roman'] });
  // @второй отвечает в ленту, никого не называя: цепочка продолжилась бы с @первого.
  orch.post(ROOM, { from: 'второй', text: 'и я так думаю', mentions: [] });
  await sleep(200);
  assert.ok(!calls.some((c) => c.who === 'первый'), 'напомнил о том же во второй раз');

  // Человек ответил — ожидание снято, обычная жизнь продолжается.
  calls.length = 0;
  orch.post(ROOM, { from: 'Roman', text: '@первый берём второе' });
  await sleep(200);
  assert.ok(calls.some((c) => c.who === 'первый'), 'после ответа человека участник не проснулся');
});

test('затянувшийся вопрос: Ведущий предлагает режим — один раз', async () => {
  const { orch, calls } = setup(['первый', 'ведущий'], {
    roles: { ведущий: 'продюсер' }, freeTalk: true,
  });

  // Счёт вопроса набран: двенадцать ходов, а вопрос не закрыт.
  orch.post(ROOM, { from: 'Roman', text: 'обсудим' });
  await sleep(100);
  const st = orch.state(ROOM);
  st.round = { from: 1, mode: '', turns: 20, tokens: 0, at: Date.now() };

  calls.length = 0;
  orch.post(ROOM, { from: 'первый', text: 'по-моему так', mentions: [] });
  await sleep(250);
  assert.ok(calls.some((c) => c.step === 'режим'), 'никто не предложил режим на двадцатом ходу');

  // Второй раз за тот же вопрос не зовём: напоминать дважды — то же, от чего ушли.
  calls.length = 0;
  orch.post(ROOM, { from: 'первый', text: 'и ещё вот', mentions: [] });
  await sleep(250);
  assert.ok(!calls.some((c) => c.step === 'режим'), 'предложил режим второй раз за один вопрос');
});

test('без темы разговор продолжает собеседник, но не бесконечно', async () => {
  const { orch, calls } = setup(['первый', 'второй', 'третий']);

  // Ни одно слово не попадает в зоны интереса: разговор продолжает тот, с кем он и шёл.
  const heard = [];
  for (let i = 0; i < 5; i += 1) {
    calls.length = 0;
    orch.post(ROOM, { from: 'Roman', text: `вопрос номер ${i}` });
    await sleep(200);
    heard.push(...calls.map((c) => c.who));
  }
  assert.ok(heard.length >= 5, `отвечали не на каждую реплику: ${heard.join(', ')}`);
  assert.equal(heard[0], heard[1], 'собеседник сменился после первой же реплики');
  // Четыре реплики подряд от одного — уже монолог: ход уходит тому, кого не было слышно.
  assert.ok(new Set(heard).size > 1, `все пять реплик достались одному: ${heard.join(', ')}`);
});

test('ведущего в свободном разговоре не будят, а тегом — будят', async () => {
  const { orch, calls } = setup(['первый', 'ведущий'], { roles: { ведущий: 'продюсер' } });

  // Реплика без тега: ведущий в разговоре не участвует, его дело — устройство разговора.
  orch.post(ROOM, { from: 'Roman', text: 'что думаете про это' });
  await sleep(200);
  assert.ok(!calls.some((c) => c.who === 'ведущий'), 'ведущий влез в разговор без тега');
  assert.ok(calls.some((c) => c.who === 'первый'), 'на реплику никто не ответил');

  // Позвали по имени — приходит.
  calls.length = 0;
  orch.post(ROOM, { from: 'Roman', text: '@ведущий что дальше?' });
  await sleep(200);
  assert.ok(calls.some((c) => c.who === 'ведущий'), 'не пришёл на прямое обращение');
});

test('человек зовёт по имени без собаки — и его слышат', async () => {
  const { orch, calls } = setup(['первый', 'второй']);

  orch.post(ROOM, { from: 'Roman', text: 'первый а ты чего затих?' });
  await sleep(200);
  assert.ok(calls.some((c) => c.who === 'первый'), 'имя без собаки не разбудило участника');
  assert.ok(!calls.some((c) => c.who === 'второй'), 'разбудило заодно и постороннего');

  // У участников имя в прозе адресом не считается: они поминают друг друга постоянно.
  calls.length = 0;
  orch.post(ROOM, { from: 'второй', text: 'первый тут прав, спорить не буду', mentions: [] });
  await sleep(200);
  assert.ok(!calls.some((c) => c.who === 'первый'), 'упоминание в прозе сработало как тег');
});

test('смена умений пересобирает участника: старая сессия помнит старые правила', () => {
  const { orch, built, config } = setup(['первый']);
  const before = orch.agents.get('первый').impl;

  // Цвет и характер сессию не трогают.
  orch.reconfigure({ agents: { первый: { ...config.agents['первый'], color: 'red' } } });
  assert.equal(orch.agents.get('первый').impl, before, 'цвет стёр память участника');

  // А выданный поиск — трогает: иначе он продолжит говорить «мне не разрешено».
  orch.reconfigure({ agents: { первый: { ...config.agents['первый'], skills: ['файлы', 'веб'] } } });
  assert.notEqual(orch.agents.get('первый').impl, before, 'умения сменились, а сессия осталась');
  assert.equal(built.filter((n) => n === 'первый').length, 2);
});

test('прораб заходит сам, когда накопилось, а не по слову «собери»', async () => {
  const { orch, calls } = setup(['первый', 'сборщик'], {
    roles: { сборщик: 'продюсер' }, freeTalk: true,
  });

  // Пока в ленте пусто, заходить незачем.
  orch.post(ROOM, { from: 'первый', text: 'первая мысль', mentions: [] });
  await sleep(200);
  assert.ok(!calls.some((c) => c.step === 'хвосты'), 'зашёл искать хвосты на пустом месте');

  // Накопилось — на следующей остановке разговора он приходит сам.
  calls.length = 0;
  for (let i = 0; i < 14; i += 1) orch.store.append(ROOM, { from: 'первый', text: `кусок ${i}` });
  orch.post(ROOM, { from: 'первый', text: 'и ещё', mentions: [] });
  await sleep(250);
  assert.ok(calls.some((c) => c.step === 'хвосты'), 'накопилось, а хвосты никто не посмотрел');
});

test('пока ход у человека, прораб за хвостами не ходит', async () => {
  const { orch, calls } = setup(['первый', 'сборщик'], {
    roles: { сборщик: 'продюсер' }, freeTalk: true,
  });

  for (let i = 0; i < 14; i += 1) orch.store.append(ROOM, { from: 'первый', text: `кусок ${i}` });
  // Он уже спросил человека и ответа не дождался: «хвост» тут только один — ход человека.
  orch.store.append(ROOM, { from: 'сборщик', text: 'Roman, за тобой решение', mentions: ['Roman'] });
  orch.post(ROOM, { from: 'первый', text: 'и ещё', mentions: [] });
  await sleep(250);
  assert.ok(!calls.some((c) => c.step === 'хвосты'), 'напомнил о том же, пока ход у человека');
});
