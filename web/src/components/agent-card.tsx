import * as React from "react"
import { Copy, MoreHorizontal, Settings as Gear, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
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
import { Switch } from "@/components/ui/switch"
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
  /** Амплуа, выбранное поверх правленого голоса: сначала предупреждаем, потом заменяем. */
  const [swap, setSwap] = React.useState<string | null>(null)

  /** Правленый голос — это отдельное, безымянное амплуа: в списке он так и стоит. */
  const custom = agent.mannerCustom !== null
  // Выбор амплуа не пишет его текст в участника, а только называет амплуа: текст берётся
  // из файла. Поэтому «вернуть как было» — это просто выбрать базовое амплуа в списке.
  const wear = (n: string) => {
    const a = settings.archetypes.find((x) => x.name === n)
    onChange({ archetype: a?.title ?? n, manner: "", mannerCustom: null })
  }

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
          {/* Рядом с ником — чем думает. Амплуа отсюда убрано: оно живёт в карточке,
              рядом с полем голоса, которым и управляет, а здесь было лишним словом. */}
          <div className="text-sm font-medium capitalize">
            {name}
            <span className="text-muted-foreground font-normal normal-case">
              {" · "}
              {brain(agent)}
            </span>
          </div>
          <div className="text-muted-foreground truncate text-sm">
            {typo(pick(lang, agent.brief, agent.briefEn))}
          </div>
        </button>

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
          {/* Колонки одинаковой ширины: пара полей в ряд читается как пара, только
              когда они равны — иначе правое выглядит важнее левого без причины. */}
          <div className="grid gap-3 sm:grid-cols-2">
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

          {/* Амплуа — готовый голос: выбор кладёт его текст целиком в поле ниже,
              дальше он правится руками. Роль отвечает на «что делает», амплуа — на
              «как звучит», и одно к другому не привязано намертво. Модель рядом:
              обе строки про то, как участник звучит и чем думает. */}
          <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>{t("card.archetype")}</FieldLabel>
            <Select
              value={custom ? "—" : agent.archetype.toLowerCase()}
              onValueChange={(v) => (custom ? setSwap(v) : wear(v))}
            >
              <SelectTrigger>
                <SelectValue>{custom ? t("card.archetypeCustom") : agent.archetype}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {custom && (
                  <SelectItem value="—">
                    <span className="grid gap-0.5">
                      {t("card.archetypeCustom")}
                      <span className="text-muted-foreground text-xs">{t("card.archetypeCustomNote")}</span>
                    </span>
                  </SelectItem>
                )}
                {settings.archetypes.map((a) => (
                  <SelectItem key={a.name} value={a.name}>
                    <span className="grid gap-0.5">
                      {pick(lang, a.title, a.titleEn)}
                      <span className="text-muted-foreground text-xs">{pick(lang, a.brief, a.briefEn)}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <AlertDialog open={swap !== null} onOpenChange={(o) => !o && setSwap(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("card.archetypeSwapTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("card.archetypeSwapBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("space.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (swap) wear(swap)
                      setSwap(null)
                    }}
                  >
                    {t("card.archetypeSwapOk")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Field>

            <Field>
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

          {/* Текста роли в карточке нет: роль — файл в roles/, там её и правят.
              Поле, заменявшее её целиком, стирало характер одной строкой и было
              третьим способом сказать то же, что закон пространства или новая роль. */}
          <Field>
            <FieldLabel htmlFor={`manner-${name}`}>{t("card.manner")}</FieldLabel>
            <Textarea
              id={`manner-${name}`}
              rows={8}
              value={agent.manner ?? ""}
              placeholder={t("card.mannerHint")}
              className="max-h-72 text-xs leading-relaxed"
              onChange={(e) => onChange({ manner: e.target.value, mannerCustom: e.target.value })}
            />
          </Field>

          <div>
            <Field>
              <FieldLabel>{t("card.skills")}</FieldLabel>
              {/* Умения выдают поштучно: выдача и есть разрешение. Прежний «уровень
                  доступа» отвечал сразу на два вопроса — что умеет и что позволено. */}
              <div className="divide-y rounded-lg border">
                {settings.skillList.map((k) => (
                  <Label
                    key={k}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm font-normal"
                  >
                    {t(`skill.${k}` as never)}
                    <Switch
                      checked={agent.skills.includes(k)}
                      onCheckedChange={(v) =>
                        onChange({ skills: v ? [...agent.skills, k] : agent.skills.filter((x) => x !== k) })
                      }
                    />
                  </Label>
                ))}
              </div>
            </Field>
          </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
