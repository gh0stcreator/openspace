import * as React from "react"

import { toneVars } from "@/components/chat-feed"

/**
 * Знак-вызов, и грамматика у него жёсткая: слева — чем заняты, в скобках — над чем.
 * Режим слева отвечает на «как мы сейчас работаем», предмет справа — на «о чём разговор».
 * Перепутать половины нельзя: open(validation) читается как «занимаемся проверкой проверки»
 * и не говорит ничего. В покое знак показывает
 * настоящее состояние пространства; наведение — только демонстрация грамматики:
 * половины меняются по очереди, сначала режим, потом тема.
 *
 * Демонстрация ничего не меняет в приложении. Ширину в вёрстке держит невидимый
 * якорь с настоящим состоянием, видимая часть лежит поверх и растёт вправо —
 * поэтому шапка не дёргается.
 */
export type Pair = { mode: string; subject: string }

/**
 * Что знак показывает под курсором — всегда одно и то же: open(space), имя продукта.
 * Случайные пары из списков показывали грамматику знака, но выглядели как подмена
 * наугад: слово менялось на слово, и прочитать в этом было нечего. Собственное имя
 * под курсором и возврат к настоящему состоянию — это один понятный жест.
 */
const HOME: Pair = { mode: "open", subject: "space" }

// Слово уезжает, через HOLD подменяется и приходит обратно. Одно значение на обе
// половины: движение у них общее. EVERY — пауза между левой и правой, STAY — сколько
// собранная пара стоит на экране, прежде чем знак разом вернётся к настоящему.
const HOLD = { mode: 110, subject: 110 }
const EVERY = 260
const STAY = 900

export function Logo({
  mode,
  subject,
  color,
  colors,
  className,
}: {
  mode: string
  subject: string
  /** Цвет нынешнего режима: им красится левая половина — та, что и есть режим. */
  color?: string | null
  /** Цвет по слагу: в перебор каждый режим приходит со своим. */
  colors?: Record<string, string>
  className?: string
}) {
  const wrap = React.useRef<HTMLSpanElement>(null)
  const part = { mode: React.useRef<HTMLSpanElement>(null), subject: React.useRef<HTMLSpanElement>(null) }
  const word = { mode: React.useRef<HTMLSpanElement>(null), subject: React.useRef<HTMLSpanElement>(null) }

  // Настоящее состояние держим в ссылке: оно может смениться прямо во время
  // демонстрации, и тогда по уходу курсора вернуть надо новое, а не старое.
  const idle = React.useRef<Pair>({ mode, subject })
  // Текст половин ведёт roll(), а не React: иначе смена режима приходит уже подменённой —
  // roll() видит «слово на месте», не играет смену и оставляет ширину прежнего слова.
  const first = React.useRef<Pair>({ mode, subject })
  // Таймеров два набора. Перебор под курсором свой эффект переподписывает при каждой
  // смене цветов, и его уборка гасила бы заодно смену настоящего состояния: знак застывал
  // на полпути, уехавшей половиной вверх. Живую смену ведут свои таймеры, их никто не трогает.
  const timers = React.useRef<number[]>([])
  const live = React.useRef<number[]>([])
  const hovering = React.useRef(false)
  const playing = React.useRef(false)

  /** Пробник внутри знака наследует шрифт, кегль и трекинг. */
  const measure = React.useCallback((s: string) => {
    if (!wrap.current) return 0
    const probe = document.createElement("span")
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;top:0;left:0"
    probe.textContent = s
    wrap.current.append(probe)
    const w = Math.ceil(probe.getBoundingClientRect().width)
    probe.remove()
    return w
  }, [])

  /** Половины лежат вне потока, поэтому ширину каждой задаём числом. */
  const fit = React.useCallback(() => {
    for (const key of ["mode", "subject"] as const) {
      const box = part[key].current
      const node = word[key].current
      if (box && node) box.style.width = `${measure(node.textContent ?? "")}px`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure])

  /**
   * Цвет левой половины. Ведём его тем же императивом, что и текст: цвет приходит
   * вместе со словом, в тот же кадр, иначе режим уже сменился, а краска ещё прежняя.
   */
  const paint = React.useCallback((tone?: string | null) => {
    const box = part.mode.current
    if (!box) return
    box.classList.toggle("tone-name", !!tone)
    const vars = toneVars(tone) as Record<string, string>
    box.style.setProperty("--h", vars["--h"])
    box.style.setProperty("--c", vars["--c"])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Одна половина: слово уезжает вверх, подменяется и приходит снизу. */
  const roll = React.useCallback((key: keyof Pair, next: string, tone?: string | null) => {
    const box = part[key].current
    const node = word[key].current
    if (!box || !node) return
    if (node.textContent === next) {
      // Слово уже на месте, но половина могла застрять уехавшей: курсор ушёл
      // ровно между «уехал» и «подменился». Возвращаем её на место.
      box.classList.remove("is-out", "is-in")
      if (key === "mode") paint(tone)
      return
    }
    box.classList.remove("is-out", "is-in")
    void box.offsetWidth
    box.classList.add("is-out")
    timers.current.push(
      window.setTimeout(() => {
        node.textContent = next
        if (key === "mode") paint(tone)
        box.style.width = `${measure(next)}px`
        box.classList.remove("is-out")
        box.classList.add("is-in")
        void box.offsetWidth
        requestAnimationFrame(() => box.classList.remove("is-in"))
      }, HOLD[key])
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, paint])

  const drop = (bag = timers) => {
    bag.current.forEach(clearTimeout)
    bag.current = []
  }

  /**
   * Показать пару: сначала левая половина, через паузу — правая. Единственный способ
   * сменить знак, и дорога назад тоже идёт по нему: если возвращать обе половины разом,
   * возврат выглядит рывком после двух спокойных ходов туда.
   */
  const show = React.useCallback(
    (pair: Pair) => {
      roll("mode", pair.mode, color)
      live.current.push(window.setTimeout(() => roll("subject", pair.subject), EVERY))
    },
    [roll, color]
  )

  // Шрифт догружается позже разметки: после этого знак надо промерить заново.
  React.useEffect(() => {
    fit()
    document.fonts?.ready.then(fit)
  }, [fit])

  // Первая покраска и смена цвета вместе с настоящим режимом. Под курсором цветом
  // распоряжается перебор, туда не лезем.
  React.useEffect(() => {
    if (!hovering.current) paint(color)
  }, [color, paint])

  React.useEffect(() => {
    // Одно наведение — один показ: знак собирается в open(space), держится и возвращается
    // к настоящему состоянию. Карусель под курсором мигала бы сбоку от текста,
    // и выключить её можно было бы только уведя мышь.
    const enter = () => {
      if (playing.current) return
      hovering.current = true
      playing.current = true
      roll("mode", HOME.mode, colors?.[HOME.mode])
      timers.current.push(window.setTimeout(() => roll("subject", HOME.subject), EVERY))
      timers.current.push(
        window.setTimeout(() => {
          playing.current = false
          show(idle.current)
        }, EVERY + STAY)
      )
    }

    const leave = () => {
      hovering.current = false
      playing.current = false
      drop()
      drop(live)
      show(idle.current)
    }

    const el = wrap.current
    el?.addEventListener("mouseenter", enter)
    el?.addEventListener("mouseleave", leave)
    return () => {
      el?.removeEventListener("mouseenter", enter)
      el?.removeEventListener("mouseleave", leave)
      playing.current = false
      drop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, roll, show])

  // Настоящее состояние сменилось: вне наведения показываем его той же сменой,
  // под курсором — покажем, когда курсор уйдёт.
  React.useEffect(() => {
    idle.current = { mode, subject }
    if (hovering.current) return
    drop(live)
    show({ mode, subject })
  }, [mode, subject, show])

  return (
    <span
      ref={wrap}
      className={`relative inline-block w-max cursor-pointer font-mono text-xl leading-none tracking-[-0.045em] whitespace-nowrap select-none ${
        className ?? ""
      }`}
    >
      {/* Якорь задаёт ширину в вёрстке — видимая часть живёт вне потока. */}
      <span className="invisible" aria-hidden>
        {mode}({subject})
      </span>

      <span className="absolute top-0 left-0 flex items-baseline whitespace-nowrap">
        <span ref={part.mode} className="logo-part logo-mode">
          <span ref={word.mode}>{first.current.mode}</span>
        </span>
        <span className="text-muted-foreground">(</span>
        <span ref={part.subject} className="logo-part logo-subject">
          <span ref={word.subject}>{first.current.subject}</span>
        </span>
        <span className="text-muted-foreground">)</span>
      </span>
    </span>
  )
}
