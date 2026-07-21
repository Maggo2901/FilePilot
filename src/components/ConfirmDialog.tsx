import {useEffect,useRef} from 'react';
import {AlertTriangle,X} from 'lucide-react';

export type ConfirmOptions={title:string;message:string;confirmLabel:string;detail?:string;danger?:boolean};

export function ConfirmDialog({options,onResult}:{options:ConfirmOptions;onResult:(confirmed:boolean)=>void}){
  const confirmRef=useRef<HTMLButtonElement>(null);
  const dialogRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    const previousFocus=document.activeElement as HTMLElement|null;
    confirmRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape')onResult(false);
      if(event.key==='Tab'){
        const focusable=[...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')||[])];
        if(!focusable.length)return;
        const first=focusable[0];
        const last=focusable[focusable.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>{window.removeEventListener('keydown',onKeyDown);previousFocus?.focus()};
  },[onResult]);
  return <div className="confirmBackdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onResult(false)}}><section ref={dialogRef} className={`confirmDialog ${options.danger?'danger':''}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message"><button className="confirmClose" onClick={()=>onResult(false)} aria-label="Dialog schließen"><X/></button><div className="confirmSymbol"><AlertTriangle/></div><h2 id="confirm-title">{options.title}</h2><p id="confirm-message">{options.message}</p>{options.detail&&<small>{options.detail}</small>}<div className="confirmActions"><button className="secondaryButton" onClick={()=>onResult(false)}>Abbrechen</button><button ref={confirmRef} className={options.danger?'dangerButton':'primaryButton'} onClick={()=>onResult(true)}>{options.confirmLabel}</button></div></section></div>;
}
