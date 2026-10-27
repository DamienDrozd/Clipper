import type { VideoStatus } from "@/generated/prisma/enums";
import { VIDEO_STATUS_LABELS, isFinalStatus } from "@/lib/status";

const TONES: Partial<Record<VideoStatus, string>> = {
  DONE: "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400",
  FAILED: "border-accent/40 bg-accent/10 text-accent",
};

export function StatusBadge({ status }: { status: VideoStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        TONES[status] ?? "border-border bg-surface text-muted"
      }`}
    >
      {!isFinalStatus(status) && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {VIDEO_STATUS_LABELS[status]}
    </span>
  );
}
