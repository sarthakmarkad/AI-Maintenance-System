import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Database } from './database';
export type Principal = { userId: string; membershipId: string; displayName: string; orgId: string; organization: string; role: Role };
export const REPOSITORY = Symbol('REPOSITORY');
export const machineSelect = { id:true, code:true, name:true, manufacturer:true, model:true, operationalStatus:true, createdAt:true, updatedAt:true, department:{select:{name:true}}, location:{select:{name:true}} } satisfies Prisma.MachineSelect;
export type MachineRecord = Prisma.MachineGetPayload<{select:typeof machineSelect}>;
export interface Repository {
  principal(userId:string): Promise<Principal|null>;
  machines(user:Principal, limit:number, after?:string): Promise<MachineRecord[]>;
  machine(user:Principal, code:string): Promise<MachineRecord|null>;
}
@Injectable()
export class PrismaRepository implements Repository {
  constructor(@Inject(Database) private readonly db: Database) {}
  private get client() { if (!this.db.client) throw new ServiceUnavailableException('Database is not configured.'); return this.db.client; }
  async principal(userId:string) {
    const membership = await this.client.membership.findUnique({where:{userId},include:{user:true,organization:true}});
    if (!membership?.active) return null;
    return { userId, membershipId:membership.id, displayName:membership.user.displayName, orgId:membership.orgId, organization:membership.organization.name, role:membership.role };
  }
  private scope(user:Principal): Prisma.MachineWhereInput {
    return { orgId:user.orgId, ...([Role.OPERATOR,Role.TECHNICIAN].includes(user.role as 'OPERATOR'|'TECHNICIAN') ? {access:{some:{membershipId:user.membershipId,orgId:user.orgId}}} : {}) };
  }
  machines(user:Principal, limit:number, after?:string) {
    return this.client.machine.findMany({where:{...this.scope(user),...(after ? {code:{gt:after}} : {})},select:machineSelect,orderBy:{code:'asc'},take:limit});
  }
  machine(user:Principal, code:string) {
    return this.client.machine.findFirst({where:{...this.scope(user),code},select:machineSelect});
  }
}
