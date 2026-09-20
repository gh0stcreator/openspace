import * as React from "react"
import { Copy, MoreHorizontal, Settings as Gear, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FacePicker } from "@/components/face-picker"
import { useLang, pick, type Key } from "@/lib/i18n"
import { typo } from "@/lib/typo"
import type { Agent, Settings } from "@/lib/api"

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
  /** Только что созданный участник: карточка открыта, чтобы его сразу настроить. */
  autoOpen?: boolean
  onRename: (next: string) => void
  onCopy: () => void
  onFire: () => void
}

const models = (agent: Agent) => MODELS[agent.engine] ?? MODELS.claude

/**
 * Движок и модель — один выбор, а не два: Opus бывает только у claude, GPT только у codex.
 * Двумя полями можно было выставить несовместимую пару и узнать об этом на первом же ходу.
 * В значении они едут вместе, `движок|модель`, и разбираются обратно при сохранении.
 */
const brainValue = (agent: Agent) => `${agent.engine}|${agent.model ?? ""}`

/** Чем участник думает: движок и, если выбрана, конкретная модель. */
const brain = (agent: Agent) => {
  const engine = agent.engine.charAt(0).toUpperCase() + agent.engine.slice(1)
  if (!agent.model) return engine
  const m = models(agent).find((x) => x.value === agent.model)
  return `${engine} ${m?.label ?? agent.model}`
}

export function AgentCard({ name, agent, settings, autoOpen, onChange, onRename, onCopy, onFire }: Props) {
  const { lang, t } = useLang()
  const [open, setOpen] = React.useState(autoOpen ?? false)
  const [nick, setNick] = React.useState(name)

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <div>
      <div className="flex min-h-16 items-center gap-3 py-3">
        <FacePicker
          name={name}
          icon={agent.icon}
          color={agent.color}
          onChange={(p) => onChange(p.icon ? { icon: p.icon, iconCustom: p.icon } : p)}
        />

        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((v) => !v)}>
          <div className="text-sm font-medium capitalize">
            {name}
            {/* Амплуа рядом с ником: иначе шестеро отличаются в списке только иконкой. */}
            {agent.archetype && (
              <span className="text-muted-foreground font-normal normal-case">
                {" · "}
                {pick(lang, agent.archetype, agent.archetypeEn)}
              </span>
            )}
          </div>
          <div className="text-muted-foreground truncate text-sm">
            {typo(pick(lang, agent.brief, agent.briefEn))}
          </div>
        </button>

        <span className="text-muted-foreground/70 hidden w-28 shrink-0 text-right text-xs sm:block">
          {brain(agent)}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={t("card.more")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setOpen((v) => !v)}>
              <Gear />
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
        <div className="grid gap-5 pt-1 pb-4">
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
                onValueChange={(v) => onChange({ roleName: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {settings.roles.map((r) => (
                    <SelectItem key={r.name} value={r.name}>
                      {pick(lang, r.title, r.titleEn)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Текста роли в карточке нет: роль — файл в roles/, там её и правят.
              Поле, заменявшее её целиком, стирало характер одной строкой и было
              третьим способом сказать то же, что закон пространства или новая роль. */}
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
            <Field className="sm:col-span-2">
              <FieldLabel>{t("card.model")}</FieldLabel>
              <Select
                value={brainValue(agent)}
                onValueChange={(v) => {
                  const [engine, model] = v.split("|")
                  onChange({ engine, model: model || null })
                }}
              >
                <SelectTrigger>
                  {/* В строке — только название: пояснение живёт в списке. */}
                  <SelectValue>{brain(agent)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {settings.engines.map((e) => (
                    <SelectGroup key={e}>
                      <SelectLabel className="capitalize">{e}</SelectLabel>
                      {(MODELS[e] ?? []).map((m) => (
                        <SelectItem key={`${e}|${m.value}`} value={`${e}|${m.value}`}>
                          <span className="grid gap-0.5">
                            {m.label || t("model.default")}
                            {m.hint && <span className="text-muted-foreground text-xs">{t(m.hint)}</span>}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
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
