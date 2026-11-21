import { getCurrentUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/api";

export const GET = route(async () => json({ user: await getCurrentUser() }));
