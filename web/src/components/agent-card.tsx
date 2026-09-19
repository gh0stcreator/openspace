import * as React from "react"
import { Copy, MoreHorizontal, Settings2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { COLOR_ORDER, Face, Icon, toneVars } from "@/components/chat-feed"
import type { Agent, Settings } from "@/lib/api"

/** Иконки для аватарки — то, чем обычно помечают роль. */
const ICONS = [
  "book-open", "sparkles", "eye", "palette", "settings", "users", "brain", "compass",
  "microscope", "flask-conical", "ruler", "pen-tool", "type", "megaphone", "scale",
  "target", "flag", "rocket", "lightbulb", "shield", "bug", "code", "terminal",
  "git-branch", "database", "globe", "heart", "flame", "music", "coffee", "crown", "gem",
]

/** Модели, которые понимают движки. Пусто — движок берёт свою по умолчанию. */
const MODELS: Record<string, { value: string; label: string }[]> = {
  claude: [
    { value: "", label: "по умолчанию" },
    { value: "opus", label: "Opus — думает дольше и глубже" },
    { value: "sonnet", label: "Sonnet — быстрее и дешевле" },
    { value: "haiku", label: "Haiku — совсем быстрый, для простого" },
  ],
  codex: [
    { value: "", label: "по умолчанию" },
    { value: "gpt-5.4", label: "gpt-5.4" },
    { value: "gpt-6-astra", label: "gpt-6-astra" },
  ],
}

type Props = {
  name: string
  agent: Agent
  settings: Settings
  onChange: (patch: Partial<Agent>) => void
  onRename: (next: string) => void
  onCopy: () => void
  onFire: () => void
}

export function AgentCard({ name, agent, settings, onChange, onRename, onCopy, onFire }: Props) {
  const [open, setOpen] = React.useState(false)
  const [nick, setNick] = React.useState(name)

  return (
    <div className={cn("rounded-lg border transition-colors", !open && "hover:bg-accent/40")}>
      <div className="flex items-center gap-3 p-3">
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="tone-hover shrink-0 rounded-full transition-shadow"
              style={toneVars(agent.color)}
              title="Аватарка и цвет"
            >
              <Face name={name} icon={agent.icon} color={agent.color} size="lg" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2">
            <div className="text-muted-foreground mb-1.5 text-xs">Цвет</div>
            <div className="mb-3 flex flex-wrap gap-1.5 border-b pb-3">
              {COLOR_ORDER.map((c) => (
                <button
                  key={c}
                  title={c}
                  onClick={() => onChange({ color: c })}
                  className={cn(
                    "tone-dot size-6 rounded-full transition-transform hover:scale-110",
                    agent.color === c && "ring-ring ring-offset-popover ring-2 ring-offset-2"
                  )}
                  style={toneVars(c)}
                />
              ))}
            </div>

            <div className="text-muted-foreground mb-1.5 text-xs">Знак</div>
            <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
              {ICONS.map((ic) => (
                <Button
                  key={ic}
                  variant={ic === agent.icon ? "secondary" : "ghost"}
                  size="icon"
                  title={ic}
                  onClick={() => onChange({ icon: ic, iconCustom: ic })}
                >
                  <Icon name={ic} />
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((v) => !v)}>
          <div className="font-medium capitalize">{name}</div>
          <div className="text-muted-foreground truncate text-sm">
            {agent.brief} · {agent.engine}
            {agent.model ? ` · ${agent.model}` : ""}
          </div>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="Ещё">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 p-1.5">
            <DropdownMenuItem className="gap-2 rounded-md px-2 py-2" onClick={() => setOpen((v) => !v)}>
              <Settings2 className="size-4" />
              Настройки
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 rounded-md px-2 py-2" onClick={onCopy}>
              <Copy className="size-4" />
              Дублировать
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" className="gap-2 rounded-md px-2 py-2" onClick={onFire}>
              <Trash2 className="size-4" />
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && (
        <div className="grid gap-5 border-t p-4">
          {/* Сначала кто это и что делает, техническое — ниже. */}
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <Field>
              <FieldLabel htmlFor={`nick-${name}`}>Как обращаться</FieldLabel>
              <Input
                id={`nick-${name}`}
                value={nick}
                onChange={(e) => setNick(e.target.value)}
                onBlur={() => nick !== name && onRename(nick.trim())}
                onKeyDown={(e) => e.key === "Enter" && onRename(nick.trim())}
              />
              <FieldDescription>Это имя вы пишете после собачки</FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Кем работает</FieldLabel>
              <Select
                value={agent.roleName}
                onValueChange={(v) => onChange({ roleName: v, promptCustom: null })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {settings.roles.map((r) => (
                    <SelectItem key={r.name} value={r.name}>
                      {r.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Готовый набор правил поведения</FieldDescription>
            </Field>
          </div>

          <Field>
            <div className="flex items-baseline justify-between gap-2">
              <FieldLabel htmlFor={`prompt-${name}`}>Что делает</FieldLabel>
              {agent.promptCustom && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={() => onChange({ promptCustom: null })}
                >
                  Вернуть как у роли
                </Button>
              )}
            </div>
            <Textarea
              id={`prompt-${name}`}
              rows={8}
              value={agent.promptCustom ?? agent.prompt}
              placeholder="Начинаешь ход с того, что…"
              className="font-mono text-xs leading-relaxed"
              onChange={(e) => onChange({ promptCustom: e.target.value })}
            />
            <FieldDescription>
              {agent.promptCustom ? "Переписано под этого участника" : "Взято у роли — можно переписать"}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`manner-${name}`}>Как говорит</FieldLabel>
            <Textarea
              id={`manner-${name}`}
              rows={3}
              value={agent.manner ?? ""}
              placeholder="Коротко и сухо. Не смягчает формулировки. Любит точные числа."
              onChange={(e) => onChange({ manner: e.target.value })}
            />
            <FieldDescription>Характер и манера речи поверх роли</FieldDescription>
          </Field>

          <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
            <Field>
              <FieldLabel>Что может</FieldLabel>
              <Select value={agent.trust} onValueChange={(v) => onChange({ trust: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="safe">Читать и править файлы</SelectItem>
                  <SelectItem value="full">Ещё и запускать команды</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Движок</FieldLabel>
              <Select value={agent.engine} onValueChange={(v) => onChange({ engine: v, model: null })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {settings.engines.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Модель</FieldLabel>
              <Select
                value={agent.model ?? "default"}
                onValueChange={(v) => onChange({ model: v === "default" ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(MODELS[agent.engine] ?? MODELS.claude).map((m) => (
                    <SelectItem key={m.value || "default"} value={m.value || "default"}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
      )}
    </div>
  )
}
