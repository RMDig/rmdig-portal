import { signOutAndContinueAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

// For a page reached with the wrong account (an invitation issued to another
// email): sign out and come back to `returnTo` after signing in as `email`.
export function SwitchAccount({ email, returnTo }: { email: string; returnTo: string }) {
  return (
    <form action={signOutAndContinueAction}>
      <input type="hidden" name="next" value={returnTo} />
      <Button type="submit" variant="outline">
        Sign out and continue as {email}
      </Button>
    </form>
  );
}
