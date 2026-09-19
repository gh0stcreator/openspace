import * as React from "react"

/**
 * Знак-вызов: слева режим работы, в скобках — тема разговора.
 * По умолчанию `open(space)`: открытое обсуждение любой темы, в работе — `premortem(megamenu)`.
 *
 * Знак живёт в кодовой эстетике, поэтому обе части латиницей. При наведении он
 * перебирает примеры — настоящие режимы и типовые темы: так видно, чем управляют
 * обе половины, без подписи «mode» и «topic».
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya", " ": "", "-": "", _: "",
}

const latin = (s: string) =>
  [...s.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("")

/** Темы для примеров: короткие, чтобы знак не растягивался на пол-шапки. */
const TOPICS = ["megamenu", "pricing", "launch", "naming", "kids"]

/** Запасные режимы — на случай, если конфиг ещё не доехал. */
const FALLBACK = ["sixhats", "redteam", "premortem", "duel"]

export function Logo({
  room,
  mode,
  modes,
  className,
}: {
  room?: string
  mode?: string
  modes?: { slug: string }[]
  className?: string
}) {
  const topic = !room || room === "общая" || room === "general" ? "space" : latin(room)
  const call = mode || "open"

  const pairs = React.useMemo(() => {
    const slugs = (modes ?? [])
      .map((m) => m.slug)
      .filter((s) => s && s !== "open" && s !== call && s.length <= 9)
    const list = (slugs.length ? slugs : FALLBACK).slice(0, TOPICS.length)
    return list.map((s, i) => [s, TOPICS[i]] as const)
  }, [modes, call])

  const [hover, setHover] = React.useState(false)
  const [i, setI] = React.useState(0)

  React.useEffect(() => {
    if (!hover || pairs.length < 2) return
    const t = setInterval(() => setI((n) => n + 1), 1100)
    return () => clearInterval(t)
  }, [hover, pairs.length])

  React.useEffect(() => {
    if (!hover) setI(0)
  }, [hover])

  const [left, right] = hover && pairs.length ? pairs[i % pairs.length] : [call, topic]

  // Ширину держим по самому длинному примеру: иначе на каждом переборе
  // дёргается вся шапка.
  const widest = [`${call}(${topic})`, ...pairs.map(([m, t]) => `${m}(${t})`)].reduce((a, b) =>
    b.length > a.length ? b : a
  )

  return (
    <span
      className={`grid font-mono text-xl tracking-tight whitespace-nowrap ${className ?? ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {widest}
      </span>
      <span key={`${left}(${right})`} className="animate-in fade-in col-start-1 row-start-1 duration-300">
        {left}
        <span className="text-muted-foreground">(</span>
        {right}
        <span className="text-muted-foreground">)</span>
      </span>
    </span>
  )
}
