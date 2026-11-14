import { cn } from "@/lib/cn";

/** Layer order is fixed by plan §6.5: background → border → base → outfit → accessory. */
export type AvatarLayers = {
  background?: string | null;
  border?: string | null;
  avatarBase?: string | null;
  outfit?: string | null;
  accessory?: string | null;
};

const ORDER: (keyof AvatarLayers)[] = [
  "background",
  "border",
  "avatarBase",
  "outfit",
  "accessory",
];

export function Avatar({
  layers,
  size = 96,
  label,
  className,
}: {
  layers: AvatarLayers;
  size?: number;
  /** Accessible name, e.g. "alice's avatar". Omit when decorative. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {ORDER.map((key) => {
        const src = layers[key];
        return src ? (
          // eslint-disable-next-line @next/next/no-img-element -- static SVG layers from /public
          <img
            key={key}
            src={src}
            alt=""
            width={size}
            height={size}
            className="absolute inset-0 size-full"
            draggable={false}
          />
        ) : null;
      })}
    </div>
  );
}

/** Reads the SVG path from an item's `asset` JSON (only trusted /cosmetics/ paths). */
export function assetSvg(asset: unknown): string | null {
  if (asset && typeof asset === "object" && "svg" in asset) {
    const svg = (asset as { svg: unknown }).svg;
    return typeof svg === "string" && svg.startsWith("/cosmetics/")
      ? svg
      : null;
  }
  return null;
}
