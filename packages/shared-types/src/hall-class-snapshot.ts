/** Hall NVR snapshots for GROUP class attendance review. */

export type HallClassSnapshotStatus = 'PENDING' | 'CAPTURED' | 'FAILED';

export interface HallClassSnapshotItem {
  id: string;
  sessionKey: string;
  externalId: string;
  roomTitle: string;
  offsetMin: number;
  slotAt: string;
  status: HallClassSnapshotStatus;
  /** Failed tries so far; 1 means a retry is scheduled or in progress. */
  captureAttempts?: number;
  nextAttemptAt?: string;
  cameraLabel?: string;
  errorMessage?: string;
  capturedAt?: string;
  /** Snapshot id for image fetch when CAPTURED. */
  imagePath?: string;
}

export interface HallClassSnapshotDueItem {
  id: string;
  clubId: string;
  sessionKey: string;
  externalId: string;
  roomTitle: string;
  offsetMin: number;
  slotAt: string;
}
