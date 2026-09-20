import * as React from "react"
import { Copy, MoreHorizontal, Settings, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FacePicker } from "@/components/face-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

import { typo } from "@/lib/typo"
import { useLang, pick } from "@/lib/i18n"
import type { FullMode } from "@/lib/api"

/**
 * Режим — правила поведения над участниками: кто говорит на шаге, слышат ли они
 * друг друга и чем шаг закрывается. Участники отвечают на вопрос «кто», режим —
 * на вопрос «как мы сейчас работаем».
 *
 * Шаблон один на все режимы, включая встроенный «Открытый»: разница между ними —
 * в содержании шагов, а не в устройстве карточки.
 */

type Props = {
  mode: FullMode
  onChange: (next: FullMode) => void
  onCopy: () => void
  onRemove: () => void
  /** Встроенный режим можно править и дублировать, но не удалять. */
  fixed?: boolean
  current?: boolean
}

export function ModeCard({
  mode,
  onChange,
  onCopy,
  onRemove,
  fixed,
  current,
}: Props) {
  const { lang, t } = useLang()
  const [open, setOpen] = React.useState(false)
  /** Раскрыт один шаг за раз: иначе полоса снова превращается в четыре формы подряд. */
  /** Текст шагов правится локально и уезжает на сервер, когда поле теряет фокус:
   *  разбор на каждую букву ломал бы шаг ровно посередине набора. */
  const [draft, setDraft] = React.useState(mode.source)
  React.useEffect(() => setDraft(mode.source), [mode.source])
  const patch = (p: Partial<FullMode>) => onChange({ ...mode, ...p })

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
            {typo(pick(lang, mode.for || mode.brief, mode.forEn || mode.briefEn))}
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
          {/* Шаги — одним полем, как голос участника: разные поля на имя, состав, слух
              и текст прятали главное и заставляли собирать режим по частям. Текст —
              источник правды, сервер разбирает его обратно в шаги. */}
          <Field>
              <Tooltip>
                <TooltipTrigger asChild>
                  <FieldLabel htmlFor={`steps-${mode.name}`} className="cursor-help">
                    {t("mode.steps")}
                  </FieldLabel>
                </TooltipTrigger>
                {/* Разметку шагов объясняем по наведению: тем, кто её уже знает,
                    абзац под полем мешает, а нужен он ровно один раз. */}
                <TooltipContent className="max-w-80">{t("mode.stepsNote")}</TooltipContent>
              </Tooltip>
            <Textarea
              id={`steps-${mode.name}`}
              rows={12}
              value={draft}
              placeholder={t("mode.stepsHint")}
              className="max-h-72 font-mono text-xs leading-relaxed"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== mode.source && patch({ source: draft })}
            />
          </Field>

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

          {/* Режим без регламента: шаги не двигаются, ходы идут как в открытом разговоре.
              Нужен там, где режим меняет не порядок ходов, а то, кем участники в нём выходят. */}
          <Label className="hover:bg-accent/50 -mx-2 flex items-center gap-3 rounded-md p-2 font-normal">
            <span className="grid flex-1 gap-0.5">
              <span className="font-medium">{t("mode.talk")}</span>
              <span className="text-muted-foreground text-sm">{t("mode.talkHint")}</span>
            </span>
            <Switch checked={mode.talk} onCheckedChange={(v) => patch({ talk: v })} />
          </Label>

          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
