/**
 * Что участник умеет руками. Раньше это был один переключатель `trust: safe|full`,
 * и он отвечал сразу на два вопроса — что участник умеет и что ему позволено. Теперь
 * умения выдают поштучно, и выдача и есть разрешение: отдельного «уровня доступа» нет.
 *
 * Список закрытый и короткий нарочно: каждый пункт должен быть понятен человеку,
 * который нанимает участника, а не описывать внутренности движка.
 */
export const SKILLS = ['файлы', 'команды', 'веб'];

/** Что выдано участнику. Старый `trust` читается как набор умений, миграции не нужно. */
export function skillsOf(cfg = {}) {
  if (Array.isArray(cfg.skills)) return cfg.skills.filter((s) => SKILLS.includes(s));
  return cfg.trust === 'full' ? ['файлы', 'команды'] : ['файлы'];
}

/**
 * Флаги CLI под выданные умения. Собираем императивом, а не склейкой готовых наборов:
 * у claude список инструментов один на всё, и два `--allowedTools` подряд не складываются,
 * а `--dangerously-skip-permissions` отменяет список целиком.
 */
export function limits(kind, skills) {
  const has = (s) => skills.includes(s);

  if (kind === 'codex') {
    // Веба у codex exec в этих флагах нет — умение есть, движок его не даёт.
    if (has('команды')) return ['-s', 'danger-full-access'];
    return ['-s', has('файлы') ? 'workspace-write' : 'read-only', '-c', 'shell_environment_policy.inherit=none'];
  }

  if (has('команды')) return ['--dangerously-skip-permissions'];
  const tools = has('файлы')
    ? ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit']
    : ['Read', 'Glob', 'Grep'];
  if (has('веб')) tools.push('WebSearch', 'WebFetch');
  return ['--permission-mode', has('файлы') ? 'acceptEdits' : 'default', '--allowedTools', tools.join(',')];
}
