"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { readAttachment, toTutorMessageParts, type Attachment } from "@/lib/attachments";
import { useStore } from "@/lib/store";
import { useTutorModel } from "@/lib/use-tutor-model";
import ModelPicker from "./ModelPicker";
import { Icon, ICON } from "./ui";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: Attachment[];
}

const ACCEPTED_FILE_TYPES =
  "image/*,.pdf,.txt,.md,.markdown,.csv,.json,.log,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.html,.css,.xml,.yml,.yaml";

const SUGGESTIONS = [
  "What should I do first tonight?",
  "Explain series convergence tests",
  "How do I raise my Calc grade?",
];

export default function TutorView() {
  const s = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useTutorModel();
  const [pending, setPending] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setReading(true);
    setError(null);
    try {
      const read = await Promise.all(Array.from(files).map(readAttachment));
      setPending((prev) => [...prev, ...read]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setReading(false);
    }
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((prev) => prev.filter((a) => a.id !== id));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, thinking]);

  /** One line per course, so the tutor can reference real work. */
  const buildContext = useCallback(() => {
    return s.snapshot.courses
      .map((c) => {
        const open = s.snapshot.assignments.filter(
          (a) => a.courseId === c.id && s.statusOf(a) !== "done"
        );
        const list = open.map((a) => a.title).join("; ") || "nothing due";
        return `${c.name}: ${c.grade} (${c.letter}), ${open.length} open — ${list}`;
      })
      .join("\n");
  }, [s]);

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? draft).trim();
      const attachments = pending;
      if ((!text && attachments.length === 0) || thinking) return;

      const next: ChatMessage[] = [
        ...messages,
        {
          id: `u${Date.now()}`,
          role: "user",
          text,
          attachments: attachments.length ? attachments : undefined,
        },
      ];
      const replyId = `a${Date.now()}`;
      setMessages([...next, { id: replyId, role: "assistant", text: "" }]);
      setDraft("");
      setPending([]);
      setThinking(true);
      setError(null);

      try {
        const res = await fetch("/api/tutor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: next.map((m) => ({
              role: m.role,
              content:
                m.role === "user" ? toTutorMessageParts(m.text, m.attachments) : m.text,
            })),
            context: buildContext(),
            studentName: s.studentName || undefined,
            model,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`Tutor unavailable (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, text: acc } : m))
          );
        }

        if (!acc.trim()) throw new Error("Empty response from tutor.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        // Drop the empty assistant bubble so the thread doesn't show a blank.
        setMessages((prev) => prev.filter((m) => m.id !== replyId || m.text));
      } finally {
        setThinking(false);
      }
    },
    [buildContext, draft, messages, model, pending, s.studentName, thinking]
  );

  const empty = messages.length === 0;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 24px 8px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 760,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            justifyContent: "flex-end",
            minHeight: "100%",
          }}
        >
          {empty && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                margin: "auto 0",
                textAlign: "center",
              }}
            >
              <Image
                src="/assets/slates-mark.png"
                alt=""
                width={34}
                height={34}
                style={{ display: "block", objectFit: "contain", opacity: 0.9 }}
              />
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>
                What are you working on?
              </div>
              <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: 1.5, color: "var(--muted)" }}>
                Ask about any assignment, a concept you&apos;re stuck on, or how to spend tonight.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 6 }}>
                {SUGGESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 9999,
                      background: "transparent",
                      padding: "8px 14px",
                      font: "inherit",
                      fontSize: 13,
                      color: "var(--text-2)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              style={{ display: "flex", width: "100%", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}
            >
              <div
                style={
                  m.role === "user"
                    ? {
                        maxWidth: "75%",
                        borderRadius: 24,
                        background: "var(--raised)",
                        padding: "10px 16px",
                        fontSize: 15,
                        lineHeight: 1.5,
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.2)",
                        whiteSpace: "pre-wrap",
                      }
                    : {
                        maxWidth: "min(75%, 42rem)",
                        borderRadius: 24,
                        border: "1px solid var(--line)",
                        background: "var(--surface)",
                        padding: "10px 16px",
                        fontSize: 15,
                        lineHeight: 1.55,
                        color: "var(--text)",
                        boxShadow: "var(--shadow-card)",
                        whiteSpace: "pre-wrap",
                      }
                }
              >
                {m.attachments && m.attachments.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginBottom: m.text ? 8 : 0,
                    }}
                  >
                    {m.attachments.map((a) => (
                      <AttachmentChip key={a.id} attachment={a} />
                    ))}
                  </div>
                )}
                {m.text}
              </div>
            </div>
          ))}

          {thinking && messages[messages.length - 1]?.text === "" && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 36,
                  borderRadius: 9999,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  padding: "0 16px",
                }}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 9999,
                      background: "var(--muted)",
                      animation: `slates-typing 1.4s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: "var(--warn)", textAlign: "center" }}>{error}</div>
          )}
        </div>
      </div>

      <div style={{ padding: "8px 24px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: "100%",
            maxWidth: 760,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            borderRadius: 26,
            border: "1px solid var(--line)",
            background: "var(--sunken)",
            boxShadow: "var(--shadow-sunken)",
            padding: "8px 8px 8px 10px",
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          {pending.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "2px 2px 0" }}>
              {pending.map((a) => (
                <AttachmentChip key={a.id} attachment={a} onRemove={() => removePending(a.id)} />
              ))}
            </div>
          )}

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) addFiles(files);
            }}
            rows={1}
            placeholder="Ask your tutor"
            aria-label="Ask your tutor"
            className="bare-field bare-field--chat"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILE_TYPES}
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Add photos or files"
              disabled={reading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                flexShrink: 0,
                borderRadius: 9999,
                border: "1px solid var(--line)",
                background: "transparent",
                color: "var(--text-2)",
                cursor: "pointer",
                opacity: reading ? 0.5 : 1,
              }}
            >
              <Icon path={ICON.plus} size={15} />
            </button>
            <ModelPicker value={model} onChange={setModel} />
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => send()}
              aria-label="Send"
              disabled={(!draft.trim() && pending.length === 0) || thinking}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                flexShrink: 0,
                border: 0,
                borderRadius: 9999,
                cursor: "pointer",
                backgroundImage:
                  "linear-gradient(180deg, oklch(0.42 0 0) 0%, oklch(0.37 0 0) 100%)",
                color: "var(--text)",
                boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.08), 0 1px 2px oklch(0 0 0 / 0.2)",
                opacity: (!draft.trim() && pending.length === 0) || thinking ? 0.4 : 1,
                pointerEvents: (!draft.trim() && pending.length === 0) || thinking ? "none" : "auto",
              }}
            >
              <Icon path={[ICON.send, ICON.send2]} size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove?: () => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 6,
        maxWidth: 180,
        borderRadius: attachment.kind === "image" ? 10 : 9999,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        overflow: "hidden",
        ...(attachment.kind === "image" ? { width: 44, height: 44 } : { padding: "5px 10px 5px 8px" }),
      }}
      title={attachment.name}
    >
      {attachment.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <>
          <Icon path={ICON.file} size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span
            style={{
              fontSize: 12,
              color: "var(--text-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {attachment.name}
          </span>
        </>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
          style={{
            position: "absolute",
            top: attachment.kind === "image" ? 2 : "50%",
            right: attachment.kind === "image" ? 2 : 4,
            transform: attachment.kind === "image" ? undefined : "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            flexShrink: 0,
            border: 0,
            borderRadius: 9999,
            background: "oklch(0 0 0 / 0.55)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          <Icon path={ICON.close} size={9} />
        </button>
      )}
    </div>
  );
}
