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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChatFeed, Face, FaceButton, Icon } from "@/components/chat-feed"
import { Composer } from "@/components/composer"
import { Logo } from "@/components/logo"
import { SettingsDialog } from "@/components/settings-dialog"
import { cn } from "@/lib/utils"
import { useLang, pick, plural } from "@/lib/i18n"
import { typo } from "@/lib/typo"
import { api, listen, type Config, type Msg, type RoomState } from "@/lib/api"

export default function App() {
  const { lang, t } = useLang()
  const [cfg, setCfg] = React.useState<Config | null>(null)
  const [room, setRoom] = React.useState("")
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [state, setState] = React.useState<RoomState>({ autoTurns: 0, paused: false })
  const [thinking, setThinking] = React.useState<string[]>([])
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
      m.kind === "edit"
        ? prev.map((x) => (x.seq === m.target ? { ...x, text: m.text, mentions: m.mentions, edited: m.ts } : x))
        : m.kind === "memory-resolved"
          ? prev.map((x) => (x.seq === m.target ? { ...x, status: m.status } : x))
          : prev.some((x) => x.seq === m.seq)
            ? prev
            : [...prev, m],
    []
  )
  const shown = (list: Msg[]) => list.filter((m) => m.kind !== "edit" && m.kind !== "memory-resolved")
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

  /** Режим приводит свой состав: вместе с ним меняется и кто в комнате. */
  const switchMode = async (m: { name: string; builtin: boolean }) => {
    try {
      const r = await api.setMode(room, m.builtin ? null : m.name)
      setState((st) => ({ ...st, modeState: r.mode }))
      setCfg((c) => (c ? { ...c, off: r.off } : c))
    } catch (e) {
      // Сервер отказал — режим остался прежним, и сказать об этом должен экран:
      // молча проглоченный отказ выглядит как «нажал, и ничего не случилось».
      toast.error((e as Error).message)
    }
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
    api.config().then((c) => {
      setCfg(c)
      const target = new URLSearchParams(location.search).get("room") || c.defaultRoom || "general"
      setRoom(target)
      document.title = `open(${target})`
    })
  }, [])

  React.useEffect(() => {
    if (!room) return
    let alive = true
    api.history(room).then(({ messages, state }) => {
      if (!alive) return
      setMessages(shown(messages))
      setState(state)
    })
    const stop = listen(
      room,
      (m) => {
        setMessages((prev) => take(prev, m))
        void api.history(room, 0).then(({ state }) => setState(state))
      },
      (who, status) =>
        setThinking((t) => (status === "thinking" ? [...new Set([...t, who])] : t.filter((x) => x !== who))),
      (topic) => setCfg((c) => (c ? { ...c, topic } : c)),
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
  const [readUpto, setReadUpto] = React.useState(() => Number(localStorage.getItem("read-upto") ?? 0))
  const mentions = React.useMemo(
    () => (cfg ? messages.filter((m) => m.from !== cfg.user && m.mentions?.includes(cfg.user)) : []),
    [messages, cfg]
  )
  const unread = mentions.filter((m) => m.seq > readUpto)

  const markRead = React.useCallback((seq: number) => {
    setReadUpto((prev) => {
      const next = Math.max(prev, seq)
      localStorage.setItem("read-upto", String(next))
      return next
    })
  }, [])

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
    document.title = `(${unread.length}) open(${room})`
    if (Notification.permission === "granted") {
      new Notification(t("notify.calls", { name: last.from }), {
        body: last.text.slice(0, 160),
        tag: last.id,
      })
    }
  }, [mentions, unread.length, room, t])

  React.useEffect(() => {
    const onShow = () => !document.hidden && (document.title = `open(${room})`)
    document.addEventListener("visibilitychange", onShow)
    if (Notification.permission === "default") void Notification.requestPermission()
    return () => document.removeEventListener("visibilitychange", onShow)
  }, [room])

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
    () => Object.fromEntries((cfg?.modes ?? []).map((m) => [m.slug, m.color])),
    [cfg?.modes]
  )

  if (!cfg) {
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
  // Текущий режим целиком: из него берём и знак, и цвет.
  const now = cfg.modes?.find((m) => (state.modeState ? m.name === state.modeState.name : m.builtin))

  /**
   * Чем участник занят. Всё, кроме «работает», существует только внутри режима: вне его
   * очереди нет, и «ждёт» было бы догадкой. Состав шага и те, кого он ещё не дождался,
   * приходят от оркестратора — интерфейс их не вычисляет.
   */
  const ms = state.modeState
  const doing = (n: string): "working" | "waiting" | "done" | "idle" => {
    if (thinking.includes(n)) return "working"
    if (!ms || !ms.cast.includes(n)) return "idle"
    return ms.pending.includes(n) ? "waiting" : "done"
  }

  return (
    <TooltipProvider>
      <div className="bg-background flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 px-4">
          {/* Знак и профиль забирают по половине свободного места. Иначе ряд аватарок
              стоит по центру того, что осталось, и уезжает, когда имя комнаты
              меняет длину знака. */}
          <div className="flex min-w-0 flex-1 basis-0 justify-start">
            <a href="/" className="min-w-0">
              {/* В скобках — предмет разговора по-английски, а не имя комнаты латиницей:
                  «проверка» превращалась в proverka, и знак говорил о комнате не больше,
                  чем её название. Пока предмет не назван — space. */}
              <Logo
                subject={cfg.topic || "space"}
                mode={state.modeState?.slug ?? "open"}
                color={live ? now?.color : null}
                colors={tones}
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
              {Object.entries(cfg.agents).filter(([n]) => here(n)).map(([n, a]) => {
                const at = doing(n)
                return (
                  <Tooltip key={n}>
                    <TooltipTrigger asChild>
                      {/* Состояние показано вокруг аватарки, а не вместо неё: цвет остаётся
                          опознавательным знаком участника и ничего не значит сам по себе. */}
                      <span
                        className={cn(
                          "rounded-full transition-opacity",
                          at === "working" && "ring-ring/50 ring-2 ring-offset-2 ring-offset-background",
                          at === "waiting" && "opacity-40"
                        )}
                      >
                        <FaceButton
                          name={n}
                          icon={a.icon}
                          color={a.color}
                          onPick={(name) => setInsert({ name, nonce: Date.now() })}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {n} · {t(`feed.status${at[0].toUpperCase()}${at.slice(1)}` as never)}
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
          /* Пустая комната показывает не «здесь тихо», а способы работы: карточка на режим.
             «Открытый» выбран с самого начала, поэтому он в том же ряду и помечен как текущий. */
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Воздух сверху и снизу нужен только когда карточки не влезают и список
                скроллится. Шесть на пустой экран — это ещё и предложение, а не список,
                поэтому в обрез: лишние два десятка пикселей включали полосу прокрутки
                при том, что на экране всё видно. */}
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-3">
              <div className="grid gap-2 sm:grid-cols-2">
              {cfg.modes?.map((m) => {
                const current = state.modeState ? state.modeState.name === m.name : m.builtin
                return (
                  <button
                    key={m.name}
                    aria-current={current || undefined}
                    className={cn(
                      "flex gap-3 rounded-lg border p-3 text-left transition-colors",
                      current ? "bg-accent/40" : "hover:bg-accent/40"
                    )}
                    onClick={() => void switchMode(m)}
                  >
                    <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
                      <Icon name={m.icon} className="size-5" />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex items-center gap-2 font-medium">
                        {pick(lang, m.title, m.titleEn)}
                        {current && <Badge variant="secondary">{t("mode.current")}</Badge>}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {typo(pick(lang, m.for || m.brief, m.forEn || m.briefEn))}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {m.who?.map((n) => (
                          <Face key={n} name={n} icon={cfg.agents[n]?.icon} color={cfg.agents[n]?.color} size="sm" />
                        ))}
                      </span>
                      {m.missing.length > 0 && (
                        <span className="text-destructive/90 text-sm">
                          {t("mode.missing", { names: m.missing.join(", ") })}
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
            agents={cfg.agents}
            thinking={thinking}
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
          agents={cfg.agents}
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
              {Object.entries(cfg.agents).map(([n, a]) => (
                <Label
                  key={n}
                  className="hover:bg-accent/50 flex items-center gap-2 rounded-md p-2 font-normal"
                >
                  <Face name={n} icon={a.icon} color={a.color} size="sm" />
                  <span className="flex-1 truncate">{n}</span>
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
                /* Что за шаг и видят ли участники друг друга — подсказкой: нужно это
                   раз в режим, а места в строке нет. */
                title={
                  state.modeState
                    ? t(state.modeState.hear ? "mode.step" : "mode.blind", {
                        n: state.modeState.step,
                        all: state.modeState.steps,
                        name: state.modeState.stepName,
                      })
                    : undefined
                }
              >
                <Icon name={now?.icon ?? "message-circle"} className="size-4" />
                {state.modeState ? pick(lang, state.modeState.short, state.modeState.shortEn) : t("mode.open")}
                {/* Где мы внутри режима. Имя шага, а не его номер: «3/3» не говорит
                    ничего, а «Починка» — говорит. Номер остался в подсказке. */}
                {state.modeState?.stepName && (
                  <span className="text-muted-foreground/70">· {state.modeState.stepName}</span>
                )}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            {/* Ширина по триггеру здесь мала: у пунктов две строки. */}
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>{t("mode.label")}</DropdownMenuLabel>
              {cfg.modes?.map((m) => {
                const current = state.modeState ? state.modeState.name === m.name : m.builtin
                return (
                  <DropdownMenuItem
                    key={m.name}
                    className={cn("items-start gap-3 py-2", current && "bg-accent/60")}
                    onClick={() => void switchMode(m)}
                  >
                    <Icon
                      name={m.icon}
                      className={cn("mt-0.5 size-4 shrink-0", current ? "text-foreground" : "text-muted-foreground")}
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 font-medium">
                        {pick(lang, m.title, m.titleEn)}
                        {current && <Check className="size-3.5 shrink-0" />}
                      </span>
                      <span className="text-muted-foreground/80 text-sm leading-snug">
                        {typo(pick(lang, m.for || m.brief, m.forEn || m.briefEn))}
                      </span>
                      {m.missing.length > 0 && (
                        <span className="text-destructive/90 mt-0.5 flex items-center gap-1 text-sm">
                          <TriangleAlert className="size-3.5 shrink-0" />
                          {t("mode.missing", { names: m.missing.join(", ") })}
                        </span>
                      )}
                    </div>
                  </DropdownMenuItem>
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
          currentMode={state.modeState?.name}
          onApplied={(s) => setCfg({ ...cfg, ...s } as Config)}
          onModes={(modes) => setCfg({ ...cfg, modes })}
          onCleared={() => {
            setMessages([])
            setState({ autoTurns: 0, paused: false })
          }}
        />
        <Toaster position="bottom-center" />
      </div>
    </TooltipProvider>
  )
}
