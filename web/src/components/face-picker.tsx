import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { COLOR_ORDER, Face, Icon, toneVars } from "@/components/chat-feed"
import { cn } from "@/lib/utils"
import { useLang } from "@/lib/i18n"

/** Иконки для аватарки — то, чем обычно помечают роль. */
export const ICONS = [
  "book-open", "sparkles", "eye", "palette", "settings", "users", "brain", "compass",
  "microscope", "flask-conical", "ruler", "pen-tool", "type", "megaphone", "scale",
  "target", "flag", "rocket", "lightbulb", "shield", "bug", "code", "terminal",
  "git-branch", "database", "globe", "heart", "flame", "music", "coffee", "crown", "gem",
]

/**
 * Выбор цвета и знака. Человек и участники выбирают аватарку одинаково, поэтому
 * пикер один: правило «цвет есть — тон, нет — нейтрально» держится в одном месте.
 */
export function FacePicker({
  name,
  icon,
  color,
  size = "lg",
  onChange,
}: {
  name: string
  icon?: string
  color?: string | null
  size?: "md" | "lg"
  onChange: (patch: { icon?: string; color?: string }) => void
}) {
  const { t } = useLang()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="tone-hover shrink-0 rounded-full transition-shadow"
          style={toneVars(color)}
          title={t("card.face")}
        >
          <Face name={name} icon={icon} color={color} size={size} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2">
        <div className="text-muted-foreground mb-1.5 text-xs">{t("card.color")}</div>
        <div className="mb-3 flex flex-wrap gap-1.5 border-b pb-3">
          {COLOR_ORDER.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => onChange({ color: c })}
              className={cn(
                "tone-dot size-6 rounded-full transition-transform hover:scale-110",
                color === c && "ring-ring ring-offset-popover ring-2 ring-offset-2"
              )}
              style={toneVars(c)}
            />
          ))}
        </div>

        <div className="text-muted-foreground mb-1.5 text-xs">{t("card.icon")}</div>
        <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
          {ICONS.map((ic) => (
            <Button
              key={ic}
              variant={ic === icon ? "secondary" : "ghost"}
              size="icon"
              title={ic}
              onClick={() => onChange({ icon: ic })}
            >
              <Icon name={ic} />
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
