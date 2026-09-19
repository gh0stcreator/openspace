import * as React from "react"
import {
  AtSign,
  Check,
  ChevronDown,
  Languages,
  Settings2,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ChatFeed, Face, FaceButton, Icon } from "@/components/chat-feed"
import { Composer } from "@/components/composer"
import { Logo } from "@/components/logo"
import { SettingsDialog } from "@/components/settings-dialog"
import { cn } from "@/lib/utils"
import { useLang, pick } from "@/lib/i18n"
import { typo } from "@/lib/typo"
import { topicOf } from "@/lib/latin"
import { api, listen, type Config, type Msg, type RoomState } from "@/lib/api"

export default function App() {
  const { lang, setLang, t } = useLang()
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
        : prev.some((x) => x.seq === m.seq)
          ? prev
          : [...prev, m],
    []
  )
  const shown = (list: Msg[]) => list.filter((m) => m.kind !== "edit")
  const [insert, setInsert] = React.useState<{ name: string; nonce: number }>()

  const local = React.useCallback((text: string) => toast.error(text), [])
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

  if (!cfg) {
    return (
      <div className="bg-background flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
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

  return (
    <TooltipProvider>
      <div className="bg-background flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <a href="/" className="shrink-0">
            <Logo
              topic={topicOf(room)}
              mode={state.modeState?.slug ?? "open"}
              className={`transition-colors ${
                live ? "hover:text-muted-foreground" : "text-destructive"
              }`}
            />
          </a>

          {/* Кто в пространстве — аватарками: имена не нужны, чтобы это понять. */}
          <div className="hidden min-w-0 flex-1 items-center justify-center gap-2.5 sm:flex">
            {Object.entries(cfg.agents).map(([n, a]) => (
              <FaceButton
                key={n}
                name={n}
                icon={a.icon}
                color={a.color}
                onPick={(name) => setInsert({ name, nonce: Date.now() })}
              />
            ))}
          </div>

          {/* Профиль: кто вы здесь. Под ним — то, что меняет пространство целиком. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="hover:bg-accent/50 data-[state=open]:bg-accent/50 ml-auto h-10 shrink-0 gap-2 pr-2 pl-1 font-normal"
              >
                <Face name={cfg.user} icon="user" size="md" muted />
                <span className="hidden sm:inline">{cfg.user}</span>
                <ChevronDown className="text-muted-foreground size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Settings2 />
                {t("profile.settings")}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Languages />
                  {t("profile.lang")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as "ru" | "en")}>
                    <DropdownMenuRadioItem value="ru">Русский</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Комната считается пустой, пока в ней нет ни одной реплики: служебные
            строки вроде «поставлено на паузу» разговором не являются. */}
        {!messages.some((m) => m.kind === "message") ? (
          /* Пустая комната показывает не «здесь тихо», а способы работы: карточка на режим.
             «Открытый» выбран с самого начала, поэтому он в том же ряду и помечен как текущий. */
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto grid w-full max-w-3xl gap-2 px-4 py-6 sm:grid-cols-2">
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
                    onClick={async () => {
                      const r = await api.setMode(room, m.builtin ? null : m.name)
                      setState((st) => ({ ...st, modeState: r.mode }))
                    }}
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
                      <span className="text-muted-foreground/70 text-sm">
                        {[
                          pick(lang, m.rubric, m.rubricEn),
                          m.who?.length ? m.who.join(", ") : t("mode.everyone"),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
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
          user={cfg.user}
          onError={local}
          onSent={(m) => setMessages((prev) => take(prev, m))}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onEdit={setEditing}
          lastMine={messages.findLast((m) => m.kind === "message" && m.from === cfg.user)}
          insert={insert}
        />


        {/* Управление под полем: слева состав и стоп, справа — режим работы. */}
        <div className="text-muted-foreground mx-auto mt-2 mb-3 flex w-full max-w-3xl items-center gap-1 px-4 text-sm">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 font-normal"
            title={`${Object.keys(cfg.agents).join(", ")}${
              spent ? ` · ${t("bar.tokens", { n: Math.round(spent / 1000) })}` : ""
            }`}
            onClick={() => setSettingsOpen(true)}
          >
            <Users />
            {t("bar.people", { n: Object.keys(cfg.agents).length })}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto gap-1.5 font-normal">
                <Icon
                  name={
                    cfg.modes?.find((m) => (state.modeState ? m.name === state.modeState.name : m.builtin))?.icon ??
                    "message-circle"
                  }
                  className="size-4"
                />
                {state.modeState ? pick(lang, state.modeState.short, state.modeState.shortEn) : t("mode.open")}
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
                    onClick={async () => {
                      const r = await api.setMode(room, m.builtin ? null : m.name)
                      setState((st) => ({ ...st, modeState: r.mode }))
                    }}
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
                        {pick(lang, m.for || m.brief, m.forEn || m.briefEn)}
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
