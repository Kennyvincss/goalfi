import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  const cluster = process.env.NEXT_PUBLIC_GOALFI_CLUSTER ?? "devnet";
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-muted-foreground">Real-life goals, community verification and on-chain prediction markets powered by Predict pm-AMM on Solana.</p>
          {cluster === "devnet" && <p className="text-xs text-warning">Running on Solana devnet with test tokens (mUSDC). No real money.</p>}
        </div>
        <div className="space-y-2">
          <div className="font-medium">Explore</div>
          <Link href="/discover" className="block text-muted-foreground hover:text-foreground">Discover</Link>
          <Link href="/markets" className="block text-muted-foreground hover:text-foreground">Markets</Link>
          <Link href="/leaderboard" className="block text-muted-foreground hover:text-foreground">Leaderboard</Link>
        </div>
        <div className="space-y-2">
          <div className="font-medium">Community</div>
          <Link href="/communities" className="block text-muted-foreground hover:text-foreground">Communities</Link>
          <Link href="/telegram" className="block text-muted-foreground hover:text-foreground">Telegram bot</Link>
        </div>
        <div className="space-y-2">
          <div className="font-medium">Learn</div>
          <Link href="/#faq" className="block text-muted-foreground hover:text-foreground">FAQ</Link>
          <a href="https://predict-pm-amm.dev" className="block text-muted-foreground hover:text-foreground" rel="noreferrer" target="_blank">Predict pm-AMM</a>
        </div>
      </div>
    </footer>
  );
}
