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
  cameraLabel?: string;
  errorMessage?: string;
  capturedAt?: string;
  /** Relative API path for JPEG when CAPTURED (JWT required). */
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
