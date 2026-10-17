"use client";
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Factory, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { getSupabase } from '@/lib/supabase';
import { publicConfig } from '@/lib/config';
function Login(){
  const router=useRouter();const search=useSearchParams();const {session,error:savedError}=useAuth();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const configured=publicConfig().success;
  useEffect(()=>{if(session)router.replace('/machines');},[session,router]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const client=getSupabase();if(!client)return;
    const data=new FormData(event.currentTarget);setBusy(true);setError('');
    try {
      const {error}=await client.auth.signInWithPassword({email:String(data.get('email')).trim(),password:String(data.get('password'))});
      if(error){setError(error.status===400||error.status===401?'The email or password was not accepted. Please try again.':'Sign in is unavailable. Please try again shortly.');return;}
      router.replace('/machines');
    }catch{setError('Could not reach the sign-in service. Please try again.');}
    finally{setBusy(false);}
  }
  return <main className="login-page"><section className="login-story"><div className="brand"><span className="brand-mark"><Factory size={26}/></span><span>SUPREME<small>Maintenance intelligence</small></span></div><div className="login-intro"><div className="eyebrow">WH-C / PILOT WORKSPACE</div><h1>Better context.<br/>Confident<br/><em>maintenance.</em></h1><p>Connect your people, machine records and maintenance decisions in one trusted workspace.</p><div className="login-divider"/><span className="story-footnote">Built for Supreme Industries<br/>Windmöller & Hölscher · Blown-film line</span></div><span className="login-bottom">MACHINE MAINTENANCE & PERFORMANCE INTELLIGENCE</span></section><section className="login-form-panel"><div className="login-form-wrap"><span className="tag">SECURE TEAM ACCESS</span><h2>Welcome back.</h2><p className="login-description">Sign in to your maintenance workspace.</p>{!configured&&<div className="config-notice" role="status"><strong>Supabase setup is required</strong><p>Add the project URL and public publishable key to the frontend configuration to enable sign in. Your administrator must also provision an application membership.</p></div>}{search.get('reason')==='expired'&&<p role="alert" className="inline-error">Your session expired. Please sign in again.</p>}{(error||savedError)&&<p className="inline-error" role="alert">{error||savedError}</p>}<form onSubmit={submit}><label htmlFor="email">Work email</label><input id="email" name="email" type="email" placeholder="you@company.com" autoComplete="username" required disabled={!configured||busy}/><label htmlFor="password">Password</label><input id="password" name="password" type="password" placeholder="Enter your password" autoComplete="current-password" required disabled={!configured||busy}/><Button type="submit" className="login-submit" disabled={!configured||busy}>{busy?'Signing in…':'Sign in'}<ArrowRight size={17}/></Button></form><div className="login-security"><ShieldCheck size={17}/><span>Access is managed by your organization.</span></div><p className="login-help">Need access or a password reset?<br/>Contact your application administrator.</p></div><small className="login-version">Local foundation · v0.1</small></section></main>;
}
export default function Page(){return <Suspense fallback={<main className="loading-state">Loading sign in…</main>}><Login/></Suspense>;}
