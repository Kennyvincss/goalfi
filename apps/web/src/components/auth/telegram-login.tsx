"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    onGoalFiTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

/** Official Telegram Login Widget. The server verifies the HMAC signature (/api/auth/telegram). */
export function TelegramLoginButton({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!BOT || !ref.current) return;
    window.onGoalFiTelegramAuth = async (user) => {
      const res = await fetch("/api/auth/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(user) });
      if (res.ok) done.current();
      else setError((await res.json().catch(() => ({}))).error ?? "Telegram sign-in failed");
    };
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", BOT);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "8");
    s.setAttribute("data-onauth", "onGoalFiTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    ref.current.replaceChildren(s);
    return () => {
      delete window.onGoalFiTelegramAuth;
    };
  }, []);
  if (!BOT) return <p className="text-center text-xs text-muted-foreground">Telegram sign-in is not configured.</p>;
  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={ref} />
      {error && <p className="text-xs text-no">{error}</p>}
    </div>
  );
}
