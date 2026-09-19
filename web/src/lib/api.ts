export type Msg = {
  seq: number
  id: string
  room: string
  from: string
  kind: "message" | "system" | "error"
  text: string
  ts: number
  mentions: string[]
  files?: FileRef[]
  replyTo?: number
  meta?: { elapsedMs?: number; usage?: { input_tokens?: number } }
}

export type FileRef = { name: string; size: number; url: string; path: string }

export type Agent = {
  label: string
  role: string
  roleName: string
  icon: string
  iconCustom: string | null
  color: string | null
  brief: string
  prompt: string
  promptCustom: string | null
  manner: string
  engine: string
  model: string | null
  trust: string
}

export type Config = {
  human: string
  humanName: string
  humanColor: string
  workdir: string
  maxAutoTurns: number
  defaultRoom: string
  // Дежурные: их считает сервер из режима «Открытый», отдельной настройки нет.
  defaultResponders: string[]
  modes: Mode[]
  agents: Record<string, Agent>
}

export type Settings = Omit<Config, "defaultResponders"> & {
  catchUp: number
  freeTalk: boolean
  goal: string
  roles: { name: string; title: string; brief: string; icon: string }[]
  engines: string[]
  trustLevels: string[]
  icons: Record<string, string>
}

export type Mode = {
  name: string
  slug: string
  short: string
  title: string
  brief: string
  for: string
  needs: string[]
  missing: string[]
  icon: string
  steps: { name: string; who: string; hear: boolean }[]
}

/** Режим целиком — с шагами: их правит редактор режимов. */
export type Step = { name: string; who: string; hear: boolean; until: string; prompt: string }
export type FullMode = Omit<Mode, "steps"> & { steps: Step[] }

export type ModeState = {
  name: string
  slug: string
  short: string
  title: string
  step: number
  steps: number
  stepName: string
  waitingHuman: boolean
} | null

export type RoomState = { autoTurns: number; paused: boolean; modeState?: ModeState }

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

  send: (room: string, text: string, files: FileRef[] = [], replyTo?: number) =>
    fetch(`/api/messages?room=${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, files, replyTo }),
    }).then(json<{ message: Msg }>),

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
    }).then(json<{ mode: ModeState }>),

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
    if (ev.kind === "status") onStatus(ev.from, ev.status)
    else onMessage(ev)
  }
  return () => es.close()
}
