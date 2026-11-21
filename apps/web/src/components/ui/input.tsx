import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-2 disabled:opacity-50",
        className,
      )}
      {...p}
    />
  );
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn("flex min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground", className)}
      {...p}
    />
  );
}

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium", className)} {...p} />;
}
