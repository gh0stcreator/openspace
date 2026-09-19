import * as React from "react"

/**
 * Знак-вызов: слева — как сейчас думаем, в скобках — о чём. В покое знак показывает
 * настоящее состояние пространства; наведение — только демонстрация грамматики:
 * половины меняются по очереди, сначала режим, потом тема.
 *
 * Демонстрация ничего не меняет в приложении. Ширину в вёрстке держит невидимый
 * якорь с настоящим состоянием, видимая часть лежит поверх и растёт вправо —
 * поэтому шапка не дёргается.
 */
export type Pair = { mode: string; topic: string }

const DEMO: Pair[] = [
  { mode: "redteam", topic: "product_strategy" },
  { mode: "research", topic: "market" },
  { mode: "design", topic: "brand" },
  { mode: "decide", topic: "pricing" },
  { mode: "review", topic: "product" },
  { mode: "brainstorm", topic: "new_idea" },
]

// Значения из макета знака: режим уходит коротко, тема — мягче и дольше.
const HOLD = { mode: 115, topic: 155 }
const EVERY = 690

export function Logo({
  mode,
  topic,
  demoPairs = DEMO,
  className,
}: {
  mode: string
  topic: string
  demoPairs?: Pair[]
  className?: string
}) {
  const wrap = React.useRef<HTMLSpanElement>(null)
  const part = { mode: React.useRef<HTMLSpanElement>(null), topic: React.useRef<HTMLSpanElement>(null) }
  const word = { mode: React.useRef<HTMLSpanElement>(null), topic: React.useRef<HTMLSpanElement>(null) }

  // Настоящее состояние держим в ссылке: оно может смениться прямо во время
  // демонстрации, и тогда по уходу курсора вернуть надо новое, а не старое.
  const idle = React.useRef<Pair>({ mode, topic })
  const timers = React.useRef<number[]>([])
  const cycle = React.useRef(0)
  const hovering = React.useRef(false)
  const at = React.useRef(0)
  const half = React.useRef(0)

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
    for (const key of ["mode", "topic"] as const) {
      const box = part[key].current
      const node = word[key].current
      if (box && node) box.style.width = `${measure(node.textContent ?? "")}px`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure])

  /** Одна половина: слово уезжает вверх, подменяется и приходит снизу. */
  const roll = React.useCallback((key: keyof Pair, next: string) => {
    const box = part[key].current
    const node = word[key].current
    if (!box || !node) return
    if (node.textContent === next) {
      // Слово уже на месте, но половина могла застрять уехавшей: курсор ушёл
      // ровно между «уехал» и «подменился». Возвращаем её на место.
      box.classList.remove("is-out", "is-in")
      return
    }
    box.classList.remove("is-out", "is-in")
    void box.offsetWidth
    box.classList.add("is-out")
    timers.current.push(
      window.setTimeout(() => {
        node.textContent = next
        box.style.width = `${measure(next)}px`
        box.classList.remove("is-out")
        box.classList.add("is-in")
        void box.offsetWidth
        requestAnimationFrame(() => box.classList.remove("is-in"))
      }, HOLD[key])
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure])

  const drop = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  /** Показать пару: сначала режим, через паузу — тема. */
  const show = React.useCallback(
    (pair: Pair) => {
      roll("mode", pair.mode)
      timers.current.push(window.setTimeout(() => roll("topic", pair.topic), 210))
    },
    [roll]
  )

  // Шрифт догружается позже разметки: после этого знак надо промерить заново.
  React.useEffect(() => {
    fit()
    document.fonts?.ready.then(fit)
  }, [fit])

  React.useEffect(() => {
    // Каждый тик меняет ровно одну половину: mode, topic, mode, topic…
    const tick = () => {
      const pair = demoPairs[at.current % demoPairs.length]
      if (half.current % 2 === 0) roll("mode", pair.mode)
      else {
        roll("topic", pair.topic)
        at.current++
      }
      half.current++
    }

    const enter = () => {
      if (cycle.current) return
      hovering.current = true
      at.current = 0
      half.current = 0
      tick()
      cycle.current = window.setInterval(tick, EVERY)
    }

    const leave = () => {
      hovering.current = false
      clearInterval(cycle.current)
      cycle.current = 0
      drop()
      show(idle.current)
    }

    const el = wrap.current
    el?.addEventListener("mouseenter", enter)
    el?.addEventListener("mouseleave", leave)
    return () => {
      el?.removeEventListener("mouseenter", enter)
      el?.removeEventListener("mouseleave", leave)
      clearInterval(cycle.current)
      cycle.current = 0
      drop()
    }
  }, [demoPairs, roll, show])

  // Настоящее состояние сменилось: вне наведения показываем его той же сменой,
  // под курсором — покажем, когда курсор уйдёт.
  React.useEffect(() => {
    idle.current = { mode, topic }
    if (hovering.current) return
    drop()
    show({ mode, topic })
  }, [mode, topic, show])

  return (
    <span
      ref={wrap}
      className={`relative inline-block w-max cursor-pointer font-mono text-xl leading-none tracking-[-0.045em] whitespace-nowrap select-none ${
        className ?? ""
      }`}
    >
      {/* Якорь задаёт ширину в вёрстке — видимая часть живёт вне потока. */}
      <span className="invisible" aria-hidden>
        {mode}({topic})
      </span>

      <span className="absolute top-0 left-0 flex items-baseline whitespace-nowrap">
        <span ref={part.mode} className="logo-part logo-mode">
          <span ref={word.mode}>{mode}</span>
        </span>
        <span className="text-muted-foreground">(</span>
        <span ref={part.topic} className="logo-part logo-topic">
          <span ref={word.topic}>{topic}</span>
        </span>
        <span className="text-muted-foreground">)</span>
      </span>
    </span>
  )
}
