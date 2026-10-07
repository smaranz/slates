import { IconLoader2 } from "@tabler/icons-react";

/* The app's one busy glyph — a quietly spinning loader that inherits the
   current text color. */
export function Spinner({ size = 14 }: { size?: number }) {
  return <IconLoader2 size={size} className="animate-spin" />;
}
