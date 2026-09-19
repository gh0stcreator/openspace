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

  "mode.label": "Режим обсуждения",
  "mode.open": "Открытый",
  "mode.missing": "нет в команде: {names}",

  "empty.title": "Здесь пока тихо",
  "empty.body": "Напишите первым — без тега ответят {duty}",
  "empty.pick": "Или выберите, как работаем: режим начнётся с вашей первой темы",

  "bar.people": "Участники: {n}",
  "bar.tokens": "{n}k токенов за разговор",
  "bar.resume": "Продолжить",
  "bar.stop": "Стоп",
  "bar.resumeTip": "Продолжить разговор",
  "bar.stopTip": "Пауза. Начатые ответы допишутся",

  "notify.calls": "{name} зовёт вас",

  "composer.placeholder": "Введите сообщение…",
  "composer.you": "это вы",
  "composer.file": "файл",
  "composer.cancelReply": "Отменить ответ",
  "composer.attach": "Приложить файл. Можно перетащить или вставить из буфера",
  "composer.drop": "Отпустите — приложу к сообщению",
  "composer.send": "Отправить",
  "composer.uploadFailed": "Не загрузилось «{name}» — {error}",
  "composer.sendFailed": "Сообщение не ушло — {error}",

  "feed.thinkingOne": "печатает",
  "feed.thinkingMany": "печатают",
  "feed.and": "и",
  "feed.edited": "изменено",
  "composer.cancelEdit": "Отменить правку",
  "composer.editFailed": "Правка не сохранилась — {error}",

  "settings.title": "Настройки",
  "settings.people": "Участники",
  "settings.modes": "Режимы",
  "settings.space": "Пространство",

  "hire.label": "Позвать ещё",
  "hire.name": "имя участника",
  "hire.role": "Роль",
  "hire.engine": "Движок",
  "hire.button": "Позвать",
  "hire.badNick": "Ник: буквы, цифры, дефис",
  "hire.taken": "@{name} уже в чате",
  "hire.lastOne": "Последнего убрать нельзя",

  "space.goal": "Цель — её видят все участники",
  "space.goalHint": "Собрать к пятнице спецификацию мегаменю, по которой можно писать код",
  "space.freeTalk": "Могут продолжать разговор между собой",
  "space.freeTalkHint": "Иначе после ответа ждут вас",
  "space.turns": "Ходов подряд, потом пауза",
  "space.catchUp": "Сколько реплик читает новый участник",
  "space.resetTitle": "Сбросить память участников",
  "space.resetBody":
    "У каждого своя память о разговоре, и она копится. Сброс её стирает: дальше они читают только хвост ленты. Сообщения в чате остаются",
  "space.reset": "Сбросить",
  "space.clearTitle": "Очистить чат",
  "space.clearBody":
    "Сообщения уйдут из ленты, участники забудут разговор. Файл истории сохранится в rooms/ с отметкой времени",
  "space.clear": "Очистить",
  "space.clearArmed": "Точно? Нажмите ещё раз",

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

  "mode.label": "Conversation mode",
  "mode.open": "Open",
  "mode.missing": "missing from the team: {names}",

  "empty.title": "Quiet in here",
  "empty.body": "Write first — with no tag, {duty} will answer",
  "empty.pick": "Or pick how you work: the mode starts with your first topic",

  "bar.people": "Participants: {n}",
  "bar.tokens": "{n}k tokens this conversation",
  "bar.resume": "Resume",
  "bar.stop": "Stop",
  "bar.resumeTip": "Resume the conversation",
  "bar.stopTip": "Pause. Replies already under way will finish",

  "notify.calls": "{name} is calling you",

  "composer.placeholder": "Write a message…",
  "composer.you": "that's you",
  "composer.file": "file",
  "composer.cancelReply": "Cancel the reply",
  "composer.attach": "Attach a file. Drag it in or paste from the clipboard",
  "composer.drop": "Let go — I'll attach it",
  "composer.send": "Send",
  "composer.uploadFailed": "“{name}” didn't upload — {error}",
  "composer.sendFailed": "The message didn't go — {error}",

  "feed.thinkingOne": "is typing",
  "feed.thinkingMany": "are typing",
  "feed.and": "and",
  "feed.edited": "edited",
  "composer.cancelEdit": "Cancel the edit",
  "composer.editFailed": "The edit wasn't saved — {error}",

  "settings.title": "Settings",
  "settings.people": "Participants",
  "settings.modes": "Modes",
  "settings.space": "Space",

  "hire.label": "Invite one more",
  "hire.name": "participant name",
  "hire.role": "Role",
  "hire.engine": "Engine",
  "hire.button": "Invite",
  "hire.badNick": "Nickname: letters, digits, hyphen",
  "hire.taken": "@{name} is already here",
  "hire.lastOne": "The last one can't be removed",

  "space.goal": "The goal — everyone here sees it",
  "space.goalHint": "Have the mega-menu spec ready by Friday, detailed enough to write code from",
  "space.freeTalk": "They may keep talking to each other",
  "space.freeTalkHint": "Otherwise they wait for you after answering",
  "space.turns": "Turns in a row, then a pause",
  "space.catchUp": "How many messages a newcomer reads",
  "space.resetTitle": "Reset what participants remember",
  "space.resetBody":
    "Each of them keeps their own memory of the conversation, and it piles up. A reset wipes it: after that they read only the tail of the feed. The messages stay",
  "space.reset": "Reset",
  "space.clearTitle": "Clear the feed",
  "space.clearBody":
    "Messages leave the feed and participants forget the conversation. The history file stays in rooms/ with a timestamp",
  "space.clear": "Clear",
  "space.clearArmed": "Sure? Press again",

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
