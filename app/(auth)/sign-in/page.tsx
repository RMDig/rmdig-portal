import Image from "next/image";
import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInForm } from "./SignInForm";

export const metadata = {
  title: "Sign in — rmdig",
};

export default function SignInPage() {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        {/* 326×96 source at 40px tall — matches the (public) header asset. */}
        <Image
          src="/rmdig-logo.png"
          alt="RMDig"
          width={136}
          height={40}
          priority
          className="mb-2"
        />
        <CardTitle>Sign in to rmdig</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
