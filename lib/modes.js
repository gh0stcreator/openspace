import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Режим — устройство разговора: кто говорит на шаге, слышат ли участники друг друга
 * и что закрывает шаг. Лежит файлом в modes/, перечитывается на каждом обращении.
 */

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modes');

const FREE = {
  name: 'свободный',
  title: 'Открытый',
  brief: 'Отвечает тот, кого позвали',
  for: 'Разговор без регламента, для любой темы',
  needs: [],
  icon: 'message-circle',
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
    if (key === 'hear') step.hear = !/^нет|no|false$/i.test(value.trim());
    else step[key] = value.trim();
  }
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
    brief: meta.brief ?? '',
    // Для чего режим годится и кто в нём обязательно нужен — это и решает человек,
    // выбирая режим; механика шагов ему в этот момент неинтересна.
    for: meta.for ?? '',
    needs: (meta.needs ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    icon: meta.icon ?? 'workflow',
    // Латинское имя для знака open(...): он набран как вызов функции.
    slug: meta.slug ?? name,
    // Короткое имя для строки управления: длинный заголовок там не помещается.
    short: meta.short ?? meta.title ?? name,
    steps: steps.length ? steps : FREE.steps,
  };
}

export function loadMode(name) {
  if (!name || name === 'свободный') return FREE;
  const safe = String(name).replace(/[^\w\-Ѐ-ӿ]/g, '');
  const file = path.join(DIR, `${safe}.md`);
  if (!fs.existsSync(file)) return FREE;
  try {
    return parse(safe, fs.readFileSync(file, 'utf8'));
  } catch {
    return FREE;
  }
}

export function listModes() {
  if (!fs.existsSync(DIR)) return [FREE];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => loadMode(f.slice(0, -3)))
    .sort((a, b) => (a.name === 'свободный' ? -1 : a.name.localeCompare(b.name)));
}

/** Кого зовёт шаг: всех, перечисленных поимённо или носителей роли. */
export function stepTargets(step, names, roster) {
  const who = (step.who ?? 'все').trim();
  if (!who || /^(все|all)$/i.test(who)) return [...names];

  const byRole = who.match(/^роль:\s*(.+)$/i);
  if (byRole) {
    const role = byRole[1].trim().toLowerCase();
    return names.filter((n) => (roster[n]?.role ?? '').toLowerCase() === role);
  }

  const listed = [...who.matchAll(/@([a-zA-Z0-9_\-Ѐ-ӿ]+)/g)].map((m) => m[1].toLowerCase());
  return names.filter((n) => listed.includes(n.toLowerCase()));
}

/** Собрать файл режима обратно из структуры — редактор правит именно его. */
export function saveMode(mode) {
  const safe = String(mode.name ?? '').replace(/[^\w\-\u0400-\u04FF]/g, '');
  if (!safe || safe === 'свободный') throw new Error('такое имя занято');

  const head = [
    '---',
    `title: ${mode.title ?? safe}`,
    `brief: ${mode.brief ?? ''}`,
    `for: ${mode.for ?? ''}`,
    `needs: ${(mode.needs ?? []).join(', ')}`,
    `icon: ${mode.icon ?? 'list-ordered'}`,
    `slug: ${mode.slug ?? safe}`,
    `short: ${mode.short ?? mode.title ?? safe}`,
    '---',
    '',
  ];

  const body = (mode.steps ?? []).map((st) => [
    `## ${st.name}`,
    `who: ${st.who || 'все'}`,
    `hear: ${st.hear === false ? 'нет' : 'да'}`,
    `until: ${st.until || 'все ответят'}`,
    `prompt: ${(st.prompt ?? '').replace(/\n+/g, ' ').trim()}`,
    '',
  ].join('\n'));

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${safe}.md`), head.concat(body).join('\n'));
  return loadMode(safe);
}

/** Удалить режим. Встроенный «свободный» не трогаем: без него не к чему возвращаться. */
export function removeMode(name) {
  const safe = String(name ?? '').replace(/[^\w\-\u0400-\u04FF]/g, '');
  if (!safe || safe === 'свободный') return false;
  const file = path.join(DIR, `${safe}.md`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
