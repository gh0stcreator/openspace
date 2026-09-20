import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRoles } from './roles.js';

/**
 * Режим — устройство разговора: кто говорит на шаге, слышат ли участники друг друга
 * и что закрывает шаг. Лежит файлом в modes/, перечитывается на каждом обращении.
 */

// Папку можно подменить: тесты движка ходят по своим режимам, а не по рабочим.
const DIR = process.env.SPACE_MODES_DIR
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modes');

/** Имя встроенного режима. Единственное место, где оно написано буквами. */
export const BUILTIN = 'свободный';

const FREE = {
  name: BUILTIN,
  title: 'Открытый',
  titleEn: 'Open',
  shortEn: 'Open',
  forEn: 'A conversation with no procedure, on any topic',
  briefEn: 'Whoever is called answers',
  brief: 'Отвечает тот, кого позвали',
  rubric: 'Разговор',
  rubricEn: 'Talk',
  for: 'Разговор без регламента, для любой темы',
  needs: [],
  icon: 'message-circle',
  color: '',
  slug: 'open',
  short: 'Открытый',
  steps: [{ name: 'разговор', who: 'все', hear: true, until: 'человек', prompt: '' }],
};

function parseStep(name, lines) {
  const step = { name, who: 'все', hear: true, until: 'все ответят', prompt: '' };
  for (const raw of lines) {
    const m = raw.match(/^(who|hear|until|prompt):\s*([\s\S]*)$/);
    if (!m) {
      // Продолжение многострочного prompt.
      if (step.prompt) step.prompt += `\n${raw}`;
      continue;
    }
    const [, key, value] = m;
    if (key === 'hear') step.hear = !/^(нет|no|false)$/i.test(value.trim());
    else step[key] = value.trim();
  }
  // Пустые строки после prompt — разделитель шагов, а не хвост текста.
  step.prompt = step.prompt.trim();
  return step;
}

function parse(name, raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  const body = m ? m[2] : raw;
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }

  const steps = [];
  let current = null;
  let buf = [];
  for (const line of body.split('\n')) {
    const head = line.match(/^##\s+(.+)$/);
    if (head) {
      if (current) steps.push(parseStep(current, buf));
      current = head[1].trim();
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) steps.push(parseStep(current, buf));

  return {
    name,
    title: meta.title ?? name,
    // Английские подписи живут рядом с русскими: один режим — один файл.
    titleEn: meta.title_en ?? '',
    shortEn: meta.short_en ?? '',
    forEn: meta.for_en ?? '',
    briefEn: meta.brief_en ?? '',
    brief: meta.brief ?? '',
    // Рубрика: к какой работе режим относится — решение, проверка, идеи, разбор.
    rubric: meta.rubric ?? '',
    rubricEn: meta.rubric_en ?? '',
    // Для чего режим годится и кто в нём обязательно нужен — это и решает человек,
    // выбирая режим; механика шагов ему в этот момент неинтересна.
    for: meta.for ?? '',
    needs: needsOf(steps),
    icon: meta.icon ?? 'workflow',
    // Цвет режима — из той же палитры, что у участников (--tone-<цвет>).
    // Пусто — режим без цвета: так выглядит разговор без регламента.
    color: meta.color ?? '',
    // Латинское имя для знака open(...): он набран как вызов функции.
    slug: slugOf(meta, name),
    // Короткое имя для строки управления: длинный заголовок там не помещается.
    short: meta.short ?? meta.title ?? name,
    steps: steps.length ? steps : FREE.steps,
  };
}

export function loadMode(name) {
  const safe = String(name || BUILTIN).replace(/[^\w\-Ѐ-ӿ]/g, '');
  const file = path.join(DIR, `${safe}.md`);
  if (!fs.existsSync(file)) return FREE;
  try {
    const mode = parse(safe, fs.readFileSync(file, 'utf8'));
    if (safe !== BUILTIN) return mode;
    // Встроенный режим тоже файл: его «кто говорит» — это дежурные. Чего в файле нет,
    // берём из значений по умолчанию, чтобы пустая строка не стёрла название.
    const filled = Object.fromEntries(Object.entries(mode).filter(([, v]) => v !== ''));
    return { ...FREE, ...filled };
  } catch {
    return FREE;
  }
}

export function listModes() {
  if (!fs.existsSync(DIR)) return [FREE];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => loadMode(f.slice(0, -3)))
    .sort((a, b) => (a.name === BUILTIN ? -1 : b.name === BUILTIN ? 1 : a.name.localeCompare(b.name)));
}

/**
 * Без кого режим не работает. Считается по шагам, а не объявляется отдельно: два списка
 * про одно и то же расходятся — в «Ревью» объявлены были двое, а работали пятеро.
 * Имена ролей узнаём по папке roles/: всё остальное в строке `who` — служебные слова.
 */
function needsOf(steps) {
  const known = new Set(listRoles().map((r) => r.name.toLowerCase()));
  const out = new Set();
  for (const st of steps ?? []) {
    for (const [, word] of String(st.who ?? '').matchAll(/@?([\p{L}\-]+)/gu)) {
      const n = word.toLowerCase();
      if (known.has(n)) out.add(n);
    }
  }
  return [...out];
}

/** Латинское имя для знака. Явный slug в файле сильнее; иначе берём английское название —
 * транслитерации здесь не бывает: «Прожарка» это roast, а не prozharka. */
function slugOf(meta, name) {
  const explicit = String(meta.slug ?? '').trim();
  if (explicit) return explicit;
  const en = String(meta.title_en ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return en || name;
}

/** Кого зовёт шаг: всех, перечисленных поимённо или носителей роли. */
export function stepTargets(step, names, roster) {
  const who = (step.who ?? 'все').trim();
  if (!who || /^(все|all)$/i.test(who)) return [...names];

  // Ролей может быть несколько: «роль: скептик, инженер». Режим описывает, кто ему нужен,
  // а не как зовут участников в конкретной комнате — иначе переименование ломает режим.
  const byRole = who.match(/^рол[ьи]:\s*(.+)$/i);
  if (byRole) {
    const want = byRole[1].split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
    return names.filter((n) => want.includes((roster[n]?.role ?? '').toLowerCase()));
  }

  const listed = [...who.matchAll(/@([a-zA-Z0-9_\-Ѐ-ӿ]+)/g)].map((m) => m[1].toLowerCase());
  return names.filter((n) => listed.includes(n.toLowerCase()));
}

/** Собрать файл режима обратно из структуры — редактор правит именно его. */
export function saveMode(mode) {
  const safe = String(mode.name ?? '').replace(/[^\w\-\u0400-\u04FF]/g, '');
  if (!safe) throw new Error('у режима нет имени');

  const head = [
    '---',
    `title: ${mode.title ?? safe}`,
    `title_en: ${mode.titleEn ?? ''}`,
    `brief: ${mode.brief ?? ''}`,
    `brief_en: ${mode.briefEn ?? ''}`,
    `for: ${mode.for ?? ''}`,
    `for_en: ${mode.forEn ?? ''}`,
    `rubric: ${mode.rubric ?? ''}`,
    `rubric_en: ${mode.rubricEn ?? ''}`,
    `icon: ${mode.icon ?? 'list-ordered'}`,
    `color: ${mode.color ?? ''}`,
    `slug: ${mode.slug ?? safe}`,
    `short: ${mode.short ?? mode.title ?? safe}`,
    `short_en: ${mode.shortEn ?? ''}`,
    '---',
    '',
  ];

  const body = (mode.steps ?? []).map((st) => [
    `## ${st.name}`,
    `who: ${st.who || 'все'}`,
    `hear: ${st.hear === false ? 'нет' : 'да'}`,
    `until: ${st.until || 'все ответят'}`,
    // Переносы внутри промпта сохраняем: разбор их понимает (продолжение строки
    // дописывается к prompt), а схлопывание в пробел молча съедало абзацы у того,
    // кто писал шаг в редакторе.
    `prompt: ${(st.prompt ?? '').trim()}`,
    '',
  ].join('\n'));

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${safe}.md`), head.concat(body).join('\n'));
  return loadMode(safe);
}

/** Удалить режим. Встроенный не трогаем: без него не к чему возвращаться. */
export function removeMode(name) {
  const safe = String(name ?? '').replace(/[^\w\-\u0400-\u04FF]/g, '');
  if (!safe || safe === BUILTIN) return false;
  const file = path.join(DIR, `${safe}.md`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
