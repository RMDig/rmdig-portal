"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { SectionTab } from "@/lib/nav/sections";

// A team's or an advertiser's tab bar; the current section is marked.
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const pathname = usePathname();
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
              active ? "border-neutral-900 font-medium dark:border-neutral-100" : "text-muted-foreground hover:text-foreground border-transparent"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
