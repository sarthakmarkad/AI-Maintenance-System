"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
type State={session:Session|null;loading:boolean;error:string|null};
const AuthContext=createContext<State>({session:null,loading:true,error:null});
export function AuthProvider({children}:{children:ReactNode}) {
  const [state,setState]=useState<State>({session:null,loading:true,error:null});
  useEffect(()=>{
    const client=getSupabase();
    if (!client) {setState({session:null,loading:false,error:null});return;}
    let mounted=true;
    const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{if(mounted)setState({session,loading:false,error:null});});
    client.auth.getSession().then(({data,error})=>{if(mounted)setState({session:data.session,loading:false,error:error?'Your saved session could not be restored. Please sign in again.':null});}).catch(()=>{if(mounted)setState({session:null,loading:false,error:'Your saved session could not be restored. Please sign in again.'});});
    return ()=>{mounted=false;subscription.unsubscribe();};
  },[]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
export const useAuth=()=>useContext(AuthContext);
