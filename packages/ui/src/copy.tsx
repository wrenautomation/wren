/**
 * Copy to the clipboard, one way everywhere: the button says "Copied" for a moment, and a copy the
 * browser refuses says so in a toast. `Copyable` is the inline value with its button; `CodeBlock`
 * the labelled block a snippet sits in.
 */
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, type ButtonTone } from "./controls.js";

/** How long "Copied" shows. */
export const COPIED_MS = 1500;

/** `copy(text, key?)`; `copied` is the key last copied, for a moment. */
export function useCopy(): { copied: string | null; copy: (text: string, key?: string) => void } {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string, key = text) => {
    const clip = navigator.clipboard;
    if (!clip) {
      toast.error("Couldn't copy. Select it instead.");
      return;
    }
    void clip.writeText(text).then(
      () => {
        setCopied(key);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), COPIED_MS);
      },
      () => toast.error("Couldn't copy. Select it instead."),
    );
  };
  return { copied, copy };
}

export function CopyButton({
  text,
  label = "Copy",
  tone = "quiet",
  size = "sm",
  className,
}: {
  text: string;
  label?: string;
  tone?: ButtonTone;
  size?: "sm" | "dense";
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <Button size={size} tone={tone} className={className} onClick={() => copy(text)}>
      {copied ? "Copied" : label}
    </Button>
  );
}

/** A value to paste somewhere else (a DNS record, a tag), inline with its copy button. */
export function Copyable({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-2", className)}>
      <code className="break-all text-[13.5px]">{text}</code>
      <CopyButton text={text} />
    </span>
  );
}

/** A labelled block of code to paste (an embed snippet), its copy button by the label. */
export function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-(--ui-ink-2)">{label}</span>
        <CopyButton text={code} />
      </div>
      <code className="block bg-(--ui-fill) p-2 text-[12.5px] break-all whitespace-pre-wrap">
        {code}
      </code>
    </div>
  );
}
