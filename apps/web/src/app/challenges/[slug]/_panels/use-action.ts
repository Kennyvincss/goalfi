"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Small helper: call an API route, show errors, refresh server data on success. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(url: string, init: RequestInit & { json?: unknown } = {}): Promise<unknown | null> {
    setBusy(true);
    setError(null);
    try {
      const { json, ...rest } = init;
      const res = await fetch(url, {
        method: "POST",
        ...rest,
        ...(json !== undefined ? { body: JSON.stringify(json), headers: { "content-type": "application/json" } } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(data.details) ? `: ${data.details.join("; ")}` : data.details ? `: ${Object.values(data.details).flat().join("; ")}` : "";
        setError((data.error ?? "Request failed") + details);
        return null;
      }
      router.refresh();
      return data;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
}
