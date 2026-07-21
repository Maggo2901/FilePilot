import {useEffect,useMemo,useState} from 'react';
import {ArchiveRestore,CheckSquare2,File,Folder,LoaderCircle,RefreshCw,Trash2} from 'lucide-react';
import {api,formatSize} from '../lib/api';
import type {ConfirmOptions} from './ConfirmDialog';

type TrashItem={id:string;name:string;type:'file'|'directory'|'symlink';size:number;deletedAt:string;originalPath?:string;location:string;restorable:boolean};

export function TrashPage({notify,confirmAction}:{notify:(message:string)=>void;confirmAction:(options:ConfirmOptions)=>Promise<boolean>}){
  const[items,setItems]=useState<TrashItem[]>([]);
  const[selected,setSelected]=useState<string[]>([]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const selectedItems=useMemo(()=>items.filter(item=>selected.includes(item.id)),[items,selected]);

  async function load(){
    setLoading(true);
    try{const response=(await api<{items:TrashItem[]}>('/trash')).items;setItems(response);setSelected(current=>current.filter(id=>response.some(item=>item.id===id)))}catch(error:any){notify(`Fehler: ${error.message}`)}finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[]);

  function toggle(id:string){setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])}

  async function restore(){
    if(!selected.length)return;
    setBusy(true);
    try{await api('/trash/restore',{method:'POST',body:JSON.stringify({ids:selected})});notify(`${selected.length} Element(e) wiederhergestellt`);setSelected([]);await load()}catch(error:any){notify(`Fehler: ${error.message}`)}finally{setBusy(false)}
  }

  async function removePermanent(){
    if(!selected.length)return;
    const confirmed=await confirmAction({title:'Endgültig löschen?',message:`${selected.length} ausgewählte Element(e) werden unwiderruflich gelöscht.`,detail:'Diese Aktion kann nicht rückgängig gemacht werden.',confirmLabel:'Endgültig löschen',danger:true});
    if(!confirmed)return;
    setBusy(true);
    try{await api('/trash',{method:'DELETE',body:JSON.stringify({ids:selected})});notify(`${selected.length} Element(e) endgültig gelöscht`);setSelected([]);await load()}catch(error:any){notify(`Fehler: ${error.message}`)}finally{setBusy(false)}
  }

  async function empty(){
    if(!items.length)return;
    const confirmed=await confirmAction({title:'Papierkorb vollständig leeren?',message:`Alle ${items.length} Element(e) werden unwiderruflich gelöscht.`,detail:'Danach können die Dateien nicht mehr wiederhergestellt werden.',confirmLabel:'Papierkorb leeren',danger:true});
    if(!confirmed)return;
    setBusy(true);
    try{await api('/trash/all',{method:'DELETE'});notify('Papierkorb geleert');setSelected([]);await load()}catch(error:any){notify(`Fehler: ${error.message}`)}finally{setBusy(false)}
  }

  return <div className="trashPage"><header className="trashHeader"><div><span><Trash2/></span><div><h1>Papierkorb</h1><p>Gelöschte Dateien wiederherstellen oder endgültig entfernen</p></div></div><div><button className="secondaryButton" onClick={()=>void load()} disabled={loading||busy}><RefreshCw className={loading?'spin':''}/>Aktualisieren</button><button className="dangerButton" onClick={()=>void empty()} disabled={!items.length||busy}><Trash2/>Papierkorb leeren</button></div></header>
    <div className="trashToolbar"><div><button onClick={()=>setSelected(selected.length===items.length?[]:items.map(item=>item.id))} disabled={!items.length}><CheckSquare2/>{selected.length===items.length&&items.length?'Auswahl aufheben':'Alle auswählen'}</button><span>{items.length} Element{items.length===1?'':'e'} · {selected.length} ausgewählt</span></div><div><button className="restoreButton" onClick={()=>void restore()} disabled={!selected.length||busy||selectedItems.some(item=>!item.restorable)}><ArchiveRestore/>Wiederherstellen</button><button className="permanentButton" onClick={()=>void removePermanent()} disabled={!selected.length||busy}><Trash2/>Endgültig löschen</button></div></div>
    <div className="trashContent">{loading?<div className="trashEmpty"><LoaderCircle className="spin"/><strong>Papierkorb wird geladen</strong></div>:items.length?<div className="trashTable" role="table" aria-label="Papierkorb-Inhalte"><div className="trashTableHead" role="row"><span/><span>Name</span><span>Ursprünglicher Ort</span><span>Gelöscht am</span><span>Größe</span></div>{items.map(item=><button key={item.id} className={`trashRow ${selected.includes(item.id)?'selected':''}`} onClick={()=>toggle(item.id)} role="row" aria-pressed={selected.includes(item.id)}><i className="trashCheckbox">{selected.includes(item.id)?'✓':''}</i><span className="trashName">{item.type==='directory'?<Folder/>:<File/>}<strong>{item.name}</strong></span><span title={item.originalPath||`Älterer Eintrag aus ${item.location}`}>{item.originalPath||`Unbekannt · ${item.location}`}</span><time dateTime={item.deletedAt}>{new Date(item.deletedAt).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'})}</time><span>{item.type==='directory'?'Ordner':formatSize(item.size)}</span></button>)}</div>:<div className="trashEmpty"><Trash2/><strong>Der Papierkorb ist leer</strong><span>Gelöschte Dateien erscheinen hier und bleiben wiederherstellbar.</span></div>}</div>
  </div>;
}
