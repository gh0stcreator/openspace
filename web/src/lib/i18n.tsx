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

  "space.label": "Комната",
  "space.missing": "нет в команде: {names}",
  "space.blind": "вслепую",
  "space.circle": "Первый круг: каждый отвечает, не видя чужих ответов",


  "bar.people": "{n} {word}",
  "bar.peopleOne": "участник",
  "bar.peopleFew": "участника",
  "bar.peopleMany": "участников",
  "bar.tokens": "{n}k токенов за разговор",

  "notify.calls": "{name} зовёт вас",

  // Подсказка в поле — по выбранному режиму: она и объясняет, чего от вас ждут на входе.
  "composer.placeholder": "Напишите команде…",
  "composer.hint.open": "Напишите команде…",
  "composer.hint.red": "Что проверяем на прочность?",
  "composer.hint.blue": "Что доводим до готового?",
  "composer.hint.green": "Для чего ищем варианты?",
  "composer.hint.violet": "В чём разбираемся?",
  "composer.hint.black": "Что решаем порознь?",
  "composer.replyTo": "Ответ {name}…",
  "composer.file": "файл",
  "composer.cancelReply": "Отменить ответ",
  "composer.removeFile": "Убрать «{name}»",
  "composer.attach": "Приложить файл. Можно перетащить или вставить из буфера",
  "composer.drop": "Отпустите — приложу к сообщению",
  "composer.send": "Отправить",
  "composer.label": "Сообщение команде",
  "feed.unread": "Вас упомянули, {n} {word} — перейти",
  "ui.close": "Закрыть",
  "ui.toEnd": "К последнему сообщению",
  "ui.toStart": "К началу разговора",
  "composer.uploadFailed": "Не загрузилось «{name}» — {error}",
  "composer.sendFailed": "Сообщение не ушло — {error}",

  "feed.thinkingOne": "думает…",
  "feed.thinkingMany": "думают…",
  "feed.and": "и",
  "feed.edited": "изменено",
  "feed.modeOn": "Перешли в комнату",
  "feed.copy": "Скопировать",
  "feed.unfold": "Развернуть",
  "feed.fold": "Свернуть",
  "feed.copied": "Скопировано",
  "feed.sentAt": "Отправлено",
  "feed.turnTook": "Ход занял",
  "feed.tokens": "Токенов",
  "feed.statusIdle": "свободен",
  "feed.statusWorking": "работает",
  "feed.statusWaiting": "ждёт хода",
  "feed.statusDone": "ответил на шаге",
  "feed.statusLimited": "лимит подписки, до {at} не отвечает",
  "feed.blind": "Отвечают, не видя ответов друг друга",
  "feed.aside": "наедине с {names}",
  "feed.cycle": "Цикл {n} из {all}: говорят парами, каждая пара — наедине",
  "feed.act.встречи": "Сходятся по двое и говорят наедине",
  "feed.act.защита": "Показывают, к чему пришли",
  "feed.act.оценка": "Оценивают чужие решения, не видя чужих оценок",
  "feed.act.проверка": "Проверяют, выполнимо ли выбранное",
  "feed.alone": "только вам",
  "memory.proposal": "предлагает записать в память",
  "memory.confirm": "Записать",
  "memory.applied": "принято в память",
  "memory.appliedPartial": "принято частично — часть правок устарела, см. ниже",
  "memory.rejected": "решили не записывать — вернуться к этому куску уже нельзя",
  "memory.reject": "Не надо",
  "composer.cancelEdit": "Отменить правку",
  "composer.editFailed": "Правка не сохранилась — {error}",

  "settings.title": "Настройки",
  "settings.general": "Общие",
  "settings.people": "Участники",
  "settings.spaces": "Комнаты",
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
  "space.memoryTitle": "Стереть память пространства",
  "space.memoryBody": "Сейчас в ней {n}, из них {shared} знает всё пространство. Это решения, находки и уроки, которые вы подтверждали кликом: они едут в промпт участникам этой комнаты, а помеченные главным — и в соседние. Очисткой чата не стираются, копия останется в rooms/ с отметкой времени",
  "space.memoryEmpty": "Пока пусто — стирать нечего",
  "space.memoryOne": "запись",
  "space.memoryFew": "записи",
  "space.memoryMany": "записей",
  "space.memoryClear": "Стереть",
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
  "card.archetype": "Амплуа",
  "card.archetypeCustom": "Своё",
  "card.archetypeCustomNote": "голос правлен руками",
  "card.archetypeSwapTitle": "Заменить голос на амплуа?",
  "card.archetypeSwapBody": "Текст, который вы правили руками, пропадёт — вместо него встанет голос выбранного амплуа.",
  "card.archetypeSwapOk": "Заменить",
  "card.manner": "Как говорит",
  "card.mannerHint": "Коротко и сухо. Не смягчает формулировки. Любит точные числа.",
  "card.skills": "Что может",
  "skill.файлы": "Править файлы",
  "skill.команды": "Запускать команды",
  "skill.веб": "Искать в интернете",
  "card.engine": "Движок",
  "card.model": "Модель",

  "model.default": "По умолчанию",
  "model.defaultHint": "Какую выберет движок",
  "model.opus": "Самая сильная, думает дольше",
  "model.fable": "Из того же поколения, другой характер",
  "model.sonnet": "Быстрее и дешевле",
  "model.haiku": "Самая быстрая, для простого",

  "space.current": "Вы здесь",
  "space.new": "Создать комнату",
  "space.slug": "Имя в знаке",
  "space.slugHint": "red",
  "space.deleteTitle": "Удалить «{name}»?",
  "space.deleteBody": "Описание комнаты будет удалено. Разговор, который в ней шёл, останется.",
  "space.name": "Название",
  "space.for": "Для чего",
  "space.forHint": "Проверить готовое на прочность: где порвётся и что развалится первым",
  "space.special": "Особая комната",
  "space.specialMany": "Особые комнаты",
  "space.talk": "Без регламента",
  "space.talkHint": "Круг здесь не заводится: разговор идёт как в общей. Для комнат, которые меняют не порядок ходов, а то, кем участники в них выходят",
  "space.cast": "Состав",
  "space.castHint": "роли: скептик, заступник, инженер",
  "space.castNote": "Кто здесь живёт: «все», «роли: скептик, инженер» или «@ник». Комната просит роли, а не имена: переименование участника её не ломает.",
  "space.duty": "Дежурные",
  "space.dutyHint": "роли: инженер",
  "space.dutyNote": "Кто отвечает, когда человек не назвал никого. Пусто — отвечает весь состав.",
  "space.circleField": "Первый круг",
  "space.circleHint": "Назови место, где это сломается: что подали, что произошло, чего ждали",
  "space.circleNote": "Задание, с которым все отвечают на вопрос человека, не видя друг друга. Пусто — круга здесь не бывает.",
  "space.order": "Уклад",
  "space.orderNote": "Как здесь принято работать. Едет в промпт каждому, кто говорит в этой комнате.",
}

const EN: Record<keyof typeof RU, string> = {
  "profile.settings": "Settings",
  "profile.lang": "Language",
  "profile.theme": "Theme",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",

  "space.label": "Room",
  "space.missing": "missing from the team: {names}",
  "space.blind": "blind",
  "space.circle": "First round: everyone answers without seeing the others",


  "bar.people": "{n} {word}",
  "bar.peopleOne": "participant",
  "bar.peopleFew": "participants",
  "bar.peopleMany": "participants",
  "bar.tokens": "{n}k tokens this conversation",

  "notify.calls": "{name} is calling you",

  "composer.placeholder": "Write to the team…",
  "composer.hint.open": "Write to the team…",
  "composer.hint.red": "What are we stress-testing?",
  "composer.hint.blue": "What are we finishing?",
  "composer.hint.green": "What are we looking for options for?",
  "composer.hint.violet": "What are we looking into?",
  "composer.hint.black": "What are we solving separately?",
  "composer.replyTo": "Reply to {name}…",
  "composer.file": "file",
  "composer.cancelReply": "Cancel the reply",
  "composer.removeFile": "Remove “{name}”",
  "composer.attach": "Attach a file. Drag it in or paste from the clipboard",
  "composer.drop": "Let go — I'll attach it",
  "composer.send": "Send",
  "composer.label": "Message to the team",
  "feed.unread": "You were mentioned in {n} {word} — go there",
  "ui.close": "Close",
  "ui.toEnd": "To the latest message",
  "ui.toStart": "To the start of the conversation",
  "composer.uploadFailed": "“{name}” didn't upload — {error}",
  "composer.sendFailed": "The message didn't go — {error}",

  "feed.thinkingOne": "is thinking…",
  "feed.thinkingMany": "are thinking…",
  "feed.and": "and",
  "feed.edited": "edited",
  "feed.modeOn": "Moved to the room",
  "feed.copy": "Copy",
  "feed.unfold": "Show more",
  "feed.fold": "Show less",
  "feed.copied": "Copied",
  "feed.sentAt": "Sent",
  "feed.turnTook": "The turn took",
  "feed.tokens": "Tokens",
  "feed.statusIdle": "free",
  "feed.statusWorking": "working",
  "feed.statusWaiting": "waiting for a turn",
  "feed.statusDone": "answered on this step",
  "feed.statusLimited": "subscription limit, silent until {at}",
  "feed.blind": "They are answering without seeing each other",
  "feed.aside": "in private with {names}",
  "feed.cycle": "Cycle {n} of {all}: they talk in pairs, each pair in private",
  "feed.act.встречи": "They meet in pairs and talk one on one",
  "feed.act.защита": "They are showing what they arrived at",
  "feed.act.оценка": "They are scoring the others without seeing each other's scores",
  "feed.act.проверка": "They are checking whether the chosen answer can be done",
  "feed.alone": "to you only",
  "memory.proposal": "proposes a change to memory",
  "memory.confirm": "Record it",
  "memory.applied": "applied to memory",
  "memory.appliedPartial": "applied in part — some edits were stale, see below",
  "memory.rejected": "decided not to record it — this piece can't be recovered",
  "memory.reject": "Skip it",
  "composer.cancelEdit": "Cancel the edit",
  "composer.editFailed": "The edit wasn't saved — {error}",

  "settings.title": "Settings",
  "settings.general": "General",
  "settings.people": "Participants",
  "settings.spaces": "Rooms",
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
  "space.memoryTitle": "Erase the space memory",
  "space.memoryBody": "It holds {n} right now, and the whole space knows {shared} of them. These are the decisions, findings and lessons you confirmed with a click: they ride in the prompt of this room's participants, and the ones marked as key ride into the neighbouring rooms too. Clearing the feed does not erase them, and a copy stays in rooms/ with a timestamp",
  "space.memoryEmpty": "Empty for now — nothing to erase",
  "space.memoryOne": "record",
  "space.memoryFew": "records",
  "space.memoryMany": "records",
  "space.memoryClear": "Erase",
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
  "card.archetype": "Cast as",
  "card.archetypeCustom": "Custom",
  "card.archetypeCustomNote": "the voice was edited by hand",
  "card.archetypeSwapTitle": "Replace the voice with an archetype?",
  "card.archetypeSwapBody": "The text you edited by hand will be gone — the chosen archetype's voice takes its place.",
  "card.archetypeSwapOk": "Replace",
  "card.manner": "How they speak",
  "card.mannerHint": "Short and dry. Doesn't soften wording. Likes exact numbers.",
  "card.skills": "What they can do",
  "skill.файлы": "Edit files",
  "skill.команды": "Run commands",
  "skill.веб": "Search the web",
  "card.engine": "Engine",
  "card.model": "Model",

  "model.default": "Default",
  "model.defaultHint": "Whichever the engine picks",
  "model.opus": "The strongest, thinks longer",
  "model.fable": "Same generation, different character",
  "model.sonnet": "Faster and cheaper",
  "model.haiku": "Fastest, for simple things",

  "space.current": "You are here",
  "space.new": "New room",
  "space.slug": "Name in the mark",
  "space.slugHint": "red",
  "space.deleteTitle": "Delete “{name}”?",
  "space.deleteBody": "The room description will be deleted. The conversation held in it stays.",
  "space.name": "Name",
  "space.for": "What for",
  "space.forHint": "Test what is finished: where it tears and what breaks first",
  "space.special": "Special room",
  "space.specialMany": "Special rooms",
  "space.talk": "No procedure",
  "space.talkHint": "No round is started here: the talk runs like in the common room. For rooms that change not the order of turns but who the participants come out as",
  "space.cast": "Who lives here",
  "space.castHint": "роли: скептик, заступник, инженер",
  "space.castNote": "Who lives here: «все», «роли: скептик, инженер» or «@nick». The room asks for roles, not names.",
  "space.duty": "On duty",
  "space.dutyHint": "роли: инженер",
  "space.dutyNote": "Who answers when nobody is named. Empty — the whole cast answers.",
  "space.circleField": "First round",
  "space.circleHint": "Name the place where this breaks: what was fed in, what happened, what was expected",
  "space.circleNote": "The task everyone answers with, without seeing each other. Empty — no round here.",
  "space.order": "How it works here",
  "space.orderNote": "How work is done in this room. Goes into the prompt of everyone who speaks here.",
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
