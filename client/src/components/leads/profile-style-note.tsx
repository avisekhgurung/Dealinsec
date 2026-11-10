/**
 * One line on a lead's message panel: which saved client profile its AI drafts follow, and how. Shown only when the
 * lead belongs to a profile (it was found by a search started from one). The note's own words are never sent here.
 */
import type { ProfileStyleView } from "@shared/acquisition-profile";

export function ProfileStyleNote({ style, channel }: { style: ProfileStyleView | null | undefined; /** The channel this panel writes for; the others the person ticked are named as a reminder. */ channel?: string }) {
  if (!style) return null;
  const others = style.channels.filter((c) => c.key !== channel).map((c) => c.label);
  return (
    <p className="rounded-lg border border-border/70 px-2.5 py-2 text-xs text-muted-foreground" data-testid="profile-style-note">
      AI drafts for this lead follow your client profile "{style.profileName}": a <span className="font-semibold text-foreground">{style.toneLabel.toLowerCase()}</span> tone{style.hasNote ? ", and the note you saved for these messages" : ""}.
      {others.length > 0 && <> For these clients you also chose {others.join(" and ")}.</>}
    </p>
  );
}
