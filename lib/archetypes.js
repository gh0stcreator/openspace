import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unwrap } from './text.js';

/**
 * Амплуа — готовый голос: как участник говорит, что замечает первым, какой длины пишет,
 * ставит ли эмодзи. Лежит файлом в archetypes/, и это шаблон, а не свойство роли: роль
 * отвечает на «что делает», амплуа — на «как звучит», и одно к другому не привязано
 * намертво. Выбрал амплуа — в поле участника лёг его текст целиком, дальше правь руками.
 */

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'archetypes');

function parse(name, raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([\wЀ-ӿ]+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }
  return {
    name,
    title: meta.title ?? name,
    titleEn: meta.title_en ?? '',
    brief: meta.brief ?? '',
    briefEn: meta.brief_en ?? '',
    // К чему персонаж неравнодушен и зачем вообще открывает рот. По словам из зоны
    // роли ловится тема, а не смысл; человек же вступает в разговор не потому,
    // что прозвучало слово, а потому, что задело — или потому, что хочется
    // выпендриться перед тем, кто рядом.
    cares: meta['близко'] ?? '',
    motive: meta['мотив'] ?? '',
    voice: unwrap(m ? m[2] : raw),
  };
}

export function loadArchetype(name) {
  const safe = String(name ?? '').toLowerCase().replace(/[^\w\-Ѐ-ӿ]/g, '');
  if (!safe) return null;
  const file = path.join(DIR, `${safe}.md`);
  if (!fs.existsSync(file)) return null;
  try {
    return parse(safe, fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Все амплуа из папки — для выбора в карточке участника. */
export function listArchetypes() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => parse(f.slice(0, -3), fs.readFileSync(path.join(DIR, f), 'utf8')))
    .sort((a, b) => a.title.localeCompare(b.title));
}
