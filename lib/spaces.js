import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRoles } from './roles.js';

/**
 * Пространство — комната, и она же тип работы. Раньше это были две сущности про одно
 * и то же: комната несла ленту, память и состав, а режим — порядок разговора и то,
 * кем в нём выходят. Резать надвое было нечего: «где мы» и «как мы сейчас работаем» —
 * один вопрос, и отвечает на него цвет комнаты. Зашёл в красную — будут ломать,
 * в зелёную — придумывать.
 *
 * Описание лежит файлом в spaces/ и едет в гит: это инструмент. Лента, состояние
 * и память лежат в rooms/ под тем же именем и в гит не едут: это разговор.
 */

// Папку можно подменить: тесты движка ходят по своим комнатам, а не по рабочим.
const DIR = process.env.SPACE_DIR
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'spaces');

/** Имя комнаты по умолчанию. Единственное место, где оно написано буквами. */
export const BUILTIN = 'опенспейс';

/**
 * Встроенная комната — та, в которой оказываешься, если файла нет. Пустой состав,
 * никакого круга: разговор без задачи. Она же подложка для комнат, оставшихся
 * от прежних лент: старый `?room=разбор` открывается и работает.
 */
const OPEN = {
  name: BUILTIN,
  title: 'Опенспейс',
  titleEn: 'Openspace',
  short: 'Опенспейс',
  shortEn: 'Openspace',
  brief: 'Разговор без задачи',
  briefEn: 'A conversation with no task',
  for: 'Просто поговорить: спросить, подумать вслух, ничего не решая',
  forEn: 'Just talk: ask, think aloud, decide nothing',
  needs: [],
  icon: 'message-circle',
  color: '',
  slug: 'open',
  cast: 'все',
  duty: '',
  circle: '',
  tune: 'разговор',
  sides: [],
  talk: false,
  laws: '',
};

/**
 * Должности этой комнаты: кто в ней за что. Роль отвечает на «что участник делает
 * вообще», должность — на «кто он здесь»: в красной комнате Скептик выходит не как
 * скептик, а как тот, кто ломает, и по ленте это видно без чтения реплик.
 * Строкой: «Ломает/hammer: скептик, инженер | Держит/shield: заступник».
 */
function sidesOf(meta) {
  const en = String(meta.sides_en ?? '').split('|').map((s) => s.trim());
  return String(meta.sides ?? '').split('|').map((chunk, i) => {
    const m = chunk.trim().match(/^([^/:]+?)(?:\/([\w-]*))?(?:\/([\w-]*))?\s*:\s*(.+)$/);
    if (!m) return null;
    return {
      label: m[1].trim(),
      labelEn: en[i] ?? '',
      icon: (m[2] ?? '').trim(),
      // Цвет необязателен: у должности его нет — цвет там опознаёт участника.
      // У персонажа он есть: голубой Крош голубой и есть, это половина его имени.
      color: (m[3] ?? '').trim(),
      roles: m[4].split(',').map((r) => r.trim().toLowerCase()).filter(Boolean),
    };
  }).filter(Boolean);
}

/** Должности обратно в строку файла: разбор и сборка обязаны быть обратны друг другу. */
export function sidesLine(sides) {
  return (sides ?? [])
    .map((s) => {
      const tail = s.color ? `/${s.icon ?? ''}/${s.color}` : (s.icon ? `/${s.icon}` : '');
      return `${s.label}${tail}: ${(s.roles ?? []).join(', ')}`;
    })
    .join(' | ');
}

/**
 * Динамика комнаты: насколько охотно здесь вступают в разговор и по чему меряют
 * собственную мысль. Числа — пороги внутренней мотивации из Inner Thoughts (CHI 2025),
 * где их калибровали на живых людях. Болтовне, разгону идей, рабочей встрече и разбору
 * чужого решения нужна разная готовность открыть рот, и одним набором тут не обойтись.
 *
 * Шкала одна на оба порога и читается в одну сторону: чем число больше, тем труднее.
 * `reply` — насколько хорошей должна быть мысль, чтобы её сказали вслух; `intervene` —
 * чтобы вклиниться в реплику, адресованную другому; `spontaneity` — доля случаев,
 * когда отвечают и без достаточного основания; `criteria` — по чему меряют мысль.
 *
 * В файле комнаты стоит одно слово — имя динамики. Числа наружу не выходят: человеку
 * нужно поведение, а не устройство движка.
 */
export const TUNES = {
  разговор: {
    reply: 3.6,
    intervene: 4.8,
    spontaneity: 0.2,
    criteria: 'зацепило ли это лично его и есть ли что сказать своё',
  },
  разгон: {
    reply: 3.8,
    intervene: 4.9,
    spontaneity: 0.1,
    criteria: 'неожиданность мысли и то, насколько она сдвинет разговор; повтор уже сказанного — балл вниз',
  },
  встреча: {
    reply: 4.0,
    intervene: 4.2,
    spontaneity: 0,
    criteria: 'пробел в сказанном, несостыковку и уход от темы; просто согласие — балл вниз',
  },
  спор: {
    reply: 3.5,
    intervene: 4.5,
    spontaneity: 0,
    criteria: 'противоречие, риск и слабое место в доводе; вежливое согласие — балл вниз',
  },
};

/** Динамика комнаты: у разговора своя, у работы — рабочая. */
export function tuneOf(space) {
  return TUNES[space?.tune] ?? (space?.talk ? TUNES.разговор : TUNES.встреча);
}

/** Должность участника — по его роли. Нет должностей у комнаты — нет и должности. */
export function sideOf(space, role) {
  const r = String(role ?? '').toLowerCase();
  return (space?.sides ?? []).find((s) => s.roles.includes(r)) ?? null;
}

function parse(name, raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  const body = m ? m[2] : raw;
  if (m) {
    for (const line of m[1].split('\n')) {
      // Ключ может быть кириллицей: «состав» — такое же поле шапки, как slug или icon.
      const kv = line.match(/^([\wЀ-ӿ]+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }

  const cast = String(meta['состав'] ?? 'все').trim() || 'все';
  // «нет» — комната без круга: сюда заходят поговорить, а не решать задачу.
  const circle = String(meta['круг'] ?? '').trim();

  return {
    name,
    title: meta.title ?? name,
    // Английские подписи живут рядом с русскими: одна комната — один файл.
    titleEn: meta.title_en ?? '',
    shortEn: meta.short_en ?? '',
    forEn: meta.for_en ?? '',
    briefEn: meta.brief_en ?? '',
    brief: meta.brief ?? '',
    // Для чего комната годится и кто в ней обязательно нужен — это и решает человек,
    // выбирая, куда зайти.
    for: meta.for ?? '',
    needs: needsOf(cast),
    icon: meta.icon ?? 'message-circle',
    // Цвет — единственный опознавательный знак комнаты. Из той же палитры, что
    // у участников (--tone-<цвет>): красная, синяя, зелёная, фиолетовая, белая.
    color: meta.color ?? '',
    // Латинское имя для знака open(...): он набран как вызов функции.
    slug: slugOf(meta, name),
    // Короткое имя для строки управления: длинный заголовок там не помещается.
    short: meta.short ?? meta.title ?? name,
    // Кто здесь живёт и кто отвечает человеку без тега. Дежурные пусты — отвечает состав.
    cast,
    duty: String(meta['дежурные'] ?? '').trim(),
    // Текст первого круга: с ним каждый отвечает, не видя чужих ответов. Пусто — круга нет.
    circle: /^(нет|no|false)$/i.test(circle) ? '' : circle,
    // Кто в комнате за что: пары ролей с подписью и знаком.
    sides: sidesOf(meta),
    // Комната без регламента: круг в ней не заводится, ходы идут как в разговоре. Нужна
    // там, где важно не как работают, а кем участники выходят.
    talk: /^(да|yes|true)$/i.test(String(meta.talk ?? '')),
    // Динамика: разговор, разгон, встреча или спор. Пусто — по типу комнаты.
    tune: TUNES[String(meta['динамика'] ?? '').trim()] ? String(meta['динамика']).trim() : '',
    // Уклад комнаты: он же её законы. Едет в промпт каждому, кто здесь говорит.
    laws: body.trim(),
  };
}

export function loadSpace(name) {
  const safe = String(name || BUILTIN).replace(/[^\w\-Ѐ-ӿ]/g, '');
  const file = path.join(DIR, `${safe}.md`);
  // Комнаты без файла — старые ленты: они открываются и работают как опенспейс.
  if (!fs.existsSync(file)) return { ...OPEN, name: safe, title: safe };
  try {
    const space = parse(safe, fs.readFileSync(file, 'utf8'));
    if (safe !== BUILTIN) return space;
    // Опенспейс тоже файл. Чего в файле нет, берём из умолчаний, чтобы пустая строка
    // не стёрла название.
    const filled = Object.fromEntries(Object.entries(space).filter(([, v]) => v !== ''));
    return { ...OPEN, ...filled };
  } catch {
    return { ...OPEN, name: safe, title: safe };
  }
}

export function listSpaces() {
  if (!fs.existsSync(DIR)) return [OPEN];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => loadSpace(f.slice(0, -3)))
    // Опенспейс первым, комнаты без регламента — последними: они не про работу,
    // а про то, кем в них выходят.
    .sort((a, b) => {
      if (a.name === BUILTIN || b.name === BUILTIN) return a.name === BUILTIN ? -1 : 1;
      if (a.talk !== b.talk) return a.talk ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Без кого комната не работает. Считается по составу, а не объявляется отдельно:
 * два списка про одно и то же расходятся. Имена ролей узнаём по папке roles/:
 * всё остальное в строке состава — служебные слова.
 */
function needsOf(cast) {
  const known = new Set(listRoles().map((r) => r.name.toLowerCase()));
  const out = new Set();
  for (const [, word] of String(cast ?? '').matchAll(/@?([\p{L}\-]+)/gu)) {
    const n = word.toLowerCase();
    if (known.has(n)) out.add(n);
  }
  return [...out];
}

/** Латинское имя для знака. Явный slug в файле сильнее; иначе английское название —
 * транслитерации здесь не бывает: «Красная» это red, а не krasnaya. */
function slugOf(meta, name) {
  const explicit = String(meta.slug ?? '').trim();
  if (explicit) return explicit;
  const en = String(meta.title_en ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return en || name;
}

/**
 * Кого зовёт строка состава: всех, перечисленных поимённо или носителей роли.
 * Комната описывает, кто ей нужен, а не как зовут участников, — иначе переименование
 * участника ломает комнату.
 */
export function pick(who, names, roster) {
  const line = (who ?? 'все').trim();
  if (!line || /^(все|all)$/i.test(line)) return [...names];

  const byRole = line.match(/^рол[ьи]:\s*(.+)$/i);
  if (byRole) {
    const want = byRole[1].split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
    return names.filter((n) => want.includes((roster[n]?.role ?? '').toLowerCase()));
  }

  const listed = [...line.matchAll(/@([a-zA-Z0-9_\-Ѐ-ӿ]+)/g)].map((m) => m[1].toLowerCase());
  return names.filter((n) => listed.includes(n.toLowerCase()));
}

/** Собрать файл комнаты обратно из структуры — редактор правит именно его. */
export function saveSpace(space) {
  const safe = String(space.name ?? '').replace(/[^\w\-Ѐ-ӿ]/g, '');
  if (!safe) throw new Error('у комнаты нет имени');

  const head = [
    '---',
    `title: ${space.title ?? safe}`,
    `title_en: ${space.titleEn ?? ''}`,
    `brief: ${space.brief ?? ''}`,
    `brief_en: ${space.briefEn ?? ''}`,
    `for: ${space.for ?? ''}`,
    `for_en: ${space.forEn ?? ''}`,
    `icon: ${space.icon ?? 'message-circle'}`,
    `color: ${space.color ?? ''}`,
    `slug: ${space.slug ?? safe}`,
    `short: ${space.short ?? space.title ?? safe}`,
    `short_en: ${space.shortEn ?? ''}`,
    `состав: ${space.cast ?? 'все'}`,
    `дежурные: ${space.duty ?? ''}`,
    `динамика: ${space.tune ?? ''}`,
    `круг: ${space.circle ? space.circle : 'нет'}`,
    `talk: ${space.talk ? 'да' : 'нет'}`,
    `sides: ${sidesLine(space.sides)}`,
    `sides_en: ${(space.sides ?? []).map((s) => s.labelEn ?? '').join(' | ')}`,
    '---',
    '',
  ];

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${safe}.md`), `${head.join('\n')}${(space.laws ?? '').trim()}\n`);
  return loadSpace(safe);
}

/** Удалить комнату. Опенспейс не трогаем: без него некуда возвращаться. */
export function removeSpace(name) {
  const safe = String(name ?? '').replace(/[^\w\-Ѐ-ӿ]/g, '');
  if (!safe || safe === BUILTIN) return false;
  const file = path.join(DIR, `${safe}.md`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
