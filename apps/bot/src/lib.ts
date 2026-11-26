// Library entry: everything needed to run the bot either as a standalone process (src/index.ts)
// or inside the website as a Telegram webhook (apps/web /api/telegram/webhook).
export { createBot } from "./bot";
export { deliverNotifications, deliverOutbox } from "./dispatch";

export const BOT_COMMANDS = [
  { command: "dashboard", description: "Your stats and active challenges" },
  { command: "challenges", description: "Active challenges" },
  { command: "markets", description: "Live markets and prices" },
  { command: "leaderboard", description: "Rankings" },
  { command: "submit", description: "Submit evidence" },
  { command: "ideas", description: "Challenge ideas for this group" },
  { command: "join", description: "Join this group's GoalFi community" },
  { command: "help", description: "Help" },
];

export const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"] as const;
