import {useState} from 'react';
import {CheckCircle2,ChevronDown,ChevronUp,CircleX,Clock3,Gauge,Trash2,X} from 'lucide-react';
import {formatSize} from '../lib/api';

export type TransferTask={
  id:string;
  name:string;
  mode:'copy'|'move'|'delete';
  loaded:number;
  total:number;
  completedFiles:number;
  totalFiles:number;
  percent:number;
  speed:number;
  etaSeconds:number;
  current?:string;
  status:'preparing'|'transferring'|'done'|'error';
  error?:string;
};

function duration(value:number){
  if(!Number.isFinite(value)||value<=0)return 'wird berechnet';
  const seconds=Math.ceil(value);
  if(seconds<60)return`${seconds} Sek.`;
  const minutes=Math.floor(seconds/60);
  if(minutes<60)return`${minutes} Min. ${seconds%60} Sek.`;
  const hours=Math.floor(minutes/60);
  return`${hours} Std. ${minutes%60} Min.`;
}

function modeLabel(mode:TransferTask['mode']){return mode==='copy'?'KOPIEREN':mode==='move'?'VERSCHIEBEN':'LÖSCHEN'}

export function TransferCenter({tasks,onDismiss,onClearCompleted}:{tasks:TransferTask[];onDismiss:(id:string)=>void;onClearCompleted:()=>void}){
  const[expanded,setExpanded]=useState(true);
  if(!tasks.length)return null;
  const active=tasks.filter(task=>task.status==='preparing'||task.status==='transferring');
  const completed=tasks.length-active.length;
  const total=active.reduce((sum,task)=>sum+task.total,0);
  const loaded=active.reduce((sum,task)=>sum+task.loaded,0);
  const percent=active.length?(total?Math.round(loaded/total*100):Math.round(active.reduce((sum,task)=>sum+task.percent,0)/active.length)):100;

  if(!expanded)return <button className={`transferCompact ${active.length?'active':'done'}`} onClick={()=>setExpanded(true)} aria-label={`Übertragungen öffnen, ${percent} Prozent abgeschlossen`} title="Übertragungen anzeigen"><span aria-hidden="true">{active.length?'🚀':'✅'}</span><div><strong>{active.length?`${percent}%`:'Fertig'}</strong><small>{active.length?`${active.length} Übertragung${active.length===1?'':'en'}`:`${tasks.length} abgeschlossen`}</small></div><i><b style={{transform:`scaleX(${percent/100})`}}/></i><ChevronDown/></button>;

  return <aside className="transferCenter" aria-label="Kopier- und Verschiebefortschritt" aria-live="polite">
    <header><div><span aria-hidden="true">🚀</span><div><strong>Dateiübertragungen</strong><small>{active.length?`${active.length} aktiv`:'Alle Vorgänge abgeschlossen'}</small></div></div><div className="transferHeaderActions">{completed>0&&<button className="transferClear" onClick={onClearCompleted} title="Alle abgeschlossenen und fehlgeschlagenen Einträge ausblenden"><Trash2/><span>Fertige löschen</span></button>}<button onClick={()=>setExpanded(false)} title="Fortschritt einklappen" aria-label="Fortschritt einklappen"><ChevronUp/></button></div></header>
    <div className="transferList">{tasks.map(task=><article key={task.id} className={`transferTask ${task.status}`}>
      <div className="transferTaskState" aria-hidden="true">{task.status==='done'?<CheckCircle2/>:task.status==='error'?<CircleX/>:task.mode==='delete'?<Trash2/>:<span>{task.mode==='copy'?'📄':'✂️'}</span>}</div>
      <div className="transferTaskBody"><div className="transferTaskTitle"><span className={`transferMode ${task.mode}`}>{modeLabel(task.mode)}</span><strong title={task.name}>{task.name}</strong><b>{task.status==='done'?'100%':task.status==='error'?'Fehler':task.status==='preparing'?'…':`${task.percent}%`}</b></div>
        <div className="transferBar" role="progressbar" aria-label={`${task.name}: ${task.percent} Prozent`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.percent}><i style={{transform:`scaleX(${task.percent/100})`}}/></div>
        {task.status==='error'?<p>{task.error}</p>:<div className="transferMeta"><span><Gauge/>{task.speed?`${formatSize(task.speed)}/s`:'wird berechnet'}</span><span><Clock3/>{task.status==='done'?'Abgeschlossen':duration(task.etaSeconds)}</span><span>{task.total?`${formatSize(task.loaded)} von ${formatSize(task.total)}`:`${task.completedFiles} Dateien`}</span></div>}
        {task.current&&task.status!=='done'&&<small className="transferCurrent" title={task.current}>{task.current}</small>}
      </div>
      {(task.status==='done'||task.status==='error')&&<button className="transferDismiss" onClick={()=>onDismiss(task.id)} title="Eintrag ausblenden" aria-label="Eintrag ausblenden"><X/></button>}
    </article>)}</div>
  </aside>;
}
