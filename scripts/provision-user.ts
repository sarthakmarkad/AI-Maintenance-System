import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { z } from 'zod';
const [id,role,name,...codes]=process.argv.slice(2);
const parsed=z.object({id:z.string().uuid(),role:z.nativeEnum(Role),name:z.string().min(1).max(120),codes:z.array(z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,31}$/))}).safeParse({id,role,name,codes});
if(!parsed.success || !process.env.DIRECT_URL) throw new Error('Usage: npm run db:provision -- <Supabase-user-UUID> <ROLE> "Display name" [WH-C]. Requires DIRECT_URL.');
const input=parsed.data;
const db=new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
async function main(){
  await db.$transaction(async tx=>{
    const org=await tx.organization.findUniqueOrThrow({where:{slug:'supreme-industries'}});
    const existing=await tx.membership.findUnique({where:{userId:input.id}});
    if(existing) throw new Error('Membership already exists. Review changes explicitly; this command only provisions new memberships.');
    const machines=await tx.machine.findMany({where:{orgId:org.id,code:{in:input.codes}}});
    if(machines.length!==new Set(input.codes).size)throw new Error('A machine code does not exist in the pilot organization.');
    if((input.role==='OPERATOR'||input.role==='TECHNICIAN') && !machines.length)throw new Error('Operators and technicians require at least one explicit machine grant.');
    await tx.appUser.upsert({where:{id:input.id},create:{id:input.id,displayName:input.name},update:{}});
    const member=await tx.membership.create({data:{userId:input.id,orgId:org.id,role:input.role}});
    for(const machine of machines)await tx.machineAccess.create({data:{orgId:org.id,machineId:machine.id,membershipId:member.id}});
    await tx.auditEvent.create({data:{orgId:org.id,action:'MEMBERSHIP_PROVISIONED',entityId:member.id,detail:{role:input.role,machineCodes:input.codes,source:'trusted owner CLI; Auth UUID must be verified by operator'}}});
  });
  console.log('Membership provisioned. Sign in using the corresponding Supabase account.');
}
main().catch(e=>{console.error(e instanceof Error && !('code' in e)?e.message:'Provisioning failed; check database configuration.');process.exitCode=1;}).finally(()=>db.$disconnect());
