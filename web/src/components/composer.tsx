import * as React from "react"
import { ArrowUp, Paperclip, X } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Quote } from "@/components/chat-feed"
import { useLang, pick as label } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { api, type Agent, type FileRef, type Msg } from "@/lib/api"

/** Показывать картинку собой имеет смысл только для картинки. */
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i

type Pending = FileRef & { uploading?: boolean }

type Props = {
  room: string
  agents: Record<string, Agent>
  onError: (text: string) => void
  /** Отданное сервером сообщение: показываем его сразу, не дожидаясь SSE. */
  onSent: (m: Msg) => void
  replyTo: Msg | null
  onCancelReply: () => void
  /** Реплика, которую сейчас правят: её текст в поле, отправка сохраняет правку. */
  editing: Msg | null
  onEdit: (m: Msg | null) => void
  /** Последняя своя реплика — её поднимает стрелка вверх в пустом поле. */
  lastMine?: Msg
  /** Клик по участнику в шапке: {name, nonce} — nonce меняется, чтобы повтор тоже сработал. */
  insert?: { name: string; nonce: number }
  /** Слаг текущего режима: от него зависит, чего поле просит на входе. */
  mode?: string
}

export function Composer({
  room,
  agents,
  onError,
  onSent,
  replyTo,
  onCancelReply,
  editing,
  onEdit,
  lastMine,
  insert,
  mode,
}: Props) {
  const { lang, t } = useLang()
  const [text, setText] = React.useState("")
  const [files, setFiles] = React.useState<Pending[]>([])
  const [mention, setMention] = React.useState<string[]>([])
  const [pick, setPick] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const picker = React.useRef<HTMLInputElement>(null)

  // Себя в подсказке нет: тег будит адресата, а будить себя незачем.
  const names = React.useMemo(() => Object.keys(agents), [agents])
  const ready = files.filter((f) => !f.uploading)
  const canSend = Boolean(text.trim() || ready.length)

  const upload = React.useCallback(
    async (list: FileList | File[]) => {
      for (const file of [...list].slice(0, 10)) {
        const slot: Pending = { name: file.name, size: file.size, url: "", path: "", uploading: true }
        setFiles((f) => [...f, slot])
        try {
          const done = await api.upload(room, file)
          setFiles((f) => f.map((x) => (x === slot ? done : x)))
        } catch (e) {
          setFiles((f) => f.filter((x) => x !== slot))
          onError(t("composer.uploadFailed", { name: file.name, error: (e as Error).message }))
        }
      }
    },
    [room, onError]
  )

  async function send() {
    if (!canSend) return
    const body = text.trim()
    if (editing) {
      if (!body) return
      setText("")
      onEdit(null)
      try {
        if (body !== editing.text) onSent((await api.edit(room, editing.seq, body)).edit)
      } catch (e) {
        setText(body)
        onEdit(editing)
        onError(t("composer.editFailed", { error: (e as Error).message }))
      }
      return
    }
    const attached = ready
    setText("")
    setFiles([])
    try {
      const { message } = await api.send(room, body, attached, replyTo?.seq)
      onSent(message)
      onCancelReply()
    } catch (e) {
      setText(body) // не теряем ни набранное,
      setFiles(attached) // ни уже загруженные файлы
      onError(t("composer.sendFailed", { error: (e as Error).message }))
    }
  }

  function onType(value: string, caret: number) {
    setText(value)
    const m = value.slice(0, caret).match(/(?:^|\s)@([a-zA-Z0-9_\-Ѐ-ӿ]*)$/)
    if (!m) return setMention([])
    const q = m[1].toLowerCase()
    setMention(names.filter((n) => n.toLowerCase().startsWith(q)))
    setPick(0)
  }

  function choose(name: string) {
    const el = ref.current
    if (!el) return
    const caret = el.selectionStart
    const before = text.slice(0, caret).replace(/@[a-zA-Z0-9_\-Ѐ-ӿ]*$/, `@${name} `)
    setText(before + text.slice(caret))
    setMention([])
    queueMicrotask(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = before.length
    })
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.length) {
      if (e.key === "ArrowDown") return (e.preventDefault(), setPick((p) => (p + 1) % mention.length))
      if (e.key === "ArrowUp")
        return (e.preventDefault(), setPick((p) => (p - 1 + mention.length) % mention.length))
      if (e.key === "Tab" || e.key === "Enter") return (e.preventDefault(), choose(mention[pick]))
      if (e.key === "Escape") return setMention([])
    }
    if (e.key === "Escape" && editing) return cancelEdit()
    if (e.key === "Escape" && replyTo) return onCancelReply()
    // Стрелка вверх в пустом поле поднимает последнюю свою реплику, как в мессенджерах.
    if (e.key === "ArrowUp" && !text && !editing && lastMine) {
      e.preventDefault()
      return onEdit(lastMine)
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  // Выбрал реплику для ответа — значит, сейчас будешь писать: курсор уже в поле.
  React.useEffect(() => {
    if (replyTo) ref.current?.focus()
  }, [replyTo])

  // Правка: текст реплики встаёт в поле, курсор — в конец.
  React.useEffect(() => {
    if (!editing) return
    setText(editing.text)
    queueMicrotask(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.selectionStart = el.selectionEnd = el.value.length
    })
  }, [editing])

  function cancelEdit() {
    setText("")
    onEdit(null)
  }

  React.useEffect(() => {
    if (!insert?.name) return
    setText((t) => {
      const tag = `@${insert.name} `
      if (t.includes(`@${insert.name}`)) return t // второй раз то же имя не дублируем
      return t ? `${t.replace(/\s*$/, "")} ${tag}` : tag
    })
    ref.current?.focus()
  }, [insert])

  // Перетаскивание на всё окно — файл можно бросить куда угодно.
  React.useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return
      depth += 1
      setDragging(true)
    }
    const leave = () => {
      if (--depth <= 0) setDragging(false)
    }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files)
    }
    addEventListener("dragenter", enter)
    addEventListener("dragleave", leave)
    addEventListener("dragover", over)
    addEventListener("drop", drop)
    return () => {
      removeEventListener("dragenter", enter)
      removeEventListener("dragleave", leave)
      removeEventListener("dragover", over)
      removeEventListener("drop", drop)
    }
  }, [upload])

  // Плейсхолдер держим в одну строку: иначе поле растянуто под него и прыгает, когда начинаешь
  // писать. Спрашивает он ровно то, с чего начинается выбранный режим: «Какое решение будем
  // проверять?» объясняет вход лучше, чем любая подпись рядом с полем.
  // Отвечая на реплику, поле не должно выглядеть так же, как в покое: подсказка
  // называет адресата, иначе единственный признак ответа — цитата, и её проматывают.
  const hint = replyTo
    ? t("composer.replyTo", { name: replyTo.from })
    : t(`composer.hint.${mode ?? "open"}` as never) || t("composer.placeholder")

  return (
    <div className="bg-background">
      <div className="relative mx-auto w-full max-w-3xl px-4 pt-3 pb-0">
        {mention.length > 0 && (
          <div className="bg-popover absolute bottom-full left-4 z-30 mb-1 min-w-52 rounded-md border p-1 shadow-md">
            {mention.map((n, i) => (
              <button
                key={n}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(n)
                }}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm capitalize ${
                  i === pick ? "bg-accent" : ""
                }`}
              >
                @{n}
                {/* Роль справа — только если она говорит больше, чем ник: у «Инженера»
                    роль «Инженер», и повторять её значит занимать строку ничем. */}
                {agents[n]?.role && agents[n].role.toLowerCase() !== n.toLowerCase() && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    {label(lang, agents[n]?.role, agents[n]?.roleEn)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* С прицепленной цитатой поле подсвечено кольцом: вы отвечаете конкретной
            реплике, и это состояние, которое видно, а не помнится. Кольцо, а не рамка:
            рамка у группы своя, и два правила цвета спорили бы между собой. */}
        <InputGroup className={cn(
              // Радиус больше половины высоты: пока поле в одну строку, это пилюля,
              // а выросло — остаётся крупное скругление, а не капсула на пол-экрана.
              "rounded-3xl",
              (editing || replyTo) && "composer-live"
            )}>
          {/* Кому отвечаем — внутри поля, над строкой ввода: ответ и есть часть того,
              что вы сейчас пишете. Отступ слева подобран так, чтобы строка цитаты
              начиналась ровно там же, где текст в поле: два соседних текста
              в разнобой читаются неряшливо. */}
          {/* Приложенное — внутри поля, над строкой: картинка показывается собой, а не
              именем файла. Про скриншот «image.png» не скажешь, тот ли он, а про картинку
              видно сразу. Всё прочее остаётся строкой со скрепкой. */}
          {files.length > 0 && (
            <InputGroupAddon align="block-start" className="flex-wrap gap-2 px-3 pt-3 pb-1">
              {files.map((f, i) => (
                <span key={f.url || f.name + i} className="group/att relative">
                  {IMAGE.test(f.name) && f.url ? (
                    <img
                      src={f.url}
                      alt={f.name}
                      className="border-border size-20 rounded-lg border object-cover"
                    />
                  ) : (
                    <span className="border-border bg-muted/40 flex h-20 w-32 flex-col justify-end gap-1 rounded-lg border p-2">
                      <Paperclip className="text-muted-foreground size-4" />
                      <span className="truncate text-xs">{f.name}</span>
                    </span>
                  )}
                  {f.uploading && (
                    <span className="bg-background/70 absolute inset-0 flex items-center justify-center rounded-lg">
                      <Spinner className="size-4" />
                    </span>
                  )}
                  {!f.uploading && (
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label={t("composer.removeFile", { name: f.name })}
                      className="absolute -top-2 -right-2 size-6 rounded-full shadow-sm"
                      onClick={() => setFiles((v) => v.filter((x) => x !== f))}
                    >
                      <X />
                    </Button>
                  )}
                </span>
              ))}
            </InputGroupAddon>
          )}

          {(editing || replyTo) && (
            <InputGroupAddon align="block-start" className="pt-2 pr-2 pb-0 pl-5">
              <Quote to={editing ?? replyTo} agents={agents}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t(editing ? "composer.cancelEdit" : "composer.cancelReply")}
                  onClick={editing ? cancelEdit : onCancelReply}
                >
                  <X />
                </Button>
              </Quote>
            </InputGroupAddon>
          )}

          {/* Скрепка, поле и отправка — одной строкой. Своей строкой их держим руками:
              от вставки сверху группа переходит в колонку, и без обёртки они разъехались
              бы тремя этажами. `data-align` — это её же признак «ребёнок занимает ряд»,
              по нему группа и считает свою высоту. */}
          <div data-align="block-end" className="flex w-full items-end">
          <InputGroupAddon align="inline-start" className="self-end pb-1.5 pl-1.5 has-[>button]:ml-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton variant="ghost" size="icon-xs" onClick={() => picker.current?.click()}>
                  <Paperclip />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{t("composer.attach")}</TooltipContent>
            </Tooltip>
          </InputGroupAddon>

          <InputGroupTextarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={hint}
            className="composer-field max-h-40 min-h-9 py-2"
            onChange={(e) => onType(e.target.value, e.target.selectionStart)}
            onKeyDown={onKey}
            onPaste={(e) => {
              const dropped = [...(e.clipboardData?.files ?? [])]
              if (dropped.length) {
                e.preventDefault()
                void upload(dropped)
              }
            }}
          />

          <InputGroupAddon align="inline-end" className="self-end pb-1.5 pr-1.5 has-[>button]:mr-0">
            <InputGroupButton
              variant="default"
              size="icon-xs"
              className="rounded-full"
              disabled={!canSend}
              onClick={() => void send()}
            >
              <ArrowUp />
            </InputGroupButton>
          </InputGroupAddon>
          </div>
        </InputGroup>

        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {dragging && (
        <div className="bg-background/80 fixed inset-0 z-50 grid place-items-center backdrop-blur-sm">
          <div className="border-ring rounded-xl border-2 border-dashed px-14 py-10 text-lg">
            {t("composer.drop")}
          </div>
        </div>
      )}
    </div>
  )
}
