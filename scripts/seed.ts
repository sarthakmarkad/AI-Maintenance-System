import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const url=process.env.DIRECT_URL;
if (!url) throw new Error('DIRECT_URL is required for seed.');
const db=new PrismaClient({datasources:{db:{url}}});
async function main(){
  await db.$transaction(async tx=>{
    const org=await tx.organization.upsert({where:{slug:'supreme-industries'},create:{slug:'supreme-industries',name:'Supreme Industries'},update:{}});
    const existing=await tx.machine.findUnique({where:{orgId_code:{orgId:org.id,code:'WH-C'}}});
    if (!existing){
      const machine=await tx.machine.create({data:{orgId:org.id,code:'WH-C',name:'Blown-film line',manufacturer:'Windmöller & Hölscher',model:null,operationalStatus:'NOT_MONITORED'}});
      await tx.auditEvent.create({data:{orgId:org.id,action:'MACHINE_SEEDED',entityId:machine.id,detail:{code:'WH-C',source:'confirmed pilot facts'}}});
    }
  });
  console.log('WH-C seed complete. No accounts, passwords, machine grants or roles were provisioned.');
}
main().catch(()=>{console.error('Seed failed. Check the migration and DIRECT_URL.');process.exitCode=1;}).finally(()=>db.$disconnect());
