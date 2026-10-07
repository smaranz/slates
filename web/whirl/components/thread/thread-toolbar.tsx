"use client";

import { useState } from "react";
import { IconBrowser, IconFiles } from "@tabler/icons-react";

import { AgentComputer } from "@whirl/components/agent-computer";
import { AgentFiles } from "@whirl/components/agent-files";
import { ThreadFilesMenu } from "./thread-files-menu";
import { TOOLBAR_PILL_CLASS } from "./toolbar-pill";

/* The thread's top-right corner: the thread's own artifacts, then the agent
   layer's two windows onto the host — Computer (the agents' live browser)
   and Files (what they sent you, and their workspace). Whirl's share pill
   is gone: chats stay on the host, so there's no public link to make. */
export function ThreadToolbar({
  threadId,
  locked = false,
}: {
  threadId: string;
  locked?: boolean;
}) {
  const [computer, setComputer] = useState(false);
  const [files, setFiles] = useState(false);
  if (locked) return null;
  return (
    <div className="flex items-center gap-1.5">
      <ThreadFilesMenu threadId={threadId} />
      <button type="button" className={TOOLBAR_PILL_CLASS} onClick={() => setFiles(true)}>
        <IconFiles size={15} />
        Files
      </button>
      <button type="button" className={TOOLBAR_PILL_CLASS} onClick={() => setComputer(true)}>
        <IconBrowser size={15} />
        Computer
      </button>
      <AgentFiles open={files} onOpenChange={setFiles} />
      <AgentComputer open={computer} onOpenChange={setComputer} />
    </div>
  );
}
