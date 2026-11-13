"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tab = { href: string; label: string; icon: ReactNode };

const iconProps = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const TABS: Tab[] = [
  {
    href: "/today",
    label: "Today",
    icon: (
      <svg {...iconProps}>
        <path d="M3 12h4l2-5 4 10 2-5h6" />
      </svg>
    ),
  },
  {
    href: "/habits",
    label: "Habits",
    icon: (
      <svg {...iconProps}>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" />
      </svg>
    ),
  },
  {
    href: "/feed",
    label: "Feed",
    icon: (
      <svg {...iconProps}>
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      </svg>
    ),
  },
  {
    href: "/shop",
    label: "Shop",
    icon: (
      <svg {...iconProps}>
        <path d="M5 8h14l-1 12H6L5 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: (
      <svg {...iconProps}>
        <path d="m12 2 8.7 5v10L12 22l-8.7-5V7L12 2Z" />
        <circle cx="12" cy="10" r="3" />
        <path d="M7 17.5a6 6 0 0 1 10 0" />
      </svg>
    ),
  },
];

export function isActiveTab(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Presentational bar; `pathname` null = nothing highlighted (static fallback). */
export function TabBarView({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="Main"
      className="bg-surface/90 fixed inset-x-0 bottom-0 z-40 border-t border-white/8 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <ul className="mx-auto flex h-(--tabbar-height) max-w-lg items-stretch justify-around px-2">
        {TABS.map((tab) => {
          const active = isActiveTab(pathname, tab.href);
          return (
            <li key={tab.href} className="flex flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition-colors",
                  active ? "text-cyan" : "text-muted hover:text-text",
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ActiveTabBar() {
  return <TabBarView pathname={usePathname()} />;
}

/** Bottom tab bar: Today · Habits · Feed · Shop · Profile. */
export function TabBar() {
  // usePathname can suspend on dynamic routes under cacheComponents.
  return (
    <Suspense fallback={<TabBarView pathname={null} />}>
      <ActiveTabBar />
    </Suspense>
  );
}
