import * as React from "react"
import * as Icons from "lucide-react"
import { FileText, Reply } from "lucide-react"

import { Button } from "@/components/ui/button"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
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
} from "@/components/ui/message-scroller"
import type { Agent, Msg } from "@/lib/api"
import { cn } from "@/lib/utils"
import { typo } from "@/lib/typo"

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
  const name = color && (COLOR_ORDER.includes(color) || color === "creator") ? color : "blue"
  return {
    "--h": `var(--tone-${name})`,
    "--c": `var(--chroma-${name})`,
  } as React.CSSProperties
}

/** Бледные цвета требуют тёмного текста в пузыре — это единственное исключение. */
export const isPale = (color?: string | null) => color === "white"

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

/** Разметка внутри реплики: код, выделение, упоминания. Текст экранирует React. */
function Rich({
  text,
  known,
  agents,
  human,
}: {
  text: string
  known: string[]
  agents: Record<string, Agent>
  human: string
}) {
  const parts = React.useMemo(() => {
    const out: React.ReactNode[] = []
    const re = /```(\w*)\n?([\s\S]*?)```|`([^`\n]+)`|\*\*([^*\n]+)\*\*|(^|[\s(,:;«"'[])@([a-z0-9_-]+)/gi
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
          hit ? (
            <b
              key={i++}
              className="tone-name capitalize"
              style={toneVars(hit === human ? "creator" : agents[hit]?.color)}
            >
              {hit === human ? "Вы" : hit}
            </b>
          ) : (
            `@${name}`
          )
        )
      }
      last = re.lastIndex
    }
    if (last < text.length) out.push(typo(text.slice(last)))
    return out
  }, [text, known, agents, human])

  return <span className="whitespace-pre-wrap">{parts}</span>
}

function Files({ files }: { files?: Msg["files"] }) {
  if (!files?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f) =>
        IMAGE.test(f.name) ? (
          <a key={f.url} href={f.url} target="_blank" rel="noopener">
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
  human: string
  agents: Record<string, Agent>
  thinking: string[]
  onReply: (m: Msg) => void
}

/** Цитата — компактная подложка с полоской в цвете автора, как в мессенджере. */
function Quote({
  to,
  agents,
  human,
}: {
  to?: Msg
  agents: Record<string, Agent>
  human: string
}) {
  if (!to) return null
  // Цвет автора смешиваем с цветом текста пузыря: на светлом фоне он темнеет,
  // на тёмном светлеет — и нигде не кричит.
  return (
    <div
      className="tone-name mb-1.5 overflow-hidden rounded-md border-l-2 border-current px-2 py-1 text-sm"
      style={{
        ...toneVars(to.from === human ? "creator" : agents[to.from]?.color),
        background: "color-mix(in oklab, currentColor 7%, transparent)",
      }}
    >
      <div className="font-medium capitalize">
        {to.from === human ? "Вы" : to.from}
      </div>
      <div className="truncate opacity-70">{typo(to.text) || "файл"}</div>
    </div>
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

export function ChatFeed({ messages, human, agents, thinking, onReply }: Props) {
  const known = React.useMemo(() => [...Object.keys(agents), human], [agents, human])
  const bySeq = React.useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end" scrollPreviousItemPeek={64}>
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

              const mine = first.from === human
              const agent = agents[first.from]

              return (
                <MessageGroup key={first.id}>
                  {group.map((m, i) => {
                    const tagged = m.mentions?.includes(human)
                    const foot = [
                      new Date(m.ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
                      m.meta?.elapsedMs ? `${Math.round(m.meta.elapsedMs / 1000)}с` : "",
                      m.meta?.usage?.input_tokens
                        ? `${Math.round(m.meta.usage.input_tokens / 1000)}k`
                        : "",
                    ].filter(Boolean)

                    return (
                      <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={mine} id={`msg-${m.seq}`}>
                        <Message
                          align={mine ? "end" : "start"}
                          onDoubleClick={() => onReply(m)}
                        >
                          {!mine && (
                            <MessageAvatar className="bg-transparent">
                              <Face name={m.from} icon={agent?.icon} color={agent?.color} size="md" />
                            </MessageAvatar>
                          )}
                          <MessageContent>
                            {!mine && i === 0 && (
                              <MessageHeader className="text-sm">
                                <span className="tone-name capitalize" style={toneVars(agent?.color)}>
                                  {m.from}
                                </span>
                                {agent?.role && agent.role.toLowerCase() !== m.from.toLowerCase() && (
                                  <span className="ml-1.5">{agent.role}</span>
                                )}
                              </MessageHeader>
                            )}
                            <Bubble
                              variant="secondary"
                              align={mine ? "end" : "start"}
                            >
                              <BubbleContent
                                className={cn(
                                  "text-base leading-normal",
                                  // Своя реплика — нейтральная: цветом кодируются собеседники.
                                  !mine && (isPale(agent?.color) ? "tone-bubble-pale" : "tone-bubble"),
                                  tagged && "is-tagged"
                                )}
                                style={mine ? undefined : toneVars(agent?.color)}
                              >
                                <Quote to={m.replyTo ? bySeq.get(m.replyTo) : undefined} agents={agents} human={human} />
                                {m.text && <Rich text={m.text} known={known} agents={agents} human={human} />}
                                <Files files={m.files} />
                              </BubbleContent>
                            </Bubble>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Ответить"
                              title="Ответить — или двойной клик по реплике"
                              onClick={() => onReply(m)}
                              className="text-muted-foreground absolute top-0 opacity-0 transition-opacity group-hover/message:opacity-100 data-[align=end]:left-0 group-data-[align=end]/message:left-0 group-data-[align=start]/message:right-0"
                            >
                              <Reply />
                            </Button>
                            {i === group.length - 1 && (
                              <MessageFooter className="text-sm">{foot.join(" · ")}</MessageFooter>
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
                    <Face name={thinking[0]} icon={agents[thinking[0]]?.icon} color={agents[thinking[0]]?.color} size="md" />
                  </MessageAvatar>
                  <MessageContent>
                    <Bubble variant="secondary" align="start">
                      <BubbleContent>
                        <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                          {thinking.map((t) => `@${t}`).join(" и ")}{" "}
                          {thinking.length > 1 ? "думают" : "думает"}
                          <span className="flex gap-1">
                            {[0, 1, 2].map((d) => (
                              <span
                                key={d}
                                className="bg-muted-foreground size-1 animate-pulse rounded-full"
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
