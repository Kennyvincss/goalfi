import Link from "next/link";
import { LegalPage, contactLine } from "@/components/legal/legal-page";

export const metadata = { title: "Terms of service" };
export const dynamic = "force-dynamic";

export default function Terms() {
  const devnet = (process.env.NEXT_PUBLIC_GOALFI_CLUSTER ?? "devnet") === "devnet";
  return (
    <LegalPage title="Terms of service" updated="23 November 2026">
      <p>By using GoalFi you agree to these terms. If you don’t agree, please don’t use the service. Questions: {contactLine()}.</p>

      <h2>The service</h2>
      <p>
        GoalFi hosts challenges (real-life goals), verifies progress through human verifiers or connected accounts, and lets people trade on outcomes in prediction markets
        that run on the Solana blockchain using the Predict pm-AMM program.
        {devnet && <> GoalFi currently runs on <b>Solana devnet with test tokens that have no monetary value</b>.</>}
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be 18 or over and give accurate information. One person, one account.</li>
        <li>Keep your password and wallet safe. GoalFi never holds your wallet’s keys and can’t reverse transactions you sign.</li>
      </ul>

      <h2>Fair play</h2>
      <ul>
        <li>Report your own progress honestly. Don’t fake evidence, enter data by hand to pass it off as recorded, or use someone else’s device or account.</li>
        <li>Don’t bet against a challenge you take part in or created, and don’t create extra accounts to influence results.</li>
        <li>GoalFi may flag, penalize reputation, exclude evidence, suspend challenges or close accounts that break these rules. See <Link href="/connected">how auto-verification works</Link>.</li>
      </ul>

      <h2>Markets and risk</h2>
      <ul>
        <li>Trading carries risk; you can lose what you put in. Prices come from an automated market maker, swaps pay a protocol fee, and on-chain transactions are final.</li>
        <li>Outcomes are decided by each challenge’s published rules and evidence, with a dispute window before settlement. GoalFi resolves markets according to those rules.</li>
        <li>Prediction markets may be restricted where you live. You’re responsible for following the laws that apply to you.</li>
      </ul>

      <h2>Your content</h2>
      <p>You keep ownership of what you upload. You let GoalFi store and show it as needed to run the challenges you join. Don’t upload anything illegal or that you don’t have the right to share.</p>

      <h2>Connected services</h2>
      <p>If you connect Google Health, GitHub or Lichess, their own terms also apply. See the <Link href="/privacy">privacy policy</Link> for what GoalFi reads and how to disconnect.</p>

      <h2>No warranty</h2>
      <p>GoalFi is provided “as is”. It depends on third-party services and blockchains that can fail or change. To the extent the law allows, GoalFi isn’t liable for indirect losses or for losses caused by those services, by blockchain transactions, or by your own wallet.</p>

      <h2>Changes</h2>
      <p>GoalFi may update these terms; the date above changes when it does. Continuing to use GoalFi after a change means you accept it.</p>
    </LegalPage>
  );
}
