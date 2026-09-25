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
import type { FullSpace } from "@/lib/api"

/**
 * Комната — место и тип работы разом: кто здесь живёт, как здесь принято работать
 * и с каким заданием все отвечают на первый вопрос. Участники отвечают на вопрос
 * «кто», комната — на вопрос «где мы и что здесь делают».
 *
 * Шаблон один на все комнаты, включая общую: разница между ними — в составе, укладе
 * и круге, а не в устройстве карточки.
 */

type Props = {
  mode: FullSpace
  onChange: (next: FullSpace) => void
  onCopy: () => void
  onRemove: () => void
  /** Общую комнату можно править и дублировать, но не удалять. */
  fixed?: boolean
  current?: boolean
}

export function SpaceCard({
  mode,
  onChange,
  onCopy,
  onRemove,
  fixed,
  current,
}: Props) {
  const { lang, t } = useLang()
  const [open, setOpen] = React.useState(false)
  /** Уклад правится локально и уезжает на сервер, когда поле теряет фокус:
   *  сохранение на каждую букву переписывало бы файл комнаты посреди набора. */
  const [draft, setDraft] = React.useState(mode.laws)
  React.useEffect(() => setDraft(mode.laws), [mode.laws])
  const patch = (p: Partial<FullSpace>) => onChange({ ...mode, ...p })

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

        {current && <Badge variant="secondary">{t("space.current")}</Badge>}

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
                    <AlertDialogTitle>{t("space.deleteTitle", { name: mode.title })}</AlertDialogTitle>
                    <AlertDialogDescription>{t("space.deleteBody")}</AlertDialogDescription>
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
          {/* Что делает комнату комнатой: кто здесь живёт, с каким заданием отвечают
              на первый вопрос и как здесь принято работать. Три коротких поля вместо
              полотна шагов: устройство разговора больше не нужно держать в голове. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <Tooltip>
                <TooltipTrigger asChild>
                  <FieldLabel htmlFor={`cast-${mode.name}`} className="cursor-help">
                    {t("space.cast")}
                  </FieldLabel>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">{t("space.castNote")}</TooltipContent>
              </Tooltip>
              <Input
                id={`cast-${mode.name}`}
                value={mode.cast}
                placeholder={t("space.castHint")}
                className="font-mono text-xs"
                onChange={(e) => patch({ cast: e.target.value })}
              />
            </Field>
            <Field>
              <Tooltip>
                <TooltipTrigger asChild>
                  <FieldLabel htmlFor={`duty-${mode.name}`} className="cursor-help">
                    {t("space.duty")}
                  </FieldLabel>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">{t("space.dutyNote")}</TooltipContent>
              </Tooltip>
              <Input
                id={`duty-${mode.name}`}
                value={mode.duty}
                placeholder={t("space.dutyHint")}
                className="font-mono text-xs"
                onChange={(e) => patch({ duty: e.target.value })}
              />
            </Field>
          </div>

          <Field>
            <Tooltip>
              <TooltipTrigger asChild>
                <FieldLabel htmlFor={`circle-${mode.name}`} className="cursor-help">
                  {t("space.circleField")}
                </FieldLabel>
              </TooltipTrigger>
              <TooltipContent className="max-w-80">{t("space.circleNote")}</TooltipContent>
            </Tooltip>
            <Textarea
              id={`circle-${mode.name}`}
              rows={3}
              value={mode.circle}
              placeholder={t("space.circleHint")}
              className="text-xs leading-relaxed"
              onChange={(e) => patch({ circle: e.target.value })}
            />
          </Field>

          <Field>
            <Tooltip>
              <TooltipTrigger asChild>
                <FieldLabel htmlFor={`laws-${mode.name}`} className="cursor-help">
                  {t("space.order")}
                </FieldLabel>
              </TooltipTrigger>
              <TooltipContent className="max-w-80">{t("space.orderNote")}</TooltipContent>
            </Tooltip>
            <Textarea
              id={`laws-${mode.name}`}
              rows={6}
              value={draft}
              className="max-h-56 text-xs leading-relaxed"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== mode.laws && patch({ laws: draft })}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
            <Field>
              <FieldLabel htmlFor={`title-${mode.name}`}>{t("space.name")}</FieldLabel>
              <Input
                id={`title-${mode.name}`}
                value={mode.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`for-${mode.name}`}>{t("space.for")}</FieldLabel>
              <Input
                id={`for-${mode.name}`}
                value={mode.for}
                placeholder={t("space.forHint")}
                onChange={(e) => patch({ for: e.target.value })}
              />
            </Field>
            <Field className="sm:w-28">
              <FieldLabel htmlFor={`slug-${mode.name}`}>{t("space.slug")}</FieldLabel>
              <Input
                id={`slug-${mode.name}`}
                value={mode.slug}
                placeholder={t("space.slugHint")}
                className="font-mono"
                onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
              />
            </Field>
          </div>

          {/* Комната без регламента: круг в ней не заводится, ходы идут как в общей.
              Нужна там, где важно не как работают, а кем участники выходят. */}
          <Label className="hover:bg-accent/50 -mx-2 flex items-center gap-3 rounded-md p-2 font-normal">
            <span className="grid flex-1 gap-0.5">
              <span className="font-medium">{t("space.talk")}</span>
              <span className="text-muted-foreground text-sm">{t("space.talkHint")}</span>
            </span>
            <Switch checked={mode.talk} onCheckedChange={(v) => patch({ talk: v })} />
          </Label>

          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
