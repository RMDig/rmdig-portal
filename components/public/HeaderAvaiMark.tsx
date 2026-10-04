"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The AvAI mark in the public header, linking to /avai. Left off the landing
// page, whose hero already shows it (two marks a few inches apart looked
// doubled). A client component so the public layout itself stays static.
export function HeaderAvaiMark() {
  if (usePathname() === "/") return null;
  return (
    <Link href="/avai" aria-label="What is AvAI?" className="hidden md:block">
      <Image src="/avai-logo.png" alt="AvAI" width={50} height={32} className="dark:hidden" />
      <Image src="/avai-logo-white.png" alt="AvAI" width={50} height={32} className="hidden dark:block" />
    </Link>
  );
}
