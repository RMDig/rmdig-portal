import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata = {
  title: "Set a new password — rmdig",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
      </CardHeader>
      <CardContent>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-red-700 dark:text-red-400">
              This reset link is missing its token. Request a new one.
            </p>
            <p className="text-muted-foreground text-center text-sm">
              <Link href="/forgot-password" className="text-foreground font-medium underline">
                Request a reset link
              </Link>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
