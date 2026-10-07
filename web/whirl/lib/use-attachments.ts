"use client";

import { useCallback, useRef, useState } from "react";
import { useAction, useMutation } from "@whirl/backend/react";

import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";
import {
  getAttachmentType,
  makeAttachmentId,
  prepareAttachment,
  prepareDirectAttachment,
  type AttachmentUpload,
} from "@whirl/lib/attachments";

/* Draft lifecycle for composer attachments, ported from v1's
   use-attachment-uploads: every picked file starts uploading immediately
   and tracks its own progress on a draft; send calls resolve() to wait
   out anything still in flight. Whether a draft is *acceptable* is not
   tracked here — that's model-relative and re-checked at render
   (attachmentRejectionReason). */

export type AttachmentDraft = {
  id: string;
  name: string;
  size: number;
  type: string;
  /** `reading` is the beat after a document's bytes land, while the backend
   *  turns it into Markdown. Only documents ever pass through it. */
  status: "uploading" | "reading" | "ready" | "error";
  /** Upload progress, 0..1. Sits at 1 once ready. */
  progress: number;
  /** Object URL for image previews — revoked on remove/clear. */
  previewUrl?: string;
  error?: string;
  upload?: AttachmentUpload;
};

export function useAttachments({
  /* Locked chats have nowhere to upload to: their files go from this tab
     straight into the turn, so there's no storage round trip and no
     progress to report. See prepareDirectAttachment. */
  direct = false,
}: { direct?: boolean } = {}) {
  const generateUploadUrl = useMutation(
    api.messages.generateAttachmentUploadUrl,
  );
  const convertDocument = useAction(api.attachmentMarkdown.convert);
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  /* Write-through mirror so resolve() reads the post-settle truth without
     waiting for a render, plus the in-flight jobs it awaits. */
  const draftsRef = useRef<AttachmentDraft[]>([]);
  const pendingRef = useRef(new Map<string, Promise<void>>());

  const commit = useCallback(
    (updater: (prev: AttachmentDraft[]) => AttachmentDraft[]) => {
      setDrafts((prev) => {
        const next = updater(prev);
        draftsRef.current = next;
        return next;
      });
    },
    [],
  );

  const patch = useCallback(
    (id: string, updates: Partial<AttachmentDraft>) => {
      commit((prev) =>
        prev.map((draft) =>
          draft.id === id ? { ...draft, ...updates } : draft,
        ),
      );
    },
    [commit],
  );

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      for (const file of files) {
        const id = makeAttachmentId();
        const type = getAttachmentType(file);
        const previewUrl = type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        commit((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            size: file.size,
            type,
            status: "uploading",
            progress: 0,
            previewUrl,
          },
        ]);

        const job = (async () => {
          try {
            const upload = direct
              ? await prepareDirectAttachment(file)
              : await prepareAttachment({
                  file,
                  getUploadUrl: () => generateUploadUrl(),
                  /* The converter is also the stage boundary: it only ever
                     runs once the bytes have landed, so flipping the chip
                     here saves threading a second callback through
                     prepareAttachment. */
                  convertDocument: ({ storageId, name }) => {
                    patch(id, { status: "reading", progress: 1 });
                    return convertDocument({
                      storageId: storageId as Id<"_storage">,
                      name,
                    });
                  },
                  onProgress: (fraction) => patch(id, { progress: fraction }),
                });
            /* Compression can shrink and rename an image — keep the chip
               honest about what will actually send. */
            patch(id, {
              status: "ready",
              progress: 1,
              upload,
              name: upload.name,
              size: upload.size,
              type: upload.type,
            });
          } catch (error) {
            patch(id, {
              status: "error",
              error:
                error instanceof Error ? error.message : "Upload failed.",
            });
          } finally {
            pendingRef.current.delete(id);
          }
        })();
        pendingRef.current.set(id, job);
      }
    },
    [commit, patch, direct, generateUploadUrl, convertDocument],
  );

  const remove = useCallback(
    (id: string) => {
      const target = draftsRef.current.find((draft) => draft.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      pendingRef.current.delete(id);
      commit((prev) => prev.filter((draft) => draft.id !== id));
    },
    [commit],
  );

  const clear = useCallback(() => {
    for (const draft of draftsRef.current) {
      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    }
    pendingRef.current.clear();
    commit(() => []);
  }, [commit]);

  /** Wait for every in-flight upload, then hand back the ready uploads in
   * tray order. Errored drafts stay behind on screen. */
  const resolve = useCallback(async (): Promise<AttachmentUpload[]> => {
    await Promise.allSettled([...pendingRef.current.values()]);
    return draftsRef.current
      .map((draft) => draft.upload)
      .filter((upload): upload is AttachmentUpload => upload !== undefined);
  }, []);

  return { drafts, addFiles, remove, clear, resolve };
}
