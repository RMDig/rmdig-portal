"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The AvAI mark in the public header, linking to /avai. Left off the landing
// page and the /avai section: both already show it large (two marks a few
// inches apart looked doubled), and on /avai it would link to itself. A
// client component so the public layout itself stays static.
function hidden(pathname: string): boolean {
  return pathname === "/" || pathname === "/avai" || pathname.startsWith("/avai/");
}

export function HeaderAvaiMark() {
  if (hidden(usePathname())) return null;
  return (
    <Link href="/avai" aria-label="What is AvAI?" className="hidden md:block">
      <Image src="/avai-logo.png" alt="AvAI" width={50} height={32} className="dark:hidden" />
      <Image src="/avai-logo-white.png" alt="AvAI" width={50} height={32} className="hidden dark:block" />
    </Link>
  );
}
