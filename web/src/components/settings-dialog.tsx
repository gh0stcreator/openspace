import * as React from "react"
import { Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { AgentCard } from "@/components/agent-card"
import { ModeCard } from "@/components/mode-card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { api, type Agent, type FullMode, type Settings } from "@/lib/api"

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onApplied: (s: Partial<Settings> & { agents: Record<string, Agent> }) => void
  onModes: (modes: FullMode[]) => void
  onCleared: () => void
  room: string
  human: string
  currentMode?: string
}

/**
 * Настройки пространства по его устройству: кто здесь (участники), как они
 * работают (режимы) и что пространство про задачу знает и помнит.
 * Ничего не «сохраняется» отдельно — всё применяется сразу.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  onApplied,
  onModes,
  onCleared,
  room,
  human,
  currentMode,
}: Props) {
  const [s, setS] = React.useState<Settings | null>(null)
  const [modes, setModes] = React.useState<FullMode[]>([])
  const [busy, setBusy] = React.useState(false)
  const [armed, setArmed] = React.useState(false)
  const [hireName, setHireName] = React.useState("")
  const [hireRole, setHireRole] = React.useState("")
  const [hireEngine, setHireEngine] = React.useState("claude")
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setArmed(false)
    setError("")
    api.settings().then((v) => {
      setS(v)
      // Роль по умолчанию — первая из существующих: пустой select выглядит поломанным.
      setHireRole((r) => (v.roles.some((x) => x.name === r) ? r : (v.roles[0]?.name ?? "")))
    })
    api.modes().then((r) => setModes(r.modes))
  }, [open])

  // Правки текстовых полей не должны бить в сервер на каждую букву.
  const later = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const defer = (key: string, fn: () => void, ms = 600) => {
    clearTimeout(later.current[key])
    later.current[key] = setTimeout(fn, ms)
  }
  React.useEffect(() => () => Object.values(later.current).forEach(clearTimeout), [])

  if (!s) return <Dialog open={open} onOpenChange={onOpenChange} />

  /** Применить настройки разговора: состояние уже обновлено, сервер догоняет. */
  async function apply(next: Settings, now = false) {
    setS(next)
    const send = async () => {
      try {
        const applied = await api.saveSettings({
          agents: next.agents,
          // Настройки всегда несут состав целиком: иначе переименование или
          // удаление оставляет прежнего участника на сервере.
          replaceTeam: true,
          maxAutoTurns: next.maxAutoTurns,
          goal: next.goal,
          catchUp: next.catchUp,
          freeTalk: next.freeTalk,
        })
        onApplied(applied)
      } catch (e) {
        setError((e as Error).message)
      }
    }
    if (now) await send()
    else defer("settings", () => void send())
  }

  const patch = (next: Partial<Settings>) => void apply({ ...s!, ...next })

  async function saveMode(next: FullMode) {
    setModes((prev) => prev.map((m) => (m.name === next.name ? next : m)))
    defer(`mode-${next.name}`, () => {
      void api
        .saveMode(next)
        .then(() => api.modes())
        .then((r) => {
          setModes(r.modes)
          onModes(r.modes)
        })
        .catch((e) => setError((e as Error).message))
    })
  }

  async function copyMode(m: FullMode) {
    let name = `${m.name}-копия`
    for (let i = 2; modes.some((x) => x.name === name); i++) name = `${m.name}-копия-${i}`
    await api.saveMode({ ...m, name, title: `${m.title} (копия)`, slug: `${m.slug}2` })
    const r = await api.modes()
    setModes(r.modes)
    onModes(r.modes)
  }

  async function dropMode(m: FullMode) {
    await api.removeMode(m.name)
    const r = await api.modes()
    setModes(r.modes)
    onModes(r.modes)
  }

  function hire() {
    const name = hireName.trim()
    if (!/^[a-zA-Z0-9_\-Ѐ-ӿ]+$/.test(name)) return setError("ник: буквы, цифры, дефис")
    if (s!.agents[name] || name === human) return setError(`@${name} уже в чате`)
    setHireName("")
    setError("")
    void apply(
      {
        ...s!,
        agents: {
          ...s!.agents,
          [name]: { roleName: hireRole, engine: hireEngine, trust: "safe" } as Agent,
        },
      },
      true
    )
  }

  const people = Object.keys(s.agents)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl"
        /* vh в шкале нет: диалог не должен вылезать за окно */
      >
        <DialogHeader>
          <DialogTitle>Настройки</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="people" className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="people">Участники</TabsTrigger>
            <TabsTrigger value="modes">Режимы</TabsTrigger>
            <TabsTrigger value="space">Пространство</TabsTrigger>
          </TabsList>

          {/* КТО. Состав команды и что каждый умеет. */}
          <TabsContent value="people" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-2">
            <div className="flex flex-col gap-2">
              {Object.entries(s.agents).map(([name, a]) => (
                <AgentCard
                  key={name}
                  name={name}
                  agent={a}
                  settings={s}
                  onChange={(p) => patch({ agents: { ...s.agents, [name]: { ...a, ...p } } })}
                  onRename={(next) => {
                    if (!next || next === name || s.agents[next]) return
                    const agents: Record<string, Agent> = {}
                    // Порядок участников сохраняем: он виден в шапке.
                    for (const [k, v] of Object.entries(s.agents)) agents[k === name ? next : k] = v
                    patch({ agents })
                  }}
                  onCopy={() => {
                    let next = `${name}-2`
                    for (let i = 3; s.agents[next]; i++) next = `${name}-${i}`
                    const agents: Record<string, Agent> = {}
                    for (const [k, v] of Object.entries(s.agents)) {
                      agents[k] = v
                      if (k === name) agents[next] = { ...v }
                    }
                    patch({ agents })
                  }}
                  onFire={() => {
                    const agents = { ...s.agents }
                    delete agents[name]
                    if (!Object.keys(agents).length) return setError("последнего убрать нельзя")
                    patch({ agents })
                  }}
                />
              ))}
            </div>

            <div className="mt-3 flex items-end gap-2">
              <Field className="flex-1">
                <FieldLabel htmlFor="hire">Позвать ещё</FieldLabel>
                <Input
                  id="hire"
                  value={hireName}
                  placeholder="имя участника"
                  onChange={(e) => setHireName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && hire()}
                />
              </Field>
              <Field className="w-44">
                <FieldLabel>Роль</FieldLabel>
                <Select value={hireRole} onValueChange={setHireRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {s.roles.map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="w-32">
                <FieldLabel>Движок</FieldLabel>
                <Select value={hireEngine} onValueChange={setHireEngine}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {s.engines.map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button onClick={hire} disabled={busy}>
                <Plus /> Позвать
              </Button>
            </div>
          </TabsContent>

          {/* КАК. Правила поведения поверх участников. */}
          <TabsContent value="modes" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-2">
            <div className="flex flex-col gap-2">
              {modes.map((m) => (
                <ModeCard
                  key={m.name}
                  mode={m}
                  participants={people}
                  roles={s.roles}
                  current={(currentMode ?? "свободный") === m.name}
                  fixed={m.name === "свободный"}
                  onChange={saveMode}
                  onCopy={() => void copyMode(m)}
                  onRemove={() => void dropMode(m)}
                />
              ))}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() =>
                void copyMode({
                  name: "новый-режим",
                  title: "Новый режим",
                  short: "Новый",
                  slug: "custom",
                  brief: "",
                  for: "",
                  icon: "list-ordered",
                  needs: [],
                  missing: [],
                  steps: [{ name: "разговор", who: "все", hear: true, until: "все ответят", prompt: "" }],
                })
              }
            >
              <Plus /> Создать режим
            </Button>
          </TabsContent>

          {/* ГДЕ. Общий контекст задачи и то, что пространство помнит. */}
          <TabsContent value="space" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-2">
            <div className="grid gap-5">
              <Field>
                <FieldLabel htmlFor="goal">Зачем мы здесь — общая цель, её видят все</FieldLabel>
                <Textarea
                  id="goal"
                  rows={2}
                  value={s.goal ?? ""}
                  placeholder="Собрать к пятнице спецификацию мегаменю, по которой можно писать код"
                  onChange={(e) => patch({ goal: e.target.value })}
                />
              </Field>

              <Label className="flex items-start justify-between gap-3 font-normal">
                <span className="grid gap-0.5">
                  Могут продолжать разговор между собой
                  <span className="text-muted-foreground text-sm">Иначе после ответа ждут вас</span>
                </span>
                <Switch checked={s.freeTalk} onCheckedChange={(v) => patch({ freeTalk: v })} />
              </Label>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="turns">Ходов подряд без вас, потом пауза</FieldLabel>
                  <Input
                    id="turns"
                    type="number"
                    min={1}
                    max={100}
                    value={s.maxAutoTurns}
                    onChange={(e) => patch({ maxAutoTurns: Number(e.target.value) })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="catch">Сколько реплик читает новый участник</FieldLabel>
                <Input
                  id="catch"
                  type="number"
                  min={1}
                  max={500}
                  value={s.catchUp}
                    onChange={(e) => patch({ catchUp: Number(e.target.value) })}
                  />
                </Field>
              </div>

              <Item variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>Сбросить память участников</ItemTitle>
                  <ItemDescription>
                    У каждого своя память о разговоре, и она копится. Сброс её стирает: дальше они
                    читают только хвост ленты. Сообщения в чате остаются
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      await api.reset(room)
                      setBusy(false)
                      onOpenChange(false)
                    }}
                  >
                    <RotateCcw />
                    Сбросить
                  </Button>
                </ItemActions>
              </Item>

              <Item variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>Очистить чат</ItemTitle>
                  <ItemDescription>
                    Сообщения уйдут из ленты, участники забудут разговор. Файл истории сохранится в
                    rooms/ с отметкой времени
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant={armed ? "destructive" : "ghost"}
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      if (!armed) {
                        setArmed(true)
                        setTimeout(() => setArmed(false), 4000)
                        return
                      }
                      setArmed(false)
                      await api.clear(room)
                      onCleared()
                      onOpenChange(false)
                    }}
                  >
                    {armed ? <TriangleAlert /> : <Trash2 />}
                    {armed ? "Точно? Нажми ещё раз" : "Очистить"}
                  </Button>
                </ItemActions>
              </Item>
            </div>
          </TabsContent>
        </Tabs>

        {error && <span className="text-destructive text-sm">{error}</span>}
      </DialogContent>
    </Dialog>
  )
}
