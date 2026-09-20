export type Msg = {
  seq: number
  id: string
  room: string
  from: string
  kind: "message" | "system" | "error" | "edit" | "mode" | "memory-proposal" | "memory-resolved"
  /** Событие правки: какую реплику и на что. Сама реплика после правки несёт `edited`. */
  target?: number
  edited?: number
  text: string
  ts: number
  mentions: string[]
  /** Знак режима: лежит в самой отметке о его включении. */
  icon?: string
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

export type Agent = {
  label: string
  role: string
  roleEn: string
  roleName: string
  icon: string
  iconCustom: string | null
  color: string | null
  brief: string
  briefEn: string
  prompt: string
  promptCustom: string | null
  manner: string
  engine: string
  model: string | null
  trust: string
}

export type Config = {
  user: string
  /** Аватарка человека: цвет из палитры участников и знак. Пустой цвет — нейтральная. */
  userColor: string
  userIcon: string
  workdir: string
  maxAutoTurns: number
  defaultRoom: string
  // Дежурные: их считает сервер из режима «Открытый», отдельной настройки нет.
  defaultResponders: string[]
  /** Кого выключили в этой комнате. Состав общий, присутствие — своё у каждой комнаты. */
  off: string[]
  /** Комнаты этой машины: знак листает их под курсором. */
  rooms: string[]
  /** Одно слово о том, чем комната занята: правая половина знака. */
  topic: string
  modes: Mode[]
  agents: Record<string, Agent>
}

export type Settings = Omit<Config, "defaultResponders" | "off" | "rooms"> & {
  catchUp: number
  freeTalk: boolean
  laws: string
  roles: { name: string; title: string; titleEn: string; brief: string; icon: string }[]
  engines: string[]
  trustLevels: string[]
  icons: Record<string, string>
}

export type Mode = {
  name: string
  /** Встроенный «Открытый»: его нельзя удалить, а выбрать его — значит закончить режим. */
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
  /** Рубрика: к какой работе режим относится. */
  rubric: string
  rubricEn: string
  /** Кто говорит в режиме. Пустой массив — говорят все. */
  who: string[]
  needs: string[]
  missing: string[]
  icon: string
  /** Цвет режима из палитры участников. Пусто — без цвета. */
  color: string
  steps: { name: string; who: string; hear: boolean }[]
}

/** Режим целиком — с шагами: их правит редактор режимов. */
export type Step = { name: string; who: string; hear: boolean; until: string; prompt: string }
export type FullMode = Omit<Mode, "steps"> & { steps: Step[] }

export type ModeState = {
  name: string
  slug: string
  short: string
  shortEn: string
  title: string
  titleEn: string
  step: number
  steps: number
  stepName: string
  /** Кого шаг зовёт и кого ещё не дождался: из этого складывается «ждёт» и «ответил». */
  cast: string[]
  pending: string[]
  hear: boolean
  waitingUser: boolean
} | null

/** `busy` — кто-то отвечает или стоит в очереди. Пусто и не занято — ход за человеком. */
export type RoomState = { autoTurns: number; paused: boolean; busy?: boolean; modeState?: ModeState }

const json = async <T,>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`сервер вернул ${r.status}`)
  return r.json()
}

export const api = {
  config: () => fetch("/api/config").then(json<Config>),
  settings: () => fetch("/api/settings").then(json<Settings>),

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

  setMode: (room: string, mode: string | null) =>
    fetch(`/api/mode?room=${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    }).then(json<{ mode: ModeState; off: string[] }>),

  modes: () => fetch("/api/modes").then(json<{ modes: FullMode[] }>),

  saveMode: (mode: Partial<FullMode> & { name: string }) =>
    fetch("/api/modes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mode),
    }).then(json<{ mode: FullMode }>),

  removeMode: (name: string) =>
    fetch(`/api/modes?name=${encodeURIComponent(name)}`, { method: "DELETE" }).then(
      json<{ ok: boolean }>
    ),

  reset: (room: string) =>
    fetch(`/api/reset?room=${encodeURIComponent(room)}`, { method: "POST" }).then(json),

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
  onTopic: (topic: string) => void,
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
    if (ev.kind === "topic") return onTopic(ev.topic)
    else onMessage(ev)
  }
  return () => es.close()
}
