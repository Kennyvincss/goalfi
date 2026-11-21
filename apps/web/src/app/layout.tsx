import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { WalletProviders } from "@/components/wallet-providers";

export const metadata: Metadata = {
  title: { default: "GoalFi: Turn Your Goals Into Markets", template: "%s · GoalFi" },
  description: "Set goals, challenge your community, prove your progress and predict the outcomes. Powered by Predict pm-AMM on Solana.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#4f46e5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <WalletProviders>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </WalletProviders>
      </body>
    </html>
  );
}
