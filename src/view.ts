import type { Status } from "../shared/types";

/** What the main list shows: today's pick, or one status column. The app always opens on "today". */
export type View = "today" | Status;
