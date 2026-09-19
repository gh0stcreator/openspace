import * as React from "react"
import { ArrowUp, Paperclip, X } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toneVars } from "@/components/chat-feed"
import { typo } from "@/lib/typo"
import { useLang, pick as label } from "@/lib/i18n"
import { api, type Agent, type FileRef, type Msg } from "@/lib/api"

type Pending = FileRef & { uploading?: boolean }

type Props = {
  room: string
  agents: Record<string, Agent>
  human: string
  onError: (text: string) => void
  /** Отданное сервером сообщение: показываем его сразу, не дожидаясь SSE. */
  onSent: (m: Msg) => void
  replyTo: Msg | null
  onCancelReply: () => void
  /** Клик по участнику в шапке: {name, nonce} — nonce меняется, чтобы повтор тоже сработал. */
  insert?: { name: string; nonce: number }
}

export function Composer({ room, agents, human, onError, onSent, replyTo, onCancelReply, insert }: Props) {
  const { lang, t } = useLang()
  const [text, setText] = React.useState("")
  const [files, setFiles] = React.useState<Pending[]>([])
  const [mention, setMention] = React.useState<string[]>([])
  const [pick, setPick] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const picker = React.useRef<HTMLInputElement>(null)

  const names = React.useMemo(() => [...Object.keys(agents), human], [agents, human])
  const replyColor = replyTo
    ? replyTo.from === human
      ? "creator"
      : (agents[replyTo.from]?.color ?? null)
    : null
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
    if (e.key === "Escape" && replyTo) return onCancelReply()
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
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

  // Плейсхолдер держим в одну строку: иначе поле растянуто под него и прыгает, когда начинаешь писать.
  const hint = t("composer.placeholder")

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
                <span className="text-muted-foreground ml-auto text-xs">
                  {n === human ? t("composer.you") : label(lang, agents[n]?.role, agents[n]?.roleEn)}
                </span>
              </button>
            ))}
          </div>
        )}

        {replyTo && (
          <div className="mb-2 flex items-center gap-2">
            <div
              className="tone-name min-w-0 flex-1 border-l-2 border-current pl-2"
              style={toneVars(replyColor)}
            >
              <div className="text-sm font-medium capitalize">
                {replyTo.from === human ? t("composer.mine") : replyTo.from}
              </div>
              <div className="text-muted-foreground truncate text-sm">
                {typo(replyTo.text) || t("composer.file")}
              </div>
            </div>
            <button
              onClick={onCancelReply}
              aria-label={t("composer.cancelReply")}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {files.length > 0 && (
          <AttachmentGroup className="mb-2">
            {files.map((f, i) => (
              <Attachment key={f.url || f.name + i}>
                <AttachmentMedia>
                  {f.uploading ? <Spinner className="size-4" /> : <Paperclip className="size-4" />}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{f.name}</AttachmentTitle>
                </AttachmentContent>
                {!f.uploading && (
                  <AttachmentActions>
                    <AttachmentAction onClick={() => setFiles((v) => v.filter((x) => x !== f))}>
                      <X />
                    </AttachmentAction>
                  </AttachmentActions>
                )}
              </Attachment>
            ))}
          </AttachmentGroup>
        )}

        <InputGroup className="rounded-2xl">
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
            className="max-h-40 min-h-9 py-2 text-base"
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
