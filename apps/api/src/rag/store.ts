import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
export type Scope = { orgId: string; machineId: string };
export type Approved = Scope & {
  documentId: string;
  fileId: string;
  title: string;
  kind: string;
  version: number;
  filename: string;
  number: number;
  sha256: string;
  approvalId: string;
};
export const approvedSql = (scope?: Scope) => Prisma.sql`
 SELECT d."orgId",d."machineId",d.id AS "documentId",d.title,d.kind,d.version,
 f.id AS "fileId",f.filename,f.number,f.sha256,e.id AS "approvalId"
 FROM maintenance."MachineDocument" d
 JOIN LATERAL (SELECT id,"fileId",action FROM maintenance."MachineDocumentEvent"
 WHERE "documentId"=d.id AND action IN ('APPROVE','WITHDRAW') ORDER BY revision DESC LIMIT 1) e ON e.action='APPROVE'
 JOIN maintenance."MachineDocumentFile" f ON f.id=e."fileId" AND f."documentId"=d.id
 ${scope ? Prisma.sql`WHERE d."orgId"=${scope.orgId}::uuid AND d."machineId"=${scope.machineId}::uuid` : Prisma.empty}`;
export const currentApproved = (tx: Prisma.TransactionClient, scope: Scope) =>
  tx.$queryRaw<Approved[]>(approvedSql(scope));
export async function enqueue(
  tx: Prisma.TransactionClient,
  source: Approved,
  profile: string,
) {
  await tx.$executeRaw`INSERT INTO maintenance."DocumentRagIndex" (id,"orgId","machineId","documentId","fileId",profile,"sourceHash")
    VALUES (${randomUUID()}::uuid,${source.orgId}::uuid,${source.machineId}::uuid,${source.documentId}::uuid,${source.fileId}::uuid,${profile},${source.sha256})
    ON CONFLICT ("fileId",profile) DO NOTHING`;
}
