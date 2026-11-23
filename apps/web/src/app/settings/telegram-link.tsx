"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TelegramLoginButton } from "@/components/auth/telegram-login";

/** Two ways to connect Telegram: through the bot (simplest) or the Telegram Login button. */
export function TelegramLink() {
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function viaBot() {
    setError(null);
    const r = await fetch("/api/telegram/link-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "LINK_ACCOUNT" }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error ?? "Could not create a link");
    window.open(d.url, "_blank", "noopener,noreferrer");
    setOpened(true);
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Button onClick={viaBot}><Send />Connect through the GoalFi bot</Button>
        <p className="text-xs text-muted-foreground">Opens Telegram. Tap <b>Start</b> in the chat with the bot, and it confirms that your account is connected.</p>
        {opened && <Button variant="outline" size="sm" onClick={() => router.refresh()}>I tapped Start: refresh</Button>}
        {error && <p className="text-sm text-no">{error}</p>}
      </div>
      <div className="space-y-2 border-t pt-4">
        <p className="text-xs text-muted-foreground">Or use Telegram Login. Telegram sends a confirmation to your Telegram app, in the chat named <b>Telegram</b> (not as an SMS).</p>
        <div className="flex justify-start"><TelegramLoginButton onDone={() => router.refresh()} /></div>
      </div>
    </div>
  );
}
