import * as React from "react"
import { Copy, MoreHorizontal, Settings2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { COLOR_ORDER, Face, Icon, toneVars } from "@/components/chat-feed"
import { useLang, type Key } from "@/lib/i18n"
import type { Agent, Settings } from "@/lib/api"

/** Иконки для аватарки — то, чем обычно помечают роль. */
const ICONS = [
  "book-open", "sparkles", "eye", "palette", "settings", "users", "brain", "compass",
  "microscope", "flask-conical", "ruler", "pen-tool", "type", "megaphone", "scale",
  "target", "flag", "rocket", "lightbulb", "shield", "bug", "code", "terminal",
  "git-branch", "database", "globe", "heart", "flame", "music", "coffee", "crown", "gem",
]

/** Модели, которые понимают движки. Пустое значение — движок берёт свою по умолчанию. */
const MODELS: Record<string, { value: string; label: string; hint?: Key }[]> = {
  claude: [
    { value: "", label: "", hint: "model.defaultHint" },
    { value: "opus", label: "Opus 5", hint: "model.opus" },
    { value: "fable", label: "Fable 5.1", hint: "model.fable" },
    { value: "sonnet", label: "Sonnet 5", hint: "model.sonnet" },
    { value: "haiku", label: "Haiku 4.5", hint: "model.haiku" },
  ],
  codex: [
    { value: "", label: "", hint: "model.defaultHint" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-6-astra", label: "GPT-6 Astra" },
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

const models = (agent: Agent) => MODELS[agent.engine] ?? MODELS.claude

/** Чем участник думает: движок и, если выбрана, конкретная модель. */
const brain = (agent: Agent) => {
  const engine = agent.engine.charAt(0).toUpperCase() + agent.engine.slice(1)
  if (!agent.model) return engine
  const m = models(agent).find((x) => x.value === agent.model)
  return `${engine} ${m?.label ?? agent.model}`
}

export function AgentCard({ name, agent, settings, onChange, onRename, onCopy, onFire }: Props) {
  const { t } = useLang()
  const [open, setOpen] = React.useState(false)
  const [nick, setNick] = React.useState(name)

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <div className={cn("rounded-lg border transition-colors", !open && "hover:bg-accent/40")}>
      <div className="flex items-center gap-3 p-3">
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="tone-hover shrink-0 rounded-full transition-shadow"
              style={toneVars(agent.color)}
              title={t("card.face")}
            >
              <Face name={name} icon={agent.icon} color={agent.color} size="lg" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2">
            <div className="text-muted-foreground mb-1.5 text-xs">{t("card.color")}</div>
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

            <div className="text-muted-foreground mb-1.5 text-xs">{t("card.icon")}</div>
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
          <div className="flex items-baseline gap-2">
            <span className="font-medium capitalize">{name}</span>
            {/* Движок и модель — техническая пометка, поэтому моноширинной и тише имени. */}
            <span className="text-muted-foreground/70 truncate font-mono text-xs">{brain(agent)}</span>
          </div>
          <div className="text-muted-foreground truncate text-sm">{agent.brief}</div>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={t("card.more")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setOpen((v) => !v)}>
              <Settings2 />
              {t("card.settings")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopy}>
              <Copy />
              {t("card.duplicate")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onFire}>
              <Trash2 />
              {t("card.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Раскрытие анимируем компонентом системы: карточка не прыгает. */}
      <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        <div className="grid gap-5 border-t p-4">
          {/* Сначала кто это и что делает, техническое — ниже. */}
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <Field>
              <FieldLabel htmlFor={`nick-${name}`}>{t("card.nick")}</FieldLabel>
              <Input
                id={`nick-${name}`}
                value={nick}
                onChange={(e) => setNick(e.target.value)}
                onBlur={() => nick !== name && onRename(nick.trim())}
                onKeyDown={(e) => e.key === "Enter" && onRename(nick.trim())}
              />
            </Field>

            <Field>
              <FieldLabel>{t("card.role")}</FieldLabel>
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
            </Field>
          </div>

          <Field>
            <div className="flex items-baseline justify-between gap-2">
              <FieldLabel htmlFor={`prompt-${name}`}>{t("card.prompt")}</FieldLabel>
              {agent.promptCustom && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={() => onChange({ promptCustom: null })}
                >
                  {t("card.promptReset")}
                </Button>
              )}
            </div>
            <Textarea
              id={`prompt-${name}`}
              rows={8}
              value={agent.promptCustom ?? agent.prompt}
              placeholder={t("card.promptHint")}
              className="font-mono text-xs leading-relaxed"
              onChange={(e) => onChange({ promptCustom: e.target.value })}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`manner-${name}`}>{t("card.manner")}</FieldLabel>
            <Textarea
              id={`manner-${name}`}
              rows={3}
              value={agent.manner ?? ""}
              placeholder={t("card.mannerHint")}
              onChange={(e) => onChange({ manner: e.target.value })}
            />
            
          </Field>

          <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
            <Field>
              <FieldLabel>{t("card.trust")}</FieldLabel>
              <Select value={agent.trust} onValueChange={(v) => onChange({ trust: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="safe">{t("card.trustSafe")}</SelectItem>
                  <SelectItem value="full">{t("card.trustFull")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("card.engine")}</FieldLabel>
              <Select value={agent.engine} onValueChange={(v) => onChange({ engine: v, model: null })}>
                <SelectTrigger className="capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {settings.engines.map((e) => (
                    <SelectItem key={e} value={e} className="capitalize">
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("card.model")}</FieldLabel>
              <Select
                value={agent.model ?? "default"}
                onValueChange={(v) => onChange({ model: v === "default" ? null : v })}
              >
                <SelectTrigger>
                  {/* В строке — только название: пояснение живёт в списке. */}
                  <SelectValue>
                    {models(agent).find((m) => (m.value || "default") === (agent.model ?? "default"))
                      ?.label || t("model.default")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {models(agent).map((m) => (
                    <SelectItem key={m.value || "default"} value={m.value || "default"}>
                      <span className="grid gap-0.5">
                        {m.label || t("model.default")}
                        {m.hint && <span className="text-muted-foreground text-xs">{t(m.hint)}</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
