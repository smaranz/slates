"use client";

import { useRef } from "react";
import {
  IconFileFilled,
  IconMicrophoneFilled,
  IconPlus,
  IconPuzzleFilled,
  IconSparklesFilled,
} from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@whirl/components/ui/dropdown-menu";
import {
  useMentionableIntegrations,
  type MentionTarget,
} from "@whirl/lib/integrations";
import { useMentionableSkills } from "@whirl/lib/skills-data";
import { IntegrationLogo } from "./integration-logo";

const ITEM = "gap-2 px-2 py-1.5";

/* One mention list, rolled into a submenu. Both kinds insert the same
   "@Name" — they're only split so neither can crowd the top-level menu out
   of shape once someone installs a dozen of either. */
function MentionSubmenu({
  label,
  icon,
  mentions,
  onMention,
}: {
  label: string;
  icon: React.ReactNode;
  mentions: MentionTarget[];
  onMention: (name: string) => void;
}) {
  if (mentions.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={ITEM}>
        {icon}
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 min-w-52 p-1">
        {mentions.map((mention) => (
          <DropdownMenuItem
            key={mention.serverId}
            className={ITEM}
            onClick={() => onMention(mention.name)}
          >
            <IntegrationLogo
              name={mention.name}
              logoUrl={mention.logoUrl}
              iconSvg={mention.iconSvg}
              size={18}
            />
            <span className="min-w-0 truncate">{mention.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/* The composer's plus button, opening upward: mentions nested behind their
   own submenus at the top, then the two things you can add to a message —
   your voice and your files — nearest the button. Signed out (or nothing
   installed) it's just those two rows. The plus turns into an × while open —
   same trick as v1. */
export function AttachMenu({
  onMention,
  onFiles,
  onVoice,
}: {
  onMention: (name: string) => void;
  onFiles: (files: FileList) => void;
  /** Absent where dictation can't run (no recorder, or signed out). */
  onVoice?: () => void;
}) {
  const integrations = useMentionableIntegrations();
  const skills = useMentionableSkills();
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMentions = integrations.length > 0 || skills.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Attach files, dictate, or mention an integration"
        className="raised group flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-muted-foreground transition-[background-color,color,scale] duration-150 hover:text-foreground data-popup-open:text-foreground active:scale-95"
      >
        <IconPlus
          size={18}
          stroke={2.5}
          className="transition-[rotate] duration-200 group-data-popup-open:rotate-45"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-52 p-1">
        {hasMentions && (
          <>
            <MentionSubmenu
              label="Integrations"
              icon={<IconPuzzleFilled size={15} className="text-muted-foreground" />}
              mentions={integrations}
              onMention={onMention}
            />
            <MentionSubmenu
              label="Skills"
              icon={<IconSparklesFilled size={15} className="text-muted-foreground" />}
              mentions={skills}
              onMention={onMention}
            />
            <DropdownMenuSeparator />
          </>
        )}
        {onVoice && (
          <DropdownMenuItem className={ITEM} onClick={onVoice}>
            <IconMicrophoneFilled size={15} className="text-muted-foreground" />
            Voice input
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className={ITEM}
          onClick={() => inputRef.current?.click()}
        >
          <IconFileFilled size={15} className="text-muted-foreground" />
          Attach files
        </DropdownMenuItem>
      </DropdownMenuContent>
      {/* Lives outside the portalled menu so it survives the menu closing
          mid-pick. Value resets so re-picking the same file still fires. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </DropdownMenu>
  );
}
