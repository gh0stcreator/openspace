import type { Msg } from "@/lib/api"

/**
 * Лента как последовательность событий, а не как список текстов.
 *
 * Разбор идёт по полям сообщения — `kind`, `from`, `mentions`, — и никогда по его тексту:
 * интерфейс, который читает «дальше твоё» в реплике, ломается от любой перефразировки
 * и от смены языка. Новый вид события добавляется сюда и в отрисовку, а не в условие
 * посреди списка.
 *
 * Часть видов рантайм пока не присылает: `stage-transition` появится, когда режим начнёт
 * отбивать шаги, `agent-activity` собирается на клиенте из канала статусов. Они объявлены
 * заранее, чтобы их добавление не переписывало ленту.
 */
export type ThreadEvent =
  | { type: "human-message"; msg: Msg }
  | { type: "agent-message"; msg: Msg; handoff: string[] }
  | { type: "handoff"; msg: Msg; to: string[] }
  | { type: "system-event"; msg: Msg }
  | { type: "memory-proposal"; msg: Msg }
  | { type: "stage-transition"; msg: Msg; name: string; step?: number; steps?: number }
  | { type: "agent-activity"; who: string; since: number }

/**
 * Передача хода — это обращение в реплике участника, а не оборот речи. Берём из `mentions`,
 * которые сервер уже разобрал; себя из списка убираем, человека оставляем: «передал вам» —
 * такая же передача, как и любая другая.
 */
const handoffOf = (m: Msg) => (m.mentions ?? []).filter((n) => n !== m.from)

/**
 * Тип события по одному сообщению — им переключается отрисовка в ленте. Отдельно
 * от `thread()`, потому что лента сначала группирует подряд идущие реплики и только
 * потом решает, чем их рисовать.
 */
export function eventType(m: Msg, user: string): ThreadEvent["type"] {
  if (m.kind === "message") return m.from === user ? "human-message" : "agent-message"
  if (m.kind === "memory-proposal") return "memory-proposal"
  return "system-event"
}

export function thread(messages: Msg[], user: string): ThreadEvent[] {
  const out: ThreadEvent[] = []
  for (const msg of messages) {
    switch (msg.kind) {
      case "message":
        if (msg.from === user) out.push({ type: "human-message", msg })
        else out.push({ type: "agent-message", msg, handoff: handoffOf(msg) })
        break
      case "memory-proposal":
        out.push({ type: "memory-proposal", msg })
        break
      case "system":
      case "error":
        out.push({ type: "system-event", msg })
        break
      // Правка не событие ленты: она уже применена к той реплике, которую правили.
      case "edit":
      case "memory-resolved":
        break
      default:
        out.push({ type: "system-event", msg })
    }
  }
  return out
}
