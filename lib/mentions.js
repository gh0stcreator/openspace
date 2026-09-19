/** Парсинг @-упоминаний и адресации. */

// Ник может быть кириллицей и с заглавной буквы («Создатель»), поэтому
// и набор символов шире латиницы, и сравнение идёт без учёта регистра.
const NICK = /(?:^|[\s(,:;«"'\[])@([a-zA-Z0-9_\-Ѐ-ӿ]+)/g;

export function parseMentions(text, known) {
  const found = new Set();
  for (const m of String(text).matchAll(NICK)) {
    // Возвращаем ник в том виде, в каком он записан в составе участников.
    const hit = known.find((k) => k.toLowerCase() === m[1].toLowerCase());
    if (hit) found.add(hit);
  }
  return [...found];
}

/**
 * Кого будить после нового сообщения.
 * Явный тег — единственный способ адресовать реплику: без него
 * агенты молчат, и чат не скатывается в самоподдерживающийся пинг-понг.
 */
export function resolveTargets(msg, agentNames) {
  return msg.mentions.filter((n) => agentNames.includes(n) && n !== msg.from);
}

export function labelOf(name, roster) {
  return roster[name]?.label ?? name;
}
