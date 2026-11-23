import Link from "next/link";
import { LegalPage, contactLine } from "@/components/legal/legal-page";

export const metadata = { title: "Privacy policy" };
export const dynamic = "force-dynamic";

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="23 November 2026">
      <p>
        GoalFi lets people set real-life goals as challenges, verify progress, and trade on the outcome in prediction markets. This page explains,
        in plain language, what GoalFi collects, why, who can see it, and how to remove it. Questions: {contactLine()}.
      </p>

      <h2>What GoalFi collects</h2>
      <ul>
        <li><b>Your account:</b> username, email address and a securely hashed password. Your reputation score and the challenges you create, join, verify or dispute.</li>
        <li><b>Evidence you upload</b> to human-verified challenges (photos, videos, links, descriptions), with a fingerprint (hash) of each file so it can’t be swapped later.</li>
        <li><b>Optional links:</b> a Solana wallet address (only to trade) and your Telegram account (for notifications and groups).</li>
        <li><b>Connected accounts</b> (optional, only if you connect them):
          <ul>
            <li><b>Google Health</b> (Fitbit, Pixel Watch), read-only: daily totals for steps, distance, running distance, floors, heart-zone minutes, workouts, and the time your main sleep ended. Only data recorded by your device is used; manually entered data is ignored.</li>
            <li><b>GitHub</b>: your public username and daily contribution counts.</li>
            <li><b>Lichess</b>: your username, finished games and puzzle results.</li>
          </ul>
          GoalFi stores the access tokens these services issue, encrypted, so it can refresh your data while you take part in challenges.
        </li>
        <li><b>Technical data:</b> a login session cookie, a short-lived security cookie during sign-in with another service, and logs needed to run and secure the service (for example, rate limits and an audit log of important actions).</li>
      </ul>

      <h2>How it’s used</h2>
      <ul>
        <li>To run challenges: count your progress, approve it as evidence, and decide the outcome when a challenge ends.</li>
        <li>To suggest challenges based on your own recent activity, shown only to you.</li>
        <li>To prevent cheating and manipulation (for example, flagging participants who bet against their own challenge).</li>
        <li>To send the notifications you’ve enabled, on the site and through Telegram.</li>
      </ul>
      <p>GoalFi does <b>not</b> sell your data, show ads, or use your data to train AI models.</p>

      <h2>Who can see it</h2>
      <ul>
        <li><b>Other participants and viewers of a challenge you join</b> see your progress in it. For app-verified challenges, that’s the daily total for that challenge’s metric on each challenge day (for example, “8,200 steps on 23 Nov”). Nothing from other days or other metrics is shown to anyone else.</li>
        <li><b>Verifiers you or a creator choose</b> see evidence you upload to human-verified challenges. Approved evidence becomes visible to everyone who can see the challenge.</li>
        <li><b>Trades are public on the Solana blockchain</b>, as on any blockchain. GoalFi shows which participants hold positions in their own challenge’s market, for fairness.</li>
        <li><b>Service providers</b> that host GoalFi (website hosting, database, file storage) process data only to run the service.</li>
      </ul>

      <h2>Google user data</h2>
      <p>
        GoalFi’s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.
        Google Health data is used only to provide the challenge features described above, which you choose to use; it isn’t used for advertising, isn’t sold, and isn’t read by people except
        as the daily totals shown inside challenges you join, or where needed for security, to comply with law, or with your consent.
      </p>

      <h2>Keeping and deleting your data</h2>
      <ul>
        <li><b>Disconnect any connected account</b> in <Link href="/settings#accounts">Settings → Connected accounts</Link>. GoalFi revokes its access with that service and deletes the stored activity data straight away.</li>
        <li>Progress already counted in a challenge stays as part of that challenge’s record, so results and disputes remain checkable.</li>
        <li>To delete your whole account, contact {contactLine()}. Records needed for finished markets and the audit log may be kept as required to settle disputes and prevent fraud; public blockchain records can’t be deleted by anyone.</li>
      </ul>

      <h2>Security</h2>
      <p>Passwords are hashed, connected-account tokens are encrypted at rest, and sign-ins with other services are protected against forgery. No system is perfectly secure; tell us at {contactLine()} if you find a problem.</p>

      <h2>Age</h2>
      <p>GoalFi includes prediction markets and is intended for people aged 18 and over.</p>

      <h2>Changes</h2>
      <p>If this policy changes in a meaningful way, GoalFi will update the date above and tell users on the site.</p>
    </LegalPage>
  );
}
