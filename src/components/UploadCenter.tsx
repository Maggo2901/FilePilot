import {CheckCircle2,CircleX,Clock3,Files,FolderOpen,Gauge,LoaderCircle,UploadCloud,X} from 'lucide-react';
import {formatSize} from '../lib/api';

export type UploadTask={
  id:string;
  name:string;
  fileCount:number;
  folderCount:number;
  loaded:number;
  total:number;
  speed:number;
  etaSeconds:number;
  elapsedSeconds:number;
  status:'uploading'|'processing'|'done'|'error'|'cancelled';
  error?:string;
};

function duration(value:number){
  const seconds=Math.max(0,Math.ceil(Number(value)||0));
  if(seconds<60)return`${seconds} Sek.`;
  const minutes=Math.floor(seconds/60);
  if(minutes<60)return`${minutes} Min. ${seconds%60} Sek.`;
  const hours=Math.floor(minutes/60);
  return`${hours} Std. ${minutes%60} Min.`;
}

export function UploadCenter({tasks,onCancel,onDismiss}:{tasks:UploadTask[];onCancel:(id:string)=>void;onDismiss:(id:string)=>void}){
  if(!tasks.length)return null;
  const active=tasks.filter(task=>task.status==='uploading'||task.status==='processing').length;

  return <section className="uploadCenter" aria-label="Upload-Fortschritt" aria-live="polite">
    <header><div><UploadCloud/><strong>Uploads vom Computer</strong><span>{active?`${active} aktiv`:'Abgeschlossen'}</span></div><Files/><span>{tasks.reduce((sum,task)=>sum+task.fileCount,0)} Datei(en)</span></header>
    <div className="uploadList">
      {tasks.map(task=>{
        const percent=task.total?Math.min(100,Math.round(task.loaded/task.total*100)):task.status==='done'||task.status==='processing'?100:0;
        const activeTask=task.status==='uploading'||task.status==='processing';
        return <article key={task.id} className={`uploadTask ${task.status}`} aria-label={`${task.name}: ${percent} Prozent`}>
          <div className="uploadState">{activeTask?<LoaderCircle className="spin"/>:task.status==='done'?<CheckCircle2/>:<CircleX/>}</div>
          <div className="uploadDetails">
            <div><strong title={task.name}>{task.name}</strong><span>{task.status==='error'?task.error:task.status==='cancelled'?'Abgebrochen':task.status==='processing'?'Upload vollständig · wird gespeichert':`${formatSize(task.loaded)} von ${formatSize(task.total)}`}</span></div>
            <div className="uploadMetrics"><span><Files/>{task.fileCount} Datei{task.fileCount===1?'':'en'}</span>{task.folderCount>0&&<span><FolderOpen/>{task.folderCount} Ordner</span>}<span><Gauge/>{task.speed?`${formatSize(task.speed)}/s`:'wird berechnet'}</span><span><Clock3/>{task.status==='uploading'?`noch ${duration(task.etaSeconds)}`:`${duration(task.elapsedSeconds)} gesamt`}</span></div>
            <div className="uploadTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{transform:`scaleX(${percent/100})`}}/></div>
          </div>
          <b>{task.status==='done'?'Fertig':task.status==='processing'?'Speichern':task.status==='uploading'?`${percent}%`:'–'}</b>
          <button className="uploadTaskAction" onClick={()=>task.status==='uploading'?onCancel(task.id):onDismiss(task.id)} disabled={task.status==='processing'} title={task.status==='uploading'?'Upload abbrechen':task.status==='processing'?'Dateien werden gespeichert':'Eintrag ausblenden'} aria-label={task.status==='uploading'?'Upload abbrechen':task.status==='processing'?'Dateien werden gespeichert':'Eintrag ausblenden'}><X/></button>
        </article>;
      })}
    </div>
  </section>;
}
