import { listEvidence, MAX_FILE_BYTES, MAX_FILES, submitEvidence, type UploadedFile } from "@goalfi/services";
import { getCurrentUser, HttpError, requireUser } from "@/lib/server/auth";
import { json, rateLimit, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const user = await getCurrentUser();
  return json({ evidence: await listEvidence(services(), user && actorOf(user), (await params).id) });
});

/** multipart/form-data: fields description, links (newline-separated), progressValue, activityDate, supersedesId; files[] */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser();
  await rateLimit(`evidence:${user.id}`, 30, 3600);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_FILES * MAX_FILE_BYTES + 100_000) throw new HttpError(413, "Upload too large");
  const form = await req.formData();
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  const files: UploadedFile[] = [];
  for (const f of form.getAll("files")) {
    if (typeof f === "string" || f.size === 0) continue;
    files.push({ name: f.name, mimeType: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  const progress = str("progressValue");
  const body = {
    description: str("description") ?? "",
    links: (str("links") ?? "").split(/\s+/).filter(Boolean),
    progressValue: progress !== undefined ? Number(progress) : undefined,
    activityDate: str("activityDate"),
    supersedesId: str("supersedesId"),
  };
  const e = await submitEvidence(services(), actorOf(user), (await params).id, body, files);
  return json({ id: e.id, contentHash: e.contentHash }, { status: 201 });
});
