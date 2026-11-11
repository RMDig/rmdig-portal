import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ONCALL_LINK_PROBLEM, readOncallLink } from "@/lib/sar/oncall-confirm";

import { ConfirmOncallForm } from "./ConfirmOncallForm";

export const metadata = {
  title: "Confirm on-call email — rmdig",
};

// Opened from the link sent to a team's proposed on-call address (plan 33
// 9.10). Reading the page changes nothing; the button confirms.
export default async function OncallVerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const link = await readOncallLink(token);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{link.ok && link.isDrill ? "DRILL: confirm on-call email" : "Confirm on-call email"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {link.ok ? (
          <ConfirmOncallForm token={token} teamName={link.teamName} address={link.address} />
        ) : (
          <p className="text-sm">{ONCALL_LINK_PROBLEM[link.reason]}</p>
        )}
      </CardContent>
    </Card>
  );
}
