import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { nextQuery } from "./return-to";

/** Send a signed-out visitor to sign-in, remembering the page they asked for
 *  (forwarded by the middleware as x-return-to). Every portal page uses this
 *  rather than a bare redirect: Next renders a page alongside its layout, so
 *  whichever redirects first wins, and both must keep the return path. */
export async function redirectToSignIn(): Promise<never> {
  redirect(`/sign-in${nextQuery((await headers()).get("x-return-to"))}`);
}
