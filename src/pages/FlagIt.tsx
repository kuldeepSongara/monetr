import { useState } from 'react'
import { Flag, Lightbulb, Upload, BrainCircuit } from 'lucide-react'
import { Card, Button, SectionTitle, Input, Badge } from '../components/ui'
import { useApp } from '../store'
import { db } from '../db/db'
import { uid } from '../lib/utils'
import { todayISO } from '../lib/dates'
import { callAI } from '../ai/client'

export default function FlagIt() {
  const { notify, profiles, refresh } = useApp()
  const [tab, setTab] = useState<'flags' | 'pre' | 'habits' | 'import'>('flags')
  const [idea, setIdea] = useState({ title: '', price: '', url: '', notes: '' })
  const [flags, setFlags] = useState<any[]>([])
  const [ideas, setIdeas] = useState<any[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [review, setReview] = useState<any[]>([])
  const [busy, setBusy] = useState(false)

  async function load() {
    const [f, i] = await Promise.all([db.flags.toArray(), db.flagIdeas.toArray()])
    setFlags(f.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
    setIdeas(i.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
  }

  async function analyzeWeekly() {
    setBusy(true)
    try {
      const res = await callAI({ task: 'digest', prompt: 'Analyze recent spending and investments. Flag anything unusual, suggest ways to save, highlight forex fees, suggest better alternatives where relevant. Be specific.' } as any)
      await db.flags.put({ id: uid('flg_'), kind: 'weekly', status: 'open', title: 'AI Weekly Review', body: res.text, createdAt: new Date().toISOString() })
      await load()
      notify('Review generated', 'success')
    } catch(e:any){ notify(e.message,'error') } finally { setBusy(false) }
  }

  async function addIdea() {
    if(!idea.title) return
    setBusy(true)
    try {
      const res = await callAI({ task: 'categorize', prompt: `Find better prices/options for: ${idea.title} price:${idea.price} url:${idea.url}. Check common stores, deals, card benefits if relevant. Suggest concrete alternatives with reasoning.` } as any)
      await db.flagIdeas.put({ id: uid('f_'), status: 'open', ...idea, analysis: res.text, createdAt: new Date().toISOString() })
      setIdea({ title:'',price:'',url:'',notes:'' })
      await load()
      notify('Flagged with AI suggestions', 'success')
    } catch(e:any){ notify(e.message,'error') } finally { setBusy(false) }
  }

  async function scan() {
    if(!files.length) return
    setBusy(true)
    try {
      const f = files[0]
      let images: string[] = []
      if(f.type.startsWith('image/')) {
        const b64 = await new Promise<string>((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsDataURL(f)})
        images=[b64]
      }
      const res = await callAI({ task: 'categorize', prompt: `Extract credit card/bank statement lines. Return JSON array: [{date, merchant, amount, currency, type:'expense'|'income', note, confidence}]. If year missing infer ${new Date().getFullYear()}. Only include clear transactions. Ask for clarification if ambiguous.`, images } as any)
      let arr:any[]=[]
      try{ arr = JSON.parse(res.text.match(/\[.*\]/s)?.[0]||'[]') }catch{}
      setReview(arr.map((x:any,i:number)=>({...x, id: uid('imp_'), _i:i})))
      await db.imports.put({ id: uid('imp_'), status:'review', count: arr.length, createdAt:new Date().toISOString() })
      notify('Scanned. Review below', 'success')
    } catch(e:any){ notify(e.message,'error') } finally { setBusy(false) }
  }

  async function commit() {
    const { addTransaction } = await import('../db/db')
    const { useApp } = await import('../store')
    // get base currency from store context not directly available; use first profile/settings via db
    const st = await db.settings.toArray()
    const base = st[0]?.currency || 'USD'
    for(const r of review) {
      if(!r.merchant || !r.amount) continue
      await addTransaction({ date: r.date || todayISO(), amount: Number(r.amount), currency: r.currency||base, type: r.type||'expense', categoryId: 'cat_other', merchant: r.merchant, note: r.note, source:'import' }, base)
    }
    setReview([])
    await refresh()
    notify('Imported to spendings', 'success')
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-10 pt-4 md:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink md:text-2xl">flagIt</h1>
        <p className="text-sm text-muted">AI flags before/after spending, habits & smart import.</p>
      </header>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={tab==='flags'?'soft':'ghost'} onClick={()=>{setTab('flags'); load()}}><Flag className="h-3.5 w-3.5"/> Flags</Button>
        <Button size="sm" variant={tab==='pre'?'soft':'ghost'} onClick={()=>setTab('pre')}><Lightbulb className="h-3.5 w-3.5"/> Pre-spend check</Button>
        <Button size="sm" variant={tab==='habits'?'soft':'ghost'} onClick={()=>setTab('habits')}><BrainCircuit className="h-3.5 w-3.5"/> Habits & prevent</Button>
        <Button size="sm" variant={tab==='import'?'soft':'ghost'} onClick={()=>setTab('import')}><Upload className="h-3.5 w-3.5"/> Statement import</Button>
      </div>

      {tab==='flags' && (
        <Card className="card-pad">
          <SectionTitle title="AI Reviews" sub="Weekly/daily analysis" action={<Button size="sm" onClick={analyzeWeekly} loading={busy}>Run AI review</Button>} />
          <div className="mt-3 grid gap-2">
            {flags.map(f=>(
              <div key={f.id} className="rounded-xl border border-line/70 p-3">
                <div className="flex items-center justify-between"><p className="font-medium text-ink">{f.title}</p><Badge tone="neutral">{f.kind}</Badge></div>
                <p className="mt-1 text-sm text-muted whitespace-pre-wrap">{f.body}</p>
              </div>
            ))}
            {flags.length===0 && <p className="text-xs text-muted">No flags yet. Run a review.</p>}
          </div>
        </Card>
      )}

      {tab==='pre' && (
        <Card className="card-pad">
          <SectionTitle title="Flag before spending" sub="Get alternatives, deals, card benefits" />
          <div className="mt-3 grid gap-2">
            <Input placeholder="Product/item (e.g. MacBook Air M5)" value={idea.title} onChange={(e)=>setIdea({...idea,title:e.target.value})}/>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Price (e.g. 1799 CAD)" value={idea.price} onChange={(e)=>setIdea({...idea,price:e.target.value})}/>
              <Input placeholder="Store URL (optional)" value={idea.url} onChange={(e)=>setIdea({...idea,url:e.target.value})}/>
            </div>
            <Input placeholder="Notes (optional)" value={idea.notes} onChange={(e)=>setIdea({...idea,notes:e.target.value})}/>
            <Button onClick={addIdea} loading={busy}>Flag & find better options</Button>
          </div>
          <div className="mt-4 grid gap-2">
            {ideas.map(i=>(
              <div key={i.id} className="rounded-xl border border-line/70 p-3">
                <div className="flex items-center justify-between"><p className="font-medium text-ink">{i.title}</p><Badge tone="neutral">{i.price||''}</Badge></div>
                <p className="mt-1 text-sm text-muted whitespace-pre-wrap">{i.analysis}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab==='habits' && (
        <Card className="card-pad">
          <SectionTitle title="Spending habits & prevention" sub="Predict and suggest alternatives" action={<Button size="sm" onClick={async()=>{
            setBusy(true)
            try{
              const res = await callAI({ task:'digest', prompt:'Look at spending history patterns. Predict next likely spend (timing/category/amount). Suggest concrete prevention ideas (home alternative, habit change) with actionable tips.' } as any)
              await db.flags.put({ id: uid('hab_'), kind:'habits', status:'open', title:'Habit prediction', body: res.text, createdAt:new Date().toISOString() })
              await load(); notify('Predicted','success')
            }catch(e:any){notify(e.message,'error')}finally{setBusy(false)}
          }} loading={busy}>Predict habits</Button>} />
          <div className="mt-3 grid gap-2">
            {flags.filter(f=>f.kind==='habits').map(f=>(
              <div key={f.id} className="rounded-xl border border-line/70 p-3">
                <p className="font-medium text-ink">{f.title}</p>
                <p className="mt-1 text-sm text-muted whitespace-pre-wrap">{f.body}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab==='import' && (
        <Card className="card-pad">
          <SectionTitle title="Import from statement/screenshot" sub="Scan, review, edit before adding" />
          <div className="mt-3 flex items-center gap-2">
            <input type="file" accept="image/*,.pdf,.csv,.txt" onChange={(e)=>setFiles(Array.from(e.target.files||[]))} />
            <Button onClick={scan} loading={busy}>Scan</Button>
          </div>
          {review.length>0 && (
            <div className="mt-4 grid gap-2">
              {review.map((r,i)=>(
                <div key={r.id} className="grid grid-cols-5 gap-2 rounded-xl border border-line/70 p-2">
                  <input className="input" value={r.date||''} onChange={(e)=>{const n=[...review];n[i]={...r,date:e.target.value};setReview(n)}}/>
                  <input className="input" value={r.merchant||''} onChange={(e)=>{const n=[...review];n[i]={...r,merchant:e.target.value};setReview(n)}}/>
                  <input className="input" value={r.amount||''} onChange={(e)=>{const n=[...review];n[i]={...r,amount:e.target.value};setReview(n)}}/>
                  <input className="input" value={r.currency||''} onChange={(e)=>{const n=[...review];n[i]={...r,currency:e.target.value};setReview(n)}}/>
                  <select className="input" value={r.type||'expense'} onChange={(e)=>{const n=[...review];n[i]={...r,type:e.target.value};setReview(n)}}><option value="expense">expense</option><option value="income">income</option></select>
                </div>
              ))}
              <Button onClick={commit}>Add all to spendings</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
