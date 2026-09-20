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
import { Icon } from "@/components/chat-feed"
import { typo } from "@/lib/typo"
import { useLang, plural, pick } from "@/lib/i18n"
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

/** Кого зовёт шаг: пусто или «все» — всех, иначе список ников. */
function parseWho(who: string) {
  const s = (who ?? "").trim()
  if (ALL.test(s)) return null
  return [...s.matchAll(/@([a-zA-Z0-9_\-Ѐ-ӿ]+)/g)].map((m) => m[1].toLowerCase())
}

function Who({
  step,
  participants,
  onChange,
}: {
  step: Step
  participants: string[]
  onChange: (who: string) => void
}) {
  const { t } = useLang()
  const picked = parseWho(step.who)

  return (
    <div className="grid gap-2">
      <Label className="flex items-center justify-between gap-3 font-normal">
        <span>{t("step.whoAll")}</span>
        <Switch
          checked={picked === null}
          onCheckedChange={(v) => onChange(v ? "все" : `@${participants[0] ?? ""}`)}
        />
      </Label>
      {picked !== null && (
        <div className="flex flex-wrap gap-2">
          {participants.map((n) => {
            const on = picked.includes(n.toLowerCase())
            return (
              <Label
                key={n}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-normal"
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) => {
                    const next = v
                      ? [...picked, n.toLowerCase()]
                      : picked.filter((x) => x !== n.toLowerCase())
                    onChange(next.map((x) => `@${x}`).join(", ") || "все")
                  }}
                />
                @{n}
              </Label>
            )
          })}
        </div>
      )}
    </div>
  )
}

type Props = {
  mode: FullMode
  participants: string[]
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
  onChange,
  onCopy,
  onRemove,
  fixed,
  current,
}: Props) {
  const { lang, t } = useLang()
  const [open, setOpen] = React.useState(false)
  const patch = (p: Partial<FullMode>) => onChange({ ...mode, ...p })
  const patchStep = (i: number, p: Partial<Step>) =>
    patch({ steps: mode.steps.map((s, j) => (i === j ? { ...s, ...p } : s)) })

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <div aria-current={current || undefined}>
      <div className="flex min-h-16 items-center gap-3 py-3">
        <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
          <Icon name={mode.icon} className="size-5" />
        </span>

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
          <div className="flex items-center gap-4">
            {/* Знак и цвет тем же пикером, что у участника: правило «цвет есть — тон,
                нет — нейтрально» живёт в одном месте. */}
            <FacePicker
              name={mode.title}
              icon={mode.icon}
              color={mode.color || null}
              size="md"
              label={t("card.face")}
              onChange={(v) => patch(v.icon !== undefined ? { icon: v.icon } : { color: v.color })}
            />
            <Field className="max-w-44">
              <FieldLabel htmlFor={`slug-${mode.name}`}>{t("mode.slug")}</FieldLabel>
              <Input
                id={`slug-${mode.name}`}
                value={mode.slug}
                placeholder={t("mode.slugHint")}
                onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
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
          </div>

          <div className="grid gap-3">
            <FieldLabel>{t("mode.steps")}</FieldLabel>
            {mode.steps.map((st, i) => (
              <div key={i} className="grid gap-4 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-6 shrink-0 font-mono text-sm">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Input
                    value={st.name}
                    placeholder={t("step.name")}
                    onChange={(e) => patchStep(i, { name: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground shrink-0"
                    aria-label={t("step.remove")}
                    onClick={() => patch({ steps: mode.steps.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </div>

                <div className="grid gap-4 pl-8 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>{t("step.who")}</FieldLabel>
                    <Who step={st} participants={participants} onChange={(who) => patchStep(i, { who })} />
                  </Field>

                  <div className="grid content-start gap-4">
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

                    <Label className="flex items-start justify-between gap-3 font-normal">
                      <span className="grid gap-0.5">
                        {t("step.hear")}
                        <span className="text-muted-foreground text-sm">
                          {t(st.hear ? "step.hearYes" : "step.hearNo")}
                        </span>
                      </span>
                      <Switch checked={st.hear} onCheckedChange={(v) => patchStep(i, { hear: v })} />
                    </Label>
                  </div>
                </div>

                <div className="pl-8">
                  <Field>
                    <FieldLabel>{t("step.prompt")}</FieldLabel>
                    <Textarea
                      rows={3}
                      value={st.prompt}
                      placeholder={t("step.promptHint")}
                      className="font-mono text-xs leading-relaxed"
                      onChange={(e) => patchStep(i, { prompt: e.target.value })}
                    />
                    <FieldDescription>{t("step.promptNote")}</FieldDescription>
                  </Field>
                </div>
              </div>
            ))}

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
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
