import * as React from "react"
import { Copy, MoreHorizontal, Plus, Settings2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Icon } from "@/components/chat-feed"
import { cn } from "@/lib/utils"
import { typo } from "@/lib/typo"
import type { FullMode, Step } from "@/lib/api"

/**
 * Режим — правила поведения над участниками: кто говорит на шаге, слышат ли
 * они друг друга и чем шаг закрывается. Участники отвечают на вопрос «кто»,
 * режим — на вопрос «как мы сейчас работаем».
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
  const picked = parseWho(step.who)

  return (
    <div className="grid gap-2">
      <Label className="flex items-center justify-between gap-3 font-normal">
        <span>Говорят все</span>
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
  roles: { name: string; title: string }[]
  onChange: (next: FullMode) => void
  onCopy: () => void
  onRemove: () => void
  /** Для встроенного режима шагов нет — вместо них правила свободного разговора. */
  rules?: React.ReactNode
  current?: boolean
}

export function ModeCard({
  mode,
  participants,
  roles,
  onChange,
  onCopy,
  onRemove,
  rules,
  current,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const patch = (p: Partial<FullMode>) => onChange({ ...mode, ...p })
  const patchStep = (i: number, p: Partial<Step>) =>
    patch({ steps: mode.steps.map((s, j) => (i === j ? { ...s, ...p } : s)) })

  return (
    <div className={cn("rounded-lg border transition-colors", !open && "hover:bg-accent/40")}>
      <div className="flex items-center gap-3 p-3">
        <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
          <Icon name={mode.icon} className="size-5" />
        </span>

        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((v) => !v)}>
          <div className="flex items-center gap-2 font-medium">
            {mode.title}
            {current && <span className="text-muted-foreground text-sm font-normal">— сейчас</span>}
          </div>
          <div className="text-muted-foreground truncate text-sm">
            {typo(mode.for || mode.brief)}
            {rules ? "" : ` · ${mode.steps.length} ${plural(mode.steps.length)}`}
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
            {!rules && (
              <DropdownMenuItem
                variant="destructive"
                className="gap-2 rounded-md px-2 py-2"
                onClick={onRemove}
              >
                <Trash2 className="size-4" />
                Удалить
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && (
        <div className="grid gap-5 border-t p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <Field>
              <FieldLabel htmlFor={`title-${mode.name}`}>Название</FieldLabel>
              <Input
                id={`title-${mode.name}`}
                value={mode.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
              <FieldDescription>Так режим выбирают в меню</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`for-${mode.name}`}>Для чего</FieldLabel>
              <Input
                id={`for-${mode.name}`}
                value={mode.for}
                placeholder="Проверить решение до того, как его проверит жизнь"
                onChange={(e) => patch({ for: e.target.value })}
              />
              <FieldDescription>Задача, ради которой его включают</FieldDescription>
            </Field>
          </div>

          {rules ?? (
            <>
              <Field>
                <FieldLabel>Без кого не работает</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {roles.map((r) => {
                    const on = mode.needs.some((n) => n.toLowerCase() === r.name.toLowerCase())
                    return (
                      <Label
                        key={r.name}
                        className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-normal"
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(v) =>
                            patch({
                              needs: v
                                ? [...mode.needs, r.name]
                                : mode.needs.filter((n) => n.toLowerCase() !== r.name.toLowerCase()),
                            })
                          }
                        />
                        {r.title}
                      </Label>
                    )
                  })}
                </div>
                <FieldDescription>
                  Если такой роли нет в команде, при выборе режима это видно заранее
                </FieldDescription>
              </Field>

              <div className="grid gap-3">
                <FieldLabel>Шаги</FieldLabel>
                {mode.steps.map((st, i) => (
                  <div key={i} className="grid gap-4 rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-6 shrink-0 font-mono text-sm">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <Input
                        value={st.name}
                        placeholder="название шага"
                        onChange={(e) => patchStep(i, { name: e.target.value })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground shrink-0"
                        aria-label="Убрать шаг"
                        onClick={() => patch({ steps: mode.steps.filter((_, j) => j !== i) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>

                    <div className="grid gap-4 pl-8 sm:grid-cols-2">
                      <Field>
                        <FieldLabel>Кто говорит</FieldLabel>
                        <Who
                          step={st}
                          participants={participants}
                          onChange={(who) => patchStep(i, { who })}
                        />
                      </Field>

                      <div className="grid content-start gap-4">
                        <Field>
                          <FieldLabel>Чем шаг закрывается</FieldLabel>
                          <Select
                            value={/человек/i.test(st.until) ? "человек" : "все ответят"}
                            onValueChange={(v) => patchStep(i, { until: v })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="все ответят">Когда все ответили</SelectItem>
                              <SelectItem value="человек">Когда ответили вы</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>

                        <Label className="flex items-start justify-between gap-3 font-normal">
                          <span className="grid gap-0.5">
                            Слышат друг друга
                            <span className="text-muted-foreground text-sm">
                              {typo(
                                st.hear
                                  ? "Отвечают по очереди, каждый видит предыдущих"
                                  : "Отвечают вслепую — первый ответ не задаёт остальным рамку"
                              )}
                            </span>
                          </span>
                          <Switch
                            checked={st.hear}
                            onCheckedChange={(v) => patchStep(i, { hear: v })}
                          />
                        </Label>
                      </div>
                    </div>

                    <div className="pl-8">
                      <Field>
                        <FieldLabel>Что они делают на этом шаге</FieldLabel>
                        <Textarea
                          rows={3}
                          value={st.prompt}
                          placeholder="Назови три способа, которыми это сломается в первый месяц"
                          className="font-mono text-xs leading-relaxed"
                          onChange={(e) => patchStep(i, { prompt: e.target.value })}
                        />
                        <FieldDescription>Это добавляется к их роли на время шага</FieldDescription>
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
                  <Plus /> Добавить шаг
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const plural = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? "шаг" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "шага" : "шагов"
