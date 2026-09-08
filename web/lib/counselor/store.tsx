"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useIdentity } from "../identity";
import { importRecord, parseRecord } from "./import";
import { applyPatch, emptyState, loadState, newThread, saveState, uid } from "./state";
import type {
  ChatMessage,
  CounselorDoc,
  Essay,
  CounselorProfile,
  CounselorState,
  StatePatch,
  Task,
  Thread,
} from "./types";

/**
 * The counselor's record, held in the browser and written through on change.
 *
 * The load is deliberately deferred to an effect rather than done in the
 * initial state: this renders on the server too, where there is no
 * localStorage, and reading it during render would hydrate one tree and then
 * replace it with another.
 */

export type CounselorView =
  | "chat"
  | "voice"
  | "essays"
  | "documents"
  | "plan"
  | "colleges"
  | "profile";

interface CounselorStore extends CounselorState {
  /** False until the saved record has been read, so views can hold off. */
  ready: boolean;

  view: CounselorView;
  setView: (v: CounselorView) => void;

  threadId: string | null;
  thread: Thread | null;
  openThread: (id: string | null) => void;
  startThread: () => string;
  deleteThread: (id: string) => void;
  setMessages: (threadId: string, next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;

  /** Folds a turn's tool edits into the record. */
  merge: (patch: StatePatch) => void;
  /** Reads an intake record produced elsewhere. See lib/counselor/import.ts. */
  importFrom: (text: string) => { summary: string[]; warnings: string[] };

  setProfile: (next: CounselorProfile) => void;
  addTask: (title: string, dueDate?: string) => void;
  setTaskStatus: (id: string, status: Task["status"]) => void;
  removeTask: (id: string) => void;
  saveDoc: (doc: CounselorDoc) => void;
  saveEssay: (essay: Essay) => void;
  removeEssay: (id: string) => void;
  /** The essay open in the studio. */
  essayId: string | null;
  openEssay: (id: string | null) => void;
  removeDoc: (id: string) => void;
  removeMemory: (id: string) => void;
  toggleList: (collegeId: string, round?: "ED" | "EA" | "RD") => void;

  /** The open document in the side panel, if any. */
  docId: string | null;
  openDoc: (id: string | null) => void;
}

const Ctx = createContext<CounselorStore | null>(null);

export function useCounselor(): CounselorStore {
  const value = useContext(Ctx);
  if (!value) throw new Error("useCounselor must be used inside <CounselorProvider>");
  return value;
}

export function CounselorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CounselorState>(emptyState);
  const identity = useIdentity();
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<CounselorView>("chat");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [essayId, setEssayId] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadState();
    setState(saved);
    setThreadId(saved.threads[0]?.id ?? null);
    setReady(true);
  }, []);

  // Nothing is written before the first read, or an empty initial state would
  // overwrite a real saved one on mount.
  const first = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (first.current) {
      first.current = false;
      return;
    }
    saveState(state);
  }, [state, ready]);

  const merge = useCallback(
    (patch: StatePatch) => {
      // A turn that recorded a name recorded it for the whole app.
      if (patch.profile && patch.profile.name && patch.profile.name !== identity.name) {
        identity.setName(patch.profile.name);
      }
      setState((prev) => applyPatch(prev, patch));
    },
    [identity]
  );

  const importFrom = useCallback(
    (text: string) => {
      const parsed = parseRecord(text);
      if ("error" in parsed) return { summary: [], warnings: [parsed.error] };

      // Read against the state as it is right now rather than a closed-over
      // copy: an import is additive, and appending to a stale list would drop
      // whatever the counselor learned since this callback was created.
      let result = { summary: [] as string[], warnings: [] as string[] };
      setState((prev) => {
        const outcome = importRecord(parsed.value, prev);
        result = { summary: outcome.summary, warnings: outcome.warnings };
        if (outcome.patch.profile?.name && outcome.patch.profile.name !== identity.name) {
          identity.setName(outcome.patch.profile.name);
        }
        return applyPatch(prev, outcome.patch);
      });
      return result;
    },
    [identity]
  );

  const startThread = useCallback(() => {
    const thread = newThread();
    setState((prev) => ({ ...prev, threads: [thread, ...prev.threads] }));
    setThreadId(thread.id);
    return thread.id;
  }, []);

  const deleteThread = useCallback((id: string) => {
    setState((prev) => ({ ...prev, threads: prev.threads.filter((t) => t.id !== id) }));
    setThreadId((current) => (current === id ? null : current));
  }, []);

  const setMessages = useCallback(
    (id: string, next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setState((prev) => ({
        ...prev,
        threads: prev.threads.map((t) => {
          if (t.id !== id) return t;
          const messages = typeof next === "function" ? next(t.messages) : next;
          // The first thing the student says names the conversation — a thread
          // called "New conversation" forever is a list you can't read.
          const firstUser = messages.find((m) => m.role === "user")?.content ?? "";
          const title =
            t.title === "New conversation" && firstUser
              ? firstUser.trim().split("\n")[0].slice(0, 60)
              : t.title;
          return { ...t, messages, title, updatedAt: Date.now() };
        }),
      }));
    },
    []
  );

  /**
   * The name is not the counselor's to own — it's the same person the school
   * half greets in its sidebar — so it is split back out to the shared
   * identity and the rest of the college profile is stored here. That is why
   * `update_profile_fact("name", …)` in a conversation renames you everywhere.
   */
  const setProfile = useCallback(
    (next: CounselorProfile) => {
      if (next.name !== identity.name) identity.setName(next.name);
      setState((prev) => ({ ...prev, profile: { ...next, name: next.name } }));
    },
    [identity]
  );

  const addTask = useCallback((title: string, dueDate?: string) => {
    const now = Date.now();
    setState((prev) => ({
      ...prev,
      tasks: [
        { id: uid(), title, dueDate, status: "open", source: "student", createdAt: now, updatedAt: now },
        ...prev.tasks,
      ],
    }));
  }, []);

  const setTaskStatus = useCallback((id: string, status: Task["status"]) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, status, updatedAt: Date.now() } : t)),
    }));
  }, []);

  const removeTask = useCallback((id: string) => {
    setState((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== id) }));
  }, []);

  const saveDoc = useCallback((doc: CounselorDoc) => {
    setState((prev) => ({
      ...prev,
      documents: prev.documents.some((d) => d.id === doc.id)
        ? prev.documents.map((d) => (d.id === doc.id ? doc : d))
        : [doc, ...prev.documents],
    }));
  }, []);

  const saveEssay = useCallback((essay: Essay) => {
    setState((prev) => ({
      ...prev,
      essays: prev.essays.some((e) => e.id === essay.id)
        ? prev.essays.map((e) => (e.id === essay.id ? essay : e))
        : [essay, ...prev.essays],
    }));
  }, []);

  const removeEssay = useCallback((id: string) => {
    setState((prev) => ({ ...prev, essays: prev.essays.filter((e) => e.id !== id) }));
    setEssayId((current) => (current === id ? null : current));
  }, []);

  const removeDoc = useCallback((id: string) => {
    setState((prev) => ({ ...prev, documents: prev.documents.filter((d) => d.id !== id) }));
    setDocId((current) => (current === id ? null : current));
  }, []);

  const removeMemory = useCallback((id: string) => {
    setState((prev) => ({ ...prev, memories: prev.memories.filter((m) => m.id !== id) }));
  }, []);

  const toggleList = useCallback((collegeId: string, round: "ED" | "EA" | "RD" = "RD") => {
    setState((prev) => {
      const existing = prev.list.find((e) => e.collegeId === collegeId);
      if (existing && existing.round === round) {
        return { ...prev, list: prev.list.filter((e) => e.collegeId !== collegeId) };
      }
      return {
        ...prev,
        list: [...prev.list.filter((e) => e.collegeId !== collegeId), { collegeId, round, addedAt: Date.now() }],
      };
    });
  }, []);

  const thread = useMemo(
    () => state.threads.find((t) => t.id === threadId) ?? null,
    [state.threads, threadId]
  );

  // Whatever is stored locally, the name handed out is the shared one — so a
  // record saved before the identity was unified reads as the same person.
  const profile = useMemo(
    () => ({ ...state.profile, name: identity.name }),
    [state.profile, identity.name]
  );

  const value = useMemo<CounselorStore>(
    () => ({
      ...state,
      profile,
      ready: ready && identity.ready,
      view,
      setView,
      threadId,
      thread,
      openThread: setThreadId,
      startThread,
      deleteThread,
      setMessages,
      merge,
      importFrom,
      setProfile,
      addTask,
      setTaskStatus,
      removeTask,
      saveDoc,
      saveEssay,
      removeEssay,
      essayId,
      openEssay: setEssayId,
      removeDoc,
      removeMemory,
      toggleList,
      docId,
      openDoc: setDocId,
    }),
    [
      state, profile, ready, identity.ready, view, threadId, thread, startThread, deleteThread, setMessages, merge, importFrom,
      setProfile, addTask, setTaskStatus, removeTask, saveDoc, removeDoc, removeMemory,
      toggleList, docId, saveEssay, removeEssay, essayId,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
