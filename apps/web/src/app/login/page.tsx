import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata = { title: "Sign in" };

export default async function Page() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-center text-2xl font-bold">Welcome back</h1>
      <Card className="mt-8 p-6">
        <Suspense><AuthForm mode="login" /></Suspense>
      </Card>
    </div>
  );
}
