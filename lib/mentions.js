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
export function resolveTargets(msg, agentNames, history = []) {
  const tagged = msg.mentions.filter((n) => agentNames.includes(n) && n !== msg.from);
  if (tagged.length) return tagged;
  // Ответ на реплику — такое же обращение, как тег: человек щёлкнул по сообщению именно
  // потому, что отвечает его автору. Без этого реплика без «@» считалась ничьей, и на неё
  // отвечали дежурные — человек писал Продюсеру, а приходил Скептик.
  const to = msg.replyTo && history.find((m) => m.seq === msg.replyTo)?.from;
  return to && agentNames.includes(to) && to !== msg.from ? [to] : [];
}

export function labelOf(name, roster) {
  return roster[name]?.label ?? name;
}
