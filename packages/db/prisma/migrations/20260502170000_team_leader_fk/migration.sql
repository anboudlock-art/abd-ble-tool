-- v2.7: declare team.leader_user_id as a real FK so Prisma can join
-- against User. The column already exists; this just adds the constraint.
ALTER TABLE "team"
  ADD CONSTRAINT "team_leader_user_id_fkey"
  FOREIGN KEY ("leader_user_id") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
