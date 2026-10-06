-- Apply after `pnpm db:push`. Idempotent.
-- Club-wide sync: at most one RUNNING ClubSyncRun per club.
CREATE UNIQUE INDEX IF NOT EXISTS club_sync_run_one_running
  ON "ClubSyncRun" ("clubId")
  WHERE status = 'RUNNING';

-- Overlapping bookings forbidden (Prisma DateTime → timestamp without time zone).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "PersonalTrainingBooking"
  DROP CONSTRAINT IF EXISTS personal_training_booking_no_overlap_trainer;
ALTER TABLE "PersonalTrainingBooking"
  ADD CONSTRAINT personal_training_booking_no_overlap_trainer
  EXCLUDE USING gist (
    "trainerId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'FAILED'));

ALTER TABLE "PersonalTrainingBooking"
  DROP CONSTRAINT IF EXISTS personal_training_booking_no_overlap_client;
ALTER TABLE "PersonalTrainingBooking"
  ADD CONSTRAINT personal_training_booking_no_overlap_client
  EXCLUDE USING gist (
    "clientId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'FAILED'));

ALTER TABLE "SpaBooking"
  DROP CONSTRAINT IF EXISTS spa_booking_no_overlap_specialist;
ALTER TABLE "SpaBooking"
  ADD CONSTRAINT spa_booking_no_overlap_specialist
  EXCLUDE USING gist (
    "specialistId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'FAILED'));

ALTER TABLE "SpaBooking"
  DROP CONSTRAINT IF EXISTS spa_booking_no_overlap_client;
ALTER TABLE "SpaBooking"
  ADD CONSTRAINT spa_booking_no_overlap_client
  EXCLUDE USING gist (
    "clientId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'FAILED') AND "clientId" IS NOT NULL);
