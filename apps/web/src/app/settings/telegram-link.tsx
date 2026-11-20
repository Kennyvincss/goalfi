"use client";

import { useRouter } from "next/navigation";
import { TelegramLoginButton } from "@/components/auth/telegram-login";

export function TelegramLink() {
  const router = useRouter();
  return (
    <div className="flex justify-start">
      <TelegramLoginButton onDone={() => router.refresh()} />
    </div>
  );
}
