import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Роли лежат в roles/*.md — по файлу на роль, с frontmatter (title, brief, icon).
 * Файлы перечитываются на каждый ход, поэтому правку роли видно без перезапуска.
 */

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'roles');

const split = (v) => String(v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const FALLBACK = {
  name: 'peer',
  title: 'собеседник',
  brief: 'Равный участник без закреплённой функции.',
  icon: '💬',
  on: [],
  off: [],
  body: 'Ты равный участник обсуждения. Говоришь по существу вопроса.',
};

function parse(name, raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { ...FALLBACK, name, body: raw.trim() };

  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return {
    name,
    title: meta.title ?? name,
    brief: meta.brief ?? '',
    icon: meta.icon ?? '🤖',
    // Зона интереса роли: по этим словам участник откликается сам, без прямого обращения.
    on: split(meta.on),
    off: split(meta.off),
    body: m[2].trim(),
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
