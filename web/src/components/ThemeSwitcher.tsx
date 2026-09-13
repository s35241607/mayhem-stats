import { Check, Moon, Palette, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { THEME_GROUPS, THEMES, useThemeName } from "@/lib/theme"

export function ThemeSwitcher() {
  const { theme, setTheme, isDark } = useThemeName()
  const current = THEMES.find((t) => t.id === theme)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" aria-label="切換主題">
          <Palette className="size-3.5" />
          {current?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {THEME_GROUPS.map((group, gi) => (
          <DropdownMenuGroup key={group.label}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {group.dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
              {group.label}
              {group.dark === isDark && <span className="ml-auto text-[10px]">目前</span>}
            </DropdownMenuLabel>
            {THEMES.filter((t) => t.dark === group.dark).map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => setTheme(t.id)} className="gap-3">
                {/* 色票：底色、介面強調、勝、敗——一眼看出這個主題長什麼樣 */}
                <span className="flex overflow-hidden rounded-md border">
                  {t.swatch.map((c) => (
                    <span key={c} className="size-4" style={{ background: c }} />
                  ))}
                </span>
                <span className="flex-1">
                  <span className="block text-sm">{t.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{t.hint}</span>
                </span>
                {theme === t.id && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
