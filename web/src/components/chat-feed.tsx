import * as React from "react"
import * as Icons from "lucide-react"
import { ArrowRight, Check, Copy, FileText } from "lucide-react"

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
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { Agent, Msg } from "@/lib/api"
import { eventType } from "@/lib/events"
import { cn } from "@/lib/utils"
import { typo } from "@/lib/typo"
import { useLang } from "@/lib/i18n"

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
export function Icon({
  name,
  className,
  style,
}: {
  name?: string
  className?: string
  style?: React.CSSProperties
}) {
  const key = (name ?? "bot")
    .split("-")
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join("") as keyof typeof Icons
  const Cmp = (Icons[key] ?? Icons.Bot) as React.ComponentType<{
    className?: string
    style?: React.CSSProperties
  }>
  return <Cmp className={className ?? "size-4"} style={style} />
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
  children,
}: {
  name: string
  color?: string | null
  onPick: (name: string) => void
  /** Вес: в тексте имя жирное, над репликой — весом заголовка. */
  className?: string
  /** Что показать вместо ника: в тексте имя склоняется — «Инженера», «Дизайнеру». */
  children?: React.ReactNode
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
      {children ?? name}
    </button>
  )
}

/** Разметка внутри реплики: код, выделение, упоминания. Текст экранирует React. */
/**
 * Разметка в реплике. Участникам велено писать как в мессенджере, но человек вставляет
 * куски статей, а куски статей размечены: заголовки, списки, линейки. Показывать их
 * сырыми значками — значит показывать текст непрочитанным.
 *
 * Блочная разметка разбирается построчно и оборачивает Rich, который остаётся разбором
 * внутристрочного. Тройные кавычки вырезаются первыми: внутри них строки — это код,
 * а не разметка, и решётка в начале строки там ничего не значит.
 */
function Markdown(props: {
  text: string
  known: string[]
  agents: Record<string, Agent>
  onMention: (name: string) => void
}) {
  const { text, ...rest } = props
  const out: React.ReactNode[] = []
  let key = 0

  // Куски вне тройных кавычек разбираем построчно, сами кавычки отдаём Rich как есть.
  for (const chunk of text.split(/(```[\s\S]*?```)/g)) {
    if (!chunk) continue
    if (chunk.startsWith("```")) {
      out.push(<Rich key={key++} text={chunk} {...rest} />)
      continue
    }

    const lines = chunk.split("\n")
    let para: string[] = []
    let list: { ordered: boolean; items: string[] } | null = null

    const flushPara = () => {
      if (!para.length) return
      const body = para.join("\n").replace(/^\n+|\n+$/g, "")
      if (body) out.push(<Rich key={key++} text={body} {...rest} />)
      para = []
    }
    const flushList = () => {
      if (!list) return
      const L = list.ordered ? "ol" : "ul"
      out.push(
        React.createElement(
          L,
          {
            key: key++,
            className: list.ordered
              ? "my-1.5 list-decimal space-y-0.5 ps-5"
              : "my-1.5 list-disc space-y-0.5 ps-5",
          },
          list.items.map((it, n) => (
            <li key={n}>
              <Rich text={it} {...rest} />
            </li>
          ))
        )
      )
      list = null
    }

    for (const line of lines) {
      const head = line.match(/^(#{1,6})\s+(.+)$/)
      const item = line.match(/^\s*[-*•]\s+(.+)$/)
      const num = line.match(/^\s*\d+[.)]\s+(.+)$/)
      const quote = line.match(/^>\s?(.*)$/)

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushPara(); flushList()
        // Линейка — тонкая и короткая: во всю ширину она режет ленту пополам.
        out.push(<hr key={key++} className="border-border/60 my-3 w-16" />)
      } else if (head) {
        flushPara(); flushList()
        out.push(
          <div key={key++} className={cn("mt-3 mb-1 font-semibold first:mt-0", head[1].length <= 2 && "text-[1.05em]")}>
            <Rich text={head[2]} {...rest} />
          </div>
        )
      } else if (item || num) {
        flushPara()
        const ordered = !!num
        if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
        list.items.push((item ?? num)![1])
      } else if (quote) {
        flushPara(); flushList()
        out.push(
          <div key={key++} className="border-border text-muted-foreground my-1.5 border-s-2 ps-3">
            <Rich text={quote[1]} {...rest} />
          </div>
        )
      } else {
        flushList()
        para.push(line)
      }
    }
    flushPara()
    flushList()
  }

  return <>{out}</>
}

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
    // Участники зовут друг друга словами, а не тегами: тег будит, а они просто ссылаются.
    // Поэтому имя узнаём и без собаки — с русскими окончаниями и только с большой буквы:
    // «Инженера» в реплике — это он, «инженера» строчными — профессия.
    const named = known
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .sort((a, b) => b.length - a.length)
      .join("|")
    const re = new RegExp(
      "```(\\w*)\\n?([\\s\\S]*?)```" +
        "|`([^`\\n]+)`" +
        "|\\*\\*([^*\\n]+)\\*\\*" +
        "|(^|[\\s(,:;«\"'\\[])@([a-zA-Z0-9_\\-Ѐ-ӿ]+)" +
        (named ? `|(?<![\\p{L}\\p{N}])(${named})(а|у|ом|е|ы|ов|ам|ами|ах)?(?![\\p{L}\\p{N}])` : ""),
      "gu"
    )
    let last = 0
    let m: RegExpExecArray | null
    let i = 0

    while ((m = re.exec(text))) {
      if (m.index > last) out.push(typo(text.slice(last, m.index)))
      if (m[2] !== undefined) {
        out.push(
          <pre key={i++} className="bg-code-surface text-code my-2 overflow-x-auto rounded-md p-3 text-[0.85em]">
            <code>{m[2].replace(/\n$/, "")}</code>
          </pre>
        )
      } else if (m[3]) {
        out.push(
          <code
            key={i++}
            /* Кегль связан с текстом вокруг, а не задан числом: в реплике шрифт 16,
               в цитате 14, и фиксированные 12 в одном месте были мелкими, в другом нет. */
            className="bg-code-surface text-code rounded px-1.5 py-0.5 text-[0.85em]"
          >
            {m[3]}
          </code>
        )
      } else if (m[4]) {
        out.push(<b key={i++}>{m[4]}</b>)
      } else if (m[7]) {
        // Имя без собаки: показываем цветом, но передачей хода это не считается —
        // её по-прежнему определяют разобранные сервером обращения.
        const word = m[7]
        const hit = known.find((k) => k.toLowerCase() === word.toLowerCase())
        out.push(
          hit ? (
            <Name key={i++} name={hit} color={getAgent(agents, hit)?.color} onPick={onMention}>
              {word + (m[8] ?? "")}
            </Name>
          ) : (
            word + (m[8] ?? "")
          )
        )
      } else if (m[6]) {
        const name = m[6]
        out.push(m[5])
        const hit = known.find((k) => k.toLowerCase() === name.toLowerCase())
        // Обращение — цветом того, кого позвали: имя в ленте и имя в тексте должны
        // опознаваться одинаково, иначе цвет перестаёт быть признаком участника.
        out.push(
          hit ? (
            <Name key={i++} name={hit} color={getAgent(agents, hit)?.color} onPick={onMention} />
          ) : (
            `@${name}`
          )
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
  /** Клик по предложению архивариуса: применить diff к памяти пространства. */
  onConfirmMemory: (m: Msg) => void
  /** Второе, отдельное действие на том же предложении: здесь нечего записывать —
   * курсор свёртки уходит вперёд, ничего не коммитится, назад не вернуть. */
  onRejectMemory: (m: Msg) => void
}

const MEMORY_ACTION = { добавить: "+", заменить: "→", отменить: "−" } as const

/** Что написать над списком правок — три исхода читаются по-разному, а не одной надписью
 * «принято»: частичное применение и отказ несут разную цену, и её нельзя прятать за одно слово. */
const MEMORY_STATUS_KEY = {
  принято: "memory.applied",
  "принято частично": "memory.appliedPartial",
  отклонено: "memory.rejected",
} as const

/**
 * Предложение архивариуса — не реплика, а решение: несколько записей с видом и действием,
 * читаются построчно. Заметно ровно настолько, чтобы не проскроллить не глядя, но без
 * своего цвета — нейтральный акцент, как у остальных структурных элементов ленты.
 *
 * Два разных действия на одной карточке: клик по всей карточке принимает diff — старое
 * поведение, менять его при появлении второго исхода незачем. «Здесь нечего записывать» —
 * отдельная строка под списком, не кнопка поверх клика по карточке: спутать одно с другим
 * значит подтвердить diff, который человек как раз собирался отклонить.
 */
function MemoryProposal({
  msg,
  onConfirm,
  onReject,
}: {
  msg: Msg
  onConfirm: (m: Msg) => void
  onReject: (m: Msg) => void
}) {
  const { t } = useLang()
  const pending = !msg.status || msg.status === "ожидает"
  const statusKey =
    msg.status && msg.status !== "ожидает" ? MEMORY_STATUS_KEY[msg.status] : "memory.proposal"
  return (
    <div
      onClick={() => {
        if (pending) onConfirm(msg)
      }}
      className={cn("border-border my-3 border-l-2 py-0.5 pl-4", pending && "cursor-pointer")}
    >
      <div className="text-muted-foreground mb-2 text-sm">
        <b className="text-foreground font-medium">{msg.from}</b> {t(statusKey)}
      </div>
      {/* Вид записи отдельной колонкой: так список читается как список, а не как
          семь абзацев подряд. Текст не режем — принимают то, что видят целиком. */}
      <div className="flex flex-col gap-2 text-base">
        {(msg.diff ?? []).map((d, i) => (
          <div key={i} className="flex gap-3">
            <span className="text-muted-foreground/60 w-3 shrink-0 text-center">
              {MEMORY_ACTION[d.action] ?? "·"}
            </span>
            <span className="text-muted-foreground w-24 shrink-0 text-sm leading-relaxed">{d.kind}</span>
            <span className="min-w-0 flex-1">{typo(d.text)}</span>
          </div>
        ))}
      </div>
      {pending && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onReject(msg)
          }}
          className="text-muted-foreground/60 hover:text-foreground mt-2 text-sm underline decoration-dotted underline-offset-2 transition-colors"
        >
          {t("memory.reject")}
        </button>
      )}
    </div>
  )
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
    <div className={cn("flex w-full min-w-0 items-center gap-2", className)}>
      {/* Полоска цветом автора вместо рамки: цитата принадлежит реплике, а не спорит
          с ней за внимание отдельной карточкой. */}
      <span
        className={cn("w-0.5 shrink-0 self-stretch rounded-full", color ? "tone-dot" : "bg-border")}
        style={color ? toneVars(color) : undefined}
      />
      <div className="min-w-0 flex-1 text-sm leading-tight">
        <div
          className={cn("truncate font-medium", color && "tone-name")}
          style={color ? toneVars(color) : undefined}
        >
          {to.from}
        </div>
        <div className="text-muted-foreground truncate">
          {typo(plain(to.text)) || t("composer.file")}
        </div>
      </div>
      {children}
    </div>
  )
}

/**
 * Скопировать реплику. Кнопка стоит под текстом, а не в шапке: рядом с именем она
 * читается как «скопировать имя». Проявляется под курсором и на фокусе с клавиатуры —
 * висеть над каждой репликой ей незачем, а находиться руками надо. Подтверждение —
 * сама кнопка: галочка на полторы секунды, без всплывашки поверх разговора.
 */
function CopyButton({ text }: { text: string }) {
  const { t } = useLang()
  const [done, setDone] = React.useState(false)

  React.useEffect(() => {
    if (!done) return
    const id = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(id)
  }, [done])

  return (
    <button
      type="button"
      aria-label={t(done ? "feed.copied" : "feed.copy")}
      title={t(done ? "feed.copied" : "feed.copy")}
      className={cn("text-muted-foreground/70 hover:text-foreground on-hover shrink-0", done && "is-done")}
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(text).then(() => setDone(true))
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/**
 * Длинная своя реплика — превью с возможностью развернуть. Статья, вставленная целиком,
 * занимает весь экран и выталкивает из поля зрения всё, что на неё ответили. Режем по
 * высоте, а не по числу знаков: обрыв должен приходиться на строку, а не на середину слова.
 */
const LONG = 700

function Folded({ text, children }: { text: string; children: React.ReactNode }) {
  const { t } = useLang()
  const [open, setOpen] = React.useState(false)
  if (text.length <= LONG) return <>{children}</>

  return (
    <>
      <div className={cn("relative", !open && "max-h-52 overflow-hidden")}>
        {children}
        {/* Затухание вместо жёсткого среза: видно, что текст продолжается. */}
        {!open && (
          <span className="from-secondary pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t to-transparent" />
        )}
      </div>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground mt-1 text-sm"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {t(open ? "feed.fold" : "feed.unfold")}
      </button>
    </>
  )
}

/**
 * Шапка реплики: кто сказал и во что это обошлось. В строке — только «дорого или дёшево»:
 * сколько шёл ход и сколько токенов ушло. Остальное раскрывается на месте, под той же
 * строкой, а не всплывает окном поверх разговора.
 *
 * Стоимости здесь нет и не будет: оба движка работают по подписке, и цифра в долларах
 * была бы выдумкой.
 */
function Head({
  msg,
  agent,
  onMention,
}: {
  msg: Msg
  agent?: Agent
  onMention: (name: string) => void
}) {
  const { t } = useLang()
  const sec = msg.meta?.elapsedMs ? Math.round(msg.meta.elapsedMs / 1000) : 0
  const tok = msg.meta?.usage?.input_tokens ?? 0
  const at = new Date(msg.ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })
  const brief = [sec ? `${sec}с` : "", tok ? `${Math.round(tok / 1000)}k` : ""].filter(Boolean)

  const name = (
    <Name name={msg.from} color={agent?.color} onPick={onMention} className="font-semibold" />
  )

  if (!brief.length) {
    return (
      <div className="flex items-baseline gap-2 text-base">
        {name}
        <span className="text-muted-foreground/70 text-sm font-normal tabular-nums">{at}</span>
      </div>
    )
  }

  const rows: [string, string][] = [
    [t("feed.sentAt"), at],
    [t("feed.turnTook"), `${sec}с`],
    [t("feed.tokens"), tok.toLocaleString("ru")],
    [t("card.engine"), agent?.engine ?? ""],
    [t("card.model"), agent?.model ?? t("model.default")],
  ]

  return (
    <Collapsible>
      <div className="flex items-baseline gap-2 text-base">
        {name}
        <CollapsibleTrigger asChild>
          <button
            className="text-muted-foreground/70 hover:text-foreground text-sm font-normal tabular-nums transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {brief.join(" · ")}
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent
        className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <dl className="text-muted-foreground mt-1.5 grid w-fit grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>{k}</dt>
              <dd className="text-foreground/70 tabular-nums">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Передача хода. В этом продукте обращение и есть передача: тегнули — участник проснулся
 * и отвечает. Поэтому блок собирается из разобранных сервером `mentions`, а не из того,
 * какими словами это сказано в тексте.
 */
function Handoff({
  msg,
  agents,
  user,
  onPick,
}: {
  msg: Msg
  agents: Record<string, Agent>
  user: string
  onPick: (name: string) => void
}) {
  // Владельца задачи зовут почти в каждой реплике — это разговор с ним, а не передача
  // работы. Блок остаётся для того, что он и означает: работа ушла к другому участнику.
  //
  // И только если по тексту этого не видно. «Креатор, собери текст» и следом стрелка
  // с тем же именем — строка, которая повторяет то, что человек уже прочитал.
  const named = (n: string) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])@?${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu")
      .test(msg.text ?? "")
  const to = (msg.mentions ?? []).filter((n) => n !== msg.from && n !== user && !named(n))
  if (!to.length) return null
  return (
    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      <ArrowRight className="size-3.5 shrink-0" />
      {to.map((n) => (
        <Name key={n} name={n} color={getAgent(agents, n)?.color} onPick={onPick} />
      ))}
    </div>
  )
}

/**
 * Сколько идёт ход. Рантайм присылает только «начал» и «кончил», поэтому время считаем
 * с прихода статуса: «двенадцать секунд» и «четыре минуты» — очень разное ожидание,
 * а без цифры и то и другое выглядит как «завис».
 */
function useElapsed(names: string[]) {
  const started = React.useRef<Record<string, number>>({})
  const [, tick] = React.useReducer((n: number) => n + 1, 0)
  const key = names.join(",")

  React.useEffect(() => {
    const now = Date.now()
    for (const n of names) started.current[n] ??= now
    for (const n of Object.keys(started.current)) {
      if (!names.includes(n)) delete started.current[n]
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  React.useEffect(() => {
    if (!names.length) return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [names.length])

  return (name: string) => {
    const from = started.current[name]
    return from ? Math.max(0, Math.round((Date.now() - from) / 1000)) : 0
  }
}

/** Секунды до минуты — секундами, дальше минутами: «12с», «4:07». */
const spent = (sec: number) =>
  sec < 60 ? `${sec}с` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`

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

export function ChatFeed({ messages, user, agents, thinking, onReply, onMention, onEdit, onConfirmMemory, onRejectMemory }: Props) {
  const elapsed = useElapsed(thinking)
  const { t } = useLang()
  const known = React.useMemo(() => [...Object.keys(agents), user], [agents, user])
  const bySeq = React.useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <FollowMine seq={messages.findLast((m) => m.from === user)?.seq} />
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport className="feed-fade">
          <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
            {groups(messages).map((group) => {
              const first = group[0]

              // Чем рисовать — решает тип события, а не текст реплики: интерфейс,
              // который вычитывает смысл из слов, ломается от любой перефразировки.
              const type = eventType(first, user)

              if (type === "memory-proposal") {
                return (
                  <React.Fragment key={first.id}>
                    {group.map((m) => (
                      <MessageScrollerItem key={m.id} messageId={m.id} id={`msg-${m.seq}`}>
                        <MemoryProposal msg={m} onConfirm={onConfirmMemory} onReject={onRejectMemory} />
                      </MessageScrollerItem>
                    ))}
                  </React.Fragment>
                )
              }

              if (type === "mode-change") {
                // Смена режима — единственный служебный след в разговоре, и он должен
                // читаться с одного взгляда: знак режима и его имя, а не просто слово.
                return (
                  <MessageScrollerItem key={first.id} messageId={first.id}>
                    <div className="text-muted-foreground/70 my-3 flex items-center justify-center gap-1.5 text-sm">
                      <span>{t("feed.modeOn")}</span>
                      <Icon name={first.icon} className="size-4" />
                      <b className="text-foreground/80 font-medium">{first.text}</b>
                    </div>
                  </MessageScrollerItem>
                )
              }

              if (type === "system-event") {
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

              const agent = getAgent(agents, first.from)

              // Своя реплика остаётся пузырём справа: так она отличается от чужих
              // с одного взгляда, не читая имени.
              if (type === "human-message") {
                return (
                  <MessageGroup key={first.id}>
                    {group.map((m) => (
                      <MessageScrollerItem key={m.id} messageId={m.id} id={`msg-${m.seq}`}>
                        <Message align="end" className="group/msg">
                          <MessageContent className="gap-1">
                            <Bubble variant="secondary" align="end">
                              <BubbleContent
                                onClick={() => {
                                  if (window.getSelection()?.toString()) return
                                  onEdit(m)
                                }}
                                className="cursor-pointer text-base leading-normal"
                              >
                                <Quote to={m.replyTo ? bySeq.get(m.replyTo) : undefined} agents={agents} className="mb-1.5" />
                                <Folded text={m.text}>
                                  {m.text && <Markdown text={m.text} known={known} agents={agents} onMention={onMention} />}
                                </Folded>
                                <Files files={m.files} />
                              </BubbleContent>
                            </Bubble>
                            <MessageFooter className="text-muted-foreground/70 gap-2 font-normal">
                              {[
                                new Date(m.ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
                                m.edited ? t("feed.edited") : "",
                              ].filter(Boolean).join(" · ")}
                              <CopyButton text={m.text} />
                            </MessageFooter>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    ))}
                  </MessageGroup>
                )
              }

              // Реплика участника — текстом в документе, а не цветным пузырём: цвет
              // здесь опознаёт говорящего, а не заливает то, что он сказал.
              return (
                <MessageGroup key={first.id}>
                  {group.map((m) => (
                    <MessageScrollerItem key={m.id} messageId={m.id} id={`msg-${m.seq}`}>
                      <Message
                        align="start"
                        onClick={() => {
                          if (window.getSelection()?.toString()) return
                          onReply(m)
                        }}
                        // Фона нет вовсе: ни в покое, ни под курсором. Серая плашка
                        // под каждой репликой — это снова карточка, от которой уходили,
                        // а что по реплике можно щёлкнуть, говорит курсор.
                        className="group/msg cursor-pointer py-1.5"
                      >
                        <MessageAvatar className="-mt-1 self-start bg-transparent">
                          <FaceButton name={m.from} icon={agent?.icon} color={agent?.color} onPick={onMention} />
                        </MessageAvatar>
                        <MessageContent className="gap-1">
                          <MessageHeader className="block px-0 text-sm">
                            <Head msg={m} agent={agent} onMention={onMention} />
                          </MessageHeader>
                          <div className="text-base leading-normal">
                            <Quote to={m.replyTo ? bySeq.get(m.replyTo) : undefined} agents={agents} className="mb-1.5" />
                            {m.text && <Markdown text={m.text} known={known} agents={agents} onMention={onMention} />}
                            <Files files={m.files} />
                            <Handoff msg={m} agents={agents} user={user} onPick={onMention} />
                          </div>
                          {/* Не MessageFooter: базовая карточка поднимает аватарку
                              на 32px, как только внутри появляется низ, — это верно
                              для своего пузыря справа и ломает строку слева. */}
                          <div className="flex items-center">
                            <CopyButton text={m.text} />
                          </div>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))}
                </MessageGroup>
              )
            })}

            {/* Кто сейчас работает — строкой в потоке, а не пузырём: это не реплика,
                а состояние. Время идёт рядом, потому что ход у участника, который правит
                файлы, занимает минуты, и без цифры это неотличимо от «завис». */}
            {thinking.length > 0 && (
              <div className="text-muted-foreground flex items-center gap-2 px-1 py-1 text-sm">
                {/* Все, кто сейчас думает, — одной строкой: три отдельных ряда занимают
                    пол-экрана и выглядят как три события, хотя событие одно. Аватарки
                    внахлёст, время — по тому, кто ждёт дольше всех. */}
                {/* Рядом, а не внахлёст: на маленьком кружке нахлёст с обводкой читается
                    как грязь, а не как группа. */}
                <span className="flex shrink-0 items-center gap-1">
                  {thinking.map((n) => (
                    <Face key={n} name={n} icon={getAgent(agents, n)?.icon} color={getAgent(agents, n)?.color} size="sm" />
                  ))}
                </span>
                <span className="min-w-0">
                  {thinking.map((n, i) => (
                    <React.Fragment key={n}>
                      {i > 0 && (i === thinking.length - 1 ? ` ${t("feed.and")} ` : ", ")}
                      <Name name={n} onPick={onMention} />
                    </React.Fragment>
                  ))}{" "}
                  {t(thinking.length > 1 ? "feed.thinkingMany" : "feed.thinkingOne")}
                </span>
                <span className="tabular-nums opacity-60">
                  {spent(Math.max(...thinking.map(elapsed)))}
                </span>
              </div>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="ms-[min(22rem,45vw)]" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
