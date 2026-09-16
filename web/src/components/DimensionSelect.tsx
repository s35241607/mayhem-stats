import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { groupBy, label, type Member } from "@/hooks/useCubeMeta"

/** 維度選單：依模型的 meta.group 分組。下鑽路徑與交叉矩陣共用。 */
export function DimensionSelect({
  value,
  options,
  onChange,
  placeholder,
  className,
}: {
  value: string
  options: Member[]
  onChange: (name: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {[...groupBy(options).entries()].map(([group, items]) => (
          <div key={group}>
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{group}</div>
            {items.map((m) => (
              <SelectItem key={m.name} value={m.name}>
                {label(m, m.name)}
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  )
}
