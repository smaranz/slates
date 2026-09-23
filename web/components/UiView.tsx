"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  UI_REGISTRIES,
  addCommand,
  languageOf,
  registryById,
  type RegistryEntry,
  type RegistryFile,
  type RegistryItem,
} from "@/lib/ui-registries";
import { useHiddenRegistries } from "@/lib/app-prefs";
import { Icon, ICON } from "./ui";

/**
 * The UI shelf.
 *
 * This was a wall of links — every card opened a website, which is a bookmarks
 * folder with a nicer grid. What you want from a component library is the
 * component: how it looks, and the file that makes it look that way. Every
 * registry here publishes the source as JSON, the same endpoint the shadcn CLI
 * reads, so both come into Slates instead of Slates sending you out.
 *
 * One shelf, not nine. Which library a component came from is a label on the
 * row, the way a book's publisher is printed inside rather than deciding which
 * room of the house you have to walk to first.
 */

type Status = "idle" | "loading" | "ready" | "error";

/** An index row, plus where it came from once the registries are merged. */
type Shelved = RegistryEntry & { registry: string; registryName: string };

/**
 * Registries publish more than components: the `cn` helper, hooks, theme
 * files. There is nothing to render for those, so they go straight to source
 * rather than showing an empty stage and a note explaining itself.
 */
const NOT_VISUAL = /(lib|hook|theme|style|file|page)$/;

function isVisual(entry: Shelved | null): boolean {
  return !!entry && !NOT_VISUAL.test(entry.type ?? "registry:ui");
}

export default function UiView() {
  const [entries, setEntries] = useState<Shelved[]>([]);
  const [indexState, setIndexState] = useState<Status>("loading");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const [picked, setPicked] = useState<Shelved | null>(null);
  const [item, setItem] = useState<RegistryItem | null>(null);
  const [itemState, setItemState] = useState<Status>("idle");
  const [itemError, setItemError] = useState<string | null>(null);
  const [gate, setGate] = useState<{ message: string; home: string } | null>(
    null,
  );

  /** Everything the preview needs to compile: the component plus its parts. */
  const [bundle, setBundle] = useState<{
    files: RegistryFile[];
    entry: string;
  } | null>(null);

  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [query, setQuery] = useState("");
  const [fileIndex, setFileIndex] = useState(0);
  const [copied, setCopied] = useState<"code" | "cmd" | null>(null);

  const frame = useRef<HTMLIFrameElement | null>(null);
  const frameReady = useRef(false);
  const pending = useRef<unknown>(null);

  /* ── the shelf ───────────────────────────────────────────────────────── */

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/ui/registry?registry=all");
        const body = (await res.json()) as {
          entries?: Shelved[];
          missing?: string[];
          error?: string;
        };
        if (!live) return;
        if (!res.ok || body.error)
          throw new Error(body.error ?? `Failed (${res.status})`);
        setEntries(body.entries ?? []);
        setMissing(body.missing ?? []);
        setIndexState("ready");
      } catch (err) {
        if (!live) return;
        setIndexError(
          err instanceof Error ? err.message : "Couldn't read the registries.",
        );
        setIndexState("error");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Libraries switched off in Settings › UI stay off the shelf.
  const [hiddenRegistries] = useHiddenRegistries();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const carried = hiddenRegistries.length
      ? entries.filter((e) => !hiddenRegistries.includes(e.registry))
      : entries;
    if (!q) return carried;
    return carried.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.registryName.toLowerCase().includes(q) ||
        (e.description ?? "").toLowerCase().includes(q),
    );
  }, [entries, query, hiddenRegistries]);

  /* ── opening one ─────────────────────────────────────────────────────── */

  const openComponent = useCallback(async (entry: Shelved) => {
    setPicked(entry);
    setTab(isVisual(entry) ? "preview" : "code");
    setItem(null);
    setBundle(null);
    setGate(null);
    setFileIndex(0);
    setItemState("loading");
    setItemError(null);

    try {
      const res = await fetch(
        `/api/ui/registry?registry=${encodeURIComponent(entry.registry)}&item=${encodeURIComponent(entry.name)}`,
      );
      const body = (await res.json()) as {
        item?: RegistryItem;
        bundle?: { files: RegistryFile[]; entry: string };
        error?: string;
        gated?: boolean;
        home?: string;
      };

      // Behind an account: a fact about the component, not an error.
      if (body.gated) {
        setGate({
          message: body.error ?? "That one needs an account.",
          home: body.home ?? entry.registry,
        });
        setItemState("error");
        return;
      }
      if (!res.ok || body.error || !body.item)
        throw new Error(body.error ?? `Failed (${res.status})`);

      setItem(body.item);
      if (!body.item.files.length) {
        setItemError("That component published no source.");
        setItemState("error");
        return;
      }

      setItemState("ready");
      if (body.bundle) setBundle(body.bundle);
    } catch (err) {
      setItemError(
        err instanceof Error ? err.message : "Couldn't read that component.",
      );
      setItemState("error");
    }
  }, []);

  /* ── the preview frame ───────────────────────────────────────────────── */

  const post = useCallback((message: unknown) => {
    // Kept either way: a frame can remount or reload after being sent this,
    // and then the only record of what it should draw is here.
    pending.current = message;
    if (frameReady.current && frame.current?.contentWindow) {
      frame.current.contentWindow.postMessage(message, "*");
    }
  }, []);

  /*
   * A frame counts as ready only once it has said so, tracked per element.
   * The flag outliving its frame is a silent failure: the render goes to a
   * document that hasn't loaded yet, nothing throws, and the stage sits empty.
   */
  const attachFrame = useCallback((node: HTMLIFrameElement | null) => {
    if (node !== frame.current) frameReady.current = false;
    frame.current = node;
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { type?: string };
      if (data?.type === "ready") {
        frameReady.current = true;
        if (pending.current)
          frame.current?.contentWindow?.postMessage(pending.current, "*");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!bundle || !picked || !isVisual(picked)) return;
    // The frame paints its own surface; matching the app keeps the jump small.
    const dark = isDark();
    post({
      type: "render",
      files: bundle.files,
      entry: bundle.entry,
      name: picked.name,
      theme: dark ? "dark" : "light",
    });
  }, [bundle, picked, post]);

  const file = item?.files[fileIndex];
  const registry = picked ? registryById(picked.registry) : null;

  const copy = useCallback(async (text: string, what: "code" | "cmd") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // A denied clipboard is not worth an error state; the code is on screen.
    }
  }, []);

  return (
    <div className="ui-shell">
      {/* ── which component ── */}
      <section className="ui-list">
        <div className="ui-list-head">
          <input
            className="ui-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search every library"
            aria-label="Search every component library"
          />
          {indexState === "ready" && (
            <span className="ui-count">{shown.length.toLocaleString()}</span>
          )}
        </div>

        <div className="ui-list-scroll">
          {indexState === "loading" && (
            <p className="ui-note">
              Reading {UI_REGISTRIES.length} registries…
            </p>
          )}
          {indexState === "error" && (
            <p className="ui-note is-bad">{indexError}</p>
          )}
          {indexState === "ready" && shown.length === 0 && (
            <p className="ui-note">Nothing matching “{query}”.</p>
          )}

          {shown.map((entry) => (
            <button
              key={`${entry.registry}/${entry.name}`}
              type="button"
              className={`ui-entry${entry.name === picked?.name && entry.registry === picked?.registry ? " is-on" : ""}`}
              onClick={() => void openComponent(entry)}
            >
              <span className="ui-entry-top">
                <span className="truncate ui-entry-title">{entry.title}</span>
                <span className="ui-entry-from">{entry.registryName}</span>
              </span>
              {entry.description && (
                <span className="truncate ui-entry-desc">
                  {entry.description}
                </span>
              )}
            </button>
          ))}

          {missing.length > 0 && indexState === "ready" && (
            <p className="ui-note is-faint">
              Couldn’t reach {missing.join(", ")}.
            </p>
          )}
        </div>
      </section>

      {/* ── what it looks like, and what makes it look that way ── */}
      <section className="ui-code">
        {!picked && (
          <div className="ui-blank">
            <p>
              Pick a component. It renders here, live, next to the real file and
              the command that adds it to a project.
            </p>
          </div>
        )}

        {picked && itemState === "loading" && (
          <div className="ui-blank">
            <p>Fetching the source…</p>
          </div>
        )}

        {picked && itemState === "error" && (
          <div className="ui-blank">
            <p className="is-bad">{itemError}</p>
          </div>
        )}

        {item && file && itemState === "ready" && registry && (
          <>
            <header className="ui-code-head">
              <div className="ui-code-id">
                <h2>{item.title}</h2>
                <p>
                  <a
                    href={registry.home}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {registry.name}
                    <Icon path={ICON.external} size={10} />
                  </a>
                  {item.description ? ` · ${item.description}` : ""}
                </p>
              </div>

              {isVisual(picked) ? (
                <div className="ui-tabs">
                  <button
                    type="button"
                    className={`ui-tab${tab === "preview" ? " is-on" : ""}`}
                    onClick={() => setTab("preview")}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className={`ui-tab${tab === "code" ? " is-on" : ""}`}
                    onClick={() => setTab("code")}
                  >
                    Code
                  </button>
                </div>
              ) : (
                <span className="ui-kind">
                  {(picked?.type ?? "").replace("registry:", "")}
                </span>
              )}
            </header>

            <div className="ui-cmd">
              <code>{addCommand(registry, item.name)}</code>
              <button
                type="button"
                className="ui-copy"
                onClick={() =>
                  void copy(addCommand(registry, item.name), "cmd")
                }
              >
                <Icon
                  path={copied === "cmd" ? ICON.check : ICON.copy}
                  size={12}
                />
                {copied === "cmd" ? "Copied" : "Copy"}
              </button>
            </div>

            {/* The frame stays mounted across tabs so switching back doesn't
                recompile a component you already looked at. */}

            <div className={`ui-codepane${tab === "code" ? "" : " is-hidden"}`}>
              {(item.dependencies?.length ||
                item.registryDependencies?.length) && (
                <div className="ui-deps">
                  {item.dependencies?.map((d, i) => (
                    <span key={`npm-${i}-${d}`} className="ui-dep">
                      {d}
                    </span>
                  ))}
                  {item.registryDependencies?.map((d, i) => (
                    <span key={`reg-${i}-${d}`} className="ui-dep is-reg">
                      {d}
                    </span>
                  ))}
                </div>
              )}

              {item.files.length > 1 && (
                <div className="ui-files">
                  {item.files.map((f, i) => (
                    <button
                      key={`${i}-${f.path}`}
                      type="button"
                      className={`ui-file${i === fileIndex ? " is-on" : ""}`}
                      onClick={() => setFileIndex(i)}
                    >
                      {f.path.split("/").pop()}
                    </button>
                  ))}
                </div>
              )}

              <div className="ui-source">
                <div className="ui-source-bar">
                  <span className="truncate">{file.path}</span>
                  <span className="ui-lang">{languageOf(file.path)}</span>
                  <button
                    type="button"
                    className="ui-copy"
                    onClick={() => void copy(file.content, "code")}
                  >
                    <Icon
                      path={copied === "code" ? ICON.check : ICON.copy}
                      size={12}
                    />
                    {copied === "code" ? "Copied" : "Copy file"}
                  </button>
                </div>
                <pre className="ui-pre">
                  <code>{file.content}</code>
                </pre>
              </div>
            </div>
          </>
        )}

        {/* Outside the block above on purpose: that block unmounts for an
            instant on every pick, and a remounted frame has to fetch and
            re-initialise the compiler before it can draw anything. */}
        {picked && isVisual(picked) && (
          <div
            className={`ui-stage${tab === "preview" && itemState === "ready" ? "" : " is-hidden"}`}
          >
            <iframe
              ref={attachFrame}
              className="ui-frame"
              src="/ui-preview.html"
              title="Component preview"
              /* Registry code is someone else's JavaScript. Without
                 allow-same-origin it runs in an opaque origin and cannot read
                 the app's storage or reach into this window. */
              sandbox="allow-scripts"
            />
          </div>
        )}
      </section>
    </div>
  );
}

/** Whether the app is currently painting dark, so the frame can match. */
function isDark(): boolean {
  if (typeof window === "undefined") return false;
  const bg = getComputedStyle(document.body).backgroundColor;
  const rgb = bg.match(/\d+(\.\d+)?/g);
  if (!rgb || rgb.length < 3) return false;
  const [r, g, b] = rgb.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}
