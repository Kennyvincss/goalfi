import { NextResponse } from "next/server";
import { getEvidenceFile } from "@goalfi/services";
import { getCurrentUser } from "@/lib/server/auth";
import { route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ fileId: string }> };

/** Serves evidence only to viewers allowed to see it. Files never get public URLs. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const user = await getCurrentUser();
  const f = await getEvidenceFile(services(), user && actorOf(user), (await params).fileId);
  return new NextResponse(Buffer.from(f.bytes), {
    headers: {
      "content-type": f.mimeType,
      "cache-control": "private, max-age=300",
      "content-disposition": "inline",
      "x-content-sha256": f.sha256,
      "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
