"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/components/wallet/wallet-button";
import { Button } from "@/components/ui/button";

/** Link a wallet by signing a one-time nonce message (no transaction, no fee). */
export function LinkWallet({ linked }: { linked: string | null }) {
  const { publicKey, signMessage, connected } = useWallet();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function link() {
    if (!publicKey || !signMessage) return setMsg({ ok: false, text: "This wallet does not support message signing." });
    setBusy(true);
    setMsg(null);
    try {
      const n = await fetch("/api/wallet/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: publicKey.toBase58() }) });
      const nd = await n.json();
      if (!n.ok) throw new Error(nd.error);
      const sig = await signMessage(new TextEncoder().encode(nd.message));
      const l = await fetch("/api/wallet/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce: nd.nonce, signature: bs58.encode(sig) }) });
      const ld = await l.json();
      if (!l.ok) throw new Error(ld.error);
      setMsg({ ok: true, text: "Wallet linked." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || "Linking failed" });
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    const r = await fetch("/api/wallet/link", { method: "DELETE" });
    const d = await r.json();
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Wallet unlinked." } : { ok: false, text: d.error });
    router.refresh();
  }

  const connectedAddr = publicKey?.toBase58();
  return (
    <div className="space-y-3">
      {linked && (
        <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">Linked: {linked}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <WalletButton style={{ height: 40, borderRadius: 8, fontSize: 14 }} />
        {connected && connectedAddr !== linked && (
          <Button onClick={link} disabled={busy}>{busy ? "Waiting for signature…" : linked ? "Link this wallet instead" : "Link this wallet"}</Button>
        )}
        {linked && <Button variant="outline" onClick={unlink} disabled={busy}>Unlink</Button>}
      </div>
      {msg && <p className={msg.ok ? "text-sm text-yes" : "text-sm text-no"}>{msg.text}</p>}
      <p className="text-xs text-muted-foreground">Linking signs a message only, with no transaction or fee. GoalFi never sees your private key. Trades are always signed in your wallet.</p>
    </div>
  );
}
