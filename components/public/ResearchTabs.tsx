"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { GITHUB_URL, GitHubMark, HUGGING_FACE_URL, HuggingFaceMark } from "./BrandIcons";

// The Research section's sub-navigation, shown at the top of every research
// page. A component rather than a /research layout because the dataset page
// keeps its long-standing URL (/snowpack_dataset, the brand's best-ranking
// page) instead of moving under /research.
export const RESEARCH_TABS = [
  { href: "/research", label: "Overview" },
  { href: "/research/models", label: "Models" },
  { href: "/snowpack_dataset", label: "Data" },
  { href: "/research/methods", label: "Methods" },
  { href: "/research/incident-detection", label: "Incident Detection" },
] as const;

export function ResearchTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3 dark:border-neutral-800">
      <nav aria-label="Research" className="flex flex-wrap gap-1 text-sm">
        {RESEARCH_TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 ${
                active
                  ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-4 text-sm text-neutral-600 dark:text-neutral-300">
        <a href={GITHUB_URL} rel="noopener" className="flex items-center gap-1.5 hover:text-neutral-900 dark:hover:text-neutral-100">
          <GitHubMark size={16} /> GitHub
        </a>
        <a href={HUGGING_FACE_URL} rel="noopener" className="flex items-center gap-1.5 hover:text-neutral-900 dark:hover:text-neutral-100">
          <HuggingFaceMark /> Hugging Face
        </a>
      </div>
    </div>
  );
}
