'use strict';
const $=id=>document.getElementById(id),KEY='hangeom-dday-v1';
const defaults=[{id:'exam',title:'한국사능력검정시험',kind:'exam',date:'2026-11-28T10:00',note:'시험 시작 · 준비물과 시험장을 미리 확인하세요.',featured:true},{id:'apply',title:'제주 원서접수',kind:'apply',date:'2026-11-06T10:00',note:'접수 시작 · 미리 로그인하고 접수 준비를 해 두세요.',featured:false}];
const valid=e=>e&&typeof e.id==='string'&&typeof e.title==='string'&&e.title.trim().length>0&&e.title.length<=80&&['exam','apply','other'].includes(e.kind)&&typeof e.date==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.date)&&Number.isFinite(Date.parse(e.date+'+09:00'))&&typeof e.note==='string'&&e.note.length<=500&&typeof e.featured==='boolean';
let events=structuredClone(defaults),editing=null,hasLocalData=false;
try{const raw=localStorage.getItem(KEY);if(raw!==null){const data=JSON.parse(raw);if(!Array.isArray(data)||!data.every(valid))throw Error();events=data;hasLocalData=true;}}catch{$('status').textContent='저장 데이터를 읽지 못했습니다. 기본 일정을 표시합니다. 백업을 확인하세요.';}
async function loadPublishedDefaults(){
  if(hasLocalData)return;
  try{
    const response=await fetch('./data/events.json',{cache:'no-store'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const published=await response.json();
    if(hasLocalData)return;
    if(published?.timezone!=='Asia/Seoul'||!Array.isArray(published.events)||!published.events.every(valid))throw Error('invalid data');
    events=published.events;
    $('status').textContent='GitHub 기준 일정 · 수정하면 이 기기에 저장됨';
    render();
  }catch{
    $('status').textContent='기본 일정 사용 중 · 공개 일정 확인 실패';
  }
}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timestamp=e=>Date.parse(e.date+'+09:00');
const dateText=e=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(timestamp(e));
function days(e,now=Date.now()){const kstDay=t=>Math.floor((t+32400000)/86400000);const diff=kstDay(timestamp(e))-kstDay(now);return diff===0?'D-DAY':diff>0?'D−'+diff:'D+'+Math.abs(diff);}
function save(){hasLocalData=true;try{localStorage.setItem(KEY,JSON.stringify(events));$('status').textContent='이 기기에 저장됨 · 동기화 없음';}catch{$('status').textContent='저장 공간에 접근할 수 없습니다. 변경 내용은 백업 저장으로 보관하세요.';}render();}
function render(){const selected=events.find(e=>e.featured)||events.find(e=>e.kind==='exam')||events[0];$('count').textContent=events.length; if(selected){const remaining=Math.max(0,Math.floor((timestamp(selected)-Date.now())/1000));$('hero').innerHTML=`<span class="tag">${timestamp(selected)>Date.now()?'목표를 향해 준비 중':'오늘도 수고했어요'}</span><h2>${escape(selected.title)}</h2><div class="dday">${days(selected)}</div><p>${escape(dateText(selected))}</p><div class="clock"><small>${remaining?'시작까지':'시작 시각 경과'}</small><strong>${Math.floor(remaining/86400)}일 ${String(Math.floor(remaining/3600)%24).padStart(2,'0')}:${String(Math.floor(remaining/60)%60).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}</strong></div>`;}else $('hero').innerHTML='<h2>새로운 목표를 정해 볼까요?</h2><p>일정을 추가하면 D-day가 시작됩니다.</p>';
$('events').innerHTML=[...events].sort((a,b)=>timestamp(a)-timestamp(b)).map(e=>`<article class="event"><div class="eventtop"><span class="badge">${({exam:'시험',apply:'원서접수',other:'기타'})[e.kind]}${e.featured?' · 대표 일정':''}</span><span class="mini">${days(e)}</span></div><h3>${escape(e.title)}</h3><p>${escape(dateText(e))}</p>${e.note?`<p>${escape(e.note)}</p>`:''}<div class="actions"><button data-action="edit" data-id="${escape(e.id)}">수정</button><button data-action="calendar" data-id="${escape(e.id)}">캘린더 ↗</button><button data-action="delete" data-id="${escape(e.id)}" aria-label="${escape(e.title)} 삭제">삭제</button></div></article>`).join('')||'<p class="muted">등록한 일정이 없습니다. 첫 일정을 추가해 보세요.</p>';}
function openEditor(e){editing=e?.id||null;$('form').reset();$('formtitle').textContent=e?'일정 수정':'일정 추가';$('title').value=e?.title||'';$('kind').value=e?.kind||'other';$('date').value=e?.date||'';$('note').value=e?.note||'';$('featured').checked=e?.featured||false;$('editor').showModal();}
$('add').onclick=()=>openEditor();$('close').onclick=()=>$('editor').close();$('help').onclick=()=>{document.querySelector('details').open=true;document.querySelector('details').scrollIntoView({behavior:'smooth'});};
$('form').onsubmit=e=>{e.preventDefault();const entry={id:editing||crypto.randomUUID(),title:$('title').value.trim(),kind:$('kind').value,date:$('date').value,note:$('note').value.trim(),featured:$('featured').checked};if(!valid(entry)){alert('일정 이름과 날짜를 확인해 주세요.');return;}if(entry.featured)events.forEach(x=>x.featured=false);if(editing)events=events.map(x=>x.id===editing?entry:x);else events.push(entry);save();$('editor').close();};
function download(data,type,name){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
const icsEscape=s=>s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
const utc=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function calendar(e){const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Hangeom Dday//KO','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+e.id+'@hangeom-dday','DTSTAMP:'+utc(Date.now()),'DTSTART:'+utc(timestamp(e)),'DTEND:'+utc(timestamp(e)+3600000),'SUMMARY:'+icsEscape(e.title),'DESCRIPTION:'+icsEscape(e.note+'\n한국 시간 기준. 종료 시간은 내보내기용 1시간 임시값입니다.'),...['-P1D','-PT1H'].flatMap(t=>['BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:일정 알림','TRIGGER:'+t,'END:VALARM']),'END:VEVENT','END:VCALENDAR']; const enc=new TextEncoder();const folded=lines.map(line=>{let out='',n=0;for(const ch of line){const len=enc.encode(ch).length;if(n+len>73){out+='\r\n ';n=1;}out+=ch;n+=len;}return out;}).join('\r\n')+'\r\n';download(folded,'text/calendar;charset=utf-8','한능검-일정.ics');}
$('events').onclick=e=>{const b=e.target.closest('button[data-action]');if(!b)return;const item=events.find(x=>x.id===b.dataset.id);if(!item)return;if(b.dataset.action==='edit')openEditor(item);if(b.dataset.action==='calendar')calendar(item);if(b.dataset.action==='delete'&&confirm('“'+item.title+'” 일정을 삭제할까요?')){events=events.filter(x=>x.id!==item.id);save();}};
$('backup').onclick=()=>download(JSON.stringify(events,null,2),'application/json','한능검-백업.json');$('restore').onclick=()=>$('file').click();$('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>1000000)throw Error();const data=JSON.parse(await f.text());if(!Array.isArray(data)||data.length>500||!data.every(valid)||new Set(data.map(x=>x.id)).size!==data.length||data.filter(x=>x.featured).length>1)throw Error();if(confirm('현재 일정을 백업 파일의 '+data.length+'개 일정으로 바꿀까요?')){events=data;save();}}catch{alert('올바른 일정 백업 파일이 아닙니다.');}e.target.value='';};
render();loadPublishedDefaults();setInterval(()=>{if(!$('editor').open)render();},1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
if('serviceWorker' in navigator&&location.protocol!=='file:'){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>$('offline').textContent='오프라인 화면 준비 완료').catch(()=>$('offline').textContent='오프라인 준비 실패 · 온라인에서 사용해 주세요');}else $('offline').textContent='설치·오프라인 기능은 HTTPS 주소에서 사용할 수 있습니다.';
