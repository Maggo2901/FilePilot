import {useEffect,useMemo,useState} from 'react';
import {ArchiveRestore,CheckCircle2,CircleX,Clock3,Copy,Download,FileClock,FolderInput,FolderOutput,FolderPlus,HardDrive,History,LoaderCircle,Pencil,RefreshCw,Scissors,Search,Settings,Trash2,Upload} from 'lucide-react';
import {api,formatSize} from '../lib/api';
import type {ConfirmOptions} from './ConfirmDialog';

type HistoryEntry={
  id:string;at:string;action:string;status:'success'|'error';title:string;detail?:string;count?:number;paths?:string[];error?:string;
  sourcePaths?:string[];resultPaths?:string[];destination?:string;bytes?:number;durationMs?:number;requestedAction?:string;
};

const actionNames:Record<string,string>={copy:'Kopieren',move:'Verschieben',delete:'Papierkorb',restore:'Wiederherstellen','delete-permanent':'Endgültig löschen','empty-trash':'Papierkorb leeren',rename:'Umbenennen',folder:'Ordner erstellen',upload:'Hochladen',download:'Herunterladen',settings:'Einstellungen',rescan:'Speicherprüfung'};

function ActionIcon({action}:{action:string}){
  if(action==='copy'||action==='transfer')return <Copy/>;
  if(action==='move')return <Scissors/>;
  if(action==='delete'||action==='delete-permanent'||action==='empty-trash')return <Trash2/>;
  if(action==='restore')return <ArchiveRestore/>;
  if(action==='rename')return <Pencil/>;
  if(action==='folder')return <FolderPlus/>;
  if(action==='upload')return <Upload/>;
  if(action==='download')return <Download/>;
  return <Settings/>;
}

function inferredSources(item:HistoryEntry){
  if(item.sourcePaths?.length)return item.sourcePaths;
  if(!item.paths?.length)return[];
  if(['copy','move','rename'].includes(item.action)&&item.count)return item.paths.slice(0,item.count);
  if(['delete','download'].includes(item.action))return item.paths;
  return[];
}

function inferredResults(item:HistoryEntry){
  if(item.resultPaths?.length)return item.resultPaths;
  if(!item.paths?.length)return[];
  if(['copy','move','rename'].includes(item.action)&&item.count)return item.paths.slice(item.count);
  if(['restore','folder','upload'].includes(item.action))return item.paths;
  return[];
}

function duration(value:number){
  if(value<1000)return `${value} ms`;
  if(value<60000)return `${(value/1000).toLocaleString('de-DE',{maximumFractionDigits:1})} Sek.`;
  return `${Math.floor(value/60000)} Min. ${Math.round(value%60000/1000)} Sek.`;
}

function PathList({title,paths,type}:{title:string;paths:string[];type:'source'|'result'}){
  if(!paths.length)return null;
  const Icon=type==='source'?FolderInput:FolderOutput;
  return <section className={`historyPathGroup ${type}`}><header><Icon/><strong>{title}</strong><span>{paths.length}</span></header><div>{paths.map((entry,index)=><code key={`${entry}-${index}`} title={entry}>{entry}</code>)}</div></section>;
}

export function HistoryPage({notify,confirmAction}:{notify:(message:string)=>void;confirmAction:(options:ConfirmOptions)=>Promise<boolean>}){
  const[items,setItems]=useState<HistoryEntry[]>([]);
  const[loading,setLoading]=useState(true);
  const[query,setQuery]=useState('');
  const[status,setStatus]=useState<'all'|'success'|'error'>('all');

  async function load(){
    setLoading(true);
    try{setItems((await api<{items:HistoryEntry[]}>('/history')).items)}catch(error:any){notify(`Fehler: ${error.message}`)}finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[]);

  const filtered=useMemo(()=>{
    const needle=query.trim().toLocaleLowerCase('de');
    return items.filter(item=>(status==='all'||item.status===status)&&(!needle||[item.title,item.detail,item.action,item.error,item.destination,...(item.paths||[]),...(item.sourcePaths||[]),...(item.resultPaths||[])].filter(Boolean).join(' ').toLocaleLowerCase('de').includes(needle)));
  },[items,query,status]);
  const successes=items.filter(item=>item.status==='success').length;
  const failures=items.length-successes;
  const today=new Date().toDateString();
  const todayCount=items.filter(item=>new Date(item.at).toDateString()===today).length;

  async function clear(){
    if(!await confirmAction({title:'Aktivitätsverlauf löschen?',message:'Alle gespeicherten Einträge im Verlauf werden entfernt.',detail:'Die eigentlichen Dateien und Ordner bleiben unverändert.',confirmLabel:'Verlauf löschen',danger:true}))return;
    try{await api('/history',{method:'DELETE'});setItems([]);notify('Verlauf gelöscht')}catch(error:any){notify(`Fehler: ${error.message}`)}
  }

  return <div className="historyPage"><header className="historyPageHeader"><div><span><History/></span><div><h1>Aktivitätsverlauf</h1><p>Alle Dateiaktionen, Ziele und Ergebnisse nachvollziehen</p></div></div><div><button className="secondaryButton" onClick={()=>void load()} disabled={loading}><RefreshCw className={loading?'spin':''}/>Aktualisieren</button><button className="dangerButton" onClick={()=>void clear()} disabled={!items.length}><Trash2/>Verlauf löschen</button></div></header>
    <section className="historySummary" aria-label="Verlauf Zusammenfassung"><div><FileClock/><span><small>Gesamt</small><strong>{items.length}</strong></span></div><div className="success"><CheckCircle2/><span><small>Erfolgreich</small><strong>{successes}</strong></span></div><div className="error"><CircleX/><span><small>Fehlgeschlagen</small><strong>{failures}</strong></span></div><div><Clock3/><span><small>Heute</small><strong>{todayCount}</strong></span></div></section>
    <div className="historyFilters"><label><Search/><span className="srOnly">Verlauf durchsuchen</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Aktion, Datei, Pfad oder Fehler suchen…"/></label><div role="group" aria-label="Status filtern">{([['all','Alle'],['success','Erfolgreich'],['error','Fehler']] as const).map(([value,label])=><button key={value} className={status===value?'active':''} aria-pressed={status===value} onClick={()=>setStatus(value)}>{label}<span>{value==='all'?items.length:value==='success'?successes:failures}</span></button>)}</div></div>
    <div className="historyPageList">{loading?<div className="historyEmpty"><LoaderCircle className="spin"/><strong>Verlauf wird geladen</strong></div>:filtered.length?filtered.map(item=>{
      const sources=inferredSources(item);const results=inferredResults(item);const timestamp=new Date(item.at);
      return <article key={item.id} className={`historyRecord ${item.status}`}><div className="historyRecordIcon"><ActionIcon action={item.action}/></div><div className="historyRecordBody"><header><div><span className="historyActionBadge">{actionNames[item.action]||item.action}</span>{item.requestedAction&&item.requestedAction!==item.action&&<span className="historyModeNote">Angefordert: {actionNames[item.requestedAction]||item.requestedAction}</span>}<h2>{item.title}</h2></div><div className={`historyState ${item.status}`}>{item.status==='success'?<CheckCircle2/>:<CircleX/>}{item.status==='success'?'Erfolgreich':'Fehlgeschlagen'}</div></header>
        <p className="historyRecordDetail">{item.detail||'Keine zusätzliche Beschreibung gespeichert.'}</p>
        <dl className="historyMeta"><div><dt>Zeitpunkt</dt><dd><time dateTime={item.at}>{timestamp.toLocaleString('de-DE',{dateStyle:'full',timeStyle:'medium'})}</time></dd></div><div><dt>Elemente</dt><dd>{item.count??Math.max(sources.length,results.length,1)}</dd></div>{item.destination&&<div><dt>Zielordner</dt><dd title={item.destination}>{item.destination}</dd></div>}{item.bytes!==undefined&&<div><dt>Datenmenge</dt><dd>{formatSize(item.bytes)}</dd></div>}{item.durationMs!==undefined&&<div><dt>Dauer</dt><dd>{duration(item.durationMs)}</dd></div>}<div><dt>Vorgangs-ID</dt><dd title={item.id}>{item.id}</dd></div></dl>
        {item.error&&<div className="historyTechnicalError" role="alert"><CircleX/><div><strong>Technische Fehlermeldung</strong><code>{item.error}</code></div></div>}
        <div className="historyPathColumns"><PathList title="Quelle" paths={sources} type="source"/><PathList title="Ziel / Ergebnis" paths={results} type="result"/></div>
      </div></article>;
    }):<div className="historyEmpty"><History/><strong>{items.length?'Keine passenden Einträge':'Noch keine Aktivitäten'}</strong><span>{items.length?'Passe Suche oder Statusfilter an.':'Neue Dateiaktionen erscheinen automatisch hier.'}</span></div>}</div>
  </div>;
}
