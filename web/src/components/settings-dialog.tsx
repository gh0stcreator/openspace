import * as React from "react"
import { Layers, MessageCircle, Plus, RotateCcw, Settings as Gear, Trash2, Users } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { AgentCard } from "@/components/agent-card"
import { FacePicker } from "@/components/face-picker"
import { SpaceCard } from "@/components/space-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { plural, useLang, pick } from "@/lib/i18n"
import { api, type Agent, type FullSpace, type Settings } from "@/lib/api"

/** Ссылки автора: репозиторий и канал. Пустая строка — ссылка не показывается. */
const AUTHOR = {
  repo: "https://github.com/gh0stcreator/openspace",
  channel: "https://t.me/romanticcollection86",
}

/** Знаки канала и гитхаба — свои, не из Lucide: это чужие логотипы, а не иконки
    интерфейса, и в реестре Lucide их больше нет. */
const Octocat = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
    <path
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      fill="currentColor"
    />
  </svg>
)


const Romantic = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 11" fill="none" aria-hidden {...props}>
    <path
      d="M2.65787 0.00473247L6.99442 4.34129L5.32678 6.00893L7.68288 8.36503L13.3853 2.6626L12.7017 1.97897L7.64559 7.03506L6.65606 6.04552L12.7017 -0.000101271L15.3644 2.6626L7.68219 10.3448L0 2.6626L2.65787 0.00473247ZM4.33655 5.0187L5.01397 4.34129L2.65787 1.98518L1.98045 2.6626L4.33655 5.0187Z"
      fill="currentColor"
    />
  </svg>
)

/** Пункт навигации: активное состояние как у меню shadcn, без своих индикаторов. */
const NAV = [
  // Рамку гасим и под курсором: вариант вкладок рисует её на hover, и пункт под мышью
  // выглядел обведённым, а не подсвеченным — читалось как «этот выбран», хотя выбран другой.
  "min-h-9 justify-start rounded-md border-transparent px-3 text-sm hover:border-transparent hover:bg-accent/50 dark:hover:border-transparent",
  // Активное состояние — только заливка. Вариант вкладок рисует свою рамку, и под dark:
  // тоже, поэтому гасим оба правила: иначе поверх заливки видна вторая рамка.
  "data-active:border-transparent data-active:bg-accent data-active:text-accent-foreground",
  "dark:data-active:border-transparent dark:data-active:bg-accent dark:data-active:text-accent-foreground",
  // Фокус — кольцо. Штатная обводка у вкладок волосяная и в упор к тексту: рядом
  // с заливкой активного пункта она читается как вторая рамка.
  // Кольцо — только на неактивном пункте. Radix переводит фокус на вкладку программно,
  // и браузер считает такой фокус клавиатурным: после щелчка кольцо оставалось висеть
  // поверх заливки. Активный пункт и так виден заливкой, второй метки ему не нужно.
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:focus-visible:ring-0",
].join(" ")

/** Заготовка нового режима: один шаг-разговор, дальше человек правит его текстом. */
const BLANK: FullSpace = {
  name: "новая-комната",
  title: "Новая комната",
  titleEn: "",
  who: [],
  faces: [],
  short: "Новая",
  shortEn: "",
  slug: "custom",
  color: "",
  brief: "",
  briefEn: "",
  for: "",
  forEn: "",
  icon: "message-circle",
  needs: [],
  missing: [],
  sides: [],
  talk: false,
  builtin: false,
  cast: "все",
  duty: "",
  tune: "",
  circle: "",
  laws: "",
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onApplied: (s: Partial<Settings> & { agents: Record<string, Agent> }) => void
  onSpaces: (spaces: FullSpace[]) => void
  onCleared: () => void
  room: string
  user: string
  /** Комната, в которой человек сейчас: её карточка помечена. */
  space?: string
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
  onSpaces,
  onCleared,
  room,
  user,
  space,
}: Props) {
  const { lang, setLang, t } = useLang()
  const { theme, setTheme } = useTheme()
  const [s, setS] = React.useState<Settings | null>(null)
  const [modes, setModes] = React.useState<FullSpace[]>([])
  const [hiring, setHiring] = React.useState(false)
  // Созданный участник — заготовка: всё остальное настраивают в его карточке, и она
  // открывается сразу, чтобы не искать его в списке.
  const [created, setCreated] = React.useState("")
  const [hireName, setHireName] = React.useState("")
  const [hireRole, setHireRole] = React.useState("")
  const [hireEngine, setHireEngine] = React.useState("claude")
  const [error, setError] = React.useState("")
  // Сколько записей в памяти пространства: число приходит с настройками, а после
  // стирания обнуляется здесь же — перечитывать всё ради одной цифры незачем.
  const [memory, setMemory] = React.useState(0)
  // Сколько записей знает всё пространство: они едут и в соседние комнаты.
  const [shared, setShared] = React.useState(0)

  React.useEffect(() => {
    if (!open) return
    setError("")
    api.settings(room).then((v) => {
      setS(v)
      setMemory(v.memory ?? 0)
      setShared(v.memoryShared ?? 0)
      // Роль по умолчанию — первая из существующих: пустой select выглядит поломанным.
      setHireRole((r) => (v.roles.some((x) => x.name === r) ? r : (v.roles[0]?.name ?? "")))
    })
    api.spaces().then((r) => setModes(r.spaces))
  }, [open, room])

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
          user: next.user,
          userColor: next.userColor,
          userIcon: next.userIcon,
          agents: next.agents,
          // Настройки всегда несут состав целиком: иначе переименование или
          // удаление оставляет прежнего участника на сервере.
          replaceTeam: true,
          maxAutoTurns: next.maxAutoTurns,
          laws: next.laws,
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

  async function saveMode(next: FullSpace) {
    setModes((prev) => prev.map((m) => (m.name === next.name ? next : m)))
    defer(`space-${next.name}`, () => {
      void api
        .saveSpace(next)
        .then(() => api.spaces())
        .then((r) => {
          setModes(r.spaces)
          onSpaces(r.spaces)
        })
        .catch((e) => setError((e as Error).message))
    })
  }

  async function copyMode(m: FullSpace) {
    let name = `${m.name}-копия`
    for (let i = 2; modes.some((x) => x.name === name); i++) name = `${m.name}-копия-${i}`
    await api.saveSpace({ ...m, name, title: `${m.title} (копия)`, slug: `${m.slug}2` })
    const r = await api.spaces()
    setModes(r.spaces)
    onSpaces(r.spaces)
  }

  async function dropMode(m: FullSpace) {
    await api.removeSpace(m.name)
    const r = await api.spaces()
    setModes(r.spaces)
    onSpaces(r.spaces)
  }

  function hire() {
    const name = hireName.trim()
    if (!/^[a-zA-Z0-9_\-Ѐ-ӿ]+$/.test(name)) return setError(t("hire.badNick"))
    if (s!.agents[name] || name === user) return setError(t("hire.taken", { name }))
    setHireName("")
    setHiring(false)
    setCreated(name)
    setError("")
    void apply(
      {
        ...s!,
        agents: {
          ...s!.agents,
          // Модель по умолчанию объявляет сама роль: Академику нужна большая,
          // Летописцу хватит мелкой. Перебить её можно в карточке.
          [name]: {
            roleName: hireRole,
            engine: hireEngine,
            model: s!.roles.find((r) => r.name === hireRole)?.model || null,
            skills: s!.roles.find((r) => r.name === hireRole)?.skills ?? ["файлы"],
          } as Agent,
        },
      },
      true
    )
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        /* Размер обычного настроечного окна, а не приложения во весь экран. Он постоянный,
           иначе диалог прыгает на каждом разделе; отступы свои у колонки и у страницы. */
        className="flex h-[640px] max-h-[calc(100vh-48px)] w-[900px] max-w-[calc(100vw-48px)] gap-0 overflow-hidden p-0 sm:max-w-[900px]"
      >
        <Tabs orientation="vertical" defaultValue="general" className="min-w-0 flex-1 gap-0">
          {/* Слева — куда идти, справа — сама настройка. Заголовок диалога живёт в колонке,
              потому что он и есть её шапка. */}
          {/* Отступ сверху тот же, что у страницы справа: заголовок колонки и заголовок
                раздела стоят на одной линии, а первый пункт — на одной с первым полем. */}
          <div className="bg-muted/30 flex w-[220px] shrink-0 flex-col border-r px-4 py-6">
            <DialogHeader className="px-3">
              <DialogTitle className="text-lg font-semibold">{t("settings.title")}</DialogTitle>
            </DialogHeader>
            {/* Пункт — кнопка в 36 пикселей с текстом по центру, подпись поля — строка сверху.
                Чтобы их текст лёг на одну линию, список поднят на половину этой разницы. */}
            {/* Отступ подобран так, чтобы первый пункт стоял на одной строке с первым полем
                раздела: колонка и содержимое читаются как один ряд, а не как два списка,
                начатых на разной высоте. */}
            <TabsList className="mt-7 w-full gap-0.5 bg-transparent p-0">
              <TabsTrigger value="general" className={NAV}>
                <Gear /> {t("settings.general")}
              </TabsTrigger>
              <TabsTrigger value="people" className={NAV}>
                <Users /> {t("settings.people")}
              </TabsTrigger>
              <TabsTrigger value="spaces" className={NAV}>
                <MessageCircle /> {t("settings.spaces")}
              </TabsTrigger>
              <TabsTrigger value="space" className={NAV}>
                <Layers /> {t("settings.space")}
              </TabsTrigger>
            </TabsList>

          </div>

          {/* Я. Как меня зовут, как я выгляжу и на каком языке говорит оболочка. */}
          <TabsContent value="general" className="pane-fade flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
            <div className="pane-head">
              <h2 className="text-xl font-semibold">{t("settings.general")}</h2>
            </div>
            <FieldGroup className="max-w-2xl gap-5">
              <Field>
                <FieldLabel>{t("general.face")}</FieldLabel>
                <div>
                  <FacePicker
                    name={s.user}
                    icon={s.userIcon}
                    color={s.userColor || null}
                    size="md"
                    label={t("general.faceEdit")}
                    onChange={(p) => patch({ userIcon: p.icon ?? s.userIcon, userColor: p.color ?? s.userColor })}
                  />
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="me">{t("general.name")}</FieldLabel>
                <Input id="me" value={s.user} onChange={(e) => patch({ user: e.target.value })} />
              </Field>

              <Field>
                <FieldLabel htmlFor="lang">{t("profile.lang")}</FieldLabel>
                <Select value={lang} onValueChange={(v) => setLang(v as "ru" | "en")}>
                  <SelectTrigger id="lang">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ru">Русский</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="theme">{t("profile.theme")}</FieldLabel>
                <Select value={theme} onValueChange={setTheme}>
                  <SelectTrigger id="theme">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">{t("theme.light")}</SelectItem>
                    <SelectItem value="dark">{t("theme.dark")}</SelectItem>
                    <SelectItem value="system">{t("theme.system")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

            </FieldGroup>

            {/* Чей это продукт. У нижнего края раздела и тише текста: это подпись автора,
                а не настройка. В колонке разделов такая ссылка читалась как ещё один раздел,
                а сразу под «Темой» — как продолжение полей. */}
            <div className="text-muted-foreground/60 mt-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-10 text-sm">
              <a
                className="hover:text-foreground flex items-center gap-2 transition-colors"
                href={AUTHOR.channel}
                target="_blank"
                rel="noopener"
              >
                <Romantic className="size-4 shrink-0" />
                {t("general.channel")}
              </a>
              <a
                className="hover:text-foreground flex items-center gap-2 transition-colors"
                href={AUTHOR.repo}
                target="_blank"
                rel="noopener"
              >
                <Octocat className="size-4 shrink-0" />
                GitHub
              </a>
            </div>
          </TabsContent>

          {/* КТО. Состав команды и что каждый умеет. */}
          <TabsContent value="people" className="pane-fade min-w-0 flex-1 overflow-y-auto p-6">
            {/* Действие раздела стоит у заголовка, а не под списком: список длинный,
                и кнопка под ним прячется за прокруткой ровно тогда, когда нужна. */}
            <div className="pane-head flex items-center gap-3">
              <h2 className="text-xl font-semibold">{t("settings.people")}</h2>
              {!hiring && (
                <Button variant="outline" size="sm" onClick={() => setHiring(true)}>
                  <Plus /> {t("hire.open")}
                </Button>
              )}
            </div>
            <div className="max-w-2xl divide-y">
              {Object.entries(s.agents).map(([name, a]) => (
                <AgentCard
                  key={name}
                  name={name}
                  autoOpen={created === name}
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

            {/* Состав смотрят постоянно, зовут редко: форма приглашения открывается по кнопке
                и не занимает низ экрана всё остальное время. */}
            {hiring ? (
              <FieldGroup className="mt-4 max-w-2xl gap-4">
                <Field>
                  <FieldLabel htmlFor="hire">{t("hire.name")}</FieldLabel>
                  <Input
                    id="hire"
                    autoFocus
                    value={hireName}
                    onChange={(e) => setHireName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && hire()}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
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
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setHiring(false)}>
                    {t("space.cancel")}
                  </Button>
                  <Button size="sm" onClick={hire}>
                    {t("hire.button")}
                  </Button>
                </div>
              </FieldGroup>
            ) : null}
          </TabsContent>

          {/* КАК. Правила поведения поверх участников. */}
          <TabsContent value="spaces" className="pane-fade min-w-0 flex-1 overflow-y-auto p-6">
            <div className="pane-head flex items-center gap-3">
              <h2 className="text-xl font-semibold">{t("settings.spaces")}</h2>
              <Button variant="outline" size="sm" onClick={() => void copyMode(BLANK)}>
                <Plus /> {t("space.new")}
              </Button>
            </div>
            <div className="max-w-2xl divide-y">
              {modes.map((m, i) => (
                <React.Fragment key={m.name}>
                {/* Режимы без регламента — последними и под своей подписью: они не про
                    порядок работы, и в общем списке читаются как ещё один рабочий приём. */}
                {m.talk && !modes[i - 1]?.talk && (
                  <div className="text-muted-foreground border-t-0 pt-8 pb-2 text-sm">
                    {t(modes.filter((x) => x.talk).length > 1 ? "space.specialMany" : "space.special")}
                  </div>
                )}
                <SpaceCard
                  mode={m}
                  current={space === m.name}
                  fixed={m.builtin}
                  onChange={saveMode}
                  onCopy={() => void copyMode(m)}
                  onRemove={() => void dropMode(m)}
                />
                </React.Fragment>
              ))}
            </div>

          </TabsContent>

          {/* ГДЕ. Общий контекст задачи и то, что пространство помнит. */}
          <TabsContent value="space" className="pane-fade min-w-0 flex-1 overflow-y-auto p-6">
            <div className="pane-head">
              <h2 className="text-xl font-semibold">{t("settings.space")}</h2>
            </div>
            <FieldGroup className="max-w-2xl gap-5">
              <Field>
                <FieldLabel htmlFor="laws">{t("space.laws")}</FieldLabel>
                <Textarea
                  id="laws"
                  rows={2}
                  value={s.laws ?? ""}
                  placeholder={t("space.lawsHint")}
                  onChange={(e) => patch({ laws: e.target.value })}
                />
                <FieldDescription>{t("space.lawsSeen")}</FieldDescription>
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="free">{t("space.freeTalk")}</FieldLabel>
                  <FieldDescription>{t("space.freeTalkHint")}</FieldDescription>
                </FieldContent>
                <Switch id="free" checked={s.freeTalk} onCheckedChange={(v) => patch({ freeTalk: v })} />
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="turns">{t("space.turns")}</FieldLabel>
                  <FieldDescription>{t("space.turnsHint")}</FieldDescription>
                </FieldContent>
                <Input
                  id="turns"
                  type="number"
                  min={1}
                  max={100}
                  className="w-24"
                  value={s.maxAutoTurns}
                  onChange={(e) => patch({ maxAutoTurns: Number(e.target.value) })}
                />
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="catch">{t("space.catchUp")}</FieldLabel>
                  <FieldDescription>{t("space.catchUpHint")}</FieldDescription>
                </FieldContent>
                <Input
                  id="catch"
                  type="number"
                  min={1}
                  max={500}
                  className="w-24"
                  value={s.catchUp}
                  onChange={(e) => patch({ catchUp: Number(e.target.value) })}
                />
              </Field>

              <FieldSeparator />

              {/* Память пространства в ленте не видна, а едет в промпт каждому перед каждым
                  ходом и очисткой чата не стирается. Без этого места человек про неё
                  не знает и не может её стереть. */}
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel>{t("space.memoryTitle")}</FieldLabel>
                  <FieldDescription>
                    {memory > 0
                      ? t("space.memoryBody", {
                        n: `${memory} ${plural(lang, memory, [
                          t("space.memoryOne"),
                          t("space.memoryFew"),
                          t("space.memoryMany"),
                        ])}`,
                        shared,
                      })
                      : t("space.memoryEmpty")}
                  </FieldDescription>
                </FieldContent>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={memory === 0}>
                      <Trash2 />
                      {t("space.memoryClear")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("space.memoryTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("space.memoryBody", {
                          n: `${memory} ${plural(lang, memory, [
                            t("space.memoryOne"),
                            t("space.memoryFew"),
                            t("space.memoryMany"),
                          ])}`,
                          shared,
                        })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("space.cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          await api.clearMemory(room)
                          setMemory(0)
                        }}
                      >
                        {t("space.memoryClear")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </Field>

              <FieldSeparator />

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel>{t("space.resetTitle")}</FieldLabel>
                  <FieldDescription>{t("space.resetBody")}</FieldDescription>
                </FieldContent>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <RotateCcw />
                      {t("space.reset")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("space.resetTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>{t("space.resetBody")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("space.cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          await api.reset(room)
                        }}
                      >
                        {t("space.reset")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel>{t("space.clearTitle")}</FieldLabel>
                  <FieldDescription>{t("space.clearBody")}</FieldDescription>
                </FieldContent>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2 />
                      {t("space.clear")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("space.clearTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>{t("space.clearBody")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("space.cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          await api.clear(room)
                          onCleared()
                        }}
                      >
                        {t("space.clear")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </Field>

            </FieldGroup>
          </TabsContent>
          {error && (
            <span className="text-destructive absolute right-6 bottom-4 text-sm">{error}</span>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
