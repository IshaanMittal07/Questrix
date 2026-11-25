"use client";

import { useMemo, useState, useTransition } from "react";
import { Avatar, type AvatarLayers } from "@/components/avatar/Avatar";
import { DisplayName } from "@/components/profile/DisplayName";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Sheet } from "@/components/ui/Sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";
import { equipItem, purchaseItem } from "@/lib/shop/actions";
import {
  RARITY_LABEL,
  type Category,
  type Equipped,
  type Rarity,
  type ShopData,
  type ShopItem,
  type Slot,
} from "@/lib/shop/types";

const TABS: { value: string; label: string; categories: Category[] }[] = [
  { value: "outfit", label: "Outfits", categories: ["outfit"] },
  { value: "accessory", label: "Gear", categories: ["accessory"] },
  { value: "name", label: "Name", categories: ["name_color", "name_style"] },
  { value: "title", label: "Titles", categories: ["title"] },
  { value: "background", label: "Scenes", categories: ["background"] },
  { value: "border", label: "Borders", categories: ["border"] },
  { value: "avatar_base", label: "Look", categories: ["avatar_base"] },
  { value: "consumable", label: "Power-ups", categories: ["consumable"] },
];

const RARITY_RING: Record<Rarity, string> = {
  common: "border-white/10",
  rare: "border-cyan/60",
  epic: "border-violet/70",
  legendary: "border-[#ffd34d]/80",
};
const RARITY_TEXT: Record<Rarity, string> = {
  common: "text-muted",
  rare: "text-cyan",
  epic: "text-violet",
  legendary: "text-[#ffd34d]",
};

const fmt = (n: number) => n.toLocaleString("en-US");

function layersFor(byId: Map<string, ShopItem>, eq: Equipped): AvatarLayers {
  const svg = (slot: Slot) => (eq[slot] ? byId.get(eq[slot]!)?.svg : null);
  return {
    background: svg("background"),
    border: svg("border"),
    avatarBase: svg("avatar_base"),
    outfit: svg("outfit"),
    accessory: svg("accessory"),
  };
}

export function ShopView({ data }: { data: ShopData }) {
  const byId = useMemo(
    () => new Map(data.items.map((i) => [i.id, i])),
    [data.items],
  );
  const [balance, setBalance] = useState(data.balance);
  const [freezes, setFreezes] = useState(data.streakFreezes);
  const [owned, setOwned] = useState(() => new Set(data.owned));
  const [equipped, setEquipped] = useState<Equipped>(data.equipped);
  const [selected, setSelected] = useState<ShopItem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  // The preview wears the selected item on top of what's equipped.
  const preview: Equipped =
    selected && selected.category !== "consumable"
      ? { ...equipped, [selected.category]: selected.id }
      : equipped;
  const layers = layersFor(byId, preview);
  const nameColor = preview.name_color
    ? byId.get(preview.name_color)?.css
    : null;
  const nameStyle = preview.name_style
    ? byId.get(preview.name_style)?.css
    : null;
  const title = preview.title ? byId.get(preview.title)?.text : null;
  const name = data.displayName || data.username;

  function buy(item: ShopItem) {
    setError("");
    start(async () => {
      const res = await purchaseItem(item.id);
      setConfirming(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBalance(res.balance);
      setFreezes(res.streakFreezes);
      if (item.category !== "consumable") {
        setOwned((o) => new Set(o).add(item.id));
      }
      setStatus(`Bought ${item.name}. Balance: ${fmt(res.balance)} points.`);
    });
  }

  function equip(slot: Slot, id: string | null, label: string) {
    setError("");
    const before = equipped;
    setEquipped({ ...equipped, [slot]: id }); // optimistic
    start(async () => {
      const res = await equipItem(slot, id);
      if (!res.ok) {
        setEquipped(before);
        setError(res.error);
        return;
      }
      setStatus(id ? `Equipped ${label}.` : `Unequipped ${label}.`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-wider uppercase">Shop</h1>
        <p className="text-sm" data-testid="shop-balance">
          <span className="text-cyan text-lg font-bold">{fmt(balance)}</span>{" "}
          <span className="text-muted">points · Lv {data.level}</span>
        </p>
      </div>

      <Card className="flex items-center gap-4">
        <Avatar layers={layers} size={96} label="Avatar preview" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">
            <DisplayName
              name={name}
              colorClass={nameColor}
              styleClass={nameStyle}
            />
          </p>
          {title ? (
            <p className="text-cyan text-sm font-semibold">{title}</p>
          ) : null}
          {selected ? (
            <SelectedActions
              item={selected}
              owned={owned.has(selected.id)}
              equippedId={
                selected.category === "consumable"
                  ? null
                  : (equipped[selected.category] ?? null)
              }
              balance={balance}
              level={data.level}
              freezes={freezes}
              freezeMax={data.freezeMax}
              pending={pending}
              onBuy={() => setConfirming(true)}
              onEquip={(id) =>
                selected.category !== "consumable" &&
                equip(selected.category, id, selected.name)
              }
            />
          ) : (
            <p className="text-muted mt-1 text-sm">Tap an item to try it on.</p>
          )}
        </div>
      </Card>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Tabs defaultValue="outfit">
        <TabsList
          aria-label="Categories"
          className="flex w-full justify-start overflow-x-auto [scrollbar-width:none]"
        >
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex-none">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.items
                .filter((i) => t.categories.includes(i.category))
                .map((item) => (
                  <li key={item.id}>
                    <ItemCard
                      item={item}
                      owned={owned.has(item.id)}
                      equipped={
                        item.category !== "consumable" &&
                        equipped[item.category] === item.id
                      }
                      locked={data.level < item.levelRequired}
                      selected={selected?.id === item.id}
                      base={layersFor(byId, equipped)}
                      onSelect={() => {
                        setSelected(item);
                        setError("");
                      }}
                    />
                  </li>
                ))}
            </ul>
          </TabsContent>
        ))}
      </Tabs>

      {selected ? (
        <Sheet
          open={confirming}
          onOpenChange={setConfirming}
          title={`Buy ${selected.name}?`}
          description={`${fmt(selected.price)} points. Balance after: ${fmt(balance - selected.price)}.`}
        >
          <div className="mt-4 flex gap-3">
            <Button
              className="flex-1"
              variant="secondary"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() => buy(selected)}
            >
              Buy for {fmt(selected.price)}
            </Button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function SelectedActions({
  item,
  owned,
  equippedId,
  balance,
  level,
  freezes,
  freezeMax,
  pending,
  onBuy,
  onEquip,
}: {
  item: ShopItem;
  owned: boolean;
  equippedId: string | null;
  balance: number;
  level: number;
  freezes: number;
  freezeMax: number;
  pending: boolean;
  onBuy: () => void;
  onEquip: (id: string | null) => void;
}) {
  const head = (
    <p className="text-sm">
      <span className="font-semibold">{item.name}</span>{" "}
      <span className={RARITY_TEXT[item.rarity]}>
        {RARITY_LABEL[item.rarity]}
      </span>
    </p>
  );
  let action;
  if (item.category === "consumable") {
    action =
      freezes >= freezeMax ? (
        <p className="text-muted text-sm">
          Holding {freezes} of {freezeMax}.
        </p>
      ) : (
        <Button disabled={pending || balance < item.price} onClick={onBuy}>
          Buy for {fmt(item.price)} ({freezes}/{freezeMax} held)
        </Button>
      );
  } else if (owned) {
    const isOn = equippedId === item.id;
    action = isOn ? (
      item.category === "avatar_base" ? (
        <p className="text-muted text-sm">Equipped</p>
      ) : (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => onEquip(null)}
        >
          Unequip
        </Button>
      )
    ) : (
      <Button disabled={pending} onClick={() => onEquip(item.id)}>
        Equip
      </Button>
    );
  } else if (level < item.levelRequired) {
    action = (
      <p className="text-muted text-sm">
        Unlocks at level {item.levelRequired}
      </p>
    );
  } else {
    action = (
      <Button disabled={pending || balance < item.price} onClick={onBuy}>
        {balance < item.price
          ? `Need ${fmt(item.price - balance)} more`
          : `Buy for ${fmt(item.price)}`}
      </Button>
    );
  }
  return (
    <div className="mt-1 flex flex-col items-start gap-1.5">
      {head}
      {action}
    </div>
  );
}

function ItemCard({
  item,
  owned,
  equipped,
  locked,
  selected,
  base,
  onSelect,
}: {
  item: ShopItem;
  owned: boolean;
  equipped: boolean;
  locked: boolean;
  selected: boolean;
  base: AvatarLayers;
  onSelect: () => void;
}) {
  const state = equipped
    ? "Equipped"
    : owned
      ? "Owned"
      : locked
        ? `Lv ${item.levelRequired}`
        : item.price === 0
          ? "Free"
          : fmt(item.price);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${item.name}, ${RARITY_LABEL[item.rarity]}, ${state}`}
      className={cn(
        "bg-surface flex min-h-11 w-full flex-col items-center gap-2 rounded-2xl border-2 p-3 text-center transition-colors",
        RARITY_RING[item.rarity],
        selected && "bg-surface-2 ring-cyan ring-2",
        locked && !owned && "opacity-60",
      )}
    >
      <Thumb item={item} base={base} />
      <span className="w-full truncate text-sm font-semibold">{item.name}</span>
      <span
        className={cn(
          "text-xs font-semibold",
          owned || equipped ? "text-success" : RARITY_TEXT[item.rarity],
        )}
      >
        {state}
      </span>
    </button>
  );
}

function Thumb({ item, base }: { item: ShopItem; base: AvatarLayers }) {
  const key: Partial<Record<Category, keyof AvatarLayers>> = {
    outfit: "outfit",
    accessory: "accessory",
    background: "background",
    border: "border",
    avatar_base: "avatarBase",
  };
  const layer = key[item.category];
  if (layer) {
    return <Avatar layers={{ ...base, [layer]: item.svg }} size={72} />;
  }
  if (item.category === "consumable") {
    return (
      <span
        aria-hidden
        className="text-cyan grid size-[72px] place-items-center text-4xl"
      >
        ❄
      </span>
    );
  }
  if (item.category === "title") {
    return (
      <span
        aria-hidden
        className="text-cyan grid h-[72px] place-items-center text-sm font-bold"
      >
        {item.text}
      </span>
    );
  }
  const isColor = item.category === "name_color";
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-[72px] place-items-center text-2xl font-bold",
        isColor ? item.css : cn("text-cyan", item.css),
      )}
    >
      Aa
    </span>
  );
}
