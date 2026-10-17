CREATE TABLE maintenance."MembershipRoleGrant" (
 "id" UUID NOT NULL,
 "orgId" UUID NOT NULL,
 "membershipId" UUID NOT NULL,
 "role" maintenance."Role" NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MembershipRoleGrant_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "MembershipRoleGrant_orgId_membershipId_fkey" FOREIGN KEY ("orgId", "membershipId") REFERENCES maintenance."Membership"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MembershipRoleGrant_membershipId_role_key" ON maintenance."MembershipRoleGrant"("membershipId", "role");
CREATE INDEX "MembershipRoleGrant_orgId_membershipId_active_idx" ON maintenance."MembershipRoleGrant"("orgId", "membershipId", "active");
REVOKE ALL ON maintenance."MembershipRoleGrant" FROM PUBLIC;
