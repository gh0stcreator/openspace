/**
 * Движок на заглушках: ни одного вызова claude или codex, токены не тратятся.
 * Правило из AGENTS.md: меняешь то, кого и когда зовут, — пишешь тест сюда.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Комнаты для тестов свои: рабочие файлы в spaces/ правят по живым прогонам.
process.env.SPACE_DIR = path.join(import.meta.dirname, 'spaces');
const { Orchestrator } = await import('../lib/orchestrator.js');
const { Store } = await import('../lib/store.js');
const { Memory } = await import('../lib/memory.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOM = 'r';
// Комната с кругом: в ней первая реплика человека поднимает всех разом, вслепую.
const CIRCLE = 'проба';

function setup(names, { delays = {}, fail = {}, dir = null, stateDir = null, roles = {}, freeTalk = false, reply = null, foldIdleMs = null, weight = {}, think = null } = {}) {
  dir = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-test-'));
  const calls = [];
  const built = [];
  const resets = [];
  const build = (name) => {
    built.push(name);
    return {
      reset() { resets.push(name); },
      async speak({ delta, step, ctx }) {
        calls.push({ who: name, step: step?.name ?? null, saw: delta.map((m) => m.seq), anew: !!ctx?.anew });
        await sleep(delays[name] ?? 20);
        if (fail[name]?.length) return { error: fail[name].shift() };
        // Вес сессии: сколько входных токенов движок насчитал за ход. По нему решается ротация.
        const meta = weight[name] ? { usage: { input_tokens: weight[name], output_tokens: 1 }, turns: 1 } : {};
        return { text: reply ?? `[${name}${step ? ' · ' + step.name : ''}]`, meta };
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
    // Свёртку запускает тишина: в тестах ждать её штатные десять минут нечестно.
    ...(foldIdleMs ? { foldIdleMs } : {}),
  };
  const orch = new Orchestrator({
    store: new Store(dir), config, build, log: { error() {} }, stateDir,
    // Короткие вопросы движку в тестах не задаём: пусто — значит «никто не отозвался»
    // и «повторов нет», а проверяем разбор ответа отдельно, подставляя его руками.
    think: think ?? (async () => ''),
  });
  return { orch, calls, built, resets, config, dir };
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

test('круг вслепую: участники не видят ответов друг друга', async () => {
  const { orch, calls } = setup(['первый', 'второй', 'третий'], { delays: { второй: 40, третий: 60 } });
  orch.post(CIRCLE, { from: 'Roman', text: 'что делаем?' });
  await sleep(900);
  const blind = calls.filter((c) => c.step === 'круг');
  const barrier = Math.max(...blind.flatMap((c) => c.saw));
  const answers = orch.store.load(CIRCLE).filter((m) => m.text.includes('· круг]')).map((m) => m.seq);
  assert.equal(blind.length, 3, 'круг прошли не все');
  assert.ok(answers.every((seq) => seq > barrier), 'ответ соседа попал в дельту круга');
  assert.equal(orch.state(CIRCLE).blind, false, 'круг не закончился сам');
});

test('пауза замораживает круг, после неё он идёт дальше', async () => {
  const { orch, calls } = setup(['первый', 'второй', 'третий'], { delays: { первый: 60 } });
  orch.post(CIRCLE, { from: 'Roman', text: 'что делаем?' });
  await sleep(20);
  orch.pause(CIRCLE, true);
  await sleep(300);
  const said = calls.length;
  await sleep(200);
  assert.equal(calls.length, said, 'на паузе кто-то заговорил');
  orch.pause(CIRCLE, false);
  await sleep(700);
  assert.equal(calls.filter((c) => c.step === 'круг').length, 3, 'после паузы круг не доспросил остальных');
});

test('занятый участник получает свой ход в круге, когда освободится', async () => {
  // Второй вопрос человека — новая тема, и это решает движок: круг заводится не по
  // счётчику реплик, а по смыслу.
  const { orch, calls } = setup(['первый', 'второй', 'третий'], {
    delays: { первый: 150 }, think: async () => 'новая',
  });
  orch.post(CIRCLE, { from: 'Roman', text: '@первый подумай подольше' });
  await sleep(30);
  orch.post(CIRCLE, { from: 'Roman', text: 'а теперь вопрос всем' });
  await sleep(1200);
  assert.ok(calls.some((c) => c.who === 'первый' && c.step === 'круг'), 'круг прошёл без занятого участника');
});

test('реплика человека посреди круга никого не будит', async () => {
  const { orch, calls } = setup(['первый', 'второй', 'третий'], { delays: { первый: 120, второй: 120, третий: 120 } });
  orch.post(CIRCLE, { from: 'Roman', text: 'что делаем?' });
  await sleep(30);
  assert.equal(orch.state(CIRCLE).blind, true, 'круг не завёлся');
  const mark = calls.length;
  orch.post(CIRCLE, { from: 'Roman', text: '@первый а ты что думаешь?' });
  await sleep(60);
  assert.equal(calls.length, mark, 'реплика посреди круга подняла лишний ход');
  await sleep(900);
  assert.equal(orch.state(CIRCLE).blind, false, 'круг не закончился');
});

test('кто отвечает без тега — это дежурные комнаты', async () => {
  const { orch, calls } = setup(['первый', 'второй']);
  // Файл комнаты задаёт круг, из которого берут отвечающего; кого именно — решает
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
const { Memory } = await import('../lib/memory.js');
  const fresh = new Store(config.workdir).load(ROOM);
  assert.equal(fresh.find((m) => m.seq === msg.seq).text, '@первый выглядит грязно');
  const raw = fs.readFileSync(path.join(config.workdir, `${ROOM}.jsonl`), 'utf8');
  assert.ok(raw.includes('вынлядит'), 'исходная строка пропала из файла');

  assert.throws(() => orch.edit(ROOM, 2, 'чужое'), /только свою/);
});

test('перезапуск: круг продолжается, участники помнят прочитанное', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-state-'));
  const first = setup(['первый', 'второй', 'третий'], {
    dir, stateDir: dir, delays: { первый: 400, второй: 400, третий: 400 },
  });
  first.orch.post(CIRCLE, { from: 'Roman', text: 'что делаем?' });
  await sleep(60);
  first.orch.pause(CIRCLE, true);
  await sleep(400);
  first.orch.flush(CIRCLE);

  const seenBefore = first.orch.agents.get('первый').lastSeen.get(CIRCLE);
  assert.equal(first.orch.state(CIRCLE).blind, true, 'круг не завёлся');

  // Новый процесс: та же папка, та же лента, ничего в памяти.
  const second = setup(['первый', 'второй', 'третий'], { dir, stateDir: dir });

  assert.equal(second.orch.state(CIRCLE).blind, true, 'круг не пережил перезапуск');
  assert.equal(second.orch.state(CIRCLE).paused, true, 'пауза забылась');
  assert.equal(second.orch.agents.get('первый').lastSeen.get(CIRCLE), seenBefore, 'прочитанное забылось');
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

test('состав задаёт комната: кого в ней нет, тот в ней и не отвечает', async () => {
  const { orch } = setup(['первый', 'второй']);
  // В общей живут все, в «тихой» — только первый: это написано в файле комнаты.
  assert.deepEqual(orch.here(ROOM).sort(), ['второй', 'первый']);
  assert.deepEqual(orch.here('тихая'), ['первый']);
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

test('перезапуск посреди круга: оборванный круг доспрашивает тех, кто не успел', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-resume-'));
  const first = setup(['первый', 'второй', 'третий'], { dir, stateDir: dir, delays: { первый: 400 } });
  first.orch.post(CIRCLE, { from: 'Roman', text: 'что делаем?' });
  await sleep(120);
  first.orch.flush(CIRCLE);
  assert.deepEqual(first.orch.state(CIRCLE).pending, ['первый'], 'круг ждёт не того');

  const second = setup(['первый', 'второй', 'третий'], { dir, stateDir: dir });
  assert.deepEqual(second.orch.state(CIRCLE).pending, ['первый'], 'состояние не поднялось');
  assert.equal(second.calls.length, 0, 'кто-то заговорил сам по себе');

  const woken = second.orch.resumeAll();
  assert.equal(woken.length, 1, 'оборванный круг не найден');
  await sleep(300);
  assert.ok(second.calls.some((c) => c.who === 'первый'), 'недоспрошенного так и не позвали');
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

test('свёртку запускает тишина, а не остановка разговора', async () => {
  // Память живёт рядом с состоянием комнат, поэтому свёртка есть только со stateDir.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-fold-'));
  const { orch, calls } = setup(['первый', 'архив'], {
    dir, stateDir: dir, roles: { архив: 'архивариус' }, freeTalk: true, foldIdleMs: 150,
  });

  // Десятка реплик мало: свёртка — отдельный вызов движка, на каждой паузе она дорога.
  for (let i = 0; i < 10; i += 1) orch.store.append(ROOM, { from: 'Roman', text: `реплика ${i}` });
  orch.post(ROOM, { from: 'первый', text: 'и я так думаю' });
  await sleep(300);
  assert.ok(!calls.some((c) => c.step === 'свёртка'), 'свернули слишком рано');

  // Порог перейдён — но разговор идёт: каждая реплика отодвигает свёртку, и карточка
  // памяти посреди работы не появляется.
  for (let i = 0; i < 35; i += 1) orch.store.append(ROOM, { from: 'Roman', text: `ещё ${i}` });
  orch.post(ROOM, { from: 'первый', text: 'ну и ладно' });
  await sleep(80);
  orch.post(ROOM, { from: 'первый', text: 'хотя нет, вот ещё' });
  await sleep(80);
  assert.ok(!calls.some((c) => c.step === 'свёртка'), 'свернули посреди разговора');

  // Замолчали — теперь ложится в память.
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

test('строка «файл: путь» превращается во вложение, а не в текст', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-attach-'));
  fs.writeFileSync(path.join(dir, 'статья.md'), '# Заголовок\nтекст\n');
  const { orch } = setup(['первый'], { dir, reply: 'Готово.\nфайл: статья.md\n' });

  orch.post(ROOM, { from: 'Roman', text: '@первый дай файл' });
  await sleep(200);
  const said = orch.store.load(ROOM).filter((m) => m.from === 'первый').at(-1);
  assert.equal(said.text, 'Готово.', 'строка с файлом осталась в тексте');
  assert.equal(said.files?.[0]?.name, 'статья.md', 'файл не приложился');
  assert.ok(said.files[0].url.startsWith('/workdir/'), 'ссылка не на рабочую папку');

  // Наружу из рабочей папки не выпускаем: реплика участника — это команда.
  assert.equal(orch.attach('../../etc/hosts'), null, 'выпустил файл за пределы папки');
});

const LIMIT_TEXT = "You've hit your weekly limit · resets 3am (Europe/Moscow)";

test('лимит подписки: упёрся один — группу на той же модели больше не зовём', async () => {
  const { orch, calls } = setup(['первый', 'второй'], { fail: { первый: [LIMIT_TEXT] } });
  orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  orch.post(ROOM, { from: 'Roman', text: '@второй два' });
  await sleep(100);
  orch.post(ROOM, { from: 'Roman', text: '@первый три' });
  await sleep(100);

  const feed = orch.store.load(ROOM);
  assert.equal(calls.length, 1, `движок звали после отказа по лимиту: ${JSON.stringify(calls)}`);
  assert.equal(feed.filter((m) => m.kind === 'error').length, 1, 'ошибка лимита повторилась');
  // Молчание неотличимо от «думают»: человеку сказали, что команда не ответит, — и один раз.
  assert.equal(feed.filter((m) => m.kind === 'system' && /лимит/.test(m.text)).length, 1);
  assert.ok(orch.view(ROOM).limited.второй, 'сосед по модели не помечен в состоянии комнаты');
});

test('лимит подписки: другая модель отвечает как отвечала', async () => {
  const { orch, calls, config } = setup(['первый', 'второй'], { fail: { первый: [LIMIT_TEXT] } });
  orch.reconfigure({
    agents: {
      первый: { ...config.agents.первый, model: 'opus' },
      второй: { ...config.agents.второй, model: 'sonnet' },
    },
  });
  orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  orch.post(ROOM, { from: 'Roman', text: '@первый и @второй два' });
  await sleep(100);

  assert.deepEqual(calls.map((c) => c.who), ['первый', 'второй']);
  const notice = orch.store.load(ROOM).filter((m) => m.kind === 'system' && /лимит/.test(m.text));
  assert.equal(notice.length, 1, 'человеку не сказали, что адресат не ответит');
  assert.match(notice[0].text, /@первый/);
});

test('лимит подписки: срок вышел — пробуем снова, и дельта не потеряна', async () => {
  const { orch, calls } = setup(['первый'], { fail: { первый: [LIMIT_TEXT] } });
  orch.config.limitCooldownMs = 60;
  const first = orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(150);
  orch.post(ROOM, { from: 'Roman', text: '@первый два' });
  await sleep(100);

  assert.equal(calls.length, 2, 'после срока участника так и не позвали');
  assert.ok(calls[1].saw.includes(first.seq), 'реплика, на которой упёрлись в лимит, потеряна');
});

test('лимит подписки: круг не ждёт того, кто сегодня не отвечает', async () => {
  const { orch, calls } = setup(['первый', 'второй', 'третий'], {
    fail: { второй: [LIMIT_TEXT] },
  });
  orch.post(CIRCLE, { from: 'Roman', text: 'что делаем?' });
  await sleep(400);
  assert.ok(orch.limited('второй'), 'лимит не запомнился');

  orch.post(CIRCLE, { from: 'Roman', text: 'а теперь другой вопрос' });
  await sleep(500);
  assert.equal(calls.filter((c) => c.who === 'второй').length, 1, 'упёршегося в лимит позвали в круг ещё раз');
});

test('[skip] оставляет след для счёта, но в разговор не попадает', async () => {
  const { orch, calls } = setup(['первый', 'второй'], { reply: '[skip]' });
  orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  orch.post(ROOM, { from: 'Roman', text: '@второй два' });
  await sleep(100);

  const feed = orch.store.load(ROOM);
  const skips = feed.filter((m) => m.kind === 'skip');
  assert.deepEqual(skips.map((m) => m.from), ['первый', 'второй'], 'пропущенный ход не записан');
  assert.ok(!feed.some((m) => m.kind === 'message' && m.from !== 'Roman'), 'пропуск попал в ленту репликой');
  const second = calls.find((c) => c.who === 'второй');
  assert.ok(!second.saw.includes(skips[0].seq), 'чужой пропуск приехал собеседнику в дельте');
});

test('сессия перевалила порог — следующий ход начинается заново, с хвостом ленты', async () => {
  const { orch, calls, resets } = setup(['первый'], { weight: { первый: 200_000 } });
  const one = orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  assert.deepEqual(resets, [], 'сессию сбросили до того, как она потяжелела');
  const two = orch.post(ROOM, { from: 'Roman', text: '@первый два' });
  await sleep(100);

  assert.deepEqual(resets, ['первый'], 'тяжёлая сессия не сброшена');
  const own = orch.store.load(ROOM).find((m) => m.from === 'первый').seq;
  // Новая сессия прежнего разговора не помнит: хвост несёт и старую реплику, и собственный ответ.
  assert.deepEqual(calls[1].saw, [one.seq, own, two.seq]);
  assert.ok(calls[1].anew && !calls[0].anew, 'участнику не сказали, что сессия началась заново');
  assert.equal(orch.store.load(ROOM).filter((m) => m.from === 'первый').at(-1).meta.rotated, true);
});

test('лёгкая сессия живёт, порог 0 ротацию выключает', async () => {
  const light = setup(['первый'], { weight: { первый: 90_000 } });
  light.orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  const two = light.orch.post(ROOM, { from: 'Roman', text: '@первый два' });
  await sleep(100);
  assert.deepEqual(light.resets, []);
  assert.deepEqual(light.calls[1].saw, [two.seq], 'без ротации участник получает только дельту');

  const off = setup(['первый'], { weight: { первый: 900_000 } });
  off.orch.config.rotateAt = 0;
  off.orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  off.orch.post(ROOM, { from: 'Roman', text: '@первый два' });
  await sleep(100);
  assert.deepEqual(off.resets, []);
});

test('ротация на шаге вслепую не заглядывает за барьер', async () => {
  const { orch, calls, resets } = setup(['первый', 'второй'], { weight: { первый: 200_000 } });
  orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  const barrier = orch.store.append(ROOM, { from: 'Roman', text: 'тема шага', mentions: [] }).seq;
  const beyond = orch.store.append(ROOM, { from: 'второй', text: 'ответ соседа на этот же шаг', mentions: [] }).seq;
  await orch.turn(ROOM, 'первый', { step: { name: 'Б', hear: false, prompt: 'вслепую' }, upto: barrier });

  assert.deepEqual(resets, ['первый']);
  const saw = calls.at(-1).saw;
  assert.ok(saw.includes(barrier) && !saw.includes(beyond), `хвост ушёл за барьер: ${saw}`);
});

test('хвост после ротации ограничен по знакам, но последние реплики целы', async () => {
  const { orch, calls } = setup(['первый'], { weight: { первый: 200_000 } });
  orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  for (let i = 0; i < 8; i += 1) orch.store.append(ROOM, { from: 'Roman', text: 'я'.repeat(12_000), mentions: [] });
  const last = orch.post(ROOM, { from: 'Roman', text: '@первый и что думаешь?' });
  await sleep(100);

  const saw = calls.at(-1).saw;
  assert.ok(saw.includes(last.seq), 'последняя реплика выпала из хвоста');
  assert.ok(saw.length >= 5 && saw.length < 10, `хвост не урезан по знакам: ${saw.length} реплик`);
});

test('вес сессии переживает перезапуск: ротация случается первым же ходом', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-rotate-'));
  const stateDir = path.join(dir, 'state');
  const first = setup(['первый'], { dir, stateDir, weight: { первый: 200_000 } });
  first.orch.post(ROOM, { from: 'Roman', text: '@первый раз' });
  await sleep(100);
  first.orch.flush(ROOM);

  const second = setup(['первый'], { dir, stateDir });
  second.orch.post(ROOM, { from: 'Roman', text: '@первый два' });
  await sleep(100);
  assert.deepEqual(second.resets, ['первый'], 'после перезапуска тяжёлая сессия пошла на полном контексте');
});

test('мысль выше порога звучит, средняя ложится в голову и приезжает следующим ходом', async () => {
  const { orch } = setup(['первый', 'второй', 'третий']);
  const mind = [
    { name: 'первый', score: 5, thought: 'это прямо про меня' },
    { name: 'второй', score: 3, thought: 'сказал бы, но обойдутся' },
    { name: 'третий', score: 1, thought: 'мимо' },
  ];
  const говорят = orch.speaks(ROOM, mind);
  assert.deepEqual(говорят, ['первый'], 'вслух идёт только тот, кого задело всерьёз');
  assert.equal(orch.take(ROOM, 'второй'), 'сказал бы, но обойдутся', 'средняя мысль не сохранилась');
  assert.equal(orch.take(ROOM, 'второй'), null, 'мысль забирают один раз');
  assert.equal(orch.take(ROOM, 'третий'), null, 'слабую мысль не держат');
});

test('в чужой разговор влезают только с пятёркой', () => {
  const { orch } = setup(['первый', 'второй']);
  const mind = [{ name: 'первый', score: 4, thought: 'есть что добавить' }];
  assert.deepEqual(orch.speaks(ROOM, mind, 5), [], 'четвёрка не перебивает адресованную другому реплику');
  assert.equal(orch.take(ROOM, 'первый'), 'есть что добавить', 'непрозвучавшая мысль осталась в голове');
});

test('круг: повторившемуся возвращают ход за другой мыслью', async () => {
  // Движок отвечает так, будто второй повторил первого своими словами.
  const think = async () => [
    'первый | делать надо быстро',
    'второй | быстрота важнее всего',
    'третий | важна не скорость, а порядок',
    'Повторы: второй — первый',
  ].join('\n');
  const { orch, calls } = setup(['первый', 'второй', 'третий'], { think });
  orch.post(CIRCLE, { from: 'Roman', text: 'что делаем?' });
  await sleep(900);
  const круг = calls.filter((c) => c.step === 'круг');
  assert.equal(круг.filter((c) => c.who === 'второй').length, 2, 'повторившемуся ход не вернули');
  assert.equal(круг.filter((c) => c.who === 'третий').length, 1, 'у того, кто не повторился, лишнего хода быть не должно');
});

test('память по присутствию: своё — с подробностями, чужое — со слов', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-memory-'));
  const mem = new Memory(dir);
  mem.commit('красная', [{ action: 'добавить', kind: 'решение', text: 'публикуем модель отдельно', level: 'деталь' }],
    'Архивариус', { where: 'красная', saw: ['Roman', 'Скептик'], span: [1, 9] });

  const был = mem.brief('красная', { me: 'Скептик', tail: 'модель', seq: 10 });
  assert.match(был.text, /ПРИ ТЕБЕ/);
  assert.equal(был.told, false, 'тому, кто был, нечего знать со слов');

  const небыл = mem.brief('красная', { me: 'Инженер', tail: 'модель', seq: 10 });
  assert.match(небыл.text, /СО СЛОВ/);
  assert.equal(небыл.told, true, 'отсутствовавший не получил пометки «со слов»');
  assert.doesNotMatch(небыл.text, /ПРИ ТЕБЕ/, 'чужая запись попала в свой раздел');
});

test('память пространства: «главное» едет в другие комнаты, «деталь» остаётся дома', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-shared-'));
  const mem = new Memory(dir);
  const ctx = { saw: ['Roman'], span: [1, 5] };
  mem.commit('красная', [
    { action: 'добавить', kind: 'ограничение', text: 'сроки двигать нельзя', level: 'главное' },
    { action: 'добавить', kind: 'находка', text: 'парсер спотыкается на переносах', level: 'деталь' },
  ], 'Архивариус', { ...ctx, where: 'красная' });

  const синяя = mem.brief('синяя', { me: 'Инженер', tail: 'сроки и парсер', seq: 6 });
  assert.match(синяя.text, /сроки двигать нельзя/, '«главное» не доехало до соседней комнаты');
  assert.doesNotMatch(синяя.text, /парсер/, '«деталь» уехала в чужую комнату');
  assert.match(синяя.text, /\(красная\)/, 'не сказано, где это было');
});

test('память: решение не выпадает по затуханию, находка — выпадает', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-fade-'));
  const mem = new Memory(dir);
  mem.commit('r', [
    { action: 'добавить', kind: 'решение', text: 'домены различаем по владельцу' },
    { action: 'добавить', kind: 'находка', text: 'у шрифта плывёт базовая линия' },
  ], 'Архивариус', { where: 'r', saw: ['Roman', 'Инженер'], span: [1, 2] });

  // Разговор ушёл далеко и совсем о другом: обязательство остаётся, находка тускнеет.
  const поздно = mem.brief('r', { me: 'Инженер', tail: 'обсуждаем цену подписки', seq: 400 });
  assert.match(поздно.text, /домены различаем/, 'решение забыли');
  assert.doesNotMatch(поздно.text, /базовая линия/, 'находка пережила три сотни реплик не о ней');
});

test('разговор не при всех: чужая пара в дельту не попадает', async () => {
  const { orch, calls } = setup(['первый', 'второй', 'третий']);
  // Встреча двоих: третий её не видит и отвечать на неё не должен.
  orch.store.append(ROOM, { from: 'первый', text: 'моя идея', kind: 'message', only: ['первый', 'второй'] });
  orch.post(ROOM, { from: 'Roman', text: '@третий что скажешь?' });
  await sleep(200);
  const ход = calls.find((c) => c.who === 'третий');
  assert.ok(ход, 'третьего не спросили');
  const виден = orch.store.load(ROOM).find((m) => m.text === 'моя идея').seq;
  assert.ok(!ход.saw.includes(виден), 'чужая парная реплика доехала до постороннего');
});

test('расписание встреч: каждый встречается с каждым ровно один раз', async () => {
  const { meetings } = await import('../lib/spaces.js');
  for (const n of [3, 4, 5, 6]) {
    const names = Array.from({ length: n }, (_, i) => `у${i}`);
    const plan = meetings(names);
    const пары = plan.flat().map(([a, b]) => [a, b].sort().join('·'));
    assert.equal(new Set(пары).size, пары.length, `${n}: кто-то встретился дважды`);
    assert.equal(пары.length, (n * (n - 1)) / 2, `${n}: встретились не все`);
    for (const цикл of plan) {
      const занят = цикл.flat();
      assert.equal(new Set(занят).size, занят.length, `${n}: кто-то в цикле занят дважды`);
    }
  }
});

test('бюллетень: за себя нельзя, прогноз отдельно, счёт по расхождению', async () => {
  const { parseVote, tallyVotes } = await import('../lib/orchestrator.js');
  const names = ['Инженер', 'Скептик', 'Креатор'];
  const b = parseVote('за: Скептик, Креатор\nпрогноз: Инженер\nпочему: у Скептика единственный сценарий сбоя', names);
  assert.deepEqual(b.for, ['Скептик', 'Креатор']);
  assert.deepEqual(b.guess, ['Инженер']);
  assert.match(b.why, /сценарий сбоя/);

  const итог = tallyVotes([
    ['А', { for: ['Скептик', 'Креатор'], guess: ['Инженер'] }],
    ['Б', { for: ['Скептик'], guess: ['Инженер'] }],
  ]);
  assert.equal(итог[0].name, 'Скептик', 'порядок не по голосам');
  assert.equal(итог[0].surprise, 2, 'расхождение голоса и прогноза посчитано неверно');
  assert.equal(итог.find((r) => r.name === 'Инженер').surprise, -2, 'ожидаемого, но невыбранного не видно');
});

test('чёрная комната: круг втайне, встречи попарно, защита при всех, оценка вслепую', async () => {
  // Движок на каждый вопрос отвечает «да»: позиции считаются изменившимися, и круговой
  // турнир проходит целиком, а не останавливается после первого цикла.
  const { orch, calls } = setup(['первый', 'второй', 'третий', 'четвёртый'], { think: async () => 'да' });
  orch.post('чёрная', { from: 'Roman', text: 'что делаем?' });
  await sleep(4000);

  const feed = orch.store.load('чёрная').filter((m) => m.kind === 'message' && m.from !== 'Roman');
  const шаги = calls.map((c) => c.step);
  assert.ok(шаги.includes('круг'), 'круга не было');
  assert.ok(шаги.includes('встреча'), 'встреч не было');
  assert.ok(шаги.includes('пересборка'), 'пересборки не было');
  assert.ok(шаги.includes('защита'), 'защиты не было');
  assert.ok(шаги.includes('оценка'), 'оценки не было');

  const круг = feed.filter((m) => m.text.includes('· круг]'));
  assert.equal(круг.length, 4, 'в круге ответили не все');
  assert.ok(круг.every((m) => m.only?.length === 1), 'ответ круга увидел кто-то, кроме автора');

  const встречи = feed.filter((m) => m.text.includes('· встреча]'));
  assert.ok(встречи.every((m) => m.only?.length === 2), 'разговор пары видят не двое');
  // Три цикла по две пары, по четыре реплики на встречу.
  assert.equal(встречи.length, 24, `встреч прошло не столько: ${встречи.length}`);

  const защита = feed.filter((m) => m.text.includes('· защита]'));
  assert.equal(защита.length, 4, 'защищались не все');
  assert.ok(защита.every((m) => !m.only), 'защита прошла не при всех');

  const оценка = feed.filter((m) => m.text.includes('· оценка]'));
  assert.ok(оценка.every((m) => m.only?.length === 1), 'оценку видели чужие');
  assert.equal(orch.state('чёрная').act, '', 'протокол не закрылся');
});
