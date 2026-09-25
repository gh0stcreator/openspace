import * as React from "react"
import {
  AtSign,
  Check,
  ChevronDown,
  Settings,
  TriangleAlert,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatFeed, Face, FaceButton, Icon, toneVars } from "@/components/chat-feed"
import { Composer } from "@/components/composer"
import { Logo } from "@/components/logo"
import { SettingsDialog } from "@/components/settings-dialog"
import { cn } from "@/lib/utils"
import { useLang, pick, plural } from "@/lib/i18n"
import { typo } from "@/lib/typo"
import { api, listen, type Agent, type Config, type Msg, type RoomState } from "@/lib/api"

/** Знак вкладки: слева комната, в скобках предмет разговора. Тот же, что в шапке. */
const sign = (slug?: string, topic?: string) => `${slug || "open"}(${topic || "space"})`

export default function App() {
  const { lang, t } = useLang()
  const [cfg, setCfg] = React.useState<Config | null>(null)
  const [room, setRoom] = React.useState("")
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [state, setState] = React.useState<RoomState>({ autoTurns: 0, paused: false })
  const [thinking, setThinking] = React.useState<string[]>([])
  /** Лента приехала хотя бы раз. До этого показываем скелет, а не пустой экран:
   *  настройки приходят раньше сообщений, и между ними виден чистый лист. */
  const [ready, setReady] = React.useState(false)
  const [live, setLive] = React.useState(true)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [replyTo, setReplyTo] = React.useState<Msg | null>(null)
  const [editing, setEditing] = React.useState<Msg | null>(null)

  /**
   * Лента на экране — только реплики. Правка приходит отдельным событием и меняет
   * свою реплику на месте; в истории с сервера она уже применена.
   */
  const take = React.useCallback(
    (prev: Msg[], m: Msg) =>
      m.kind === "skip"
        ? prev
        : m.kind === "edit"
        ? prev.map((x) => (x.seq === m.target ? { ...x, text: m.text, mentions: m.mentions, edited: m.ts } : x))
        : m.kind === "memory-resolved"
          ? prev.map((x) => (x.seq === m.target ? { ...x, status: m.status } : x))
          : prev.some((x) => x.seq === m.seq)
            ? prev
            : [...prev, m],
    []
  )
  // Пропущенный ход — запись для счёта, а не событие разговора: на экране его нет.
  const shown = (list: Msg[]) =>
    list.filter((m) => m.kind !== "edit" && m.kind !== "memory-resolved" && m.kind !== "skip")
  const [insert, setInsert] = React.useState<{ name: string; nonce: number }>()

  /** Выключенные в этой комнате: состав общий, присутствие — своё у каждой. */
  const off = cfg?.off ?? []
  const here = (n: string) => !off.includes(n)
  const present = React.useMemo(
    () => Object.keys(cfg?.agents ?? {}).filter((n) => !off.includes(n)),
    [cfg?.agents, off]
  )
  const toggle = async (name: string, on: boolean) => {
    const { here: names } = await api.presence(room, name, on)
    setCfg((c) => (c ? { ...c, off: Object.keys(c.agents).filter((n) => !names.includes(n)) } : c))
  }

  /**
   * Перейти в другую комнату. Всё остальное делают уже существующие эффекты: подписка
   * на ленту, состав, знак и счётчик памяти у каждой комнаты свои и приезжают по room.
   * Адрес меняем сразу: комната — это место, и на него должна вести ссылка.
   */
  const go = (name: string) => {
    if (name === room) return
    history.pushState(null, "", `?room=${encodeURIComponent(name)}`)
    setReplyTo(null)
    setEditing(null)
    setRoom(name)
  }

  const local = React.useCallback((text: string) => toast.error(text), [])

  /** Клик по предложению архивариуса: применяем diff к памяти. Ответ приходит и через
   * SSE (событие memory-resolved), но не ждём его — своё решение видно сразу. */
  const confirmMemory = async (m: Msg) => {
    try {
      const { resolved } = await api.confirmMemory(room, m.seq)
      setMessages((prev) => take(prev, resolved))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  /** «Здесь нечего записывать»: курсор свёртки уходит вперёд, как если бы diff пришёл
   * пустым, ничего не коммитится. Действие необратимо — предупреждение об этом в тексте
   * кнопки, не здесь: второй попытки спросить у человека не будет. */
  const rejectMemory = async (m: Msg) => {
    try {
      const { resolved } = await api.rejectMemory(room, m.seq)
      setMessages((prev) => take(prev, resolved))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  React.useEffect(() => {
    // Комнату из адреса знаем до запроса — с ней и спрашиваем: иначе состав и знак
    // приходят от комнаты по умолчанию, а лента — от той, что в адресе. Дальше этот же
    // запрос повторяется на каждый переход: у каждой комнаты свой состав и свой знак.
    const asked = room || new URLSearchParams(location.search).get("room") || undefined
    api.config(asked).then((c) => {
      setCfg(c)
      const target = asked || c.defaultRoom || "опенспейс"
      setRoom(target)
      // Заголовок вкладки — тот же знак, что в шапке: комната слева, предмет в скобках.
      document.title = sign(c.space?.slug, c.topic)
    })
  }, [room])

  React.useEffect(() => {
    if (!room) return
    let alive = true
    api.history(room).then(({ messages, state }) => {
      if (!alive) return
      setMessages(shown(messages))
      setState(state)
      // Кто думал, пока нас не было: живые события мы пропустили, состояние знает.
      setThinking(Object.keys(state.thinking ?? {}))
      setReady(true)
    })
    const stop = listen(
      room,
      (m) => {
        setMessages((prev) => take(prev, m))
        void api.history(room, 0).then(({ state }) => setState(state))
      },
      (who, status) =>
        setThinking((t) => (status === "thinking" ? [...new Set([...t, who])] : t.filter((x) => x !== who))),
      (topic, doing) => setCfg((c) => (c ? { ...c, topic, doing } : c)),
      setLive,
      () =>
        void api.history(room).then(({ messages, state }) => {
          setMessages(shown(messages))
          setState(state)
        })
    )
    return () => {
      alive = false
      stop()
    }
  }, [room, take])

  /**
   * Непрочитанные обращения. Прочитанным считаем то, что было на экране, пока лента
   * стояла внизу: счётчик гаснет сам, без отдельного действия.
   */
  // Счётчик свой у каждой комнаты: общий врал сразу после перехода.
  const [readUpto, setReadUpto] = React.useState(0)
  React.useEffect(() => {
    setReadUpto(Number(localStorage.getItem(`read-upto:${room}`) ?? 0))
  }, [room])
  const mentions = React.useMemo(
    () => (cfg ? messages.filter((m) => m.from !== cfg.user && m.mentions?.includes(cfg.user)) : []),
    [messages, cfg]
  )
  const unread = mentions.filter((m) => m.seq > readUpto)

  const markRead = React.useCallback((seq: number) => {
    setReadUpto((prev) => {
      const next = Math.max(prev, seq)
      localStorage.setItem(`read-upto:${room}`, String(next))
      return next
    })
  }, [room])

  React.useEffect(() => {
    if (document.hidden || !messages.length) return
    const t = setTimeout(() => markRead(messages.at(-1)!.seq), 1500)
    return () => clearTimeout(t)
  }, [messages, markRead])

  // Вкладка скрыта — зовём системой, как обычный мессенджер.
  const notified = React.useRef("")
  React.useEffect(() => {
    const last = mentions.at(-1)
    if (!last || !document.hidden || notified.current === last.id) return
    notified.current = last.id
    document.title = `(${unread.length}) ${sign(cfg?.space?.slug, cfg?.topic)}`
    if (Notification.permission === "granted") {
      new Notification(t("notify.calls", { name: last.from }), {
        body: last.text.slice(0, 160),
        tag: last.id,
      })
    }
  }, [mentions, unread.length, room, cfg?.space?.slug, cfg?.topic, t])

  React.useEffect(() => {
    // Возвращаемся во вкладку — заголовок снова тот же знак, что в шапке.
    const onShow = () => !document.hidden && (document.title = sign(cfg?.space?.slug, cfg?.topic))
    document.addEventListener("visibilitychange", onShow)
    if (Notification.permission === "default") void Notification.requestPermission()
    return () => document.removeEventListener("visibilitychange", onShow)
  }, [room, cfg?.space?.slug, cfg?.topic])

  // Esc — самый частый жест, когда разговор разогнался.
  React.useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || state.paused || settingsOpen) return
      if (document.activeElement instanceof HTMLTextAreaElement && document.activeElement.value) return
      void api.pause(room, true).then((r) => setState(r.state))
    }
    addEventListener("keydown", onEsc)
    return () => removeEventListener("keydown", onEsc)
  }, [room, state.paused, settingsOpen])

  // Цвет по слагу — памяткой: собранный заново на каждый рендер объект менял ссылку,
  // знак пересоздавал подписку на наведение, и её уборка сносила таймеры прямо
  // посреди показа. Считаем до раннего возврата: хук не может стоять за условием.
  const tones = React.useMemo(
    () => Object.fromEntries((cfg?.spaces ?? []).map((m) => [m.slug, m.color])),
    [cfg?.spaces]
  )

  /**
   * Кем участники выходят в этой комнате. `personas` — ник → имя персонажа, `cast` — состав
   * для ленты и подсказок: в нём и ники, и имена персонажей, поэтому «@Крош» опознаётся
   * так же, как «@Креатор», и красится его цветом. Тоже до раннего возврата: хук за условием
   * — это чёрный экран на всё приложение, и мы это уже проходили.
   */
  const faces = state.modeState?.personas
  const personas = React.useMemo(
    () => Object.fromEntries(Object.entries(faces ?? {}).map(([n, p]) => [n, p.name])),
    [faces]
  )
  const cast = React.useMemo(() => {
    const out: Record<string, Agent> = { ...(cfg?.agents ?? {}) }
    for (const [nick, p] of Object.entries(faces ?? {})) {
      const a = out[nick]
      if (a) out[p.name] = { ...a, icon: p.icon || a.icon, color: p.color || a.color }
    }
    return out
  }, [cfg?.agents, faces])

  /**
   * Кого предлагать человеку в подсказке «@». Здесь, в отличие от `cast`, настоящих ников
   * у переименованных нет: в Смешариках человек выбирает из семерых круглых, а не из
   * четырнадцати имён, половина которых — те же самые участники под рабочими никами.
   */
  const picks = React.useMemo(() => {
    const out: Record<string, Agent> = {}
    for (const [nick, a] of Object.entries(cfg?.agents ?? {})) {
      const p = faces?.[nick]
      if (p) out[p.name] = { ...a, icon: p.icon || a.icon, color: p.color || a.color }
      else out[nick] = a
    }
    return out
  }, [cfg?.agents, faces])

  if (!cfg || !ready) {
    return (
      <div className="bg-background flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 px-4">
          <Skeleton className="h-5 w-32 shrink-0" />
          <div className="hidden min-w-0 flex-1 items-center justify-center gap-2.5 sm:flex">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="hidden h-9 w-28 rounded-full lg:block" />
            ))}
            <Skeleton className="h-8 w-14 rounded-full lg:hidden" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
        </header>

        <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">
          {[70, 45, 85].map((w, i) => (
            <div key={i} className="flex items-end gap-2">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-16 rounded-xl" style={{ width: `${w}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="p-4">
          <Skeleton className="mx-auto h-12 w-full max-w-3xl rounded-2xl" />
        </div>
      </div>
    )
  }

  const spent = messages.reduce((n, m) => n + (m.meta?.usage?.input_tokens ?? 0), 0)
  // Комната считается пустой, пока в ней нет ни одной реплики: служебные строки
  // вроде «поставлено на паузу» разговором не являются.
  const started = messages.some((m) => m.kind === "message")
  // Комната, в которой человек сейчас: из неё берём и знак, и цвет.
  const now = cfg.space ?? cfg.spaces?.find((m) => m.name === room)

  /**
   * Чем участник занят. «Ждёт» существует только пока идёт круг: вне его очереди нет,
   * и ожидание было бы догадкой. Состав круга и те, кого он ещё не дождался, приходят
   * от оркестратора — интерфейс их не вычисляет.
   */
  const ms = state.modeState


  /**
   * Порядок участников: противоположные черты рядом, ведущий в конце. Порядок найма
   * в шапке читается как случайность, а пара видна сразу: осторожность стоит плечом
   * к плечу с импульсом.
   */
  const TRAITS = ["импульс", "осторожность", "теория", "практика", "вкус", "опыт"]
  const byPole = (a: string, b: string) => {
    const at = TRAITS.indexOf(cfg.agents[a]?.pulls ?? "")
    const bt = TRAITS.indexOf(cfg.agents[b]?.pulls ?? "")
    return (at < 0 ? 99 : at) - (bt < 0 ? 99 : bt)
  }

  /**
   * Как участник выглядит сейчас. Ник остаётся его именем в коде — по нему считается
   * присутствие и состояние хода, — но показываем того, под кем он вышел: в режиме
   * с персонами в шапке и в списке должны стоять те же лица, что в ленте.
   */
  const face = (n: string) => {
    const a = cfg.agents[n]
    const p = faces?.[n]
    return { name: p?.name ?? n, icon: p?.icon || a?.icon, color: p?.color || a?.color }
  }

  // Идёт круг: все отвечают разом и не видят друг друга. Строка нужна, чтобы тишина
  // в несколько ходов читалась как работа, а не как «сломалось».
  const yourStep = ms?.blind && ms.pending.length ? t("feed.blind") : ""

  const limitedUntil = (n: string) => {
    const until = state.limited?.[n] ?? 0
    return until > Date.now() ? until : 0
  }

  const doing = (n: string): "working" | "waiting" | "done" | "idle" | "limited" => {
    if (thinking.includes(n)) return "working"
    // Упёрся в лимит — не «свободен»: свободного можно позвать, этого до срока нет.
    if (limitedUntil(n)) return "limited"
    if (!ms || !ms.cast.includes(n)) return "idle"
    return ms.pending.includes(n) ? "waiting" : "done"
  }

  return (
    <TooltipProvider>
      {/* Весь экран подкрашен тоном комнаты — очень слабо, как подложка. Цвет здесь
          единственный опознавательный знак места, и по нему видно, где ты, раньше,
          чем прочитано название. У опенспейса цвета нет: общее место и есть фон. */}
      <div
        className={cn("bg-background flex h-dvh flex-col", now?.color && "room-tint")}
        style={now?.color ? toneVars(now.color) : undefined}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 px-4">
          {/* Знак и профиль забирают по половине свободного места. Иначе ряд аватарок
              стоит по центру того, что осталось, и уезжает, когда имя комнаты
              меняет длину знака. */}
          <div className="flex min-w-0 flex-1 basis-0 justify-start">
            <a href="/" className="min-w-0">
              {/* Слева — комната, в скобках — предмет разговора по-английски. Имя комнаты
                  латиницей не транслитерируется: «красная» это red, а не krasnaya.
                  Пока предмет не назван — space. */}
              <Logo
                subject={cfg.topic || "space"}
                mode={now?.slug ?? (cfg.doing || "open")}
                color={live ? now?.color : null}
                colors={tones}
                // У комнаты с персонами цвет не один: знак красится их цветами по буквам.
                letters={live ? now?.sides?.map((x) => x.color).filter(Boolean) as string[] : undefined}
                className={`transition-colors ${
                  live ? "hover:text-muted-foreground" : "text-destructive"
                }`}
              />
            </a>
          </div>

          {/* Кто в пространстве — аватарками: имена не нужны, чтобы это понять.
              В пустой комнате состав и так нарисован на карточках режимов, поэтому
              ряд появляется только когда разговор начался. */}
          {started && (
            <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
              {Object.keys(cfg.agents).filter(here).sort(byPole).map((n) => {
                const at = doing(n)
                const f = face(n)
                return (
                  <Tooltip key={n}>
                    <TooltipTrigger asChild>
                      {/* Состояние показано вокруг аватарки, а не вместо неё: цвет остаётся
                          опознавательным знаком участника и ничего не значит сам по себе. */}
                      <span
                        className={cn(
                          "rounded-full transition-opacity",
                          at === "working" && "breathe",
                          (at === "waiting" || at === "limited") && "opacity-40"
                        )}
                      >
                        <FaceButton
                          name={f.name}
                          icon={f.icon}
                          color={f.color}
                          onPick={(name) => setInsert({ name, nonce: Date.now() })}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {f.name} ·{" "}
                      {t(`feed.status${at[0].toUpperCase()}${at.slice(1)}` as never, {
                        at: new Date(limitedUntil(n)).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }),
                      })}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          )}

          {/* Профиль: кто вы здесь. Под ним — то, что меняет пространство целиком. */}
          <div className="flex min-w-0 flex-1 basis-0 justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="hover:bg-accent/50 data-[state=open]:bg-accent/50 h-10 shrink-0 gap-2 pr-2 pl-1 font-normal"
              >
                <Face name={cfg.user} icon={cfg.userIcon} color={cfg.userColor || null} size="md" muted={!cfg.userColor} />
                <span className="hidden sm:inline">{cfg.user}</span>
                <ChevronDown className="text-muted-foreground size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Settings />
                {t("profile.settings")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>

        {!started ? (
          /* Пустая комната показывает не «здесь тихо», а куда можно пойти: карточка
             на комнату. Та, в которой человек сейчас, в том же ряду и помечена. */
          <div className="feed-fade min-h-0 flex-1 overflow-y-auto">
            {/* Воздух сверху и снизу нужен только когда карточки не влезают и список
                скроллится. Шесть на пустой экран — это ещё и предложение, а не список,
                поэтому в обрез: лишние два десятка пикселей включали полосу прокрутки
                при том, что на экране всё видно. */}
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-3">
              <div className="grid gap-2 sm:grid-cols-2">
              {cfg.spaces?.map((m) => {
                const current = m.name === room
                return (
                  <button
                    key={m.name}
                    aria-current={current || undefined}
                    className={cn(
                      "flex gap-3 rounded-lg border p-3 text-left transition-colors",
                      current ? "bg-accent/40" : "hover:bg-accent/40"
                    )}
                    onClick={() => go(m.name)}
                  >
                    {/* Кружок красится цветом комнаты: он и есть её опознавательный знак. */}
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full",
                        m.color ? "tone-face" : "bg-muted text-muted-foreground"
                      )}
                      style={m.color ? toneVars(m.color) : undefined}
                    >
                      <Icon name={m.icon} className="size-5" />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex items-center gap-2 font-medium">
                        {pick(lang, m.title, m.titleEn)}
                        {current && <Badge variant="secondary">{t("space.current")}</Badge>}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {typo(pick(lang, m.for || m.brief, m.forEn || m.briefEn))}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {m.who?.map((n) => {
                          // Карточка обещает состав — значит, показывает и лица: у комнаты
                          // с персонами это её персонажи, а не наши ники.
                          const role = (cfg.agents[n]?.roleName ?? "").toLowerCase()
                          const side = m.sides?.find((x) => x.roles?.includes(role))
                          return (
                            <Face
                              key={n}
                              name={side?.label ?? n}
                              icon={side?.icon || cfg.agents[n]?.icon}
                              color={side?.color || cfg.agents[n]?.color}
                              size="sm"
                            />
                          )
                        })}
                      </span>
                      {m.missing.length > 0 && (
                        <span className="text-destructive/90 text-sm">
                          {t("space.missing", { names: m.missing.join(", ") })}
                        </span>
                      )}
                    </span>
                  </button>
                )
                })}
              </div>
            </div>
          </div>
        ) : (
          <ChatFeed
            messages={messages}
            user={cfg.user}
            agents={cast}
            personas={personas}
            thinking={thinking}
            waiting={yourStep}
            since={state.thinking}
            onReply={(m) => {
              setEditing(null)
              setReplyTo(m)
            }}
            onEdit={(m) => {
              setReplyTo(null)
              setEditing(m)
            }}
            onMention={(name) => setInsert({ name, nonce: Date.now() })}
            onConfirmMemory={confirmMemory}
            onRejectMemory={rejectMemory}
          />
        )}

        {unread.length > 0 && (
          <div className="pointer-events-none relative mx-auto w-full max-w-3xl px-4">
            <Button
              size="icon-lg"
              className="pointer-events-auto absolute -top-14 right-6 z-20 rounded-full shadow-lg"
              onClick={() => {
                const first = unread[0]
                document
                  .getElementById(`msg-${first.seq}`)
                  ?.scrollIntoView({ block: "center", behavior: "smooth" })
                markRead(first.seq)
              }}
            >
              <AtSign />
              <span className="bg-background text-foreground absolute -top-1 -right-1 rounded-full px-1.5 text-xs font-medium">
                {unread.length}
              </span>
            </Button>
          </div>
        )}

        <Composer
          room={room}
          agents={picks}
          onError={local}
          onSent={(m) => setMessages((prev) => take(prev, m))}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onEdit={setEditing}
          lastMine={messages.findLast((m) => m.kind === "message" && m.from === cfg.user)}
          insert={insert}
          mode={now?.slug}
        />


        {/* Управление под полем: слева состав и стоп, справа — режим работы. */}
        <div className="text-muted-foreground mx-auto mt-2 mb-3 flex w-full max-w-3xl items-center gap-1 px-4 text-sm">
          {/* Кто сейчас в комнате. Состав заводят в настройках, здесь только включают
              и выключают: чаще нужно убрать двоих, а не менять команду. */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 font-normal"
                title={spent ? t("bar.tokens", { n: Math.round(spent / 1000) }) : undefined}
              >
                <Users />
                {t("bar.people", {
                  n: present.length,
                  word: plural(lang, present.length, [
                    t("bar.peopleOne"),
                    t("bar.peopleFew"),
                    t("bar.peopleMany"),
                  ]),
                })}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              {Object.keys(cfg.agents).sort(byPole).map((n) => (
                <Label
                  key={n}
                  className="hover:bg-accent/50 flex items-center gap-2 rounded-md p-2 font-normal"
                >
                  <Face name={face(n).name} icon={face(n).icon} color={face(n).color} size="sm" />
                  <span className="flex-1 truncate">{face(n).name}</span>
                  <Switch checked={here(n)} onCheckedChange={(v) => void toggle(n, v)} />
                </Label>
              ))}
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto gap-1.5 font-normal"
                /* Для чего эта комната — подсказкой: читают это раз, а места в строке нет. */
                title={now ? typo(pick(lang, now.for || now.brief, now.forEn || now.briefEn)) : undefined}
              >
                <Icon name={now?.icon ?? "message-circle"} className="size-4" />
                {now ? pick(lang, now.short, now.shortEn) : room}
                {/* Идёт круг — об этом говорит строка в ленте, а здесь одно слово:
                    в строке управления место есть только для имени комнаты. */}
                {ms?.blind && <span className="text-muted-foreground/70">· {t("space.blind")}</span>}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            {/* Ширина по триггеру здесь мала: у пунктов две строки. */}
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>{t("space.label")}</DropdownMenuLabel>
              {cfg.spaces?.map((m, i) => {
                const current = m.name === room
                // Комнаты без регламента идут последними и отделены чертой: в них не
                // работают, и в одном ряду с рабочими они читались бы как ещё один приём.
                const apart = m.talk && !cfg.spaces[i - 1]?.talk
                return (
                  <React.Fragment key={`${m.name}-wrap`}>
                  {apart && <DropdownMenuSeparator />}
                  {apart && (
                    <DropdownMenuLabel className="text-muted-foreground font-normal">
                      {t(cfg.spaces.filter((x) => x.talk).length > 1 ? "space.specialMany" : "space.special")}
                    </DropdownMenuLabel>
                  )}
                  <DropdownMenuItem
                    key={m.name}
                    className={cn("items-start gap-3 py-2", current && "bg-accent/60")}
                    onClick={() => go(m.name)}
                  >
                    {/* Знак комнаты в её цвете: по цвету её и узнают. */}
                    <Icon
                      name={m.icon}
                      className={cn("mt-0.5 size-4 shrink-0", m.color ? "tone-name" : (current ? "text-foreground" : "text-muted-foreground"))}
                      style={m.color ? toneVars(m.color) : undefined}
                    />
                    {/* Строка списка — компонентами системы: заголовок и подпись
                        под ним выглядят одинаково здесь, в выборе амплуа и в выборе модели. */}
                    <ItemContent>
                      <ItemTitle>
                        {pick(lang, m.title, m.titleEn)}
                        {current && <Check className="size-3.5 shrink-0" />}
                      </ItemTitle>
                      <ItemDescription>
                        {typo(pick(lang, m.for || m.brief, m.forEn || m.briefEn))}
                      </ItemDescription>
                      {m.missing.length > 0 && (
                        <ItemDescription className="text-destructive/90 mt-0.5 flex items-center gap-1">
                          <TriangleAlert className="size-3.5 shrink-0" />
                          {t("space.missing", { names: m.missing.join(", ") })}
                        </ItemDescription>
                      )}
                    </ItemContent>
                  </DropdownMenuItem>
                  </React.Fragment>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          room={room}
          user={cfg.user}
          space={room}
          onApplied={(s) => setCfg({ ...cfg, ...s } as Config)}
          // Редактор комнат отдаёт их целиком, с текстами; в шапке и на карточках нужна
          // короткая половина — лишние поля просто не читаются.
          onSpaces={(spaces) => setCfg({ ...cfg, spaces })}
          onCleared={() => {
            setMessages([])
            setState({ autoTurns: 0, paused: false })
            // Знак собран из меток комнаты, а они приходят раз, при открытии страницы.
            // Сервер их при очистке сбрасывает — клиенту об этом никто не говорит,
            // и в пустой комнате в шапке висело описание разговора, которого уже нет.
            setCfg((c) => (c ? { ...c, topic: "", doing: "" } : c))
          }}
        />
        <Toaster position="bottom-center" />
      </div>
    </TooltipProvider>
  )
}
