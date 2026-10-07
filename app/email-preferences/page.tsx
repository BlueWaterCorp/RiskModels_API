'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
function Preferences() {
  const token = useSearchParams().get('token');
  const [state,setState] = useState<'ready'|'saving'|'done'|'error'>('ready');
  async function pause() {
    setState('saving');
    try {
      const r=await fetch('/api/email-preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
      setState(r.ok?'done':'error');
    } catch {setState('error');}
  }
  return <main className="mx-auto max-w-xl px-6 py-20 text-zinc-200">
    <h1 className="text-2xl mb-4">RiskModels setup emails</h1>
    {state==='done' ? <p>Setup follow-ups are paused. Your API access and account notices continue as usual.</p> : <>
      <p className="mb-6">Pause emails offering help with setup and your first analyses.</p>
      <button disabled={!token||state==='saving'} onClick={pause} className="rounded bg-blue-600 px-4 py-2 disabled:opacity-50">{state==='saving'?'Saving…':'Pause setup follow-ups'}</button>
      {!token&&<p className="mt-4">Open the preference link from your RiskModels email.</p>}
      {state==='error'&&<p role="alert" className="mt-4">Could not save. Please try again or reply to the email for help.</p>}
    </>}
  </main>;
}
export default function Page(){return <Suspense fallback={<p>Loading preferences…</p>}><Preferences/></Suspense>;}
