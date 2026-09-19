/** Разбор обращений и файлов режимов — чистые функции, без движка. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-modes-'));
process.env.SPACE_MODES_DIR = dir;
const { parseMentions } = await import('../lib/mentions.js');
const { loadMode, saveMode, stepTargets } = await import('../lib/modes.js');

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

test('режим переживает круг «сохранили — прочитали»', () => {
  const saved = saveMode({
    name: 'круг', title: 'Круг', titleEn: 'Round', for: 'проверка', needs: ['скептик'], slug: 'round',
    steps: [{ name: 'раз', who: '@скептик', hear: false, until: 'человек', prompt: 'одна строка' }],
  });
  assert.equal(saved.titleEn, 'Round');
  assert.deepEqual(saved.needs, ['скептик']);
  assert.deepEqual(saved.steps[0], { name: 'раз', who: '@скептик', hear: false, until: 'человек', prompt: 'одна строка' });
});
