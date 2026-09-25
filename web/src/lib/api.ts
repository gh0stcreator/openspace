export type Msg = {
  seq: number
  id: string
  room: string
  from: string
  kind: "message" | "system" | "error" | "edit" | "mode" | "skip" | "memory-proposal" | "memory-resolved"
  /** Разговор не при всех: кто эту реплику видит. Пусто — видят все. Человек видит всегда. */
  only?: string[]
  /** Событие правки: какую реплику и на что. Сама реплика после правки несёт `edited`. */
  target?: number
  edited?: number
  text: string
  ts: number
  mentions: string[]
  /** Знак режима: лежит в самой отметке о его включении. */
  icon?: string
  /** Сторона в режиме: кем участник был в этом споре. Остаётся в реплике навсегда. */
  side?: Side
  files?: FileRef[]
  replyTo?: number
  meta?: { elapsedMs?: number; usage?: { input_tokens?: number } }
  /** Предложение архивариуса: что изменить в памяти пространства, и решено ли уже. */
  diff?: MemoryChange[]
  status?: "ожидает" | "принято" | "принято частично" | "отклонено"
}

export type MemoryChange = {
  action: "добавить" | "заменить" | "отменить"
  kind: string
  text: string
  id?: string
}

export type FileRef = { name: string; size: number; url: string; path: string }

/**
 * Сторона в режиме: кто в нём за что. Роль говорит, что участник делает вообще,
 * сторона — кем он вышел в этот разговор: Скептик в дебатах спорит как «против».
 */
export type Side = {
  label: string
  labelEn: string
  icon: string
  /** Цвет стороны. У персонажа он есть — голубой Крош голубой и есть; у стороны спора нет. */
  color?: string
  /** Персона встаёт вместо ника, сторона — плашкой рядом с ним. */
  persona?: boolean
  roles?: string[]
}

export type Agent = {
  label: string
  role: string
  roleEn: string
  roleName: string
  /** Амплуа: одно слово про место в ансамбле. Приходит из роли, в карточке не правится. */
  archetype: string
  archetypeEn: string
  /** Главная черта роли, она же конец оси. Пусто — роль вне пар (ведёт или молчит). */
  pulls: string
  icon: string
  iconCustom: string | null
  color: string | null
  brief: string
  briefEn: string
  prompt: string
  promptCustom: string | null
  /** Голос, который реально работает: своё поле, текст амплуа или голос роли. */
  manner: string
  mannerCustom: string | null
  engine: string
  model: string | null
  /** Что умеет руками: файлы, команды, веб. Выдача умения и есть разрешение. */
  skills: string[]
}

export type Config = {
  user: string
  /** Аватарка человека: цвет из палитры участников и знак. Пустой цвет — нейтральная. */
  userColor: string
  userIcon: string
  workdir: string
  maxAutoTurns: number
  defaultRoom: string
  /** Дежурные комнаты: кто отвечает человеку, когда он не назвал никого. */
  defaultResponders: string[]
  /** Кого выключили в этой комнате. Состав общий, присутствие — своё у каждой комнаты. */
  off: string[]
  /** Знак комнаты: чем заняты и над чем. Левую половину держит сама комната. */
  topic: string
  doing: string
  /** Комнаты этой машины и та, в которой человек сейчас. */
  spaces: (Space | FullSpace)[]
  space: Space
  agents: Record<string, Agent>
}

export type Settings = Omit<Config, "defaultResponders" | "off" | "spaces" | "space"> & {
  catchUp: number
  freeTalk: boolean
  /** Сколько записей в памяти пространства. В ленте её не видно, а в промпт она едет всем. */
  memory: number
  /** Сколько из них помечено «главным»: эти знает всё пространство. */
  memoryShared: number
  laws: string
  roles: {
    name: string
    title: string
    titleEn: string
    brief: string
    icon: string
    archetype: string
    archetypeEn: string
    model: string
    pulls: string
    skills: string[]
  }[]
  /** Амплуа — готовые голоса. Выбор кладёт текст целиком в поле «как говорит». */
  archetypes: { name: string; title: string; titleEn: string; brief: string; briefEn: string; voice: string }[]
  engines: string[]
  skillList: string[]
  icons: Record<string, string>
}

export type Space = {
  name: string
  /** Опенспейс: его нельзя удалить, там разговаривают без задачи. */
  builtin: boolean
  slug: string
  short: string
  shortEn: string
  title: string
  titleEn: string
  brief: string
  briefEn: string
  for: string
  forEn: string
  /** Кто здесь живёт. */
  who: string[]
  needs: string[]
  missing: string[]
  icon: string
  /** Цвет комнаты — её единственный опознавательный знак. Пусто — у общей. */
  color: string
  /** Должности комнаты: подпись, знак и роли, которые её занимают. */
  sides: Side[]
  /** Заводится ли здесь круг: первый ответ на вопрос дают все и не видя друг друга. */
  circle: boolean
  /** Без регламента: круг не заводится, ходы идут как в разговоре. */
  talk: boolean
}

/** Комната целиком — с текстами: их правит редактор комнат. */
// В коротком описании `circle` — «есть ли здесь круг», в полном — само задание круга:
// карточке комнаты нужен текст, а списку — только признак.
export type FullSpace = Omit<Space, "circle"> & {
  laws: string
  circle: string
  cast: string
  duty: string
  tune: string
}

export type CircleState = {
  name: string
  slug: string
  short: string
  shortEn: string
  title: string
  titleEn: string
  color: string
  icon: string
  /** Кто здесь живёт и кого круг ещё не дождался: из этого «ждёт» и «ответил». */
  cast: string[]
  pending: string[]
  /** Идёт ли круг: пока идёт, участники отвечают, не видя друг друга. */
  blind: boolean
  /** Кем участники выходят в этой комнате: ник → персона. Пусто — выходят собой. */
  personas: Record<string, { name: string; labelEn: string; icon: string; color: string }>
} | null

/** `busy` — кто-то отвечает или стоит в очереди. Пусто и не занято — ход за человеком. */
export type RoomState = {
  autoTurns: number
  paused: boolean
  busy?: boolean
  /** Кто думает прямо сейчас и с какого мгновения: после перезагрузки взять неоткуда. */
  thinking?: Record<string, number>
  /** Кто упёрся в лимит подписки и до какого мгновения его не зовут. */
  limited?: Record<string, number>
  modeState?: CircleState
}

const json = async <T,>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`сервер вернул ${r.status}`)
  return r.json()
}

export const api = {
  // Оба ответа зависят от комнаты: состав, знак и число записей памяти у каждой свои.
  // Без `room` сервер отвечает за комнату по умолчанию — и вторая комната показывала
  // чужой состав и чужой счётчик памяти рядом с кнопкой «Стереть», которая бьёт по своей.
  config: (room?: string) =>
    fetch(`/api/config${room ? `?room=${encodeURIComponent(room)}` : ""}`).then(json<Config>),
  settings: (room: string) =>
    fetch(`/api/settings?room=${encodeURIComponent(room)}`).then(json<Settings>),

  history: (room: string, since = 0) =>
    fetch(`/api/messages?room=${encodeURIComponent(room)}&since=${since}`).then(
      json<{ messages: Msg[]; state: RoomState }>
    ),

  edit: (room: string, seq: number, text: string) =>
    fetch(`/api/messages/edit?room=${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seq, text }),
    }).then(json<{ edit: Msg }>),

  confirmMemory: (room: string, seq: number) =>
    fetch(`/api/memory/confirm?room=${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seq }),
    }).then(json<{ resolved: Msg }>),

  rejectMemory: (room: string, seq: number) =>
    fetch(`/api/memory/reject?room=${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seq }),
    }).then(json<{ resolved: Msg }>),

  send: (room: string, text: string, files: FileRef[] = [], replyTo?: number) =>
    fetch(`/api/messages?room=${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, files, replyTo }),
    }).then(json<{ message: Msg }>),

  presence: (room: string, name: string, on: boolean) =>
    fetch(`/api/presence?room=${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, on }),
    }).then(json<{ here: string[] }>),

  pause: (room: string, on: boolean) =>
    fetch(`/api/pause?room=${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on }),
    }).then(json<{ state: RoomState }>),

  spaces: () => fetch("/api/spaces").then(json<{ spaces: FullSpace[] }>),

  saveSpace: (space: Partial<FullSpace> & { name: string }) =>
    fetch("/api/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(space),
    }).then(json<{ space: FullSpace }>),

  removeSpace: (name: string) =>
    fetch(`/api/spaces?name=${encodeURIComponent(name)}`, { method: "DELETE" }).then(
      json<{ ok: boolean }>
    ),

  reset: (room: string) =>
    fetch(`/api/reset?room=${encodeURIComponent(room)}`, { method: "POST" }).then(json),

  clearMemory: (room: string) =>
    fetch(`/api/memory/clear?room=${encodeURIComponent(room)}`, { method: "POST" }).then(json<{ ok: true }>),

  clear: (room: string) =>
    fetch(`/api/clear?room=${encodeURIComponent(room)}`, { method: "POST" }).then(json),

  saveSettings: (patch: Record<string, unknown>) =>
    fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<Partial<Settings> & { agents: Record<string, Agent> }>),

  upload: (room: string, file: File) =>
    fetch(
      `/api/upload?room=${encodeURIComponent(room)}&name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      }
    ).then(json<FileRef>),
}

/** Лента приходит через SSE; статусы «думает» едут тем же каналом. */
export function listen(
  room: string,
  onMessage: (m: Msg) => void,
  onStatus: (who: string, status: string) => void,
  onTopic: (topic: string, doing: string) => void,
  onLive: (live: boolean) => void,
  onReconnect?: () => void
) {
  const es = new EventSource(`/api/events?room=${encodeURIComponent(room)}`)
  // Соединение могло оборваться (перезапуск сервера, сон машины): при возврате
  // забираем всё, что пришло, пока нас не было.
  es.onopen = () => {
    onLive(true)
    onReconnect?.()
  }
  es.onerror = () => onLive(false)
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data)
    if (ev.kind === "status") return onStatus(ev.from, ev.status)
    if (ev.kind === "topic") return onTopic(ev.topic, ev.doing)
    else onMessage(ev)
  }
  return () => es.close()
}
