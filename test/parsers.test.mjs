/** Разбор обращений и файлов режимов — чистые функции, без движка. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-modes-'));
process.env.SPACE_MODES_DIR = dir;
const { parseMentions } = await import('../lib/mentions.js');
const { loadMode, saveMode, sideOf, stepTargets } = await import('../lib/modes.js');
const { saysRestart } = await import('../lib/orchestrator.js');

test('обращения: кириллица, регистр, знаки вокруг', () => {
  const known = ['Скептик', 'qa-bot', 'Roman'];
  assert.deepEqual(parseMentions('@скептик, глянь. И (@QA-bot) тоже', known), ['Скептик', 'qa-bot']);
  assert.deepEqual(parseMentions('почта roman@example.com и @Никто', known), []);
});

test('hear читается строго: «нет», «no», «false» — и только они', () => {
  for (const [value, hear] of [['нет', false], ['no', false], ['да', true], ['нетрудно', true], ['да, но (no anchoring)', true]]) {
    fs.writeFileSync(path.join(dir, 'x.md'), `## шаг\nwho: все\nhear: ${value}\nuntil: все ответят\nprompt: п\n`);
    assert.equal(loadMode('x').steps[0].hear, hear, `hear: ${value}`);
  }
});

test('кого зовёт шаг: все, поимённо, по роли', () => {
  const names = ['Инженер', 'Скептик'];
  const roster = { Инженер: { role: 'инженер' }, Скептик: { role: 'скептик' } };
  assert.deepEqual(stepTargets({ who: 'все' }, names, roster), names);
  assert.deepEqual(stepTargets({ who: '@скептик, @никто' }, names, roster), ['Скептик']);
  assert.deepEqual(stepTargets({ who: 'роль: инженер' }, names, roster), ['Инженер']);
});

test('ведущий начинает заново: маркер ловится и на кириллице', () => {
  // `\b` в JS знает только латиницу: «Заново — новый предмет» ей не граница слова,
  // и маркер молча не срабатывал.
  assert.ok(saysRestart('Заново — новый предмет: кто прав'));
  assert.ok(saysRestart('заново. спорим о другом'));
  assert.ok(!saysRestart('Мы на шаге «Тезис», до твоего слова дойдём в приговоре'));
  assert.ok(!saysRestart('Зановоль'));
});

test('стороны режима: разбор, сторона по роли, круг «сохранили — прочитали»', () => {
  const saved = saveMode({
    name: 'спор', title: 'Спор', slug: 'argue',
    sides: [
      { label: 'За', labelEn: 'For', icon: 'thumbs-up', roles: ['креатор', 'инженер'] },
      { label: 'Против', labelEn: 'Against', icon: '', roles: ['скептик'] },
    ],
    steps: [{ name: 'раз', who: 'все', hear: true, until: 'человек', prompt: 'п' }],
  });
  assert.deepEqual(saved.sides[0], {
    label: 'За', labelEn: 'For', icon: 'thumbs-up', color: '', roles: ['креатор', 'инженер'],
  });
  // Знак и цвет необязательны: сторона без них остаётся стороной.
  assert.deepEqual(saved.sides[1], {
    label: 'Против', labelEn: 'Against', icon: '', color: '', roles: ['скептик'],
  });
  assert.equal(sideOf(saved, 'ИНЖЕНЕР').label, 'За');
  assert.equal(sideOf(saved, 'дизайнер'), null);
  // Режим без сторон — не ошибка: их нет у большинства.
  assert.deepEqual(loadMode('x').sides, []);

  // Персона — сторона с цветом: под ней участник выходит целиком, а не помечен подписью.
  const cast = saveMode({
    name: 'цирк', title: 'Цирк', slug: 'circus', talk: true,
    sides: [{ label: 'Крош', labelEn: 'Krosh', icon: 'rocket', color: 'sky', roles: ['креатор'] }],
    steps: [{ name: 'разговор', who: 'роли: креатор', hear: true, until: 'человек', prompt: '' }],
  });
  assert.equal(cast.sides[0].color, 'sky');
  assert.equal(cast.talk, true, 'режим без регламента не пережил сохранения');
});

test('режим переживает круг «сохранили — прочитали»', () => {
  const saved = saveMode({
    name: 'круг', title: 'Круг', titleEn: 'Round', for: 'проверка', needs: ['скептик'], slug: 'round',
    steps: [{ name: 'раз', who: '@скептик', hear: false, until: 'человек', prompt: 'одна строка' }],
  });
  assert.equal(saved.titleEn, 'Round');
  assert.deepEqual(saved.needs, ['скептик']);
  assert.deepEqual(saved.steps[0], { name: 'раз', who: '@скептик', hear: false, until: 'человек', prompt: 'одна строка' });
});
