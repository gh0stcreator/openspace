/** Разбор обращений и файлов комнат — чистые функции, без движка. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-modes-'));
process.env.SPACE_DIR = dir;
const { parseMentions } = await import('../lib/mentions.js');
const { loadSpace, saveSpace, sideOf, pick, tuneOf } = await import('../lib/spaces.js');

test('обращения: кириллица, регистр, знаки вокруг', () => {
  const known = ['Скептик', 'qa-bot', 'Roman'];
  assert.deepEqual(parseMentions('@скептик, глянь. И (@QA-bot) тоже', known), ['Скептик', 'qa-bot']);
  assert.deepEqual(parseMentions('почта roman@example.com и @Никто', known), []);
});

test('круг читается строго: «нет» — это отсутствие круга, остальное — задание', () => {
  for (const [value, circle] of [['нет', ''], ['no', ''], ['ответь сам', 'ответь сам'], ['нетрудно', 'нетрудно']]) {
    fs.writeFileSync(path.join(dir, 'x.md'), `---\ntitle: Икс\nкруг: ${value}\n---\n`);
    assert.equal(loadSpace('x').circle, circle, `круг: ${value}`);
  }
});

test('динамика комнаты: имя из файла, а неизвестное — по типу комнаты', () => {
  fs.writeFileSync(path.join(dir, 'y.md'), '---\ntitle: Игрек\nдинамика: спор\n---\n');
  assert.equal(tuneOf(loadSpace('y')).reply, 3.5);
  fs.writeFileSync(path.join(dir, 'y.md'), '---\ntitle: Игрек\nдинамика: чепуха\n---\n');
  assert.equal(tuneOf(loadSpace('y')).reply, 4, 'неизвестная динамика — рабочая встреча');
  fs.writeFileSync(path.join(dir, 'y.md'), '---\ntitle: Игрек\ntalk: да\n---\n');
  assert.equal(tuneOf(loadSpace('y')).reply, 3.6, 'у комнаты без регламента динамика разговора');
});

test('кого зовёт состав комнаты: все, поимённо, по роли', () => {
  const names = ['Инженер', 'Скептик'];
  const roster = { Инженер: { role: 'инженер' }, Скептик: { role: 'скептик' } };
  assert.deepEqual(pick('все', names, roster), names);
  assert.deepEqual(pick('@скептик, @никто', names, roster), ['Скептик']);
  assert.deepEqual(pick('роли: инженер', names, roster), ['Инженер']);
});

test('должности комнаты: разбор, должность по роли, круг «сохранили — прочитали»', () => {
  const saved = saveSpace({
    name: 'спор', title: 'Спор', slug: 'argue', cast: 'все',
    sides: [
      { label: 'За', labelEn: 'For', icon: 'thumbs-up', roles: ['креатор', 'инженер'] },
      { label: 'Против', labelEn: 'Against', icon: '', roles: ['скептик'] },
    ],
  });
  assert.deepEqual(saved.sides[0], {
    label: 'За', labelEn: 'For', icon: 'thumbs-up', color: '', roles: ['креатор', 'инженер'],
  });
  // Знак и цвет необязательны: должность без них остаётся должностью.
  assert.deepEqual(saved.sides[1], {
    label: 'Против', labelEn: 'Against', icon: '', color: '', roles: ['скептик'],
  });
  assert.equal(sideOf(saved, 'ИНЖЕНЕР').label, 'За');
  assert.equal(sideOf(saved, 'дизайнер'), null);
  // Комната без должностей — не ошибка: их нет у большинства.
  assert.deepEqual(loadSpace('x').sides, []);

  // Персона — должность с цветом: под ней участник выходит целиком, а не помечен подписью.
  const cast = saveSpace({
    name: 'цирк', title: 'Цирк', slug: 'circus', talk: true, cast: 'роли: креатор',
    sides: [{ label: 'Крош', labelEn: 'Krosh', icon: 'rocket', color: 'sky', roles: ['креатор'] }],
  });
  assert.equal(cast.sides[0].color, 'sky');
  assert.equal(cast.talk, true, 'комната без регламента не пережила сохранения');
});

test('комната переживает круг «сохранили — прочитали»', () => {
  const saved = saveSpace({
    name: 'разбор', title: 'Разбор', titleEn: 'Review', for: 'проверка', slug: 'review',
    color: 'red', cast: 'роли: скептик', duty: 'роли: скептик', tune: 'спор',
    circle: 'назови, где сломается', laws: 'Здесь ломают, а не хвалят.',
  });
  assert.equal(saved.titleEn, 'Review');
  assert.equal(saved.color, 'red');
  assert.deepEqual(saved.needs, ['скептик']);
  assert.equal(saved.circle, 'назови, где сломается');
  assert.equal(saved.laws, 'Здесь ломают, а не хвалят.');
  assert.equal(saved.tune, 'спор');
});

/**
 * Словарь оболочки: русская и английская строки стоят рядом ровно затем, чтобы
 * не разъезжаться. Разъезжались всё равно — английская подпись к памяти обещала
 * не то, что русская, и не знала про одну из подстановок. Теперь это ловится здесь.
 */
test('словарь: ключи и подстановки совпадают в обоих языках', async () => {
  const src = fs.readFileSync(new URL('../web/src/lib/i18n.tsx', import.meta.url), 'utf8');
  const dicts = [...src.matchAll(/const (RU|EN)[^=]*=\s*\{([\s\S]*?)\n\}\s*(?:as const)?/g)];
  const parse = (body) => {
    const out = new Map();
    for (const m of body.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) out.set(m[1], m[2]);
    return out;
  };
  const ru = parse(dicts.find((d) => d[1] === 'RU')[2]);
  const en = parse(dicts.find((d) => d[1] === 'EN')[2]);
  assert.ok(ru.size > 100, 'русский словарь не разобрался');

  assert.deepEqual([...ru.keys()].filter((k) => !en.has(k)), [], 'есть ключи без перевода');
  assert.deepEqual([...en.keys()].filter((k) => !ru.has(k)), [], 'есть перевод без русского ключа');

  // Подстановка, которой нет в одном из языков, — это дыра в строке: «Сейчас в ней 12,
  // из них 3 знает всё пространство» против «It holds 12 right now» про совсем другое.
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const врозь = [...ru].filter(([k, v]) => ph(v) !== ph(en.get(k)))
    .map(([k, v]) => `${k}: RU{${ph(v)}} EN{${ph(en.get(k))}}`);
  assert.deepEqual(врозь, [], 'подстановки разошлись');
});

/** Ключи, которые переведены на два языка и не вызываются нигде, — это мёртвый вес. */
test('словарь: мёртвых ключей нет', async () => {
  const root = new URL('../web/src/', import.meta.url);
  const code = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|ts)$/.test(e.name) && !p.endsWith('i18n.tsx')) code.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(new URL('.', root).pathname);
  const all = code.join('\n');

  const src = fs.readFileSync(new URL('lib/i18n.tsx', root), 'utf8');
  const body = src.match(/const RU[^=]*=\s*\{([\s\S]*?)\n\}/)[1];
  const keys = [...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]);

  // Ключ могут собирать шаблоном: `feed.act.${act}`, `composer.hint.${slug}`,
  // `feed.status${Имя}`. Семью считаем живой, если в коде есть любое её начало,
  // за которым сразу идёт подстановка. Начало короче четырёх знаков не берём:
  // по нему совпадёт что угодно.
  const живой = (k) => all.includes(k)
    || [...Array(k.length - 3).keys()].some((i) => all.includes(`${k.slice(0, i + 4)}\${`));
  const мёртвые = keys.filter((k) => !живой(k));
  assert.deepEqual(мёртвые, [], 'словарь тащит ключи, которых никто не спрашивает');
});
