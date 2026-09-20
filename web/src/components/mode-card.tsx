import * as React from "react"
import { Copy, MoreHorizontal, Plus, Settings, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { FacePicker } from "@/components/face-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

import { cn } from "@/lib/utils"
import { typo } from "@/lib/typo"
import { useLang, plural, pick, type Lang } from "@/lib/i18n"
import type { FullMode, Step } from "@/lib/api"

/**
 * Режим — правила поведения над участниками: кто говорит на шаге, слышат ли они
 * друг друга и чем шаг закрывается. Участники отвечают на вопрос «кто», режим —
 * на вопрос «как мы сейчас работаем».
 *
 * Шаблон один на все режимы, включая встроенный «Открытый»: разница между ними —
 * в содержании шагов, а не в устройстве карточки.
 */

const ALL = /^(все|all)?$/i

/**
 * Кого зовёт шаг, тремя способами: все, носители ролей («роли: скептик, инженер»)
 * или поимённо («@первый, @второй»). Режимы написаны ролями — так они переживают
 * переименование участника, — и редактор обязан это понимать: раньше он знал только
 * ники и молча превращал «роли: скептик» в список ников при первом же касании.
 */
function parseWho(who: string): { kind: "all" } | { kind: "roles" | "names"; list: string[] } {
  const s = (who ?? "").trim()
  if (ALL.test(s)) return { kind: "all" }
  const byRole = s.match(/^рол[ьи]:\s*(.+)$/i)
  if (byRole) {
    return { kind: "roles", list: byRole[1].split(",").map((r) => r.trim().toLowerCase()).filter(Boolean) }
  }
  return { kind: "names", list: [...s.matchAll(/@([a-zA-Z0-9_\-Ѐ-ӿ]+)/g)].map((m) => m[1].toLowerCase()) }
}

const writeWho = (kind: "roles" | "names", list: string[]) =>
  !list.length ? "все" : kind === "roles" ? `роли: ${list.join(", ")}` : list.map((x) => `@${x}`).join(", ")

/** Строка состава для полосы шагов: имена ролей или ники, как в самом шаге. */
function whoLabel(
  who: string,
  roles: { name: string; title: string; titleEn: string }[],
  lang: Lang,
  t: (k: never) => string
) {
  const parsed = parseWho(who)
  if (parsed.kind === "all") return t("step.whoAll" as never)
  if (!parsed.list.length) return t("step.whoAll" as never)
  if (parsed.kind === "names") return parsed.list.map((n) => `@${n}`).join(", ")
  return parsed.list
    .map((n) => {
      const r = roles.find((x) => x.name.toLowerCase() === n)
      return r ? pick(lang, r.title, r.titleEn) : n
    })
    .join(", ")
}

function Who({
  step,
  participants,
  roles,
  onChange,
}: {
  step: Step
  participants: string[]
  roles: { name: string; title: string; titleEn: string }[]
  onChange: (who: string) => void
}) {
  const { lang, t } = useLang()
  const parsed = parseWho(step.who)
  const kind = parsed.kind
  const list = kind === "all" ? [] : parsed.list

  const chips = (
    k: "roles" | "names",
    items: { key: string; label: string }[],
  ) => (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = kind === k && list.includes(it.key)
        return (
          <Label
            key={it.key}
            className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-normal"
          >
            <Checkbox
              checked={on}
              onCheckedChange={(v) => {
                // Переключение между ролями и никами — это смена способа, а не добавка:
                // «роли: скептик, @первый» движок не понимает.
                const base = kind === k ? list : []
                const next = v ? [...base, it.key] : base.filter((x) => x !== it.key)
                onChange(writeWho(k, next))
              }}
            />
            {it.label}
          </Label>
        )
      })}
    </div>
  )

  return (
    <div className="grid gap-2">
      <Label className="flex items-center justify-between gap-3 font-normal">
        <span>{t("step.whoAll")}</span>
        <Switch
          checked={kind === "all"}
          onCheckedChange={(v) => onChange(v ? "все" : writeWho("roles", [roles[0]?.name ?? ""]))}
        />
      </Label>
      {kind !== "all" && (
        <div className="grid gap-2">
          <span className="text-muted-foreground text-sm">{t("step.whoRoles")}</span>
          {chips("roles", roles.map((r) => ({ key: r.name.toLowerCase(), label: pick(lang, r.title, r.titleEn) })))}
          <span className="text-muted-foreground mt-1 text-sm">{t("step.whoNames")}</span>
          {chips("names", participants.map((n) => ({ key: n.toLowerCase(), label: `@${n}` })))}
        </div>
      )}
    </div>
  )
}

type Props = {
  mode: FullMode
  participants: string[]
  roles: { name: string; title: string; titleEn: string }[]
  onChange: (next: FullMode) => void
  onCopy: () => void
  onRemove: () => void
  /** Встроенный режим можно править и дублировать, но не удалять. */
  fixed?: boolean
  current?: boolean
}

export function ModeCard({
  mode,
  participants,
  roles,
  onChange,
  onCopy,
  onRemove,
  fixed,
  current,
}: Props) {
  const { lang, t } = useLang()
  const [open, setOpen] = React.useState(false)
  /** Раскрыт один шаг за раз: иначе полоса снова превращается в четыре формы подряд. */
  const [step, setStep] = React.useState<number | null>(null)
  const patch = (p: Partial<FullMode>) => onChange({ ...mode, ...p })
  const patchStep = (i: number, p: Partial<Step>) =>
    patch({ steps: mode.steps.map((s, j) => (i === j ? { ...s, ...p } : s)) })

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <div aria-current={current || undefined}>
      <div className="flex min-h-16 items-center gap-3 py-3">
        {/* Знак и цвет меняются тем же кружком, что и у участника: одно правило на всех.
            Отдельная строка «цвет и знак» под шапкой была вторым способом сделать то же. */}
        <FacePicker
          name={mode.title}
          icon={mode.icon}
          color={mode.color || null}
          onChange={(v) => patch(v.icon !== undefined ? { icon: v.icon } : { color: v.color })}
        />

        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((v) => !v)}>
          <div className="text-sm font-medium">{pick(lang, mode.title, mode.titleEn)}</div>
          <div className="text-muted-foreground truncate text-sm">
            {typo(pick(lang, mode.for || mode.brief, mode.forEn || mode.briefEn))} · {mode.steps.length}{" "}
            {plural(lang, mode.steps.length, [t("mode.stepOne"), t("mode.stepFew"), t("mode.stepMany")])}
          </div>
        </button>

        {current && <Badge variant="secondary">{t("mode.current")}</Badge>}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={t("card.more")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setOpen((v) => !v)}>
              <Settings />
              {t("card.settings")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopy}>
              <Copy />
              {t("card.duplicate")}
            </DropdownMenuItem>
            {!fixed && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                    <Trash2 />
                    {t("card.delete")}
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("mode.deleteTitle", { name: mode.title })}</AlertDialogTitle>
                    <AlertDialogDescription>{t("mode.deleteBody")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("space.cancel")}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={onRemove}>
                      {t("card.delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Раскрытие анимируем компонентом системы: карточка не прыгает. */}
      <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        <div className="grid gap-5 pt-1 pb-4">
          <div className="grid gap-3">
            <FieldLabel>{t("mode.steps")}</FieldLabel>
            {/* Полоса, а не четыре раскрытые формы подряд: устройство режима — сколько
                шагов, где вслепую, чем каждый закрывается — должно читаться с одного
                взгляда. Текст шага раскрывается по клику, по одному за раз. */}
            <div className="divide-y rounded-lg border">
              {mode.steps.map((st, i) => (
                <div key={i}>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <span className="text-muted-foreground w-5 shrink-0 font-mono text-xs">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <button
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setStep(step === i ? null : i)}
                    >
                      <span className="w-24 shrink-0 truncate text-sm font-medium">{st.name}</span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                        {whoLabel(st.who, roles, lang, t as never)}
                      </span>
                      {/* Вслепую или нет — главное свойство шага, поэтому оно видно всегда. */}
                      <span className={cn("shrink-0 text-xs", st.hear ? "text-muted-foreground" : "text-foreground")}>
                        {t(st.hear ? "step.aloud" : "step.blind")}
                      </span>
                      <span className="text-muted-foreground hidden w-24 shrink-0 text-right text-xs sm:block">
                        {t(/человек/i.test(st.until) ? "step.waitHuman" : "step.waitAll")}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground shrink-0"
                      aria-label={t("step.remove")}
                      onClick={() => {
                        setStep(null)
                        patch({ steps: mode.steps.filter((_, j) => j !== i) })
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  {step === i && (
                    <div className="grid gap-4 border-t px-3 py-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel>{t("step.name")}</FieldLabel>
                          <Input
                            value={st.name}
                            placeholder={t("step.name")}
                            onChange={(e) => patchStep(i, { name: e.target.value })}
                          />
                        </Field>
                        <Field>
                          <FieldLabel>{t("step.until")}</FieldLabel>
                          <Select
                            value={/человек/i.test(st.until) ? "человек" : "все ответят"}
                            onValueChange={(v) => patchStep(i, { until: v })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="все ответят">{t("step.untilAll")}</SelectItem>
                              <SelectItem value="человек">{t("step.untilHuman")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>

                      <Label className="flex items-start justify-between gap-3 font-normal">
                        <span className="grid gap-0.5">
                          {t("step.hear")}
                          <span className="text-muted-foreground text-sm">
                            {t(st.hear ? "step.hearYes" : "step.hearNo")}
                          </span>
                        </span>
                        <Switch checked={st.hear} onCheckedChange={(v) => patchStep(i, { hear: v })} />
                      </Label>

                      <Field>
                        <FieldLabel>{t("step.who")}</FieldLabel>
                        <Who
                          step={st}
                          participants={participants}
                          roles={roles}
                          onChange={(who) => patchStep(i, { who })}
                        />
                      </Field>

                      <Field>
                        <FieldLabel>{t("step.prompt")}</FieldLabel>
                        <Textarea
                          rows={4}
                          value={st.prompt}
                          placeholder={t("step.promptHint")}
                          className="font-mono text-xs leading-relaxed"
                          onChange={(e) => patchStep(i, { prompt: e.target.value })}
                        />
                        <FieldDescription>{t("step.promptNote")}</FieldDescription>
                      </Field>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                patch({
                  steps: [
                    ...mode.steps,
                    { name: "шаг", who: "все", hear: true, until: "все ответят", prompt: "" },
                  ],
                })
              }
            >
              <Plus /> {t("step.add")}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
            <Field>
              <FieldLabel htmlFor={`title-${mode.name}`}>{t("mode.name")}</FieldLabel>
              <Input
                id={`title-${mode.name}`}
                value={mode.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`for-${mode.name}`}>{t("mode.for")}</FieldLabel>
              <Input
                id={`for-${mode.name}`}
                value={mode.for}
                placeholder={t("mode.forHint")}
                onChange={(e) => patch({ for: e.target.value })}
              />
            </Field>
            <Field className="sm:w-28">
              <FieldLabel htmlFor={`slug-${mode.name}`}>{t("mode.slug")}</FieldLabel>
              <Input
                id={`slug-${mode.name}`}
                value={mode.slug}
                placeholder={t("mode.slugHint")}
                className="font-mono"
                onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
              />
            </Field>
          </div>

          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
