import { z } from 'zod';
const configSchema=z.object({apiUrl:z.string().url(),supabaseUrl:z.string().url(),publishableKey:z.string().min(10).refine(v=>!v.startsWith('sb_secret_'),'Use a public key.')});
export function publicConfig() {
  return configSchema.safeParse({apiUrl:process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api',supabaseUrl:process.env.NEXT_PUBLIC_SUPABASE_URL,publishableKey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY});
}
