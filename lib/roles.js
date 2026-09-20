import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Роли лежат в roles/*.md — по файлу на роль, с frontmatter (title, brief, icon).
 * Файлы перечитываются на каждый ход, поэтому правку роли видно без перезапуска.
 */

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'roles');

const split = (v) => String(v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Оси ансамбля. Состав держится не списком ролей, а парами, которые тянут разговор
 * в разные стороны: роль, которая ни с кем не спорит, — лишний рот. Полюс объявлен
 * в самой роли полем `тянет`, пара считается отсюда.
 *
 * Продюсер и Архивариус полюса не имеют, и это не пропуск: первый ведёт разговор,
 * а не тянет его, второй в разговоре не участвует вовсе.
 */
export const AXES = [
  ['импульс', 'осторожность'],
  ['теория', 'практика'],
  ['опыт', 'вкус'],
];

/** Противоположный полюс той же оси. Неизвестный полюс — пусто, а не догадка. */
export function opposite(pole) {
  const p = String(pole ?? '').trim().toLowerCase();
  for (const [a, b] of AXES) {
    if (p === a) return b;
    if (p === b) return a;
  }
  return '';
}

const FALLBACK = {
  name: 'peer',
  title: 'собеседник',
  titleEn: 'peer',
  brief: 'Равный участник без закреплённой функции.',
  briefEn: 'An equal participant with no fixed function.',
  icon: '💬',
  archetype: '',
  archetypeEn: '',
  model: '',
  skills: [],
  decides: '',
  pulls: '',
  on: [],
  off: [],
  body: 'Ты равный участник обсуждения. Говоришь по существу вопроса.',
  voice: '',
};

function parse(name, raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { ...FALLBACK, name, ...split_voice(raw) };

  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w\u0400-\u04FF]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return {
    name,
    title: meta.title ?? name,
    titleEn: meta.title_en ?? '',
    brief: meta.brief ?? '',
    briefEn: meta.brief_en ?? '',
    icon: meta.icon ?? '🤖',
    // Амплуа — одно слово: место в ансамбле, а не функция. Живёт в роли, а не в карточке:
    // Скептик с темпераментом Заводилы уже не Скептик.
    archetype: meta.archetype ?? '',
    archetypeEn: meta.archetype_en ?? '',
    // Какой моделью такую роль обычно водят. Подставляется при найме, перебивается в карточке.
    model: meta.model ?? '',
    // Домен, в котором слово этой роли закрывает спор. Иерархия по компетенции —
    // единственная, которая в литературе помогает: ранг сам по себе в комнате моделей
    // производит не порядок, а согласие (Woolley 2010, Sharma 2023, Zhang ACL 2024).
    decides: (meta['решает'] ?? '').trim(),
    // Что роли нужно уметь руками: подставляется при найме, дальше правится в карточке.
    skills: (meta['умеет'] ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    // Куда роль тянет разговор: полюс одной из осей. Пусто — роль вне пар.
    pulls: (meta['тянет'] ?? meta.pulls ?? '').trim().toLowerCase(),
    // Зона интереса роли: по этим словам участник откликается сам, без прямого обращения.
    on: split(meta.on),
    off: split(meta.off),
    ...split_voice(m[2]),
  };
}

/**
 * Поведение и голос правятся врозь, поэтому и лежат врозь: всё до «## Голос» —
 * что участник делает, всё после — как он это говорит. Без раздела роль остаётся
 * безголосой, и тогда все шестеро звучат одним человеком.
 */
function split_voice(raw) {
  const text = String(raw).trim();
  const at = text.search(/^##\s+Голос\s*$/m);
  if (at < 0) return { body: text, voice: '' };
  return {
    body: text.slice(0, at).trim(),
    voice: text.slice(at).replace(/^##\s+Голос\s*\n?/, '').trim(),
  };
}

export function loadRole(name) {
  if (!name) return FALLBACK;
  // Имя роли может быть кириллицей; режем только то, что опасно для пути.
  const safe = String(name).replace(/[^\w\-\u0400-\u04FF]/g, '');
  const file = path.join(DIR, `${safe}.md`);
  if (!fs.existsSync(file)) return { ...FALLBACK, name: safe };
  try {
    return parse(safe, fs.readFileSync(file, 'utf8'));
  } catch {
    return { ...FALLBACK, name: safe };
  }
}

export function roleOf(cfg) {
  return loadRole(cfg?.role);
}

/** Все роли, что лежат в папке, — для подсказок и валидации при найме. */
export function listRoles() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => loadRole(f.slice(0, -3)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
