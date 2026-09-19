/**
 * Знак-вызов набран как код, поэтому обе его половины латиницей: русское имя
 * комнаты превращается в тему `open(megamenu)`.
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya", " ": "_", "-": "_",
}

export const latin = (s: string) =>
  [...s.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("")

/** Тема разговора для знака: общая комната — это просто «space». */
export const subjectOf = (room?: string) =>
  !room || room === "общая" || room === "general" ? "space" : latin(room)
