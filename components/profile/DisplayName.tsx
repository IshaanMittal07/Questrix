import { cn } from "@/lib/cn";

/** A name with its equipped colour and style classes (allowlisted in lib/shop/types). */
export function DisplayName({
  name,
  colorClass,
  styleClass,
  className,
}: {
  name: string;
  colorClass?: string | null;
  styleClass?: string | null;
  className?: string;
}) {
  return <span className={cn(colorClass, styleClass, className)}>{name}</span>;
}
