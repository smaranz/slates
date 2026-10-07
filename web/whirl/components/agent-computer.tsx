"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowLeft, IconBrowser, IconHandFinger, IconPlayerPlayFilled } from "@tabler/icons-react";

import { Button } from "@whirl/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@whirl/components/ui/dialog";
import { Input } from "@whirl/components/ui/input";
import { cn } from "@whirl/lib/utils";

/* The agents' browser, live: the real Chrome on the host that agents drive,
   streamed as frames. Watch what they're doing, or take control to sign in
   somewhere for them — clicks, scrolls and typing go straight to the page.
   Sign-ins persist, so an agent can carry on once you hand it back. */

type Frame = { running: boolean; url?: string; title?: string; width?: number; height?: number; image?: string; error?: string };

async function post(body: unknown) {
  const response = await fetch("/api/agent/computer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok || data.error) throw new Error(data.error ?? "The browser didn't respond.");
}

export function AgentComputer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [control, setControl] = useState(false);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const typed = useRef("");
  const flushTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const data = (await (await fetch("/api/agent/computer", { cache: "no-store" })).json()) as Frame;
      setFrame(data);
      if (!data.running) setControl(false);
      if (!editing && data.url) setAddress(data.url);
    } catch {
      /* keep the last frame */
    }
  }, [editing]);

  // Frames only while the dialog is open; faster while you're driving.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: number | undefined;
    const loop = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") await load();
      timer = window.setTimeout(loop, control ? 450 : 1100);
    };
    void loop();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, load, control]);

  useEffect(() => {
    if (control) screen.current?.focus();
  }, [control]);

  const send = useCallback(
    async (input: Record<string, unknown>) => {
      try {
        await post({ input });
        setError(null);
        window.setTimeout(() => void load(), 150);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const flushTyped = useCallback(() => {
    window.clearTimeout(flushTimer.current);
    const text = typed.current;
    typed.current = "";
    if (text) void send({ type: "text", text });
  }, [send]);

  const point = (clientX: number, clientY: number) => {
    const el = img.current;
    if (!el || !frame?.width || !frame.height) return null;
    const box = el.getBoundingClientRect();
    return { x: ((clientX - box.left) / box.width) * frame.width, y: ((clientY - box.top) / box.height) * frame.height };
  };

  const start = async () => {
    setStarting(true);
    try {
      await post({ op: "start" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          flushTyped();
          setControl(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[min(64rem,calc(100vw-2rem))] max-w-none flex-col gap-3 sm:max-w-none">
        <div className="flex items-center gap-2">
          <DialogTitle className="flex shrink-0 items-center gap-2 text-base">
            <IconBrowser size={18} />
            Computer
          </DialogTitle>
          {frame?.running && (
            <form
              className="flex min-w-0 flex-1 items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                setEditing(false);
                if (address.trim()) void send({ type: "navigate", url: address.trim() });
              }}
            >
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Back" onClick={() => void send({ type: "back" })}>
                <IconArrowLeft size={15} />
              </Button>
              <Input
                value={address}
                onFocus={() => setEditing(true)}
                onBlur={() => setEditing(false)}
                onChange={(e) => setAddress(e.target.value)}
                aria-label="Address"
                spellCheck={false}
                className="h-8 text-[13px]"
              />
            </form>
          )}
          {frame?.running && (
            <Button
              size="sm"
              variant={control ? "default" : "secondary"}
              onClick={() => {
                flushTyped();
                setControl((c) => !c);
              }}
            >
              <IconHandFinger size={14} />
              {control ? "Hand back" : "Take control"}
            </Button>
          )}
        </div>

        {!frame ? (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">Connecting…</div>
        ) : !frame.running ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg bg-muted text-center text-sm text-muted-foreground">
            <span className="max-w-sm">The agents&apos; browser isn&apos;t running. It starts on its own when an agent needs it, or start it now to sign in somewhere for them.</span>
            <Button size="sm" onClick={() => void start()} disabled={starting}>
              <IconPlayerPlayFilled size={13} />
              {starting ? "Starting…" : "Start browser"}
            </Button>
          </div>
        ) : (
          <div
            ref={screen}
            tabIndex={control ? 0 : -1}
            className={cn("relative min-h-0 overflow-hidden rounded-lg bg-black outline-none", control && "ring-2 ring-ring")}
            onWheel={(e) => {
              if (!control) return;
              const p = point(e.clientX, e.clientY);
              if (p) void send({ type: "scroll", ...p, dy: e.deltaY });
            }}
            onKeyDown={(e) => {
              if (!control) return;
              if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                typed.current += e.key;
                window.clearTimeout(flushTimer.current);
                flushTimer.current = window.setTimeout(flushTyped, 250);
              } else if (["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete"].includes(e.key)) {
                e.preventDefault();
                flushTyped();
                void send({ type: "key", key: e.key });
              }
            }}
          >
            {frame.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- a live frame, not an asset
              <img
                ref={img}
                src={`data:image/jpeg;base64,${frame.image}`}
                alt={frame.title ? `The agents' browser: ${frame.title}` : "The agents' browser"}
                className={cn("block max-h-[70dvh] w-full object-contain", control ? "cursor-pointer" : "cursor-default")}
                draggable={false}
                onClick={(e) => {
                  if (!control) return;
                  flushTyped();
                  const p = point(e.clientX, e.clientY);
                  if (p) void send({ type: "click", ...p });
                }}
              />
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-neutral-400">{frame.error ?? "Waiting for a frame…"}</div>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {error ??
            (control
              ? "You're in control: click, scroll and type on the page. Hand back when you're done."
              : "Agents drive this browser. Sign-ins stay, so take control to log in to a site for them. Never type passwords into chat.")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
