import * as React from "react"

/**
 * Знак-вызов: слева — как сейчас думаем, в скобках — о чём. Idle показывает
 * настоящее состояние пространства, наведение — только демонстрацию: что обе
 * половины независимы и меняются по отдельности.
 *
 * Демонстрация ничего не меняет в приложении. Ширину в вёрстке держит невидимый
 * якорь с настоящим состоянием, видимая часть лежит поверх и растёт вправо —
 * поэтому шапка не дёргается.
 */
export type Pair = { mode: string; topic: string }

const DEMO: Pair[] = [
  { mode: "redteam", topic: "product_strategy" },
  { mode: "design", topic: "brand" },
  { mode: "brainstorm", topic: "new_idea" },
  { mode: "consult", topic: "career" },
  { mode: "review", topic: "product" },
  { mode: "research", topic: "market" },
  { mode: "edit", topic: "book" },
]

const ROLL = 180 // сколько текст уезжает вверх, прежде чем смениться
const STAGGER = 260 // пауза между сменой левой и правой половины
const EVERY = 1600 // шаг демонстрации

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
  const box = [React.useRef<HTMLSpanElement>(null), React.useRef<HTMLSpanElement>(null)]
  const line = [React.useRef<HTMLSpanElement>(null), React.useRef<HTMLSpanElement>(null)]

  // Настоящее состояние держим в ссылке: оно может смениться прямо во время
  // демонстрации, и тогда по уходу курсора вернуть надо новое, а не старое.
  const idle = React.useRef<Pair>({ mode, topic })
  idle.current = { mode, topic }

  const timers = React.useRef<number[]>([])
  const cycle = React.useRef(0)
  const at = React.useRef(0)
  const hovering = React.useRef(false)

  /** Ширину считаем пробником внутри знака: он наследует шрифт, кегль и трекинг. */
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

  const put = React.useCallback(
    (i: number, s: string) => {
      if (line[i].current) line[i].current!.textContent = s
      if (box[i].current) box[i].current!.style.width = `${measure(s)}px`
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measure]
  )

  React.useEffect(() => {
    /** Одна половина: текст уезжает вверх, подменяется и приходит снизу. */
    const roll = (i: number, s: string) => {
      const b = box[i].current
      if (!b || !line[i].current) return
      if (line[i].current!.textContent === s) return // то же слово — не дёргаем
      b.classList.remove("is-out", "is-in")
      void b.offsetWidth
      b.classList.add("is-out")
      timers.current.push(
        window.setTimeout(() => {
          put(i, s)
          b.classList.remove("is-out")
          b.classList.add("is-in")
          void b.offsetWidth
          requestAnimationFrame(() => b.classList.remove("is-in"))
        }, ROLL)
      )
    }

    const drop = () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }

    // Сначала меняется только режим, через паузу — только тема: видно, что это
    // две независимые половины, а не одна строка.
    const step = () => {
      const next = demoPairs[at.current % demoPairs.length]
      at.current++
      roll(0, next.mode)
      timers.current.push(window.setTimeout(() => roll(1, next.topic), STAGGER))
    }

    const start = () => {
      if (cycle.current) return
      hovering.current = true
      step()
      cycle.current = window.setInterval(step, EVERY)
    }

    const stop = () => {
      hovering.current = false
      clearInterval(cycle.current)
      cycle.current = 0
      drop()
      at.current = 0
      box.forEach((b) => b.current?.classList.remove("is-out", "is-in"))
      put(0, idle.current.mode)
      put(1, idle.current.topic)
    }

    stop()
    const el = wrap.current
    el?.addEventListener("mouseenter", start)
    el?.addEventListener("mouseleave", stop)
    return () => {
      el?.removeEventListener("mouseenter", start)
      el?.removeEventListener("mouseleave", stop)
      clearInterval(cycle.current)
      cycle.current = 0
      drop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoPairs, put])

  // Настоящее состояние сменилось: вне наведения показываем его сразу,
  // под курсором — покажем, когда курсор уйдёт.
  React.useEffect(() => {
    if (hovering.current) return
    put(0, mode)
    put(1, topic)
  }, [mode, topic, put])

  return (
    <span
      ref={wrap}
      className={`relative inline-block cursor-pointer font-mono text-xl tracking-tight whitespace-nowrap select-none ${
        className ?? ""
      }`}
    >
      {/* Якорь задаёт ширину в вёрстке — видимая часть живёт вне потока. */}
      <span className="invisible" aria-hidden>
        {mode}({topic})
      </span>

      {/* Без правой границы: видимая часть шире якоря и растёт вправо. */}
      <span className="absolute top-0 left-0 flex h-full whitespace-nowrap">
        <span ref={box[0]} className="logo-seg">
          <span ref={line[0]}>{mode}</span>
        </span>
        <span className="text-muted-foreground">(</span>
        <span ref={box[1]} className="logo-seg">
          <span ref={line[1]}>{topic}</span>
        </span>
        <span className="text-muted-foreground">)</span>
      </span>
    </span>
  )
}
