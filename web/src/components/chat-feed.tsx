import * as React from "react"
import * as Icons from "lucide-react"
import { FileText } from "lucide-react"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import type { Agent, Msg } from "@/lib/api"
import { cn } from "@/lib/utils"
import { typo } from "@/lib/typo"
import { useLang, pick } from "@/lib/i18n"

/**
 * Палитра участников живёт в теме (index.css): там тон и насыщенность каждого цвета,
 * там же шкала ролей цвета. Здесь — только имена и то, как их передать в CSS.
 */
export const COLOR_ORDER = [
  "red", "coral", "orange", "yellow", "lime", "green", "teal",
  "sky", "blue", "indigo", "plum", "pink", "white", "black",
]

/** Переменные тона для элемента: дальше цвет считают классы .tone-* из темы. */
export function toneVars(color?: string | null): React.CSSProperties {
  const known = color && COLOR_ORDER.includes(color)
  return {
    "--h": `var(--tone-${known ? color : "blue"})`,
    "--c": known ? `var(--chroma-${color})` : "0",
  } as React.CSSProperties
}

/** Бледные цвета требуют тёмного текста в пузыре — это единственное исключение. */
export const isPale = (color?: string | null) => color === "white"

/** Ник могли записать в другом регистре (старые логи, ручной ввод) — ищем без учёта регистра. */
function getAgent(agents: Record<string, Agent>, name?: string): Agent | undefined {
  if (!name) return undefined
  if (agents[name]) return agents[name]
  const lower = name.toLowerCase()
  const key = Object.keys(agents).find((k) => k.toLowerCase() === lower)
  return key ? agents[key] : undefined
}

/**
 * Аватарка. Размер — ступенью, а не классом по месту: иначе кружок меняется,
 * а знак внутри остаётся прежним, и пропорция плывёт от экрана к экрану.
 */
const FACE_SIZES = {
  xs: { box: "size-4.5", icon: "size-2.5" },
  sm: { box: "size-6", icon: "size-3" },
  md: { box: "size-8", icon: "size-4" },
  lg: { box: "size-10", icon: "size-5" },
} as const

export function Face({
  name,
  icon,
  color,
  size = "md",
  muted,
  className,
}: {
  name: string
  icon?: string
  color?: string | null
  size?: keyof typeof FACE_SIZES
  /** Аватарка без тона: человек в своём профиле — не собеседник в ленте. */
  muted?: boolean
  className?: string
}) {
  const s = FACE_SIZES[size]
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        muted ? "bg-muted text-muted-foreground" : "tone-face",
        s.box,
        className
      )}
      style={muted ? undefined : toneVars(color)}
      title={name}
    >
      <Icon name={icon} className={s.icon} />
    </span>
  )
}

/** Аватарка, по клику ставящая обращение: одна и та же в шапке, у реплики и у индикатора. */
export function FaceButton({
  name,
  icon,
  color,
  onPick,
}: {
  name: string
  icon?: string
  color?: string | null
  onPick: (name: string) => void
}) {
  return (
    <button
      type="button"
      aria-label={name}
      className="tone-hover rounded-full transition-shadow"
      style={toneVars(color)}
      onClick={(e) => {
        e.stopPropagation()
        onPick(name)
      }}
    >
      <Face name={name} icon={icon} color={color} size="md" />
    </button>
  )
}

/** Имя иконки из роли → компонент Lucide: тот же набор, что в настройках. */
export function Icon({ name, className }: { name?: string; className?: string }) {
  const key = (name ?? "bot")
    .split("-")
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join("") as keyof typeof Icons
  const Cmp = (Icons[key] ?? Icons.Bot) as React.ComponentType<{ className?: string }>
  return <Cmp className={className ?? "size-4"} />
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i
const size = (b: number) =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`

/**
 * Имя — кнопка: по клику встаёт обращением в поле ввода. В тексте реплики оно просто жирное,
 * без собаки и без цвета: несколько тонов в одном абзаце спорят с тоном самого бабла.
 * Над репликой имя идёт в тоне автора; у кого цвета нет (человек) — нейтральное.
 */
function Name({
  name,
  color,
  onPick,
  className = "font-bold",
}: {
  name: string
  color?: string | null
  onPick: (name: string) => void
  /** Вес: в тексте имя жирное, над репликой — весом заголовка. */
  className?: string
}) {
  return (
    // Кнопка стоит в строке текста: Button из системы — inline-flex со своей высотой,
    // он рвёт строку и сбивает базовую линию.
    <button
      type="button"
      className={cn("hover:underline", className, color && "tone-name")}
      style={color ? toneVars(color) : undefined}
      onClick={(e) => {
        e.stopPropagation()
        onPick(name)
      }}
    >
      {name}
    </button>
  )
}

/** Разметка внутри реплики: код, выделение, упоминания. Текст экранирует React. */
function Rich({
  text,
  known,
  agents,
  onMention,
}: {
  text: string
  known: string[]
  agents: Record<string, Agent>
  onMention: (name: string) => void
}) {
  const parts = React.useMemo(() => {
    const out: React.ReactNode[] = []
    const re = /```(\w*)\n?([\s\S]*?)```|`([^`\n]+)`|\*\*([^*\n]+)\*\*|(^|[\s(,:;«"'[])@([a-z0-9_\-Ѐ-ӿ]+)/gi
    let last = 0
    let m: RegExpExecArray | null
    let i = 0

    while ((m = re.exec(text))) {
      if (m.index > last) out.push(typo(text.slice(last, m.index)))
      if (m[2] !== undefined) {
        out.push(
          <pre key={i++} className="bg-background/60 my-2 overflow-x-auto rounded-md p-3 text-xs">
            <code>{m[2].replace(/\n$/, "")}</code>
          </pre>
        )
      } else if (m[3]) {
        out.push(
          <code key={i++} className="bg-background/60 rounded px-1 py-0.5 text-xs">
            {m[3]}
          </code>
        )
      } else if (m[4]) {
        out.push(<b key={i++}>{m[4]}</b>)
      } else if (m[6]) {
        const name = m[6]
        out.push(m[5])
        const hit = known.find((k) => k.toLowerCase() === name.toLowerCase())
        out.push(
          hit ? <Name key={i++} name={hit} onPick={onMention} /> : `@${name}`
        )
      }
      last = re.lastIndex
    }
    if (last < text.length) out.push(typo(text.slice(last)))
    return out
  }, [text, known, agents, onMention])

  return <span className="whitespace-pre-wrap">{parts}</span>
}

function Files({ files }: { files?: Msg["files"] }) {
  if (!files?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f) =>
        IMAGE.test(f.name) ? (
          <a key={f.url} href={f.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
            <img
              src={f.url}
              alt={f.name}
              className="max-h-72 max-w-full rounded-md border object-contain"
            />
          </a>
        ) : (
          <a
            key={f.url}
            href={f.url}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className="bg-background/60 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
          >
            <FileText className="size-3.5" />
            {f.name} · {size(f.size)}
          </a>
        )
      )}
    </div>
  )
}

type Props = {
  messages: Msg[]
  user: string
  agents: Record<string, Agent>
  thinking: string[]
  onReply: (m: Msg) => void
  /** Клик по своей реплике: не отвечать же себе — правим её. */
  onEdit: (m: Msg) => void
  /** Клик по имени в ленте: поставить обращение в поле ввода. */
  onMention: (name: string) => void
}

/** Текст без разметки: в цитате нет ни кода, ни жирного, ни собак у имён. */
const plain = (text: string) =>
  text.replace(/[`*]/g, "").replace(/(^|[\s(,:;«"'[])@([a-z0-9_\-Ѐ-ӿ]+)/gi, "$1$2")

/**
 * Цитата — системный Item: одна и та же в реплике и над полем ввода. Тон автора несёт
 * только имя, текст нейтральный и без разметки.
 */
export function Quote({
  to,
  agents,
  children,
  className,
}: {
  to?: Msg | null
  agents: Record<string, Agent>
  /** Действие справа: над полем ввода там стоит отмена ответа. */
  children?: React.ReactNode
  className?: string
}) {
  const { t } = useLang()
  if (!to) return null
  const color = getAgent(agents, to.from)?.color
  return (
    <Item variant="outline" size="xs" className={className}>
      <ItemContent>
        <ItemTitle className={color ? "tone-name" : undefined} style={color ? toneVars(color) : undefined}>
          {to.from}
        </ItemTitle>
        <ItemDescription>{typo(plain(to.text)) || t("composer.file")}</ItemDescription>
      </ItemContent>
      {children && <ItemActions>{children}</ItemActions>}
    </Item>
  )
}

/** Группа — подряд идущие реплики одного автора с паузой меньше пяти минут. */
function groups(messages: Msg[]) {
  const out: Msg[][] = []
  for (const m of messages) {
    const last = out.at(-1)
    const prev = last?.at(-1)
    const groupable = m.kind === "message" && prev?.kind === "message"
    const sameAuthor = prev && prev.from === m.from
    const closeInTime = prev && m.ts - prev.ts < 5 * 60 * 1000
    if (last && groupable && sameAuthor && closeInTime) last.push(m)
    else out.push([m])
  }
  return out
}

/** Отправил сам — лента уходит вниз, даже если была отмотана: как в любом мессенджере. */
function FollowMine({ seq }: { seq?: number }) {
  const { scrollToEnd } = useMessageScroller()
  const seen = React.useRef(seq)
  React.useEffect(() => {
    if (seq === undefined || seq === seen.current) return
    seen.current = seq
    scrollToEnd({ behavior: "smooth" })
  }, [seq, scrollToEnd])
  return null
}

export function ChatFeed({ messages, user, agents, thinking, onReply, onMention, onEdit }: Props) {
  const { lang, t } = useLang()
  const known = React.useMemo(() => [...Object.keys(agents), user], [agents, user])
  const bySeq = React.useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <FollowMine seq={messages.findLast((m) => m.from === user)?.seq} />
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
            {groups(messages).map((group) => {
              const first = group[0]

              if (first.kind !== "message") {
                // Служебное событие — неброская отметка в ленте, не блок во всю ширину.
                return (
                  <MessageScrollerItem key={first.id} messageId={first.id}>
                    <div className="my-3 flex flex-col items-center gap-1">
                      {group.map((m) => (
                        <span key={m.id} className="text-muted-foreground/50 text-sm">
                          {m.kind === "error" && <b className="font-medium">{m.from}: </b>}
                          {typo(m.text)}
                        </span>
                      ))}
                    </div>
                  </MessageScrollerItem>
                )
              }

              const mine = first.from === user
              const agent = getAgent(agents, first.from)

              return (
                <MessageGroup key={first.id}>
                  {group.map((m, i) => {
                    const tagged = m.mentions?.includes(user)
                    const foot = [
                      new Date(m.ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
                      m.meta?.elapsedMs ? `${Math.round(m.meta.elapsedMs / 1000)}с` : "",
                      m.meta?.usage?.input_tokens
                        ? `${Math.round(m.meta.usage.input_tokens / 1000)}k`
                        : "",
                      m.edited ? t("feed.edited") : "",
                    ].filter(Boolean)

                    return (
                      <MessageScrollerItem key={m.id} messageId={m.id} id={`msg-${m.seq}`}>
                        <Message align={mine ? "end" : "start"}>
                          {!mine && (
                            <MessageAvatar className="bg-transparent">
                              <FaceButton name={m.from} icon={agent?.icon} color={agent?.color} onPick={onMention} />
                            </MessageAvatar>
                          )}
                          <MessageContent className="gap-1">
                            {!mine && i === 0 && (
                              <MessageHeader className="text-sm">
                                <Name name={m.from} color={agent?.color} onPick={onMention} className="" />
                                {agent?.role && agent.role.toLowerCase() !== m.from.toLowerCase() && (
                                  <span className="ml-1.5">{pick(lang, agent.role, agent.roleEn)}</span>
                                )}
                              </MessageHeader>
                            )}
                            <Bubble
                              variant="secondary"
                              align={mine ? "end" : "start"}
                            >
                              <BubbleContent
                                // Ответить — кликом по реплике. Клик, которым закончили
                                // выделять текст, ответом не считается.
                                onClick={() => {
                                  if (window.getSelection()?.toString()) return
                                  if (mine) onEdit(m)
                                  else onReply(m)
                                }}
                                className={cn(
                                  "cursor-pointer text-base leading-normal",
                                  // Своя реплика — нейтральная: цветом кодируются собеседники.
                                  !mine && (isPale(agent?.color) ? "tone-bubble-pale" : "tone-bubble"),
                                  tagged && "is-tagged"
                                )}
                                style={mine ? undefined : toneVars(agent?.color)}
                              >
                                <Quote to={m.replyTo ? bySeq.get(m.replyTo) : undefined} agents={agents} className="mb-1.5" />
                                {m.text && <Rich text={m.text} known={known} agents={agents} onMention={onMention} />}
                                <Files files={m.files} />
                              </BubbleContent>
                            </Bubble>
                            {/* Время и расход — служебная строка: размер системный, тон тише имени. */}
                            {i === group.length - 1 && (
                              <MessageFooter className="text-muted-foreground/70 font-normal">
                                {foot.join(" · ")}
                              </MessageFooter>
                            )}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    )
                  })}
                </MessageGroup>
              )
            })}

            {thinking.length > 0 && (
              <MessageGroup>
                <Message align="start">
                  <MessageAvatar className="bg-transparent">
                    <FaceButton
                      name={thinking[0]}
                      icon={getAgent(agents, thinking[0])?.icon}
                      color={getAgent(agents, thinking[0])?.color}
                      onPick={onMention}
                    />
                  </MessageAvatar>
                  <MessageContent>
                    <Bubble variant="secondary" align="start">
                      {/* Пузырь сразу в цвете участника: ждать его реплику
                          и получить её — одно и то же место, а не два разных. */}
                      <BubbleContent
                        className={cn(
                          "text-sm",
                          isPale(getAgent(agents, thinking[0])?.color) ? "tone-bubble-pale" : "tone-bubble"
                        )}
                        style={toneVars(getAgent(agents, thinking[0])?.color)}
                      >
                        <span className="flex items-center gap-1.5 opacity-70">
                          <span>
                            {thinking.map((n, i) => (
                              <React.Fragment key={n}>
                                {i > 0 && ` ${t("feed.and")} `}
                                <Name name={n} onPick={onMention} />
                              </React.Fragment>
                            ))}{" "}
                            {t(thinking.length > 1 ? "feed.thinkingMany" : "feed.thinkingOne")}
                          </span>
                          <span className="flex gap-1">
                            {[0, 1, 2].map((d) => (
                              <span
                                key={d}
                                className="size-1 animate-pulse rounded-full bg-current"
                                style={{ animationDelay: `${d * 0.2}s` }}
                              />
                            ))}
                          </span>
                        </span>
                      </BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              </MessageGroup>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="ms-[min(22rem,45vw)]" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
