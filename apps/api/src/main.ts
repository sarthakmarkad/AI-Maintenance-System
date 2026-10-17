import { createApp } from './app';
import { parseConfig } from './config';
async function main() {
  const config=parseConfig(process.env);
  const app=await createApp(config);
  await app.listen(config.PORT,config.HOST);
}
main().catch(error=>{console.error(error instanceof Error ? error.message : 'Startup failed');process.exitCode=1;});
