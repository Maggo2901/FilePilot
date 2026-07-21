import {useEffect,useMemo,useRef,useState} from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckSquare2,
  ClipboardPaste,
  ClipboardCopy,
  Columns2,
  Columns3,
  Columns4,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FilePlus2,
  Files,
  FolderHeart,
  FolderOpen,
  FolderPlus,
  HardDrive,
  History,
  Info,
  LogOut,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Scissors,
  Star,
  StarOff,
  Square,
  Trash2,
  Upload,
  X,
  type LucideIcon
} from 'lucide-react';
import {api,AppSettings,Bootstrap,FileItem,formatSize,Location,token} from './lib/api';
import {randomUUID} from './lib/id';
import {Login} from './components/Login';
import {FilePane,PaneHandle} from './components/FilePane';
import {SettingsPage} from './components/SettingsPage';
import {UploadCenter,UploadTask} from './components/UploadCenter';
import {TransferCenter,TransferTask} from './components/TransferCenter';
import {HistoryPage} from './components/HistoryPanel';
import {ConfirmDialog,ConfirmOptions} from './components/ConfirmDialog';
import {TrashPage} from './components/TrashPage';
import {BrandLockup,BrandMark} from './components/Brand';

function ask(message:string,initial=''){return window.prompt(message,initial)}

type ContextMenuItem={label:string;Icon:LucideIcon;action:()=>void;disabled?:boolean;danger?:boolean;separator?:boolean};
type ContextMenuState={x:number;y:number;label:string;items:ContextMenuItem[]};
type FileClipboard={paths:string[];mode:'copy'|'move'};
type TransferStreamEvent={type:'preparing'|'start'|'progress'|'result'|'error';mode?:'copy'|'move';error?:string;loaded?:number;total?:number;completedFiles?:number;totalFiles?:number;current?:string;percent?:number;speed?:number;etaSeconds?:number};
type DeleteStreamEvent={type:'preparing'|'start'|'progress'|'result'|'error';error?:string;loaded?:number;total?:number;completedFiles?:number;totalFiles?:number;current?:string;percent?:number;speed?:number;etaSeconds?:number;skipped?:number};
type WorkspaceTab={id:string;path:string;selected:string[];viewMode:AppSettings['viewMode']};

function workspaceTab(path:string,viewMode:AppSettings['viewMode']):WorkspaceTab{return{id:randomUUID(),path,selected:[],viewMode}}

async function streamedTransfer(paths:string[],destination:string,mode:'copy'|'move',onEvent:(event:TransferStreamEvent)=>void){
  const response=await fetch('/api/transfer-stream',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`},body:JSON.stringify({paths,destination,mode})});
  if(response.status===401){localStorage.removeItem('filepilot-token');location.reload();throw new Error('Sitzung abgelaufen')}
  if(!response.ok)throw new Error(`Übertragung fehlgeschlagen (${response.status})`);
  if(!response.body)throw new Error('Der Browser unterstützt keine Live-Fortschrittsanzeige');
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  let completed=false;
  const consume=(line:string)=>{
    if(!line.trim())return;
    const event=JSON.parse(line) as TransferStreamEvent;
    if(event.type==='error')throw new Error(event.error||'Übertragung fehlgeschlagen');
    if(event.type==='result')completed=true;
    onEvent(event);
  };
  while(true){
    const{done,value}=await reader.read();
    buffer+=decoder.decode(value,{stream:!done});
    const lines=buffer.split('\n');
    buffer=lines.pop()||'';
    for(const line of lines)consume(line);
    if(done)break;
  }
  consume(buffer);
  if(!completed)throw new Error('Die Übertragung wurde unerwartet beendet');
}

async function streamedDelete(paths:string[],onEvent:(event:DeleteStreamEvent)=>void){
  const response=await fetch('/api/delete-stream',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`},body:JSON.stringify({paths})});
  if(response.status===401){localStorage.removeItem('filepilot-token');location.reload();throw new Error('Sitzung abgelaufen')}
  if(!response.ok)throw new Error(`Löschen fehlgeschlagen (${response.status})`);
  if(!response.body)throw new Error('Der Browser unterstützt keine Live-Fortschrittsanzeige');
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  let completed=false;
  const consume=(line:string)=>{
    if(!line.trim())return;
    const event=JSON.parse(line) as DeleteStreamEvent;
    if(event.type==='error')throw new Error(event.error||'Löschen fehlgeschlagen');
    if(event.type==='result')completed=true;
    onEvent(event);
  };
  while(true){
    const{done,value}=await reader.read();
    buffer+=decoder.decode(value,{stream:!done});
    const lines=buffer.split('\n');
    buffer=lines.pop()||'';
    for(const line of lines)consume(line);
    if(done)break;
  }
  consume(buffer);
  if(!completed)throw new Error('Der Löschvorgang wurde unerwartet beendet');
}

export default function App(){
  if(!token())return <Login/>;
  return <AuthenticatedApp/>;
}

function AuthenticatedApp(){
  const[bootstrap,setBootstrap]=useState<Bootstrap|null>(null);
  const[error,setError]=useState('');

  useEffect(()=>{
    api<Bootstrap>('/bootstrap').then(setBootstrap).catch(reason=>setError(reason?.message||'FilePilot konnte nicht gestartet werden'));
  },[]);

  if(error)return <main className="bootScreen"><BrandMark className="bootBrand" title="FilePilot"/><h1>FilePilot konnte nicht starten</h1><p>{error}</p><button onClick={()=>location.reload()}><RefreshCw/>Neu laden</button></main>;
  if(!bootstrap)return <main className="bootScreen"><div className="loader"><BrandMark title="FilePilot"/></div><h1>FilePilot wird gestartet</h1><p>Dateien. Klar auf Kurs.</p><small>Speicherorte werden automatisch erkannt…</small></main>;
  return <Explorer bootstrap={bootstrap} setBootstrap={setBootstrap}/>;
}

function locationForPath(pathValue:string,locations:Location[]){
  const match=pathValue.match(/^\/@\/([^/]+)/);
  return locations.find(location=>location.id===match?.[1]);
}

function favoriteLabel(pathValue:string,locations:Location[]){
  if(pathValue==='/')return 'Alle Speicherorte';
  const location=locationForPath(pathValue,locations);
  if(!location)return pathValue;
  if(pathValue===location.virtualPath)return location.name;
  return decodeURIComponent(pathValue.split('/').filter(Boolean).pop()||location.name);
}

function Explorer({bootstrap,setBootstrap}:{bootstrap:Bootstrap;setBootstrap:(value:Bootstrap)=>void}){
  const initialWorkspace=useRef<{tabs:WorkspaceTab[];visible:string[];active:string}|null>(null);
  if(!initialWorkspace.current){
    const count=Math.max(1,Math.min(4,bootstrap.settings.paneCount||2));
    const initialTabs=Array.from({length:Math.max(2,count)},(_,index)=>workspaceTab(index%2===0?bootstrap.startPaths.left:bootstrap.startPaths.right,bootstrap.settings.viewMode));
    initialWorkspace.current={tabs:initialTabs,visible:initialTabs.slice(0,count).map(tab=>tab.id),active:initialTabs[0].id};
  }
  const[tabs,setTabs]=useState(initialWorkspace.current.tabs);
  const[activeTabId,setActiveTabId]=useState(initialWorkspace.current.active);
  const[visibleTabIds,setVisibleTabIds]=useState(initialWorkspace.current.visible);
  const[toast,setToast]=useState('');
  const[preview,setPreview]=useState<FileItem|null>(null);
  const[info,setInfo]=useState<any>(null);
  const[page,setPage]=useState<'files'|'settings'|'trash'|'history'>('files');
  const paneHandles=useRef(new Map<string,PaneHandle>());
  const uploadInput=useRef<HTMLInputElement>(null);
  const uploadDestinationRef=useRef<string|null>(null);
  const uploadRequests=useRef(new Map<string,XMLHttpRequest>());
  const uploadProgressAt=useRef(new Map<string,number>());
  const deletingPaths=useRef(new Set<string>());
  const[uploads,setUploads]=useState<UploadTask[]>([]);
  const[transfers,setTransfers]=useState<TransferTask[]>([]);
  const[contextMenu,setContextMenu]=useState<ContextMenuState|null>(null);
  const[clipboard,setClipboard]=useState<FileClipboard|null>(null);
  const[dragMode,setDragMode]=useState<'copy'|'move'>('copy');
  const[confirmOptions,setConfirmOptions]=useState<ConfirmOptions|null>(null);
  const confirmResolve=useRef<((confirmed:boolean)=>void)|null>(null);

  const settings=bootstrap.settings;
  const activeLocations=bootstrap.locations.filter(location=>location.enabled&&location.available);
  const activeTab=tabs.find(tab=>tab.id===activeTabId)||tabs[0];
  const visibleTabs=visibleTabIds.map(id=>tabs.find(tab=>tab.id===id)).filter((tab):tab is WorkspaceTab=>Boolean(tab));
  const activeVisibleIndex=Math.max(0,visibleTabs.findIndex(tab=>tab.id===activeTabId));
  const destinationTab=visibleTabs.length>1?visibleTabs[(activeVisibleIndex+1)%visibleTabs.length]:undefined;
  const selected=activeTab?.selected||[];
  const current=activeTab?.path||'/';
  const destination=destinationTab?.path||'/';
  const currentLocation=locationForPath(current,bootstrap.locations);
  const canWrite=current!=='/'&&!currentLocation?.readOnly;

  function updateTab(id:string,patch:Partial<Omit<WorkspaceTab,'id'>>){
    setTabs(currentTabs=>currentTabs.map(tab=>tab.id===id?{...tab,...patch}:tab));
  }

  function setSelected(value:string[]){
    if(activeTab)updateTab(activeTab.id,{selected:value});
  }

  function notify(message:string){
    setToast(message);
    window.setTimeout(()=>setToast(''),3000);
  }

  function confirmAction(options:ConfirmOptions){
    confirmResolve.current?.(false);
    setConfirmOptions(options);
    return new Promise<boolean>(resolve=>{confirmResolve.current=resolve});
  }

  function resolveConfirmation(confirmed:boolean){
    const resolve=confirmResolve.current;
    confirmResolve.current=null;
    setConfirmOptions(null);
    resolve?.(confirmed);
  }

  function refresh(){
    visibleTabIds.forEach(id=>paneHandles.current.get(id)?.refresh());
  }

  async function run(action:()=>Promise<unknown>,success:string){
    try{
      await action();
      notify(success);
      refresh();
      return true;
    }catch(error:any){notify(`Fehler: ${error?.message||'Aktion fehlgeschlagen'}`);return false}
  }

  async function saveSettings(nextSettings:AppSettings,success?:string){
    try{
      const response=await api<Bootstrap>('/settings',{method:'PUT',body:JSON.stringify({settings:nextSettings})});
      setBootstrap(response);
      if(success)notify(success);
    }catch(error:any){notify(`Fehler: ${error.message}`)}
  }

  function mustCopyAcrossStorage(paths:string[],dest:string){
    const destinationLocation=locationForPath(dest,bootstrap.locations);
    return !destinationLocation||paths.some(sourcePath=>locationForPath(sourcePath,bootstrap.locations)?.id!==destinationLocation.id);
  }

  async function transfer(mode:'copy'|'move',paths=selected,dest=destination){
    if(!paths.length){notify('Bitte zuerst Dateien oder Ordner auswählen');return false}
    if(dest==='/'){notify('Öffne im Zielbereich zuerst einen Speicherort');return false}
    const forcedCopy=mode==='move'&&mustCopyAcrossStorage(paths,dest);
    const effectiveMode=forcedCopy?'copy':mode;
    if(forcedCopy)notify('Sicherheitsmodus: Zwischen verschiedenen Speicherorten wird immer kopiert');
    const id=randomUUID();
    const firstName=decodeURIComponent(paths[0].split('/').pop()||'Auswahl');
    const destinationName=favoriteLabel(dest,bootstrap.locations);
    const name=`${firstName}${paths.length>1?` + ${paths.length-1} weitere`:''} → ${destinationName}`;
    const task:TransferTask={id,name,mode:effectiveMode,loaded:0,total:0,completedFiles:0,totalFiles:0,percent:0,speed:0,etaSeconds:0,status:'preparing'};
    setTransfers(currentTasks=>[task,...currentTasks]);
    try{
      await streamedTransfer(paths,dest,effectiveMode,event=>{
        setTransfers(currentTasks=>currentTasks.map(currentTask=>currentTask.id===id?{
          ...currentTask,
          mode:event.mode??currentTask.mode,
          status:event.type==='result'?'done':event.type==='progress'?'transferring':currentTask.status,
          loaded:event.loaded??currentTask.loaded,
          total:event.total??currentTask.total,
          completedFiles:event.completedFiles??currentTask.completedFiles,
          totalFiles:event.totalFiles??currentTask.totalFiles,
          current:event.current??currentTask.current,
          percent:event.type==='result'?100:event.percent??currentTask.percent,
          speed:event.speed??currentTask.speed,
          etaSeconds:event.type==='result'?0:event.etaSeconds??currentTask.etaSeconds
        }:currentTask));
      });
      notify(effectiveMode==='copy'?'Auswahl vollständig kopiert':'Auswahl vollständig verschoben');
      refresh();
      return true;
    }catch(error:any){
      const message=error?.message||'Übertragung fehlgeschlagen';
      setTransfers(currentTasks=>currentTasks.map(currentTask=>currentTask.id===id?{...currentTask,status:'error',error:message}:currentTask));
      notify(`Fehler: ${message}`);
      refresh();
      return false;
    }
  }

  function stageClipboard(mode:'copy'|'move',paths=selected){
    if(!paths.length)return notify('Bitte zuerst Dateien oder Ordner auswählen');
    setClipboard({paths:[...paths],mode});
    notify(`${paths.length} Element${paths.length===1?'':'e'} zum ${mode==='copy'?'Kopieren':'Verschieben'} vorgemerkt`);
  }

  async function pasteClipboard(destinationPath=current){
    if(!clipboard)return notify('Die Zwischenablage ist leer');
    const forcedCopy=clipboard.mode==='move'&&mustCopyAcrossStorage(clipboard.paths,destinationPath);
    const succeeded=await transfer(clipboard.mode,clipboard.paths,destinationPath);
    if(succeeded&&clipboard.mode==='move'&&!forcedCopy)setClipboard(null);
  }

  useEffect(()=>{
    const previewListener=(event:Event)=>setPreview((event as CustomEvent<FileItem>).detail);
    const dropListener=(event:Event)=>{
      const detail=(event as CustomEvent<{paths:string[];destination:string}>).detail;
      void transfer(dragMode,detail.paths,detail.destination);
    };
    window.addEventListener('filepilot-preview',previewListener);
    window.addEventListener('filepilot-drop',dropListener);
    return()=>{
      window.removeEventListener('filepilot-preview',previewListener);
      window.removeEventListener('filepilot-drop',dropListener);
    };
  },[activeTabId,tabs,visibleTabIds,dragMode,bootstrap.locations]);

  function updateUpload(id:string,patch:Partial<UploadTask>){
    setUploads(tasks=>tasks.map(task=>task.id===id?{...task,...patch}:task));
  }

  function uploadFiles(files:FileList|null){
    if(!files?.length)return;
    const uploadDestination=uploadDestinationRef.current||current;
    uploadDestinationRef.current=null;
    const uploadLocation=locationForPath(uploadDestination,bootstrap.locations);
    if(uploadDestination==='/'||uploadLocation?.readOnly)return notify('Dieser Speicherort ist nicht beschreibbar');
    const selectedFiles=[...files];
    const id=randomUUID();
    const total=selectedFiles.reduce((sum,file)=>sum+file.size,0);
    const name=selectedFiles.length===1?selectedFiles[0].name:`${selectedFiles[0].name} + ${selectedFiles.length-1} weitere`;
    const form=new FormData();
    selectedFiles.forEach(file=>form.append('files',file));
    form.append('destination',uploadDestination);
    const task:UploadTask={id,name,fileCount:selectedFiles.length,loaded:0,total,status:'uploading'};
    setUploads(tasks=>[task,...tasks]);

    const request=new XMLHttpRequest();
    uploadRequests.current.set(id,request);
    request.open('POST','/api/upload');
    request.setRequestHeader('Authorization',`Bearer ${token()}`);
    request.upload.onprogress=event=>{
      const now=performance.now();
      const previous=uploadProgressAt.current.get(id)||0;
      if(now-previous<100&&event.loaded<event.total)return;
      uploadProgressAt.current.set(id,now);
      updateUpload(id,{loaded:event.loaded,total:event.lengthComputable?event.total:total});
    };
    request.onload=()=>{
      uploadRequests.current.delete(id);
      uploadProgressAt.current.delete(id);
      if(request.status===401){localStorage.removeItem('filepilot-token');location.reload();return}
      if(request.status>=200&&request.status<300){
        updateUpload(id,{loaded:total,total,status:'done'});
        notify(`${selectedFiles.length} Datei(en) hochgeladen`);
        refresh();
        return;
      }
      let message='Upload fehlgeschlagen';
      try{message=JSON.parse(request.responseText).error||message}catch{/* use fallback */}
      updateUpload(id,{status:'error',error:message});
      notify(`Fehler: ${message}`);
    };
    request.onerror=()=>{uploadRequests.current.delete(id);updateUpload(id,{status:'error',error:'Netzwerkfehler beim Upload'});notify('Fehler: Netzwerkfehler beim Upload')};
    request.onabort=()=>{uploadRequests.current.delete(id);updateUpload(id,{status:'cancelled'})};
    request.send(form);
    if(uploadInput.current)uploadInput.current.value='';
  }

  async function showInfo(pathValue=selected.length===1?selected[0]:''){
    if(!pathValue)return notify('Bitte genau ein Element auswählen');
    setInfo({loading:true,name:decodeURIComponent(pathValue.split('/').pop()||'Element')});
    try{setInfo(await api(`/info?path=${encodeURIComponent(pathValue)}`))}catch(error:any){setInfo(null);notify(`Fehler: ${error.message}`)}
  }

  async function toggleFavorite(pathValue=current){
    const favorites=settings.favorites.includes(pathValue)?settings.favorites.filter(value=>value!==pathValue):[...settings.favorites,pathValue];
    await saveSettings({...settings,favorites},settings.favorites.includes(pathValue)?'Favorit entfernt':'Favorit hinzugefügt');
  }

  async function toggleHidden(){
    await saveSettings({...settings,showHidden:!settings.showHidden});
  }

  function openLocation(location:Location){
    setPage('files');
    if(activeTab)updateTab(activeTab.id,{path:location.virtualPath,selected:[]});
  }

  function createFolder(parent=current){
    const parentLocation=locationForPath(parent,bootstrap.locations);
    if(parent==='/'||parentLocation?.readOnly)return notify('Öffne zuerst einen beschreibbaren Speicherort');
    const name=ask('Name des neuen Ordners:');
    if(name)void run(()=>api('/folder',{method:'POST',body:JSON.stringify({parent,name})}),'Ordner erstellt');
  }

  function renameSelected(pathValue=selected.length===1?selected[0]:''){
    if(!pathValue)return notify('Bitte genau ein Element auswählen');
    const initial=pathValue.split('/').pop()||'';
    const name=ask('Neuer Name:',initial);
    if(name)void run(()=>api('/rename',{method:'POST',body:JSON.stringify({path:pathValue,name})}),'Element umbenannt');
  }

  function downloadSelected(paths=selected){
    if(!paths.length)return notify('Bitte zuerst Dateien oder Ordner auswählen');
    const url=`/api/download?paths=${encodeURIComponent(JSON.stringify(paths))}`;
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=paths.length===1?(paths[0].split('/').pop()||'Download'):'FilePilot-Auswahl.zip';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function deleteSelected(paths=selected){
    if(!paths.length)return notify('Bitte zuerst Dateien oder Ordner auswählen');
    const proceed=!settings.confirmDelete||await confirmAction(settings.trashEnabled?{title:'In den Papierkorb verschieben?',message:`${paths.length} Element(e) werden aus dem aktuellen Ordner entfernt.`,detail:'Du kannst sie anschließend im FilePilot-Papierkorb wiederherstellen oder endgültig löschen.',confirmLabel:'In Papierkorb',danger:true}:{title:'Endgültig löschen?',message:`${paths.length} Element(e) werden unwiderruflich gelöscht.`,detail:'Diese Aktion kann nicht rückgängig gemacht werden.',confirmLabel:'Endgültig löschen',danger:true});
    if(!proceed)return;
    if(paths.some(pathValue=>deletingPaths.current.has(pathValue)))return notify('Diese Auswahl wird bereits gelöscht');
    paths.forEach(pathValue=>deletingPaths.current.add(pathValue));
    const id=randomUUID();
    const firstName=decodeURIComponent(paths[0].split('/').filter(Boolean).pop()||'Auswahl');
    const name=paths.length===1?firstName:`${firstName} + ${paths.length-1} weitere`;
    const task:TransferTask={id,name,mode:'delete',loaded:0,total:0,completedFiles:0,totalFiles:0,percent:0,speed:0,etaSeconds:0,status:'preparing'};
    setTransfers(currentTasks=>[task,...currentTasks]);
    try{
      let skipped=0;
      await streamedDelete(paths,event=>{
        skipped=event.skipped??skipped;
        setTransfers(currentTasks=>currentTasks.map(currentTask=>currentTask.id===id?{
          ...currentTask,
          status:event.type==='result'?'done':event.type==='progress'?'transferring':currentTask.status,
          loaded:event.loaded??currentTask.loaded,
          total:event.total??currentTask.total,
          completedFiles:event.completedFiles??currentTask.completedFiles,
          totalFiles:event.totalFiles??currentTask.totalFiles,
          current:event.current??currentTask.current,
          percent:event.type==='result'?100:event.percent??currentTask.percent,
          speed:event.speed??currentTask.speed,
          etaSeconds:event.type==='result'?0:event.etaSeconds??currentTask.etaSeconds
        }:currentTask));
      });
      setSelected([]);
      notify(skipped?`${skipped} bereits entfernte Element(e) übersprungen`:settings.trashEnabled?'In den Papierkorb verschoben':'Endgültig gelöscht');
      refresh();
    }catch(error:any){
      const message=error?.message||'Löschen fehlgeschlagen';
      setTransfers(currentTasks=>currentTasks.map(currentTask=>currentTask.id===id?{...currentTask,status:'error',error:message}:currentTask));
      notify(`Fehler: ${message}`);
      refresh();
    }finally{
      paths.forEach(pathValue=>deletingPaths.current.delete(pathValue));
    }
  }

  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement|null;
      if(event.key!=='Delete'||event.repeat||page!=='files'||!selected.length||confirmOptions||preview||info||contextMenu||target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target?.tagName||''))return;
      event.preventDefault();
      void deleteSelected([...selected]);
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[page,selected,confirmOptions,preview,info,contextMenu,settings.confirmDelete,settings.trashEnabled]);

  useEffect(()=>{
    const onClipboardShortcut=(event:KeyboardEvent)=>{
      if(!(event.ctrlKey||event.metaKey)||event.altKey||event.repeat||page!=='files'||confirmOptions||preview||info||contextMenu)return;
      const target=event.target as HTMLElement|null;
      if(target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target?.tagName||''))return;
      const key=event.key.toLocaleLowerCase();
      if((key==='c'||key==='x')&&window.getSelection()?.toString())return;
      if(key==='c'&&selected.length){event.preventDefault();stageClipboard('copy',[...selected]);return}
      if(key==='x'&&selected.length){event.preventDefault();stageClipboard('move',[...selected]);return}
      if(key==='v'&&clipboard&&canWrite){event.preventDefault();void pasteClipboard(current)}
    };
    window.addEventListener('keydown',onClipboardShortcut);
    return()=>window.removeEventListener('keydown',onClipboardShortcut);
  },[page,selected,clipboard,canWrite,current,confirmOptions,preview,info,contextMenu,bootstrap.locations,tabs,visibleTabIds]);

  function showContextMenu(event:React.MouseEvent,items:ContextMenuItem[],label:string){
    event.preventDefault();
    event.stopPropagation();
    const width=238;
    const height=Math.min(items.length*39+46,window.innerHeight-16);
    setContextMenu({x:Math.max(8,Math.min(event.clientX,window.innerWidth-width-8)),y:Math.max(8,Math.min(event.clientY,window.innerHeight-height-8)),items,label});
  }

  function setPanePath(tabId:string,pathValue:string){
    setPage('files');
    setActiveTabId(tabId);
    updateTab(tabId,{path:pathValue,selected:[]});
  }

  function activateTab(tabId:string){
    setPage('files');
    setActiveTabId(tabId);
    if(!visibleTabIds.includes(tabId)){
      const replaceIndex=Math.max(0,visibleTabIds.indexOf(activeTabId));
      setVisibleTabIds(ids=>ids.map((id,index)=>index===replaceIndex?tabId:id));
    }
  }

  function openInNewTab(pathValue=current,viewMode=settings.viewMode){
    const next=workspaceTab(pathValue,viewMode);
    setTabs(currentTabs=>[...currentTabs,next]);
    setVisibleTabIds(ids=>ids.map(id=>id===activeTabId?next.id:id));
    setActiveTabId(next.id);
    setPage('files');
  }

  function closeTab(tabId:string){
    if(tabs.length===1)return notify('Mindestens ein Tab bleibt geöffnet');
    const remaining=tabs.filter(tab=>tab.id!==tabId);
    let nextVisible=visibleTabIds.filter(id=>id!==tabId&&remaining.some(tab=>tab.id===id));
    for(const tab of remaining){
      if(nextVisible.length>=Math.min(settings.paneCount,remaining.length))break;
      if(!nextVisible.includes(tab.id))nextVisible.push(tab.id);
    }
    const nextActive=activeTabId===tabId?(nextVisible[0]||remaining[0].id):activeTabId;
    setTabs(remaining);
    setVisibleTabIds(nextVisible);
    setActiveTabId(nextActive);
    paneHandles.current.delete(tabId);
  }

  function changePaneCount(value:number,persist=true){
    const requested=Number.isInteger(value)?value:2;
    const count=Math.max(1,Math.min(4,requested)) as AppSettings['paneCount'];
    const nextTabs=[...tabs];
    while(nextTabs.length<count)nextTabs.push(workspaceTab(nextTabs.length%2===0?bootstrap.startPaths.left:bootstrap.startPaths.right,settings.viewMode));
    let nextVisible=visibleTabIds.filter(id=>nextTabs.some(tab=>tab.id===id));
    if(nextVisible.length>count){
      const activeIndex=nextVisible.indexOf(activeTabId);
      nextVisible=nextVisible.slice(0,count);
      if(activeIndex>=count)nextVisible[count-1]=activeTabId;
    }
    for(const tab of nextTabs){
      if(nextVisible.length>=count)break;
      if(!nextVisible.includes(tab.id))nextVisible.push(tab.id);
    }
    setTabs(nextTabs);
    setVisibleTabIds(nextVisible);
    if(!nextVisible.includes(activeTabId))setActiveTabId(nextVisible[0]);
    if(persist)void saveSettings({...settings,paneCount:count},`${count} Bereich${count===1?'':'e'} sichtbar`);
  }

  useEffect(()=>{
    const configured=settings.paneCount||2;
    if(configured!==visibleTabIds.length)changePaneCount(configured,false);
  },[settings.paneCount]);

  function copyPath(pathValue:string){
    void navigator.clipboard.writeText(pathValue).then(()=>notify('Pfad kopiert')).catch(()=>notify('Pfad konnte nicht kopiert werden'));
  }

  async function moveFavorite(pathValue:string,direction:-1|1){
    const index=settings.favorites.indexOf(pathValue);
    const target=index+direction;
    if(index<0||target<0||target>=settings.favorites.length)return;
    const favorites=[...settings.favorites];
    [favorites[index],favorites[target]]=[favorites[target],favorites[index]];
    await saveSettings({...settings,favorites},'Favorit verschoben');
  }

  function fileContext(event:React.MouseEvent,item:FileItem|undefined,tabId:string){
    setActiveTabId(tabId);
    const tab=tabs.find(candidate=>candidate.id===tabId);
    if(!tab)return;
    const panePath=tab.path;
    const paneSelected=tab.selected;
    const paths=item?(paneSelected.includes(item.path)?paneSelected:[item.path]):[];
    const paneIndex=visibleTabIds.indexOf(tabId);
    const locked=Boolean(item?.readOnly||item?.locationRoot);
    if(!item){
      const location=locationForPath(panePath,bootstrap.locations);
      const writable=panePath!=='/'&&!location?.readOnly;
      return showContextMenu(event,[
        {label:clipboard?`${clipboard.paths.length} Element${clipboard.paths.length===1?'':'e'} einfügen`:'Einfügen',Icon:ClipboardPaste,action:()=>void pasteClipboard(panePath),disabled:!clipboard||!writable},
        {label:'Neuer Ordner',Icon:FolderPlus,action:()=>createFolder(panePath),disabled:!writable,separator:true},
        {label:'Dateien hochladen',Icon:Upload,action:()=>{uploadDestinationRef.current=panePath;uploadInput.current?.click()},disabled:!writable},
        {label:settings.favorites.includes(panePath)?'Aus Favoriten entfernen':'Zu Favoriten hinzufügen',Icon:settings.favorites.includes(panePath)?StarOff:Star,action:()=>void toggleFavorite(panePath),disabled:panePath==='/',separator:true},
        {label:'Diesen Bereich aktualisieren',Icon:RefreshCw,action:()=>paneHandles.current.get(tabId)?.refresh()},
        {label:'Einstellungen',Icon:Settings,action:()=>setPage('settings'),separator:true}
      ],`Bereich ${Math.max(1,paneIndex+1)}: Ordneraktionen`);
    }
    const folderWritable=item.type==='directory'&&!item.readOnly;
    showContextMenu(event,[
      {label:item.type==='directory'?'Ordner öffnen':'Vorschau öffnen',Icon:FolderOpen,action:()=>item.type==='directory'?setPanePath(tabId,item.path):setPreview(item),disabled:item.type==='symlink'},
      {label:'In diesen Ordner einfügen',Icon:ClipboardPaste,action:()=>void pasteClipboard(item.path),disabled:!clipboard||!folderWritable,separator:true},
      {label:'Kopieren',Icon:Copy,action:()=>stageClipboard('copy',paths),disabled:Boolean(item.locationRoot)},
      {label:'Ausschneiden',Icon:Scissors,action:()=>stageClipboard('move',paths),disabled:locked},
      {label:'Umbenennen',Icon:Pencil,action:()=>renameSelected(item.path),disabled:paths.length!==1||locked},
      {label:'Herunterladen',Icon:Download,action:()=>downloadSelected(paths)},
      {label:item.type==='directory'?(settings.favorites.includes(item.path)?'Aus Favoriten entfernen':'Zu Favoriten hinzufügen'):'Pfad kopieren',Icon:item.type==='directory'?(settings.favorites.includes(item.path)?StarOff:Star):ClipboardCopy,action:()=>item.type==='directory'?void toggleFavorite(item.path):copyPath(item.path),separator:true},
      {label:'Informationen',Icon:Info,action:()=>void showInfo(item.path)},
      {label:'Löschen',Icon:Trash2,action:()=>deleteSelected(paths),disabled:locked,danger:true,separator:true}
    ],paths.length>1?`${paths.length} Elemente`:item.name);
  }

  function favoriteContext(event:React.MouseEvent,pathValue:string,index:number){
    showContextMenu(event,[
      {label:'Im aktiven Tab öffnen',Icon:FolderOpen,action:()=>activeTab&&setPanePath(activeTab.id,pathValue)},
      {label:'In neuem Tab öffnen',Icon:Plus,action:()=>openInNewTab(pathValue)},
      {label:'Nach oben verschieben',Icon:ArrowUp,action:()=>void moveFavorite(pathValue,-1),disabled:index===0,separator:true},
      {label:'Nach unten verschieben',Icon:ArrowDown,action:()=>void moveFavorite(pathValue,1),disabled:index===settings.favorites.length-1},
      {label:'Pfad kopieren',Icon:ClipboardCopy,action:()=>copyPath(pathValue),separator:true},
      {label:'Favorit entfernen',Icon:StarOff,action:()=>void toggleFavorite(pathValue),danger:true}
    ],favoriteLabel(pathValue,bootstrap.locations));
  }

  function locationContext(event:React.MouseEvent,location:Location){
    const favorite=settings.favorites.includes(location.virtualPath);
    showContextMenu(event,[
      {label:'Im aktiven Tab öffnen',Icon:FolderOpen,action:()=>activeTab&&setPanePath(activeTab.id,location.virtualPath)},
      {label:'In neuem Tab öffnen',Icon:Plus,action:()=>openInNewTab(location.virtualPath)},
      {label:favorite?'Aus Favoriten entfernen':'Zu Favoriten hinzufügen',Icon:favorite?StarOff:Star,action:()=>void toggleFavorite(location.virtualPath),separator:true},
      {label:'Systempfad kopieren',Icon:ClipboardCopy,action:()=>copyPath(location.rootPath)}
    ],location.name);
  }

  function tabContext(event:React.MouseEvent,tab:WorkspaceTab){
    showContextMenu(event,[
      {label:'Tab anzeigen',Icon:FolderOpen,action:()=>activateTab(tab.id)},
      {label:'Tab duplizieren',Icon:Copy,action:()=>openInNewTab(tab.path,tab.viewMode)},
      {label:'Pfad kopieren',Icon:ClipboardCopy,action:()=>copyPath(tab.path),separator:true},
      {label:'Tab schließen',Icon:X,action:()=>closeTab(tab.id),disabled:tabs.length===1,danger:true}
    ],favoriteLabel(tab.path,bootstrap.locations));
  }

  const favoriteActive=settings.favorites.includes(current);
  const platformText=bootstrap.isDocker?'Unraid / Docker':bootstrap.platform==='win32'?'Windows-PC':'Lokales System';

  useEffect(()=>{
    const isUsable=(pathValue:string)=>pathValue==='/'||Boolean(locationForPath(pathValue,bootstrap.locations)?.enabled&&locationForPath(pathValue,bootstrap.locations)?.available);
    setTabs(currentTabs=>currentTabs.map((tab,index)=>isUsable(tab.path)?tab:{...tab,path:index%2===0?bootstrap.startPaths.left:bootstrap.startPaths.right,selected:[]}));
  },[bootstrap.locations,bootstrap.startPaths.left,bootstrap.startPaths.right]);

  return <div className="app" data-accent={settings.accent}>
    <aside><button className="logo" onClick={()=>setPage('files')} title="Zum Dateimanager" aria-label="Zum Dateimanager"><BrandLockup/></button>
      <nav className="favoritesNav"><span>FAVORITEN</span>{settings.favorites.map((favorite,index)=><button key={favorite} className={page==='files'&&current===favorite?'active':''} onClick={()=>{setPage('files');if(activeTab)updateTab(activeTab.id,{path:favorite,selected:[]})}} onContextMenu={event=>favoriteContext(event,favorite,index)}><span className="navEmoji" aria-hidden="true">⭐</span><span>{favoriteLabel(favorite,bootstrap.locations)}</span></button>)}</nav>
      <nav className="locationsNav"><span>SPEICHERORTE</span>{activeLocations.map(location=><button key={location.id} className={page==='files'&&current.startsWith(location.virtualPath)?'active':''} onClick={()=>openLocation(location)} onContextMenu={event=>locationContext(event,location)} title={location.rootPath}>{location.kind==='unraid'?<Server/>:<HardDrive/>}<span>{location.name}</span>{location.readOnly&&<small>RO</small>}</button>)}</nav>
      <div className="sideBottom"><button className={page==='history'?'active':''} onClick={()=>setPage('history')}><History/><span>Aktivitätsverlauf</span></button><button className={page==='trash'?'active':''} onClick={()=>setPage('trash')}><Trash2/><span>Papierkorb</span></button><button className={page==='settings'?'active':''} onClick={()=>setPage('settings')}><Settings/><span>Einstellungen</span></button><button onClick={()=>void toggleHidden()}>{settings.showHidden?<EyeOff/>:<Eye/>}<span>{settings.showHidden?'Versteckte ausblenden':'Versteckte anzeigen'}</span></button><button onClick={()=>void api('/auth/logout',{method:'POST'}).finally(()=>{localStorage.removeItem('filepilot-token');location.reload()})}><LogOut/><span>Abmelden</span></button></div>
    </aside>

    <main className={page==='settings'?'settingsMain':page==='trash'?'trashMain':page==='history'?'historyMain':''}>{page==='settings'?<SettingsPage bootstrap={bootstrap} onSaved={setBootstrap} notify={notify}/>:page==='trash'?<TrashPage notify={notify} confirmAction={confirmAction}/>:page==='history'?<HistoryPage notify={notify} confirmAction={confirmAction}/>:<>
      <header className="top"><div><h1><Files/>Dateimanager</h1><p><HardDrive/>{platformText} · {activeLocations.length} Speicherort(e) erkannt</p></div><div className="topActions"><button className="ghost" onClick={()=>void toggleFavorite()}><FolderHeart/>{favoriteActive?'Favorit entfernen':'Als Favorit'}</button></div></header>

      <div className="workspaceBar">
        <div className="workspaceTabs" role="tablist" aria-label="Geöffnete Datei-Tabs">{tabs.map(tab=>{const visible=visibleTabIds.includes(tab.id);return <div key={tab.id} className={`workspaceTab ${tab.id===activeTabId?'active':''} ${visible?'visible':''}`} onContextMenu={event=>tabContext(event,tab)}><button role="tab" aria-selected={tab.id===activeTabId} title={tab.path} onClick={()=>activateTab(tab.id)}><FolderOpen/><span>{favoriteLabel(tab.path,bootstrap.locations)}</span>{visible&&<small>{visibleTabIds.indexOf(tab.id)+1}</small>}</button><button className="tabClose" aria-label={`${favoriteLabel(tab.path,bootstrap.locations)} schließen`} title="Tab schließen" onClick={()=>closeTab(tab.id)} disabled={tabs.length===1}><X/></button></div>})}<button className="newTabButton" onClick={()=>openInNewTab()} title="Neuen Tab öffnen" aria-label="Neuen Tab öffnen"><Plus/></button></div>
        <div className="layoutPicker"><span>Bereiche</span>{([Square,Columns2,Columns3,Columns4] as LucideIcon[]).map((Icon,index)=>{const count=index+1;return <button key={count} className={visibleTabs.length===count?'active':''} aria-label={`${count} Bereich${count===1?'':'e'} nebeneinander`} title={`${count} Bereich${count===1?'':'e'} nebeneinander`} onClick={()=>changePaneCount(count)}><Icon/><small>{count}</small></button>})}</div>
      </div>

      <UploadCenter tasks={uploads} onCancel={id=>uploadRequests.current.get(id)?.abort()} onDismiss={id=>setUploads(tasks=>tasks.filter(task=>task.id!==id))}/>

      <div className="toolbar">
        <div className="dragModeControl" role="group" aria-label="Drag-and-Drop-Verhalten">
          <span>Drag &amp; Drop</span>
          <button className={dragMode==='copy'?'active':''} aria-pressed={dragMode==='copy'} onClick={()=>setDragMode('copy')} title="Beim Ziehen kopieren"><Copy/>Kopieren</button>
          <button className={dragMode==='move'?'active':''} aria-pressed={dragMode==='move'} onClick={()=>setDragMode('move')} title="Beim Ziehen innerhalb desselben Speicherorts verschieben"><Scissors/>Verschieben</button>
          <small title="Zwischen unterschiedlichen Speicherorten wird aus Sicherheitsgründen immer kopiert">Andere Speicher: immer Kopie</small>
        </div>
        <i/>
        <button data-tone="amber" onClick={()=>createFolder()} disabled={!canWrite} title="Neuen Ordner im aktiven Bereich erstellen"><FolderPlus/>Neuer Ordner</button>
        <button data-tone="cyan" onClick={()=>{uploadDestinationRef.current=null;uploadInput.current?.click()}} disabled={!canWrite} title="Dateien vom Computer hochladen"><Upload/>Hochladen</button>
        <input ref={uploadInput} hidden multiple type="file" onChange={event=>void uploadFiles(event.target.files)}/>
        <i/>
        <button data-tone="blue" onClick={()=>stageClipboard('copy')} disabled={!selected.length} title="Auswahl kopieren (Strg+C)"><Copy/>Kopieren</button>
        <button data-tone="violet" onClick={()=>stageClipboard('move')} disabled={!selected.length} title="Auswahl ausschneiden (Strg+X)"><Scissors/>Ausschneiden</button>
        <button data-tone="green" onClick={()=>void pasteClipboard()} disabled={!clipboard||!canWrite} title="In den aktiven Ordner einfügen (Strg+V)"><ClipboardPaste/>Einfügen</button>
        <button data-tone="orange" onClick={()=>renameSelected()} disabled={selected.length!==1} title="Ausgewähltes Element umbenennen"><Pencil/>Umbenennen</button>
        <button data-tone="green" onClick={()=>downloadSelected()} disabled={!selected.length} title="Auswahl herunterladen"><Download/>Download</button>
        <button data-tone="cyan" onClick={()=>void showInfo()} disabled={selected.length!==1} title="Eigenschaften anzeigen"><Info/>Info</button>
        <button className="danger" onClick={()=>deleteSelected()} disabled={!selected.length} title="Auswahl löschen"><Trash2/>Löschen</button>
        <i/>
        <button data-tone="violet" onClick={()=>{setSelected([]);notify('Auswahl aufgehoben')}} disabled={!selected.length} title="Auswahl aufheben"><CheckSquare2/>Auswahl aufheben</button>
        <button data-tone="cyan" onClick={refresh} title="Sichtbare Bereiche aktualisieren"><RefreshCw/>Aktualisieren</button>
      </div>

      <div className="panes modularPanes" style={{gridTemplateColumns:`repeat(${visibleTabs.length}, minmax(330px, 1fr))`}}>{visibleTabs.map((tab,index)=><div key={tab.id} data-pane-index={index} onMouseDown={()=>setActiveTabId(tab.id)} onFocusCapture={()=>setActiveTabId(tab.id)} className={tab.id===activeTabId?'activePane':''}><FilePane title={`Bereich ${index+1}`} path={tab.path} setPath={path=>updateTab(tab.id,{path,selected:[]})} selected={tab.selected} setSelected={value=>updateTab(tab.id,{selected:value})} viewMode={tab.viewMode} onViewModeChange={viewMode=>updateTab(tab.id,{viewMode})} register={handle=>paneHandles.current.set(tab.id,handle)} settings={settings} locations={bootstrap.locations} onError={notify} onContextMenu={(event,item)=>fileContext(event,item,tab.id)}/></div>)}</div>
    </>}</main>

    {toast&&<div className="toast" role="status" aria-live="polite">{toast}</div>}
    <TransferCenter tasks={transfers} onDismiss={id=>setTransfers(currentTasks=>currentTasks.filter(task=>task.id!==id))} onClearCompleted={()=>setTransfers(currentTasks=>currentTasks.filter(task=>task.status==='preparing'||task.status==='transferring'))}/>
    {confirmOptions&&<ConfirmDialog options={confirmOptions} onResult={resolveConfirmation}/>}
    {contextMenu&&<ContextMenu menu={contextMenu} close={()=>setContextMenu(null)}/>}
    {preview&&<Modal wide close={()=>setPreview(null)}><h2>{preview.name}</h2><Preview item={preview}/></Modal>}
    {info&&<Modal wide close={()=>setInfo(null)}><InfoDetails info={info}/></Modal>}
  </div>;
}

function formatDuration(value:unknown){
  const seconds=Number(value);
  if(!Number.isFinite(seconds))return '—';
  const whole=Math.max(0,Math.round(seconds));
  const hours=Math.floor(whole/3600);
  const minutes=Math.floor((whole%3600)/60);
  const rest=whole%60;
  return hours?`${hours}:${String(minutes).padStart(2,'0')}:${String(rest).padStart(2,'0')}`:`${minutes}:${String(rest).padStart(2,'0')}`;
}

function formatBitRate(value:unknown){
  const bits=Number(value);
  if(!Number.isFinite(bits)||bits<=0)return '—';
  return bits>=1_000_000?`${(bits/1_000_000).toLocaleString('de-DE',{maximumFractionDigits:2})} Mbit/s`:`${Math.round(bits/1000).toLocaleString('de-DE')} kbit/s`;
}

function formatDate(value:unknown){
  if(!value)return '—';
  const date=new Date(String(value));
  return Number.isNaN(date.getTime())?'—':date.toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'medium'});
}

function InfoRow({label,value}:{label:string;value:React.ReactNode}){
  return <><dt>{label}</dt><dd>{value??'—'}</dd></>;
}

function InfoDetails({info}:{info:any}){
  if(info.loading)return <div className="infoLoading" role="status"><LoaderCircle className="spin"/><strong>Datei wird analysiert</strong><span>Technische Metadaten und Medienspuren werden ausgelesen…</span></div>;
  const media=info.media;
  const streams=Array.isArray(media?.streams)?media.streams:[];
  const tags=Object.entries(media?.tags||{});
  const typeLabel=info.type==='directory'?'Ordner':info.type==='symlink'?'Verknüpfung':'Datei';
  return <div className="infoPanel">
    <header className="infoHeader"><span aria-hidden="true">🔎</span><div><h2>{info.name}</h2><p>{media?'Technische Datei- und Medienanalyse':'Dateieigenschaften'}</p></div></header>
    <section className="infoSection"><h3><span aria-hidden="true">📄</span>Allgemein</h3><dl className="infoGrid">
      <InfoRow label="Name" value={info.name}/><InfoRow label="Typ" value={typeLabel}/>
      <InfoRow label="Dateiendung" value={info.extension?`.${info.extension}`:'—'}/><InfoRow label="MIME-Typ" value={info.mimeType||'—'}/>
      <InfoRow label="Größe" value={formatSize(info.size)}/><InfoRow label="Belegter Speicher" value={info.allocatedSize?formatSize(info.allocatedSize):'—'}/>
      <InfoRow label="Speicherort" value={info.location}/><InfoRow label="Virtueller Pfad" value={<code>{info.path}</code>}/>
      <InfoRow label="Systempfad" value={<code>{info.absolutePath}</code>}/><InfoRow label="Rechte" value={`${info.mode}${info.readOnly?' · Nur Lesen':''}`}/>
      <InfoRow label="Erstellt" value={formatDate(info.created)}/><InfoRow label="Geändert" value={formatDate(info.modified)}/>
      <InfoRow label="Letzter Zugriff" value={formatDate(info.accessed)}/><InfoRow label="Metadaten geändert" value={formatDate(info.changed)}/>
      <InfoRow label="UID / GID" value={`${info.uid} / ${info.gid}`}/><InfoRow label="Inode / Hardlinks" value={`${info.inode} / ${info.hardLinks}`}/>
    </dl></section>
    {media&&<section className="infoSection mediaInfo"><h3><span aria-hidden="true">🎞️</span>Medienübersicht</h3><dl className="infoGrid">
      <InfoRow label="Containerformat" value={media.formatLongName||media.formatName||'—'}/><InfoRow label="Formatkennung" value={media.formatName||'—'}/>
      <InfoRow label="Dauer" value={formatDuration(media.duration)}/><InfoRow label="Gesamtbitrate" value={formatBitRate(media.bitRate)}/>
      <InfoRow label="Spuren" value={streams.length}/><InfoRow label="Analysewert" value={media.probeScore!=null?`${media.probeScore}%`:'—'}/>
    </dl></section>}
    {streams.length>0&&<section className="infoSection"><h3><span aria-hidden="true">🎛️</span>Video-, Audio- und Untertitelspuren</h3><div className="streamGrid">{streams.map((stream:any,index:number)=>{
      const emoji=stream.type==='video'?'🎥':stream.type==='audio'?'🎧':stream.type==='subtitle'?'💬':'📡';
      const label=stream.type==='video'?'Videospur':stream.type==='audio'?'Tonspur':stream.type==='subtitle'?'Untertitelspur':'Datenspur';
      return <article className={`streamCard stream-${stream.type||'data'}`} key={`${stream.index}-${index}`}><header><span aria-hidden="true">{emoji}</span><div><strong>{label} {stream.index!=null?`#${stream.index+1}`:''}</strong><small>{stream.title||stream.language||'Ohne Bezeichnung'}</small></div>{stream.default&&<b>STANDARD</b>}</header><dl>
        <InfoRow label="Codec" value={stream.codecLongName||stream.codec||'—'}/>{stream.profile&&<InfoRow label="Profil" value={stream.profile}/>}
        {stream.width&&stream.height&&<InfoRow label="Auflösung" value={`${stream.width} × ${stream.height} px`}/>} {stream.frameRate&&<InfoRow label="Bildrate" value={`${stream.frameRate.toLocaleString('de-DE')} FPS`}/>}
        {stream.pixelFormat&&<InfoRow label="Pixelformat" value={stream.pixelFormat}/>} {stream.colorSpace&&<InfoRow label="Farbraum" value={`${stream.colorSpace}${stream.colorRange?` · ${stream.colorRange}`:''}`}/>}
        {stream.bitRate&&<InfoRow label="Bitrate" value={formatBitRate(stream.bitRate)}/>} {stream.channels&&<InfoRow label="Audiokanäle" value={`${stream.channels}${stream.channelLayout?` · ${stream.channelLayout}`:''}`}/>}
        {stream.sampleRate&&<InfoRow label="Abtastrate" value={`${Number(stream.sampleRate).toLocaleString('de-DE')} Hz`}/>} {stream.bitsPerSample&&<InfoRow label="Bittiefe" value={`${stream.bitsPerSample} Bit`}/>}
        {stream.language&&<InfoRow label="Sprache" value={stream.language}/>} {stream.forced&&<InfoRow label="Erzwungen" value="Ja"/>}
      </dl></article>})}</div></section>}
    {tags.length>0&&<section className="infoSection"><h3><span aria-hidden="true">🏷️</span>Tags und eingebettete Angaben</h3><dl className="infoGrid tagGrid">{tags.map(([key,value])=><InfoRow key={key} label={key} value={String(value)}/>)}</dl></section>}
    {!media&&info.type==='file'&&<div className="infoNotice"><span aria-hidden="true">ℹ️</span><span>Für diesen Dateityp sind keine zusätzlichen Medienmetadaten vorhanden. Die verfügbaren Dateisysteminformationen werden vollständig angezeigt.</span></div>}
  </div>;
}

function ContextMenu({menu,close}:{menu:ContextMenuState;close:()=>void}){
  const menuRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const dismiss=()=>close();
    const timer=window.setTimeout(()=>menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),0);
    window.addEventListener('mousedown',dismiss);
    window.addEventListener('contextmenu',dismiss);
    window.addEventListener('blur',dismiss);
    window.addEventListener('resize',dismiss);
    window.addEventListener('scroll',dismiss,true);
    return()=>{window.clearTimeout(timer);window.removeEventListener('mousedown',dismiss);window.removeEventListener('contextmenu',dismiss);window.removeEventListener('blur',dismiss);window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',dismiss,true)};
  },[close]);
  function keyboard(event:React.KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();close();return}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();
    const buttons=[...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[])];
    if(!buttons.length)return;
    const currentIndex=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?(currentIndex+1+buttons.length)%buttons.length:(currentIndex-1+buttons.length)%buttons.length;
    buttons[nextIndex].focus();
  }
  return <div ref={menuRef} className="contextMenu" role="menu" aria-label={menu.label} style={{left:menu.x,top:menu.y}} onMouseDown={event=>event.stopPropagation()} onContextMenu={event=>event.preventDefault()} onKeyDown={keyboard}><div className="contextMenuTitle">{menu.label}</div>{menu.items.map((item,index)=>{const Icon=item.Icon;return <button key={`${item.label}-${index}`} role="menuitem" className={`${item.separator?'separator ':''}${item.danger?'danger':''}`} disabled={item.disabled} onClick={()=>{close();item.action()}}><Icon/><span>{item.label}</span></button>})}</div>;
}

function Modal({children,close,wide=false}:{children:React.ReactNode;close:()=>void;wide?:boolean}){
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.focus();
    return()=>previous?.focus();
  },[]);
  return <div className="modalBg" onMouseDown={close}><div ref={dialog} className={`modal ${wide?'wideModal':''}`} role="dialog" aria-modal="true" aria-label="FilePilot-Dialog" tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape')close()}} onMouseDown={event=>event.stopPropagation()}><button className="close" onClick={close} title="Fenster schließen" aria-label="Fenster schließen"><X/></button>{children}</div></div>;
}

const IMAGE_EXTENSIONS=['jpg','jpeg','jpe','jfif','png','gif','webp','bmp','avif','svg','ico'];
const DIRECT_VIDEO_EXTENSIONS=['mp4','webm','mov','m4v','ogv'];
const VIDEO_EXTENSIONS=[...DIRECT_VIDEO_EXTENSIONS,'mkv','avi','wmv','flv','mpeg','mpg','ts','m2ts'];
const AUDIO_EXTENSIONS=['mp3','wav','ogg','flac','m4a','opus','aac'];
const TEXT_EXTENSIONS=['txt','md','markdown','log','nfo','json','jsonl','xml','yaml','yml','csv','tsv','ini','conf','config','env','properties','toml','sql','js','jsx','ts','tsx','css','scss','less','html','htm','sh','bash','zsh','ps1','bat','cmd','py','java','c','cc','cpp','h','hpp','cs','go','rs','php','rb','vue','svelte'];
const OFFICE_EXTENSIONS=['doc','docx','xls','xlsx','xlsm','ppt','pptx','odt','ods','odp'];

function Preview({item}:{item:FileItem}){
  const source=`/api/raw?path=${encodeURIComponent(item.path)}`;
  const downloadSource=`/api/download?paths=${encodeURIComponent(JSON.stringify([item.path]))}`;
  const extension=item.name.split('.').pop()?.toLowerCase()||'';
  const canOpenInTab=(IMAGE_EXTENSIONS.includes(extension)&&extension!=='svg')||VIDEO_EXTENSIONS.includes(extension)||AUDIO_EXTENSIONS.includes(extension)||extension==='pdf';
  let content:React.ReactNode;
  if(IMAGE_EXTENSIONS.includes(extension))content=<ImagePreview item={item}/>;
  else if(VIDEO_EXTENSIONS.includes(extension))content=<VideoPreview item={item} preferDirect={DIRECT_VIDEO_EXTENSIONS.includes(extension)}/>;
  else if(AUDIO_EXTENSIONS.includes(extension))content=<audio className="audioPreview" src={source} controls/>;
  else if(extension==='pdf')content=<iframe className="previewFrame" src={source} title={item.name}/>;
  else if(TEXT_EXTENSIONS.includes(extension)||(!extension&&item.size<=1024*1024))content=<TextPreview item={item}/>;
  else content=<div className="noPreview"><FilePlus2/><strong>{OFFICE_EXTENSIONS.includes(extension)?'Office-Datei erkannt':'Keine Browser-Vorschau verfügbar'}</strong><p>{OFFICE_EXTENSIONS.includes(extension)?'Word-, Excel- und PowerPoint-Dateien werden mit der auf deinem Computer installierten Standard-App geöffnet. Lade die Datei dafür herunter.':'Dieses Format kann der Browser nicht sicher direkt darstellen. Du kannst die Datei herunterladen und mit deiner Standard-App öffnen.'}</p><a className="primaryButton" href={downloadSource}><Download/>Herunterladen und öffnen</a></div>;
  return <div className="previewShell"><div className="previewActions"><span><FileText/>Vorschau · {formatSize(item.size)}</span><div>{canOpenInTab&&<a className="secondaryButton" href={source} target="_blank" rel="noreferrer"><ExternalLink/>Neuer Tab</a>}<a className="secondaryButton" href={downloadSource}><Download/>Herunterladen</a></div></div><div className="previewBody">{content}</div></div>;
}

function VideoPreview({item,preferDirect}:{item:FileItem;preferDirect:boolean}){
  const directSource=`/api/raw?path=${encodeURIComponent(item.path)}`;
  const convertedSource=`/api/media-stream?path=${encodeURIComponent(item.path)}`;
  const[converted,setConverted]=useState(!preferDirect);
  const[error,setError]=useState('');
  useEffect(()=>{setConverted(!preferDirect);setError('')},[item.path,preferDirect]);
  const source=converted?convertedSource:directSource;
  if(error)return <div className="textPreviewState" role="alert"><FilePlus2/><strong>Video konnte nicht wiedergegeben werden</strong><span>{error}</span><small>Die Originaldatei kann weiterhin heruntergeladen werden.</small></div>;
  return <div className="videoPreview"><video key={source} className="preview" src={source} controls playsInline preload="metadata" onError={()=>{
    if(!converted){setConverted(true);return}
    setError('Die Live-Konvertierung konnte nicht gestartet werden. Bitte prüfe die Server-Logs und ob FFmpeg installiert ist.');
  }}/>{converted&&<small><LoaderCircle/>Live-Konvertierung für den Browser · Das erste Starten kann einige Sekunden dauern</small>}</div>;
}

function ImagePreview({item}:{item:FileItem}){
  const[source,setSource]=useState('');
  const[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    let objectUrl='';
    setSource('');
    setError('');
    void fetch(`/api/raw?path=${encodeURIComponent(item.path)}`,{headers:{Authorization:`Bearer ${token()}`},signal:controller.signal}).then(async response=>{
      if(!response.ok){let message=`Bild konnte nicht geladen werden (${response.status})`;try{message=(await response.json()).error||message}catch{/* use fallback */}throw new Error(message)}
      const blob=await response.blob();
      if(!blob.type.startsWith('image/'))throw new Error('Die Datei wurde nicht als unterstütztes Bild erkannt');
      objectUrl=URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(reason=>{if(reason?.name!=='AbortError')setError(reason?.message||'Bild konnte nicht geladen werden')});
    return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[item.path]);
  if(error)return <div className="textPreviewState" role="alert"><FilePlus2/><strong>Bildvorschau nicht möglich</strong><span>{error}</span><small>Du kannst die Originaldatei weiterhin herunterladen.</small></div>;
  if(!source)return <div className="textPreviewState"><LoaderCircle className="spin"/><span>Bild wird geladen…</span></div>;
  return <img className="preview" src={source} alt={item.name} onError={()=>setError('Der Browser konnte dieses Bildformat nicht dekodieren')}/>;
}

function TextPreview({item}:{item:FileItem}){
  const[data,setData]=useState<{text:string;size:number;truncated:boolean;encoding:string}|null>(null);
  const[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    setData(null);
    setError('');
    void api<{text:string;size:number;truncated:boolean;encoding:string}>(`/text-preview?path=${encodeURIComponent(item.path)}`).then(value=>{if(active)setData(value)}).catch(reason=>{if(active)setError(reason?.message||'Textvorschau konnte nicht geladen werden')});
    return()=>{active=false};
  },[item.path]);
  if(error)return <div className="textPreviewState" role="alert"><FilePlus2/><strong>Textvorschau nicht möglich</strong><span>{error}</span></div>;
  if(!data)return <div className="textPreviewState"><LoaderCircle className="spin"/><span>Datei wird gelesen…</span></div>;
  return <div className="textPreview"><div><span>{data.encoding}</span>{data.truncated&&<strong>Vorschau auf 1 MB begrenzt</strong>}</div><pre>{data.text||'Diese Textdatei ist leer.'}</pre></div>;
}
