import * as React from "react"

import { typo } from "@/lib/typo"

/**
 * Язык интерфейса. Тексты живут одним словарём: их видно рядом, поэтому русская
 * и английская версии не разъезжаются по смыслу.
 *
 * Локализуется оболочка — то, что написано в коде. Роли, режимы и ники участников
 * — это данные пространства, они лежат в `roles/*.md`, `modes/*.md` и конфиге
 * и остаются такими, какими их завёл человек.
 */
export type Lang = "ru" | "en"

const RU = {
  "profile.settings": "Настройки",
  "profile.lang": "Язык",
  "profile.theme": "Тема",
  "theme.light": "Светлая",
  "theme.dark": "Тёмная",
  "theme.system": "Системная",

  "mode.label": "Режим обсуждения",
  "mode.open": "Открытый",
  "mode.missing": "нет в команде: {names}",
  "mode.step": "Шаг {n} из {all}: {name}",
  "mode.blind": "Шаг {n} из {all}: {name}. Участники не видят ответов друг друга",

  "empty.title": "Здесь пока тихо",
  "empty.body": "Напишите первым — без тега ответят {duty}",
  "empty.pick": "Или выберите, как работаем: режим начнётся с вашей первой темы",

  "bar.people": "{n} {word}",
  "bar.peopleOne": "участник",
  "bar.peopleFew": "участника",
  "bar.peopleMany": "участников",
  "bar.tokens": "{n}k токенов за разговор",
  "bar.resume": "Продолжить",
  "bar.stop": "Стоп",
  "bar.resumeTip": "Продолжить разговор",
  "bar.stopTip": "Пауза. Начатые ответы допишутся",

  "notify.calls": "{name} зовёт вас",

  // Подсказка в поле — по выбранному режиму: она и объясняет, чего от вас ждут на входе.
  "composer.placeholder": "Напишите команде…",
  "composer.hint.open": "Напишите команде…",
  "composer.hint.defense": "Какую позицию будем защищать?",
  "composer.hint.roast": "Какое решение будем проверять?",
  "composer.hint.brainstorm": "Для чего ищем идеи?",
  "composer.hint.premortem": "Какой план проверим на провал?",
  "composer.hint.strategy": "Какое решение нужно принять?",
  "composer.hint.review": "Покажите работу: код, текст, макет",
  "composer.hint.sixhats": "Какой вопрос разберём?",
  "composer.you": "это вы",
  "composer.file": "файл",
  "composer.cancelReply": "Отменить ответ",
  "composer.removeFile": "Убрать «{name}»",
  "composer.attach": "Приложить файл. Можно перетащить или вставить из буфера",
  "composer.drop": "Отпустите — приложу к сообщению",
  "composer.send": "Отправить",
  "composer.uploadFailed": "Не загрузилось «{name}» — {error}",
  "composer.sendFailed": "Сообщение не ушло — {error}",

  "feed.thinkingOne": "думает…",
  "feed.thinkingMany": "думают…",
  "feed.and": "и",
  "feed.edited": "изменено",
  "feed.modeOn": "Включён режим",
  "feed.copy": "Скопировать",
  "feed.copied": "Скопировано",
  "feed.yourTurn": "Никто не отвечает — ход за вами",
  "feed.details": "Как это считалось",
  "feed.sentAt": "Отправлено",
  "feed.turnTook": "Ход занял",
  "feed.tokens": "Токенов",
  "feed.handoff": "передаёт ход",
  "feed.waits": "ждёт {name}",
  "feed.statusIdle": "свободен",
  "feed.statusWorking": "работает",
  "feed.statusWaiting": "ждёт хода",
  "feed.statusDone": "ответил на шаге",
  "memory.proposal": "предлагает изменить память — нажмите, чтобы принять",
  "memory.applied": "принято в память",
  "memory.appliedPartial": "принято частично — часть правок устарела, см. ниже",
  "memory.rejected": "решили не записывать — вернуться к этому куску уже нельзя",
  "memory.reject": "Здесь нечего записывать",
  "composer.cancelEdit": "Отменить правку",
  "composer.editFailed": "Правка не сохранилась — {error}",

  "settings.title": "Настройки",
  "settings.general": "Общие",
  "settings.people": "Участники",
  "settings.modes": "Режимы",
  "settings.space": "Пространство",

  "hire.name": "Имя",
  "hire.role": "Роль",
  "hire.engine": "Движок",
  "hire.button": "Создать",
  "hire.badNick": "Ник: буквы, цифры, дефис",
  "hire.taken": "@{name} уже есть",
  "hire.lastOne": "Последнего удалить нельзя",

  "general.name": "Имя",
  "general.face": "Аватарка",
  "general.faceEdit": "Изменить",
  "hire.open": "Создать участника",
  "general.channel": "Романтика Повседневности",

  "space.laws": "Законы пространства",
  "space.lawsSeen": "Что здесь верно всегда, независимо от задачи. Это читает каждый участник перед каждым ходом",
  "space.lawsHint": "Спорить по существу: несогласие — работа, а не грубость.\nНазывать цену: не «есть риск», а что увидит человек, когда сломается.\nНечего добавить — молчать.",
  "space.freeTalk": "Говорят между собой",
  "space.freeTalkHint": "Иначе после ответа ждут вас",
  "space.turns": "Ходов подряд без вас",
  "space.turnsHint": "Потом пауза",
  "space.catchUp": "Реплик для нового участника",
  "space.catchUpHint": "Сколько он прочтёт, когда его позвали",
  "space.resetTitle": "Сбросить память участников",
  "space.resetBody":
    "У каждого своя память о разговоре, и она копится. Сброс её стирает: дальше они читают только хвост ленты. Сообщения в чате остаются",
  "space.reset": "Сбросить",
  "space.clearTitle": "Очистить чат",
  "space.clearBody":
    "Сообщения уйдут из ленты, участники забудут разговор. Файл истории сохранится в rooms/ с отметкой времени",
  "space.clear": "Очистить",
  "space.cancel": "Отмена",

  "card.more": "Ещё",
  "card.settings": "Настройки",
  "card.duplicate": "Дублировать",
  "card.delete": "Удалить",
  "card.face": "Цвет и знак",
  "card.color": "Цвет",
  "card.icon": "Знак",
  "card.nick": "Как обращаться",
  "card.role": "Кем работает",
  "card.prompt": "Что делает",
  "card.promptHint": "Начинаешь ход с того, что…",
  "card.promptReset": "Вернуть как у роли",
  "card.manner": "Как говорит",
  "card.mannerHint": "Коротко и сухо. Не смягчает формулировки. Любит точные числа.",
  "card.trust": "Что может",
  "card.trustSafe": "Читать и править файлы",
  "card.trustFull": "Ещё и запускать команды",
  "card.engine": "Движок",
  "card.model": "Модель",

  "model.default": "По умолчанию",
  "model.defaultHint": "Какую выберет движок",
  "model.opus": "Самая сильная, думает дольше",
  "model.fable": "Из того же поколения, другой характер",
  "model.sonnet": "Быстрее и дешевле",
  "model.haiku": "Самая быстрая, для простого",

  "mode.current": "Текущий",
  "mode.new": "Создать режим",
  "mode.slug": "Имя в знаке",
  "mode.slugHint": "roast",
  "mode.slugNote": "Латиницей: из него собирается open(…)",
  "mode.deleteTitle": "Удалить «{name}»?",
  "mode.deleteBody": "Файл режима будет удалён. Разговоры, которые в нём шли, останутся.",
  "mode.name": "Название",
  "mode.for": "Для чего",
  "mode.forHint": "Проверить решение до того, как его проверит жизнь",
  "mode.needs": "Без кого не работает",
  "mode.steps": "Шаги",
  "mode.stepOne": "шаг",
  "mode.stepFew": "шага",
  "mode.stepMany": "шагов",
  "step.name": "название шага",
  "step.remove": "Убрать шаг",
  "step.who": "Кто говорит",
  "step.whoAll": "Говорят все",
  "step.until": "Чем шаг закрывается",
  "step.untilAll": "Когда все ответили",
  "step.untilHuman": "Когда ответили вы",
  "step.hear": "Слышат друг друга",
  "step.hearYes": "Отвечают по очереди, каждый видит предыдущих",
  "step.hearNo": "Отвечают вслепую — первый ответ не задаёт остальным рамку",
  "step.prompt": "Что они делают на этом шаге",
  "step.promptHint": "Назови три способа, которыми это сломается в первый месяц",
  "step.promptNote": "Добавляется к их роли на время шага",
  "step.add": "Добавить шаг",
}

const EN: Record<keyof typeof RU, string> = {
  "profile.settings": "Settings",
  "profile.lang": "Language",
  "profile.theme": "Theme",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",

  "mode.label": "Conversation mode",
  "mode.open": "Open",
  "mode.missing": "missing from the team: {names}",
  "mode.step": "Step {n} of {all}: {name}",
  "mode.blind": "Step {n} of {all}: {name}. Participants cannot see each other's answers",

  "empty.title": "Quiet in here",
  "empty.body": "Write first — with no tag, {duty} will answer",
  "empty.pick": "Or pick how you work: the mode starts with your first subject",

  "bar.people": "{n} {word}",
  "bar.peopleOne": "participant",
  "bar.peopleFew": "participants",
  "bar.peopleMany": "participants",
  "bar.tokens": "{n}k tokens this conversation",
  "bar.resume": "Resume",
  "bar.stop": "Stop",
  "bar.resumeTip": "Resume the conversation",
  "bar.stopTip": "Pause. Replies already under way will finish",

  "notify.calls": "{name} is calling you",

  "composer.placeholder": "Write to the team…",
  "composer.hint.open": "Write to the team…",
  "composer.hint.defense": "What position are we defending?",
  "composer.hint.roast": "Which decision are we testing?",
  "composer.hint.brainstorm": "What are we looking for ideas for?",
  "composer.hint.premortem": "Which plan do we test for failure?",
  "composer.hint.strategy": "What decision has to be made?",
  "composer.hint.review": "Show the work: code, copy, a layout",
  "composer.hint.sixhats": "What question are we working through?",
  "composer.you": "that's you",
  "composer.file": "file",
  "composer.cancelReply": "Cancel the reply",
  "composer.removeFile": "Remove “{name}”",
  "composer.attach": "Attach a file. Drag it in or paste from the clipboard",
  "composer.drop": "Let go — I'll attach it",
  "composer.send": "Send",
  "composer.uploadFailed": "“{name}” didn't upload — {error}",
  "composer.sendFailed": "The message didn't go — {error}",

  "feed.thinkingOne": "is thinking…",
  "feed.thinkingMany": "are thinking…",
  "feed.and": "and",
  "feed.edited": "edited",
  "feed.modeOn": "Mode on:",
  "feed.copy": "Copy",
  "feed.copied": "Copied",
  "feed.yourTurn": "Nobody is answering — your turn",
  "feed.details": "How this was counted",
  "feed.sentAt": "Sent",
  "feed.turnTook": "The turn took",
  "feed.tokens": "Tokens",
  "feed.handoff": "hands over to",
  "feed.waits": "waiting for {name}",
  "feed.statusIdle": "free",
  "feed.statusWorking": "working",
  "feed.statusWaiting": "waiting for a turn",
  "feed.statusDone": "answered on this step",
  "memory.proposal": "proposes a change to memory — click to accept",
  "memory.applied": "applied to memory",
  "memory.appliedPartial": "applied in part — some edits were stale, see below",
  "memory.rejected": "decided not to record it — this piece can't be recovered",
  "memory.reject": "Nothing worth recording here",
  "composer.cancelEdit": "Cancel the edit",
  "composer.editFailed": "The edit wasn't saved — {error}",

  "settings.title": "Settings",
  "settings.general": "General",
  "settings.people": "Participants",
  "settings.modes": "Modes",
  "settings.space": "Space",

  "hire.name": "Name",
  "hire.role": "Role",
  "hire.engine": "Engine",
  "hire.button": "Create",
  "hire.badNick": "Nickname: letters, digits, hyphen",
  "hire.taken": "@{name} already exists",
  "hire.lastOne": "The last one cannot be deleted",

  "general.name": "Name",
  "general.face": "Avatar",
  "general.faceEdit": "Change",
  "hire.open": "Create a participant",
  "general.channel": "Романтика Повседневности",

  "space.laws": "Laws of this space",
  "space.lawsSeen": "What holds here whatever the task. Every participant reads it before every turn",
  "space.lawsHint": "Argue on the substance: disagreement is the work, not rudeness.\nName the cost: not «there is a risk», but what the person sees when it breaks.\nNothing to add — say nothing.",
  "space.freeTalk": "They talk to each other",
  "space.freeTalkHint": "Otherwise they wait for you after answering",
  "space.turns": "Turns in a row without you",
  "space.turnsHint": "Then a pause",
  "space.catchUp": "Messages for a newcomer",
  "space.catchUpHint": "How many they read when invited",
  "space.resetTitle": "Reset what participants remember",
  "space.resetBody":
    "Each of them keeps their own memory of the conversation, and it piles up. A reset wipes it: after that they read only the tail of the feed. The messages stay",
  "space.reset": "Reset",
  "space.clearTitle": "Clear the feed",
  "space.clearBody":
    "Messages leave the feed and participants forget the conversation. The history file stays in rooms/ with a timestamp",
  "space.clear": "Clear",
  "space.cancel": "Cancel",

  "card.more": "More",
  "card.settings": "Settings",
  "card.duplicate": "Duplicate",
  "card.delete": "Delete",
  "card.face": "Color and mark",
  "card.color": "Color",
  "card.icon": "Mark",
  "card.nick": "What to call them",
  "card.role": "What they are",
  "card.prompt": "What they do",
  "card.promptHint": "You start your turn by…",
  "card.promptReset": "Back to the role's",
  "card.manner": "How they speak",
  "card.mannerHint": "Short and dry. Doesn't soften wording. Likes exact numbers.",
  "card.trust": "What they may do",
  "card.trustSafe": "Read and edit files",
  "card.trustFull": "Also run commands",
  "card.engine": "Engine",
  "card.model": "Model",

  "model.default": "Default",
  "model.defaultHint": "Whichever the engine picks",
  "model.opus": "The strongest, thinks longer",
  "model.fable": "Same generation, different character",
  "model.sonnet": "Faster and cheaper",
  "model.haiku": "Fastest, for simple things",

  "mode.current": "Current",
  "mode.new": "New mode",
  "mode.slug": "Name in the mark",
  "mode.slugHint": "roast",
  "mode.slugNote": "Latin letters: open(…) is built from it",
  "mode.deleteTitle": "Delete “{name}”?",
  "mode.deleteBody": "The mode file will be deleted. Conversations held in it stay.",
  "mode.name": "Name",
  "mode.for": "What for",
  "mode.forHint": "Test a decision before life tests it",
  "mode.needs": "Doesn't work without",
  "mode.steps": "Steps",
  "mode.stepOne": "step",
  "mode.stepFew": "steps",
  "mode.stepMany": "steps",
  "step.name": "step name",
  "step.remove": "Remove the step",
  "step.who": "Who speaks",
  "step.whoAll": "Everyone speaks",
  "step.until": "What closes the step",
  "step.untilAll": "When everyone has answered",
  "step.untilHuman": "When you have answered",
  "step.hear": "They hear each other",
  "step.hearYes": "They answer in turn, each seeing the previous ones",
  "step.hearNo": "They answer blind — the first answer doesn't frame the rest",
  "step.prompt": "What they do on this step",
  "step.promptHint": "Name three ways this breaks in the first month",
  "step.promptNote": "Added to their role for the length of the step",
  "step.add": "Add a step",
}

export type Key = keyof typeof RU

const DICT: Record<Lang, Record<Key, string>> = { ru: RU, en: EN }

// По умолчанию русский: роли, режимы и ники в пространстве пока русские,
// и английская оболочка поверх них выглядела бы половинчатой.
const detect = (): Lang => {
  const saved = localStorage.getItem("lang")
  return saved === "ru" || saved === "en" ? saved : "ru"
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: Key, vars?: Record<string, string | number>) => string }

const LangCtx = React.createContext<Ctx>({ lang: "ru", setLang: () => {}, t: (k) => RU[k] })

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, set] = React.useState<Lang>(() => {
    try {
      return detect()
    } catch {
      return "ru"
    }
  })

  const setLang = React.useCallback((l: Lang) => {
    set(l)
    try {
      localStorage.setItem("lang", l)
    } catch {
      // приватное окно — язык проживёт до перезагрузки
    }
    document.documentElement.lang = l
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const t = React.useCallback(
    (k: Key, vars?: Record<string, string | number>) => {
      let s = DICT[lang][k] ?? RU[k]
      if (vars) for (const [key, v] of Object.entries(vars)) s = s.replaceAll(`{${key}}`, String(v))
      // Висячие предлоги — беда русской строки; английскую трогать незачем.
      return lang === "ru" ? typo(s) : s
    },
    [lang]
  )

  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>
}

export const useLang = () => React.useContext(LangCtx)

/**
 * Подпись из данных пространства: у режимов и ролей английский вариант лежит
 * в том же файле. Нет перевода — показываем как есть, полупустой список хуже.
 */
export const pick = (lang: Lang, ru?: string, en?: string) => (lang === "en" && en ? en : (ru ?? ""))

/** Русское число: 1 шаг, 2 шага, 5 шагов. В английском хватает одной формы. */
export function plural(lang: Lang, n: number, forms: [string, string, string]) {
  if (lang !== "ru") return n === 1 ? forms[0] : forms[2]
  if (n % 10 === 1 && n % 100 !== 11) return forms[0]
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return forms[1]
  return forms[2]
}
