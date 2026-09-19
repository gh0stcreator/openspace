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
import { useLang, pick } from "@/lib/i18n"
import { api, type Agent, type FullMode, type Settings } from "@/lib/api"

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onApplied: (s: Partial<Settings> & { agents: Record<string, Agent> }) => void
  onModes: (modes: FullMode[]) => void
  onCleared: () => void
  room: string
  user: string
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
  user,
  currentMode,
}: Props) {
  const { lang, t } = useLang()
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
    if (!/^[a-zA-Z0-9_\-Ѐ-ӿ]+$/.test(name)) return setError(t("hire.badNick"))
    if (s!.agents[name] || name === user) return setError(t("hire.taken", { name }))
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
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="people" className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="people">{t("settings.people")}</TabsTrigger>
            <TabsTrigger value="modes">{t("settings.modes")}</TabsTrigger>
            <TabsTrigger value="space">{t("settings.space")}</TabsTrigger>
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
                    if (!Object.keys(agents).length) return setError(t("hire.lastOne"))
                    patch({ agents })
                  }}
                />
              ))}
            </div>

            {/* На узком экране строка найма складывается в столбик. */}
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_11rem_8rem_auto] sm:items-end">
              <Field>
                <FieldLabel htmlFor="hire">{t("hire.label")}</FieldLabel>
                <Input
                  id="hire"
                  value={hireName}
                  placeholder={t("hire.name")}
                  onChange={(e) => setHireName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && hire()}
                />
              </Field>
              <Field>
                <FieldLabel>{t("hire.role")}</FieldLabel>
                <Select value={hireRole} onValueChange={setHireRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {s.roles.map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {pick(lang, r.title, r.titleEn)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>{t("hire.engine")}</FieldLabel>
                <Select value={hireEngine} onValueChange={setHireEngine}>
                  <SelectTrigger className="capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {s.engines.map((e) => (
                      <SelectItem key={e} value={e} className="capitalize">
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button onClick={hire} disabled={busy}>
                <Plus /> {t("hire.button")}
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
                  titleEn: "",
                  short: "Новый",
                  shortEn: "",
                  slug: "custom",
                  brief: "",
                  briefEn: "",
                  for: "",
                  forEn: "",
                  icon: "list-ordered",
                  needs: [],
                  missing: [],
                  steps: [{ name: "разговор", who: "все", hear: true, until: "все ответят", prompt: "" }],
                })
              }
            >
              <Plus /> {t("mode.new")}
            </Button>
          </TabsContent>

          {/* ГДЕ. Общий контекст задачи и то, что пространство помнит. */}
          <TabsContent value="space" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-2">
            <div className="grid gap-5">
              <Field>
                <FieldLabel htmlFor="goal">{t("space.goal")}</FieldLabel>
                <Textarea
                  id="goal"
                  rows={2}
                  value={s.goal ?? ""}
                  placeholder={t("space.goalHint")}
                  onChange={(e) => patch({ goal: e.target.value })}
                />
              </Field>

              <Label className="flex items-start justify-between gap-3 font-normal">
                <span className="grid gap-0.5">
                  {t("space.freeTalk")}
                  <span className="text-muted-foreground text-sm">{t("space.freeTalkHint")}</span>
                </span>
                <Switch checked={s.freeTalk} onCheckedChange={(v) => patch({ freeTalk: v })} />
              </Label>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="turns">{t("space.turns")}</FieldLabel>
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
                  <FieldLabel htmlFor="catch">{t("space.catchUp")}</FieldLabel>
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
                  <ItemTitle>{t("space.resetTitle")}</ItemTitle>
                  <ItemDescription>{t("space.resetBody")}</ItemDescription>
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
                    {t("space.reset")}
                  </Button>
                </ItemActions>
              </Item>

              <Item variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>{t("space.clearTitle")}</ItemTitle>
                  <ItemDescription>{t("space.clearBody")}</ItemDescription>
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
                    {armed ? t("space.clearArmed") : t("space.clear")}
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
