import type { Category, Settings, Txn } from '../types'
import { currencyInfo } from './money'
import type { Range } from './dates'

/*
 * Interactive spending report: one self-contained .html file (no internet, no libraries) that you
 * open on a laptop or tablet to filter by category and date, hover spending spikes, click a day to
 * see what happened, and read cash flow month by month.
 */

export interface ReportOptions {
  range: Range
  includeNotes: boolean
  title?: string
}

const TYPE_CODE: Record<Txn['type'], string> = { expense: 'e', income: 'i', refund: 'r', transfer: 't' }

export function buildReportHtml(txns: Txn[], categories: Category[], settings: Settings, opts: ReportOptions): string {
  const info = currencyInfo(settings.currency)
  const rows = txns
    .filter((t) => t.date >= opts.range.start && t.date <= opts.range.end)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => [
      t.date,
      TYPE_CODE[t.type],
      t.baseAmount,
      t.categoryId,
      t.merchant,
      opts.includeNotes ? (t.note ?? '') : '',
      t.currency !== settings.currency ? `${t.currency} ${(t.amount / 10 ** currencyInfo(t.currency).decimals).toFixed(currencyInfo(t.currency).decimals)}` : '',
    ])
  const data = {
    currency: settings.currency,
    decimals: info.decimals,
    generatedAt: new Date().toISOString(),
    range: opts.range,
    categories: categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, color: c.color, kind: c.kind })),
    txns: rows,
  }
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const title = opts.title ?? `Monetr report · ${opts.range.start} to ${opts.range.end}`
  // Function replacers: a plain string would treat "$&" / "$'" in merchant names as patterns.
  return TEMPLATE.replace('__TITLE__', () => escapeHtml(title)).replace('__DATA__', () => json)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--ink:#14161c;--muted:#6b7280;--line:#e5e7eb;--accent:#7c5cff;--good:#16a34a;--bad:#dc2626;--warn:#d97706}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--card:#14171f;--ink:#eef0f5;--muted:#8d97ab;--line:#262b36;--accent:#9b85ff;--good:#34d399;--bad:#fb7185;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:22px;margin:0}h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.sub{color:var(--muted);font-size:12px;margin-top:4px}
.grid{display:grid;gap:12px}.g4{grid-template-columns:repeat(4,minmax(0,1fr))}.g2{grid-template-columns:1.4fr 1fr}
@media(max-width:860px){.g4{grid-template-columns:repeat(2,minmax(0,1fr))}.g2{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}
.kpi .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:4px}.kpi .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:16px 0}
input,select,button{font:inherit;color:inherit}
input[type=date],input[type=search],select{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:7px 10px}
.chip{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer;user-select:none}
.chip.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent)}
.chip.off{opacity:.45}
.btn{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:7px 12px;cursor:pointer}
svg{display:block;width:100%;overflow:visible}
.tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--bg);font-size:12px;padding:7px 9px;border-radius:8px;max-width:280px;z-index:9;display:none;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.bar-row{display:grid;grid-template-columns:150px 1fr 90px;gap:8px;align-items:center;font-size:12px;padding:3px 0;cursor:pointer}
.bar-row .track{height:10px;background:var(--line);border-radius:6px;overflow:hidden}.bar-row .fill{height:100%;border-radius:6px}
.bar-row .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.num{text-align:right;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px 6px;border-bottom:1px solid var(--line);text-align:left}
th{color:var(--muted);font-weight:600;cursor:pointer;white-space:nowrap}td.num,th.num{text-align:right}
.tag{font-size:10px;border-radius:6px;padding:1px 5px;border:1px solid var(--line);color:var(--muted)}
.pos{color:var(--good)}.neg{color:var(--ink)}.muted{color:var(--muted)}
.foot{color:var(--muted);font-size:11px;margin-top:20px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <h1 id="title"></h1>
  <div class="sub" id="subtitle"></div>

  <div class="filters">
    <label class="muted">From <input type="date" id="from"></label>
    <label class="muted">To <input type="date" id="to"></label>
    <input type="search" id="q" placeholder="Search merchant or note">
    <button class="btn" id="reset">Reset filters</button>
    <span class="muted" id="dayFilter"></span>
  </div>
  <div class="filters" id="cats"></div>

  <div class="grid g4" id="kpis"></div>

  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h2>Daily spending <span class="muted" style="text-transform:none;letter-spacing:0">· hover a spike, click a day to see it</span></h2><svg id="daily" height="220"></svg></div>
    <div class="card"><h2>By category <span class="muted" style="text-transform:none;letter-spacing:0">· click to focus</span></h2><div id="catBars"></div></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h2>Monthly cash flow</h2><svg id="monthly" height="220"></svg></div>
    <div class="card"><h2>Top merchants</h2><div id="merchants"></div><h2 style="margin-top:14px">By weekday</h2><svg id="weekday" height="110"></svg></div>
  </div>

  <div class="card" style="margin-top:12px">
    <h2>Transactions <span class="muted" id="count" style="text-transform:none;letter-spacing:0"></span></h2>
    <div style="overflow-x:auto"><table><thead><tr>
      <th data-k="0">Date</th><th data-k="4">Merchant</th><th data-k="3">Category</th><th>Type</th><th class="num" data-k="2">Amount</th>
    </tr></thead><tbody id="rows"></tbody></table></div>
  </div>
  <div class="foot" id="foot"></div>
</div>
<div class="tip" id="tip"></div>
<script type="application/json" id="data">__DATA__</script>
<script>
(function(){
var D=JSON.parse(document.getElementById('data').textContent);
var CAT={};D.categories.forEach(function(c){CAT[c.id]=c});
var unit=Math.pow(10,D.decimals);
var nf;try{nf=new Intl.NumberFormat(undefined,{style:'currency',currency:D.currency,maximumFractionDigits:D.decimals})}catch(e){nf={format:function(v){return D.currency+' '+v.toFixed(D.decimals)}}}
function money(m){return nf.format(m/unit)}
function short(m){var v=Math.abs(m/unit);return (m<0?'-':'')+(v>=1e6?(v/1e6).toFixed(1)+'m':v>=1e3?(v/1e3).toFixed(v>=1e4?0:1)+'k':v.toFixed(0))}
var T=D.txns.map(function(r,i){return{i:i,date:r[0],type:r[1],amt:r[2],cat:r[3],merchant:r[4],note:r[5],orig:r[6]}});
function delta(t){return t.type==='e'?t.amt:t.type==='r'?-t.amt:0}
var S={from:D.range.start,to:D.range.end,q:'',off:{},only:null,day:null,sort:{k:0,dir:-1}};
var $=function(id){return document.getElementById(id)};
$('title').textContent='Spending report';
$('subtitle').textContent=fmtDate(D.range.start)+' – '+fmtDate(D.range.end)+' · '+D.currency+' · '+T.length+' transactions';
$('foot').textContent='Generated by Monetr on '+new Date(D.generatedAt).toLocaleString()+'. Everything in this file stays on your computer.';
$('from').value=S.from;$('to').value=S.to;$('from').min=$('to').min=D.range.start;$('from').max=$('to').max=D.range.end;
$('from').onchange=function(e){S.from=e.target.value||D.range.start;S.day=null;draw()};
$('to').onchange=function(e){S.to=e.target.value||D.range.end;S.day=null;draw()};
$('q').oninput=function(e){S.q=e.target.value.toLowerCase();draw()};
$('reset').onclick=function(){S.from=D.range.start;S.to=D.range.end;S.q='';S.off={};S.only=null;S.day=null;$('from').value=S.from;$('to').value=S.to;$('q').value='';draw()};
function fmtDate(d){var p=d.split('-');return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}
function addDays(d,n){var p=d.split('-');var x=new Date(+p[0],+p[1]-1,+p[2]+n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')}
function visible(t,ignoreDay){
  if(t.date<S.from||t.date>S.to)return false;
  if(!ignoreDay&&S.day&&t.date!==S.day)return false;
  if(S.only&&t.cat!==S.only)return false;
  if(S.off[t.cat])return false;
  if(S.q&&(t.merchant+' '+t.note).toLowerCase().indexOf(S.q)<0)return false;
  return true}
var tip=$('tip');
function showTip(e,html){tip.innerHTML=html;tip.style.display='block';var x=e.clientX+14,y=e.clientY+14;if(x+290>innerWidth)x=e.clientX-290;tip.style.left=x+'px';tip.style.top=y+'px'}
function hideTip(){tip.style.display='none'}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function svgEl(svg){var w=svg.getBoundingClientRect().width||600;svg.setAttribute('viewBox','0 0 '+w+' '+svg.getAttribute('height'));svg.innerHTML='';return w}
var NS='http://www.w3.org/2000/svg';
function add(svg,tag,attrs,text){var el=document.createElementNS(NS,tag);for(var k in attrs)el.setAttribute(k,attrs[k]);if(text!=null)el.textContent=text;svg.appendChild(el);return el}

function drawCats(){
  var used={};T.forEach(function(t){if(t.type!=='t')used[t.cat]=1});
  var box=$('cats');box.innerHTML='';
  Object.keys(used).map(function(id){return CAT[id]||{id:id,name:'Other',emoji:'📦'}}).sort(function(a,b){return a.name.localeCompare(b.name)}).forEach(function(c){
    var el=document.createElement('span');el.className='chip'+(S.only===c.id?' on':'')+(S.off[c.id]?' off':'');
    el.textContent=(c.emoji||'')+' '+c.name;el.title='Click to hide/show · double-click to focus';
    el.onclick=function(){if(S.only===c.id){S.only=null}else{S.off[c.id]=!S.off[c.id]}draw()};
    el.ondblclick=function(){S.only=S.only===c.id?null:c.id;S.off={};draw()};
    box.appendChild(el)});
}

function draw(){
  drawCats();
  var rows=T.filter(function(t){return visible(t)});
  var all=T.filter(function(t){return visible(t,true)});
  // KPIs
  var spent=0,income=0,refunds=0;rows.forEach(function(t){if(t.type==='e')spent+=t.amt;else if(t.type==='i')income+=t.amt;else if(t.type==='r')refunds+=t.amt});
  var days=Math.max(1,Math.round((new Date(S.to)-new Date(S.from))/864e5)+1);
  var k=[['Spent (after refunds)',money(spent-refunds)],['Income',money(income)],['Net',money(income-spent+refunds)],['Per day',money(Math.round((spent-refunds)/(S.day?1:days)))]];
  $('kpis').innerHTML=k.map(function(x){return '<div class="card kpi"><div class="l">'+x[0]+'</div><div class="v">'+x[1]+'</div></div>'}).join('');
  $('dayFilter').innerHTML=S.day?'Showing '+fmtDate(S.day)+' · <a href="#" id="clearDay">show all days</a>':'';
  if(S.day)$('clearDay').onclick=function(e){e.preventDefault();S.day=null;draw()};
  drawDaily(all);drawCatBars(rows);drawMonthly(all);drawMerchants(rows);drawWeekday(rows);drawTable(rows);
}

function drawDaily(rows){
  var svg=$('daily'),W=svgEl(svg),H=220,pl=44,pb=22,pt=8;
  var byDay={};rows.forEach(function(t){var d=delta(t);if(!d)return;var o=byDay[t.date]||(byDay[t.date]={v:0,items:[]});o.v+=d;o.items.push(t)});
  var days=[],d=S.from;while(d<=S.to&&days.length<1200){days.push(d);d=addDays(d,1)}
  var vals=days.map(function(x){return byDay[x]?byDay[x].v:0});
  var max=Math.max.apply(null,vals.concat([1]));
  var avg=vals.map(function(_,i){var s=0,n=0;for(var j=Math.max(0,i-6);j<=i;j++){s+=vals[j];n++}return s/n});
  var bw=(W-pl)/Math.max(1,days.length),y=function(v){return pt+(H-pb-pt)*(1-Math.max(0,v)/max)};
  for(var g=0;g<=3;g++){var gv=max*g/3;add(svg,'line',{x1:pl,x2:W,y1:y(gv),y2:y(gv),stroke:'var(--line)'});add(svg,'text',{x:pl-6,y:y(gv)+4,'text-anchor':'end','font-size':10,fill:'var(--muted)'},short(gv))}
  var mean=vals.reduce(function(a,b){return a+b},0)/Math.max(1,vals.filter(function(v){return v>0}).length);
  days.forEach(function(day,i){var v=vals[i];if(v<=0)return;var spike=v>mean*2.2;
    var r=add(svg,'rect',{x:pl+i*bw+bw*.12,y:y(v),width:Math.max(1,bw*.76),height:H-pb-y(v),rx:Math.min(3,bw/3),fill:S.day===day?'var(--warn)':spike?'var(--bad)':'var(--accent)',opacity:S.day&&S.day!==day?.35:.9,style:'cursor:pointer'});
    r.onmousemove=function(e){var it=byDay[day].items.slice().sort(function(a,b){return b.amt-a.amt}).slice(0,4);
      showTip(e,'<b>'+fmtDate(day)+'</b> · '+money(v)+(spike?' <b>spike</b>':'')+'<br>'+it.map(function(t){return esc(t.merchant)+' — '+money(delta(t))}).join('<br>'))};
    r.onmouseleave=hideTip;r.onclick=function(){S.day=S.day===day?null:day;hideTip();draw()}});
  var path=avg.map(function(v,i){return (i?'L':'M')+(pl+i*bw+bw/2)+' '+y(v)}).join(' ');
  add(svg,'path',{d:path,fill:'none',stroke:'var(--warn)','stroke-width':2,'stroke-dasharray':'4 3'});
  var step=Math.ceil(days.length/8);days.forEach(function(day,i){if(i%step)return;add(svg,'text',{x:pl+i*bw+bw/2,y:H-6,'text-anchor':'middle','font-size':10,fill:'var(--muted)'},day.slice(5))});
}

function drawCatBars(rows){
  var by={};rows.forEach(function(t){var d=delta(t);if(!d)return;by[t.cat]=(by[t.cat]||0)+d});
  var list=Object.keys(by).map(function(id){return{id:id,v:by[id]}}).filter(function(x){return x.v>0}).sort(function(a,b){return b.v-a.v});
  var tot=list.reduce(function(a,b){return a+b.v},0)||1,max=list[0]?list[0].v:1;
  $('catBars').innerHTML=list.map(function(x){var c=CAT[x.id]||{name:'Other',emoji:'📦',color:'#64748b'};
    return '<div class="bar-row" data-id="'+x.id+'" title="Click to focus on this category"><span class="name">'+(c.emoji||'')+' '+esc(c.name)+'</span><span class="track"><span class="fill" style="display:block;width:'+(x.v/max*100)+'%;background:'+c.color+'"></span></span><span class="num">'+money(x.v)+' <span class="muted">'+Math.round(x.v/tot*100)+'%</span></span></div>'}).join('')||'<div class="muted">No spending in this view.</div>';
  Array.prototype.forEach.call($('catBars').children,function(el){el.onclick=function(){var id=el.getAttribute('data-id');S.only=S.only===id?null:id;S.off={};draw()}});
}

function drawMonthly(rows){
  var svg=$('monthly'),W=svgEl(svg),H=220,pl=44,pb=22,pt=8;
  var by={};rows.forEach(function(t){var m=t.date.slice(0,7);var o=by[m]||(by[m]={inc:0,out:0});if(t.type==='i')o.inc+=t.amt;else o.out+=delta(t)});
  var months=Object.keys(by).sort();if(!months.length)return;
  var max=Math.max.apply(null,months.map(function(m){return Math.max(by[m].inc,by[m].out)}).concat([1]));
  var gw=(W-pl)/months.length,bw=Math.min(28,gw*.34),y=function(v){return pt+(H-pb-pt)*(1-Math.max(0,v)/max)};
  for(var g=0;g<=3;g++){var gv=max*g/3;add(svg,'line',{x1:pl,x2:W,y1:y(gv),y2:y(gv),stroke:'var(--line)'});add(svg,'text',{x:pl-6,y:y(gv)+4,'text-anchor':'end','font-size':10,fill:'var(--muted)'},short(gv))}
  months.forEach(function(m,i){var o=by[m],cx=pl+gw*i+gw/2;
    var a=add(svg,'rect',{x:cx-bw-1,y:y(o.inc),width:bw,height:H-pb-y(o.inc),rx:3,fill:'var(--good)'});
    var b=add(svg,'rect',{x:cx+1,y:y(o.out),width:bw,height:H-pb-y(o.out),rx:3,fill:'var(--accent)'});
    [a,b].forEach(function(r){r.onmousemove=function(e){showTip(e,'<b>'+m+'</b><br>Income '+money(o.inc)+'<br>Spent '+money(o.out)+'<br>Net <b>'+money(o.inc-o.out)+'</b>')};r.onmouseleave=hideTip});
    add(svg,'text',{x:cx,y:H-6,'text-anchor':'middle','font-size':10,fill:'var(--muted)'},new Date(m+'-01T00:00').toLocaleDateString(undefined,{month:'short',year:'2-digit'}))});
}

function drawMerchants(rows){
  var by={};rows.forEach(function(t){var d=delta(t);if(!d)return;var o=by[t.merchant]||(by[t.merchant]={v:0,n:0});o.v+=d;if(t.type==='e')o.n++});
  var list=Object.keys(by).map(function(k){return{k:k,v:by[k].v,n:by[k].n}}).filter(function(x){return x.v>0}).sort(function(a,b){return b.v-a.v}).slice(0,8);
  var max=list[0]?list[0].v:1;
  $('merchants').innerHTML=list.map(function(x){return '<div class="bar-row" data-m="'+esc(x.k)+'" title="Click to search"><span class="name">'+esc(x.k)+' <span class="muted">×'+x.n+'</span></span><span class="track"><span class="fill" style="display:block;width:'+(x.v/max*100)+'%;background:var(--accent)"></span></span><span class="num">'+money(x.v)+'</span></div>'}).join('');
  Array.prototype.forEach.call($('merchants').children,function(el){el.onclick=function(){S.q=el.getAttribute('data-m').toLowerCase();$('q').value=el.getAttribute('data-m');draw()}});
}

function drawWeekday(rows){
  var svg=$('weekday'),W=svgEl(svg),H=110,names=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],v=[0,0,0,0,0,0,0];
  rows.forEach(function(t){var p=t.date.split('-');var wd=(new Date(+p[0],+p[1]-1,+p[2]).getDay()+6)%7;v[wd]+=delta(t)});
  var max=Math.max.apply(null,v.concat([1])),bw=W/7;
  v.forEach(function(x,i){var h=(H-20)*Math.max(0,x)/max;var r=add(svg,'rect',{x:i*bw+bw*.2,y:H-18-h,width:bw*.6,height:h,rx:3,fill:'var(--accent)',opacity:.85});
    r.onmousemove=function(e){showTip(e,names[i]+': '+money(x))};r.onmouseleave=hideTip;
    add(svg,'text',{x:i*bw+bw/2,y:H-4,'text-anchor':'middle','font-size':10,fill:'var(--muted)'},names[i])});
}

function drawTable(rows){
  var k=S.sort.k,dir=S.sort.dir;
  var key=function(t){return k===0?t.date:k===2?t.amt:k===3?((CAT[t.cat]||{}).name||''):t.merchant.toLowerCase()};
  rows=rows.slice().sort(function(a,b){var x=key(a),y=key(b);return (x<y?-1:x>y?1:0)*dir});
  $('count').textContent='· '+rows.length+' shown';
  var TL={e:'expense',i:'income',r:'refund',t:'transfer'};
  $('rows').innerHTML=rows.slice(0,2000).map(function(t){var c=CAT[t.cat]||{name:'Other',emoji:'📦'};var sign=t.type==='i'||t.type==='r'?'+':t.type==='t'?'↔ ':'−';
    return '<tr><td>'+t.date+'</td><td>'+esc(t.merchant)+(t.note?'<div class="muted">'+esc(t.note)+'</div>':'')+(t.orig?' <span class="tag">'+esc(t.orig)+'</span>':'')+'</td><td>'+(c.emoji||'')+' '+esc(c.name)+'</td><td><span class="tag">'+TL[t.type]+'</span></td><td class="num '+(sign==='+'?'pos':'neg')+'">'+sign+money(t.amt)+'</td></tr>'}).join('');
}
Array.prototype.forEach.call(document.querySelectorAll('th[data-k]'),function(th){th.onclick=function(){var k=+th.getAttribute('data-k');S.sort={k:k,dir:S.sort.k===k?-S.sort.dir:(k===2?-1:1)};draw()}});
var rt;window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(draw,120)});
draw();
})();
</script>
</body>
</html>`
