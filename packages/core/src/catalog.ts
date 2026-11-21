import type { SuccessRule } from "./success-rule";

export interface CategoryDef {
  slug: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  examples: string[];
}

/** Initial categories. Admins can add more at runtime (Category table). */
export const INITIAL_CATEGORIES: CategoryDef[] = [
  { slug: "fitness", name: "Fitness", icon: "dumbbell", description: "Running, gym, steps and body goals.",
    examples: ["Running", "Walking", "Gym sessions", "Push-ups", "Weightlifting", "Weight loss", "Daily exercise", "Step counts"] },
  { slug: "education", name: "Education", icon: "graduation-cap", description: "Reading, courses, languages and new skills.",
    examples: ["Reading", "Learning to code", "Online courses", "Consistent study", "Languages", "New skills"] },
  { slug: "productivity", name: "Productivity", icon: "target", description: "Projects, writing, routines and weekly goals.",
    examples: ["Personal projects", "Daily work", "Writing", "Building websites", "Weekly goals", "Daily routines"] },
  { slug: "entertainment", name: "Entertainment", icon: "gamepad-2", description: "Gaming, content creation, music and creative work.",
    examples: ["Gaming competitions", "Content creation", "Music", "Creative competitions"] },
  { slug: "business", name: "Business", icon: "briefcase", description: "Startup milestones, revenue and launches.",
    examples: ["Startup milestones", "Revenue targets", "Product launches", "Growth goals"] },
  { slug: "lifestyle", name: "Lifestyle", icon: "sunrise", description: "Healthy habits and daily routines.",
    examples: ["Waking up early", "Hydration", "Less screen time", "Healthy routines"] },
  { slug: "community", name: "Community", icon: "users", description: "Group competitions and collective milestones.",
    examples: ["Participation", "Group competitions", "Collective milestones", "Social activities"] },
];

export interface ChallengeTemplate {
  id: string;
  category: string;
  title: string;
  description: string;
  rules: string;
  successCriteria: string;
  successRule: SuccessRule;
  evidenceReq: string;
  durationDays: number;
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  marketQuestion: string;
}

const t = (x: ChallengeTemplate) => x;

/** Starter templates. Every field is editable in the create form. */
export const CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  t({ id: "run-50k-7d", category: "fitness", title: "Run 50 km in 7 days", durationDays: 7, recurrence: "NONE",
    description: "Log 50 kilometres of running within one week.",
    rules: "Only outdoor or treadmill runs count. Each run must be a single continuous activity.",
    successCriteria: "Each participant must log at least 50 km of approved runs.",
    successRule: { type: "individual_threshold", unit: "km", threshold: 50, minParticipants: 1 },
    evidenceReq: "Screenshot from a fitness app (Strava, Garmin, Apple Fitness…) showing date and distance.",
    marketQuestion: "Will the participants run 50 km within 7 days?" }),
  t({ id: "pushups-100-daily", category: "fitness", title: "100 push-ups daily", durationDays: 30, recurrence: "DAILY",
    description: "Complete 100 push-ups every day for 30 days.",
    rules: "Sets can be split through the day. One submission per day.",
    successCriteria: "Approved submissions on 30 distinct days.",
    successRule: { type: "daily_completion", requiredDays: 30, minParticipants: 1 },
    evidenceReq: "A short video or a tracker screenshot for each day.",
    marketQuestion: "Will the participants complete 100 push-ups every day for 30 days?" }),
  t({ id: "steps-10k-daily", category: "fitness", title: "Walk 10,000 steps every day", durationDays: 30, recurrence: "DAILY",
    description: "Hit 10,000 steps every day for a month.",
    rules: "Steps from a phone or wearable count. One submission per day.",
    successCriteria: "Approved 10k-step days on 30 distinct days.",
    successRule: { type: "daily_completion", requiredDays: 30, minParticipants: 1 },
    evidenceReq: "Screenshot of the daily step count with the date visible.",
    marketQuestion: "Will the participants hit 10,000 steps every day for 30 days?" }),
  t({ id: "gym-20-in-30", category: "fitness", title: "20 gym sessions in 30 days", durationDays: 30, recurrence: "NONE",
    description: "Train at the gym 20 times within 30 days.",
    rules: "A session is at least 30 minutes of training. Max one session per day counts.",
    successCriteria: "Approved gym sessions on 20 distinct days.",
    successRule: { type: "daily_completion", requiredDays: 20, minParticipants: 1 },
    evidenceReq: "Gym check-in, workout log or photo with timestamp.",
    marketQuestion: "Will the participants complete 20 gym sessions in 30 days?" }),
  t({ id: "community-run-1500", category: "community", title: "30-Day Community Running Challenge", durationDays: 30, recurrence: "NONE",
    description: "Can this community collectively complete 1,500 kilometres of running within 30 days?",
    rules: "Runs must be logged by a supported fitness app. Distances are counted per approved submission.",
    successCriteria: "At least 15 participants must individually complete 100 km within the challenge period.",
    successRule: { type: "individual_threshold", unit: "km", threshold: 100, minParticipants: 15 },
    evidenceReq: "Screenshots or records from supported fitness applications.",
    marketQuestion: "Will the community successfully complete the challenge?" }),
  t({ id: "read-3-books", category: "education", title: "Read three books in 30 days", durationDays: 30, recurrence: "NONE",
    description: "Finish three books in one month.",
    rules: "Books must be at least 150 pages. Audiobooks count.",
    successCriteria: "Each participant logs 3 approved finished books.",
    successRule: { type: "individual_threshold", unit: "books", threshold: 3, minParticipants: 1 },
    evidenceReq: "Photo of the last page, Goodreads/Kindle completion screenshot, or a short written summary.",
    marketQuestion: "Will the participants finish three books in 30 days?" }),
  t({ id: "complete-course", category: "education", title: "Complete a programming course", durationDays: 30, recurrence: "NONE",
    description: "Finish an online programming course end to end.",
    rules: "Pick the course before the start date and state it in your first submission.",
    successCriteria: "An approved certificate or completion record.",
    successRule: { type: "milestone", minCompleters: 1 },
    evidenceReq: "Certificate of completion or a screenshot of 100% progress.",
    marketQuestion: "Will the participant complete the course in time?" }),
  t({ id: "study-2h-daily", category: "education", title: "Study two hours daily", durationDays: 21, recurrence: "DAILY",
    description: "Two focused hours of study every day for three weeks.",
    rules: "Use a timer app. Breaks do not count toward the two hours.",
    successCriteria: "Approved study logs on 21 distinct days.",
    successRule: { type: "daily_completion", requiredDays: 21, minParticipants: 1 },
    evidenceReq: "Timer or focus-app screenshot for each day.",
    marketQuestion: "Will the participants study two hours every day for 21 days?" }),
  t({ id: "language-30", category: "education", title: "Learn a new language: 30-day sprint", durationDays: 30, recurrence: "DAILY",
    description: "Practise a new language every day for 30 days.",
    rules: "At least 20 minutes of practice per day.",
    successCriteria: "Approved practice on 30 distinct days.",
    successRule: { type: "daily_completion", requiredDays: 30, minParticipants: 1 },
    evidenceReq: "Language app streak/lesson screenshot.",
    marketQuestion: "Will the participants practise every day for 30 days?" }),
  t({ id: "ship-website-14d", category: "productivity", title: "Build and launch a website in 14 days", durationDays: 14, recurrence: "NONE",
    description: "Go from nothing to a live website in two weeks.",
    rules: "The site must be publicly reachable on its own URL.",
    successCriteria: "An approved link to the live website.",
    successRule: { type: "milestone", minCompleters: 1 },
    evidenceReq: "The live URL plus a screenshot.",
    marketQuestion: "Will the website be live within 14 days?" }),
  t({ id: "publish-20-articles", category: "productivity", title: "Publish 20 articles", durationDays: 30, recurrence: "NONE",
    description: "Write and publish 20 articles within a month.",
    rules: "Each article must be at least 500 words and publicly published.",
    successCriteria: "20 approved published articles per participant.",
    successRule: { type: "individual_threshold", unit: "articles", threshold: 20, minParticipants: 1 },
    evidenceReq: "Link to each published article.",
    marketQuestion: "Will the participants publish 20 articles in 30 days?" }),
  t({ id: "personal-project", category: "productivity", title: "Complete a personal project", durationDays: 30, recurrence: "NONE",
    description: "Finish a project you have been putting off.",
    rules: "Describe the finished state in your first submission.",
    successCriteria: "An approved submission showing the finished project.",
    successRule: { type: "milestone", minCompleters: 1 },
    evidenceReq: "Photos, links or documents showing the finished project.",
    marketQuestion: "Will the project be completed in time?" }),
  t({ id: "wake-before-6", category: "lifestyle", title: "Wake up before 6 AM for 30 days", durationDays: 30, recurrence: "DAILY",
    description: "Rise before 6 AM every day for a month.",
    rules: "Submit before 6:15 AM local time.",
    successCriteria: "Approved early-rise check-ins on 30 distinct days.",
    successRule: { type: "daily_completion", requiredDays: 30, minParticipants: 1 },
    evidenceReq: "Timestamped photo or sleep-app screenshot.",
    marketQuestion: "Will the participants wake before 6 AM for 30 days?" }),
  t({ id: "community-1000-members", category: "community", title: "Reach 1,000 community members", durationDays: 30, recurrence: "NONE",
    description: "Grow the community to 1,000 members.",
    rules: "Member count is taken from the community's own platform.",
    successCriteria: "An approved screenshot showing at least 1,000 members.",
    successRule: { type: "milestone", minCompleters: 1 },
    evidenceReq: "Screenshot of the member count with date visible.",
    marketQuestion: "Will the community reach 1,000 members within 30 days?" }),
  t({ id: "community-event", category: "community", title: "Organize a community event", durationDays: 30, recurrence: "NONE",
    description: "Plan and hold an in-person or online community event.",
    rules: "At least 10 attendees.",
    successCriteria: "Approved photos/recording of the event.",
    successRule: { type: "milestone", minCompleters: 1 },
    evidenceReq: "Photos, recording, or attendee list.",
    marketQuestion: "Will the event happen within 30 days?" }),
  t({ id: "group-learning", category: "community", title: "Group learning challenge", durationDays: 21, recurrence: "NONE",
    description: "A group studies together and each member finishes the same course.",
    rules: "Everyone takes the same course announced at the start.",
    successCriteria: "At least 5 members finish the course.",
    successRule: { type: "milestone", minCompleters: 5 },
    evidenceReq: "Course completion certificate.",
    marketQuestion: "Will at least 5 members finish the course?" }),
];
