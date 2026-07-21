import {CheckCircle2,CircleX,Files,LoaderCircle,UploadCloud,X} from 'lucide-react';
import {formatSize} from '../lib/api';

export type UploadTask={
  id:string;
  name:string;
  fileCount:number;
  loaded:number;
  total:number;
  status:'uploading'|'done'|'error'|'cancelled';
  error?:string;
};

export function UploadCenter({tasks,onCancel,onDismiss}:{tasks:UploadTask[];onCancel:(id:string)=>void;onDismiss:(id:string)=>void}){
  if(!tasks.length)return null;
  const active=tasks.filter(task=>task.status==='uploading').length;

  return <section className="uploadCenter" aria-label="Upload-Fortschritt">
    <header><div><UploadCloud/><strong>Übertragungen</strong><span>{active?`${active} aktiv`:'Abgeschlossen'}</span></div><Files/><span>{tasks.reduce((sum,task)=>sum+task.fileCount,0)} Datei(en)</span></header>
    <div className="uploadList">
      {tasks.map(task=>{
        const percent=task.total?Math.min(100,Math.round(task.loaded/task.total*100)):0;
        return <article key={task.id} className={`uploadTask ${task.status}`} aria-label={`${task.name}: ${percent} Prozent`}>
          <div className="uploadState">{task.status==='uploading'?<LoaderCircle className="spin"/>:task.status==='done'?<CheckCircle2/>:<CircleX/>}</div>
          <div className="uploadDetails"><div><strong title={task.name}>{task.name}</strong><span>{task.fileCount>1?`${task.fileCount} Dateien · `:''}{task.status==='error'?task.error:task.status==='cancelled'?'Abgebrochen':`${formatSize(task.loaded)} von ${formatSize(task.total)}`}</span></div><div className="uploadTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{transform:`scaleX(${percent/100})`}}/></div></div>
          <b>{task.status==='done'?'Fertig':task.status==='uploading'?`${percent}%`:'–'}</b>
          <button className="uploadTaskAction" onClick={()=>task.status==='uploading'?onCancel(task.id):onDismiss(task.id)} title={task.status==='uploading'?'Upload abbrechen':'Eintrag ausblenden'} aria-label={task.status==='uploading'?'Upload abbrechen':'Eintrag ausblenden'}><X/></button>
        </article>;
      })}
    </div>
  </section>;
}
