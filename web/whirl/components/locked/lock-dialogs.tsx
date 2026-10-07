"use client";

import { useEffect } from "react";
import { useConvexAuth } from "@whirl/backend/react";

import { ConfirmDialog } from "@whirl/components/confirm-dialog";
import { forgetAllKeys } from "@whirl/lib/locked/keyring";
import {
  closeLockDialog,
  useLockDialog,
} from "@whirl/lib/locked/lock-dialogs";
import { useLockActions } from "@whirl/lib/locked/thread-lock";
import { useSuppressReplay } from "@whirl/lib/replay-guard";
import { showToast } from "@whirl/lib/toasts";
import { useView } from "@whirl/lib/view";
import { ChangePasswordModal } from "./change-password-modal";
import { LockSetupModal } from "./lock-setup-modal";
import { UnlockModal } from "./unlock-modal";

/* The one host for every lock dialog, mounted once near the root. Whichever
   the store names is the one that's up; the rest aren't mounted at all, so a
   dismissed run leaves nothing behind to reset. */

export function LockDialogs() {
  const dialog = useLockDialog();
  const actions = useLockActions();
  const { openThread } = useView();
  const { isAuthenticated } = useConvexAuth();

  /* These can open over any thread, including from the sidebar while an
     ordinary chat is on screen — so they hold replay off themselves rather
     than relying on the chat face having done it. The recovery key in
     particular is shown exactly once, and a recording would keep it. */
  useSuppressReplay(dialog !== null);

  /* Losing the session locks everything back up. Watching the auth state
     rather than hooking the two Log out buttons: a session that simply
     expires has to close these chats too, and a third sign-out path added
     later shouldn't have to remember to. */
  useEffect(() => {
    if (isAuthenticated) return;
    forgetAllKeys();
  }, [isAuthenticated]);

  return (
    <>
      <LockSetupModal
        open={dialog?.kind === "lock"}
        onOpenChange={(open) => !open && closeLockDialog()}
        {...(dialog?.kind === "lock" && dialog.threadId
          ? { threadId: dialog.threadId }
          : {})}
        /* A chat locked from home is a chat that didn't exist a moment ago —
           land in it, ready to type. */
        onLocked={(threadId) => openThread(threadId)}
      />

      <UnlockModal
        threadId={dialog?.kind === "unlock" ? dialog.threadId : null}
        open={dialog?.kind === "unlock"}
        onOpenChange={(open) => !open && closeLockDialog()}
      />

      <ChangePasswordModal
        threadId={dialog?.kind === "password" ? dialog.threadId : null}
        open={dialog?.kind === "password"}
        onOpenChange={(open) => !open && closeLockDialog()}
      />

      <ConfirmDialog
        open={dialog?.kind === "remove"}
        onOpenChange={(open) => !open && closeLockDialog()}
        title="Remove the lock?"
        message="Whirl decrypts this chat and stores it as a usual chat. No password is necessary to open it. The messages do not change."
        confirmLabel="Remove lock"
        destructive
        onConfirm={() => {
          if (dialog?.kind !== "remove") return;
          void actions
            .unlock(dialog.threadId)
            .catch(() =>
              showToast("Whirl cannot remove the lock. Try again."),
            );
        }}
      />
    </>
  );
}
