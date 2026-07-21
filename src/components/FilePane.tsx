import {useEffect,useMemo,useRef,useState} from 'react';
import {CalendarClock,CheckSquare2,ChevronRight,FileText,FolderOpen,FolderSearch,HardDrive,Home,LayoutGrid,List,LoaderCircle,LockKeyhole,RefreshCw,Ruler,Search,Server,TriangleAlert,X} from 'lucide-react';
import {api,AppSettings,displayFileName,FileItem,formatSize,Location,token} from '../lib/api';
import {FileEmoji} from './FileIcon';

export type PaneHandle={refresh:()=>void};

type Props={
  title:string;
  path:string;
  setPath:(value:string)=>void;
  selected:string[];
  setSelected:(value:string[])=>void;
  viewMode:AppSettings['viewMode'];
  onViewModeChange:(value:AppSettings['viewMode'])=>void;
  register:(handle:PaneHandle)=>void;
  settings:AppSettings;
  locations:Location[];
  onError:(message:string)=>void;
  onContextMenu:(event:React.MouseEvent,item?:FileItem)=>void;
};

type ListResponse={items:FileItem[];path:string;label:string;location?:Location};
type SearchResponse={items:FileItem[];scanned:number;truncated:boolean};
type SearchKind='all'|'images'|'videos'|'audio'|'word'|'spreadsheets'|'pdf'|'archives'|'code'|'folders';
type SearchProgress={phase:'preparing'|'scanning';discovered:number;scanned:number;total:number;found:number;percent:number};
type SearchStreamEvent={type:'preparing';discovered:number}|{type:'start';total:number}|{type:'progress';scanned:number;total:number;found:number;percent:number}|({type:'result'}&SearchResponse)|{type:'error';error:string};

const SEARCH_PRESETS:{kind:SearchKind;label:string;emoji:string}[]=[
  {kind:'all',label:'Alles',emoji:'🧭'},
  {kind:'images',label:'Bilder',emoji:'🖼️'},
  {kind:'videos',label:'Videos',emoji:'🎬'},
  {kind:'audio',label:'Musik',emoji:'🎵'},
  {kind:'word',label:'Word / Text',emoji:'📝'},
  {kind:'spreadsheets',label:'Excel / Tabellen',emoji:'📊'},
  {kind:'pdf',label:'PDF',emoji:'📕'},
  {kind:'archives',label:'Archive',emoji:'📦'},
  {kind:'code',label:'Code',emoji:'💻'},
  {kind:'folders',label:'Ordner',emoji:'📁'}
];

async function streamedSearch(url:string,signal:AbortSignal,onEvent:(event:SearchStreamEvent)=>void){
  const response=await fetch(`/api${url}`,{headers:{Authorization:`Bearer ${token()}`},signal});
  if(response.status===401){localStorage.removeItem('filepilot-token');location.reload();throw new Error('Sitzung abgelaufen')}
  if(!response.ok){let message=`Suche fehlgeschlagen (${response.status})`;try{message=(await response.json()).error||message}catch{/* use fallback */}throw new Error(message)}
  if(!response.body)throw new Error('Der Browser unterstützt keine Live-Fortschrittsanzeige');
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  let result:SearchResponse|undefined;
  const consume=(line:string)=>{
    if(!line.trim())return;
    const event=JSON.parse(line) as SearchStreamEvent;
    if(event.type==='error')throw new Error(event.error);
    if(event.type==='result')result={items:event.items,scanned:event.scanned,truncated:event.truncated};
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
  if(!result)throw new Error('Die Suche wurde ohne Ergebnis beendet');
  return result;
}

function parentPath(current:string){
  if(current==='/')return '/';
  const parts=current.split('/').filter(Boolean);
  if(parts.length<=2)return '/';
  return '/'+parts.slice(0,-1).join('/');
}

function resultParentLabel(item:FileItem,locations:Location[]){
  if(!item.parentPath)return '';
  const location=locations.find(entry=>entry.id===item.locationId);
  const parts=item.parentPath.split('/').filter(Boolean).slice(2).map(part=>{try{return decodeURIComponent(part)}catch{return part}});
  return parts.length?parts.join(' / '):(location?.name||'Speicherort');
}

export function FilePane({title,path,setPath,selected,setSelected,viewMode,onViewModeChange,register,settings,locations,onError,onContextMenu}:Props){
  const[items,setItems]=useState<FileItem[]>([]);
  const[loading,setLoading]=useState(false);
  const[sort,setSort]=useState<'name'|'size'|'modified'>('name');
  const[desc,setDesc]=useState(false);
  const[query,setQuery]=useState('');
  const[error,setError]=useState('');
  const[lastClicked,setLastClicked]=useState(-1);
  const loadSequence=useRef(0);
  const searchSequence=useRef(0);
  const[searchKind,setSearchKind]=useState<SearchKind>('all');
  const[deepSearch,setDeepSearch]=useState(false);
  const[searchItems,setSearchItems]=useState<FileItem[]|null>(null);
  const[searching,setSearching]=useState(false);
  const[searchError,setSearchError]=useState('');
  const[searchMeta,setSearchMeta]=useState({scanned:0,truncated:false});
  const[searchProgress,setSearchProgress]=useState<SearchProgress>({phase:'preparing',discovered:0,scanned:0,total:0,found:0,percent:0});
  const[searchRevision,setSearchRevision]=useState(0);

  async function load(){
    const sequence=++loadSequence.current;
    setLoading(true);
    setError('');
    try{
      const data=await api<ListResponse>(`/list?path=${encodeURIComponent(path)}`);
      if(sequence!==loadSequence.current)return;
      setItems(data.items);
      setSelected([]);
    }catch(reason:any){
      if(sequence!==loadSequence.current)return;
      const message=reason?.message||'Ordner konnte nicht geladen werden';
      setError(message);
      onError(message);
    }finally{
      if(sequence===loadSequence.current)setLoading(false);
    }
  }

  useEffect(()=>{setSearchItems(null);void load();return()=>{loadSequence.current+=1}},[path]);
  useEffect(()=>{register({refresh:()=>{void load();setSearchRevision(value=>value+1)}})},[path]);

  useEffect(()=>{
    const sequence=++searchSequence.current;
    if(!deepSearch){
      setSearchItems(null);
      setSearching(false);
      setSearchError('');
      setSearchMeta({scanned:0,truncated:false});
      setSearchProgress({phase:'preparing',discovered:0,scanned:0,total:0,found:0,percent:0});
      return;
    }
    setSearching(true);
    setSearchError('');
    setSearchProgress({phase:'preparing',discovered:0,scanned:0,total:0,found:0,percent:0});
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      void streamedSearch(`/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query.trim())}&kind=${searchKind}&scan=1&stream=1`,controller.signal,event=>{
        if(sequence!==searchSequence.current)return;
        if(event.type==='preparing')setSearchProgress(current=>({...current,phase:'preparing',discovered:event.discovered}));
        else if(event.type==='start')setSearchProgress({phase:'scanning',discovered:event.total,scanned:0,total:event.total,found:0,percent:event.total?0:100});
        else if(event.type==='progress')setSearchProgress({phase:'scanning',discovered:event.total,scanned:event.scanned,total:event.total,found:event.found,percent:event.percent});
      }).then(async data=>{
        if(sequence!==searchSequence.current)return;
        setSearchItems(data.items);
        setSearchMeta({scanned:data.scanned,truncated:data.truncated});
        setSearchProgress(current=>({...current,phase:'scanning',scanned:data.scanned,total:Math.max(current.total,data.scanned),found:data.items.length,percent:100}));
        await new Promise(resolve=>window.setTimeout(resolve,350));
      }).catch(reason=>{
        if(reason?.name==='AbortError')return;
        if(sequence!==searchSequence.current)return;
        const message=reason?.message||'Unterordner konnten nicht durchsucht werden';
        setSearchError(message);
        setSearchItems([]);
        onError(message);
      }).finally(()=>{
        if(sequence===searchSequence.current)setSearching(false);
      });
    },query.trim()?300:0);
    return()=>{window.clearTimeout(timer);controller.abort()};
  },[path,query,searchKind,deepSearch,searchRevision]);

  const sourceItems=deepSearch?(searchItems||[]):items;
  const shown=useMemo(()=>[...sourceItems]
    .filter(item=>(settings.showHidden||!item.hidden)&&(deepSearch||item.name.toLowerCase().includes(query.toLowerCase())))
    .sort((a,b)=>{
      if(settings.foldersFirst&&a.type!==b.type)return a.type==='directory'?-1:1;
      let result=sort==='name'
        ?a.name.localeCompare(b.name,'de',{numeric:true,sensitivity:'base'})
        :sort==='size'?(a.size||0)-(b.size||0)
        :+new Date(a.modified)-+new Date(b.modified);
      return desc?-result:result;
    }),[sourceItems,settings.showHidden,settings.foldersFirst,query,sort,desc,deepSearch]);

  const pathParts=path.split('/').filter(Boolean);
  const locationId=pathParts[1]||'';
  const location=locations.find(item=>item.id===locationId);
  const relativeParts=pathParts.slice(2);
  const searchLabel=SEARCH_PRESETS.find(entry=>entry.kind===searchKind)?.label||'Dateien';
  const searchDone=searchProgress.phase==='scanning'&&searchProgress.percent>=100;

  function select(item:FileItem,index:number,event:React.MouseEvent|React.KeyboardEvent){
    if(event.shiftKey&&lastClicked>=0){
      const start=Math.min(lastClicked,index);
      const end=Math.max(lastClicked,index);
      const range=shown.slice(start,end+1).map(entry=>entry.path);
      setSelected([...new Set([...selected,...range])]);
    }else if(event.ctrlKey||event.metaKey){
      setSelected(selected.includes(item.path)?selected.filter(value=>value!==item.path):[...selected,item.path]);
      setLastClicked(index);
    }else{
      setSelected([item.path]);
      setLastClicked(index);
    }
  }

  function toggleSort(nextSort:'name'|'size'|'modified'){
    setDesc(sort===nextSort?!desc:false);
    setSort(nextSort);
  }

  function clearDeepSearch(){
    setDeepSearch(false);
    setSearchKind('all');
    setQuery('');
    setSearchItems(null);
    setSearchError('');
  }

  function keyboardItem(event:React.KeyboardEvent,item:FileItem,index:number){
    if(event.key==='Enter'){
      event.preventDefault();
      open(item);
    }else if(event.key===' '){
      event.preventDefault();
      select(item,index,event);
    }
  }

  function open(item:FileItem){
    if(item.type==='directory')setPath(item.path);
    else if(item.type==='file')window.dispatchEvent(new CustomEvent('filepilot-preview',{detail:item}));
  }

  function startDrag(event:React.DragEvent,item:FileItem){
    event.dataTransfer.effectAllowed='copyMove';
    event.dataTransfer.setData('application/filepilot',JSON.stringify(selected.includes(item.path)?selected:[item.path]));
  }

  function receiveDrop(event:React.DragEvent){
    event.preventDefault();
    try{
      const paths=JSON.parse(event.dataTransfer.getData('application/filepilot')||'[]');
      if(Array.isArray(paths)&&paths.length)window.dispatchEvent(new CustomEvent('filepilot-drop',{detail:{paths,destination:path}}));
    }catch{/* ignore foreign drag data */}
  }

  function showContextMenu(event:React.MouseEvent,item?:FileItem){
    event.preventDefault();
    event.stopPropagation();
    if(item&&!selected.includes(item.path))setSelected([item.path]);
    onContextMenu(event,item);
  }

  const table=<div className="tableWrap"><table><thead><tr>
    <th aria-sort={sort==='name'?(desc?'descending':'ascending'):'none'}><button onClick={()=>toggleSort('name')}><FileText/>Name</button></th>
    <th aria-sort={sort==='size'?(desc?'descending':'ascending'):'none'}><button onClick={()=>toggleSort('size')}><Ruler/>Größe</button></th>
    <th aria-sort={sort==='modified'?(desc?'descending':'ascending'):'none'}><button onClick={()=>toggleSort('modified')}><CalendarClock/>Geändert</button></th>
  </tr></thead><tbody>
    {path!=='/'&&<tr className="parentRow" tabIndex={0} onDoubleClick={()=>setPath(parentPath(path))} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();setPath(parentPath(path))}}}><td><span className="fileName"><FolderOpen size={19}/><span>..</span></span></td><td/><td/></tr>}
    {shown.map((item,index)=><tr key={item.path} tabIndex={0} aria-selected={selected.includes(item.path)} className={selected.includes(item.path)?'selected':''} draggable={!item.locationRoot} onDragStart={event=>startDrag(event,item)} onClick={event=>select(item,index,event)} onDoubleClick={()=>open(item)} onContextMenu={event=>showContextMenu(event,item)} onKeyDown={event=>keyboardItem(event,item,index)}>
      <td><span className="fileName"><FileEmoji item={item}/><span className="fileText"><span>{displayFileName(item.name,settings.hideExtensions,item.type==='directory')}</span>{deepSearch&&item.parentPath&&<small>{resultParentLabel(item,locations)}</small>}</span>{item.readOnly&&<LockKeyhole className="readonlyIcon" size={13}/>}</span></td>
      <td>{item.locationRoot?`${formatSize(item.freeBytes)} frei`:item.type==='directory'?'—':formatSize(item.size)}</td>
      <td>{new Date(item.modified).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})}</td>
    </tr>)}
    {!loading&&!searching&&!error&&!shown.length&&<tr><td colSpan={3} className="empty">{deepSearch?<Search size={34}/>:<FolderOpen size={34}/>}<span>{deepSearch?'Keine passenden Treffer in diesem Ordner und seinen Unterordnern':'Dieser Ordner ist leer'}</span>{deepSearch&&<small>Probiere einen anderen Dateityp oder Suchbegriff.</small>}</td></tr>}
  </tbody></table></div>;

  const grid=<div className="fileGrid">
    {path!=='/'&&<button className="fileCard parentCard" onClick={()=>setPath(parentPath(path))}><FolderOpen size={34}/><strong>..</strong><span>Eine Ebene höher</span></button>}
    {shown.map((item,index)=><button key={item.path} aria-pressed={selected.includes(item.path)} className={`fileCard ${selected.includes(item.path)?'selected':''}`} draggable={!item.locationRoot} onDragStart={event=>startDrag(event,item)} onClick={event=>select(item,index,event)} onDoubleClick={()=>open(item)} onContextMenu={event=>showContextMenu(event,item)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();open(item)}}}>
      <FileEmoji item={item}/><strong title={item.name}>{displayFileName(item.name,settings.hideExtensions,item.type==='directory')}</strong><span>{item.type==='directory'?(item.locationRoot?`${formatSize(item.freeBytes)} frei`:'Ordner'):formatSize(item.size)}</span>{deepSearch&&item.parentPath&&<small className="searchResultPath">{resultParentLabel(item,locations)}</small>}{item.readOnly&&<LockKeyhole className="cardLock" size={14}/>}</button>)}
    {!loading&&!searching&&!error&&!shown.length&&<div className="gridEmpty">{deepSearch?<Search size={40}/>:<FolderOpen size={40}/>}<span>{deepSearch?'Keine passenden Treffer':'Dieser Ordner ist leer'}</span>{deepSearch&&<small>Wähle einen anderen Filter oder Suchbegriff.</small>}</div>}
  </div>;

  return <section className={`pane ${settings.compactRows?'compact':''}`} aria-busy={loading} aria-label={`${title}: ${location?.name||'Speicherorte'}`} onContextMenu={event=>showContextMenu(event)} onDragOver={event=>event.preventDefault()} onDrop={receiveDrop}>
    <header className="paneTopbar"><div className="paneIdentity">{location?.kind==='unraid'?<Server size={16}/>:<HardDrive size={16}/>}<strong>{title}</strong></div><div className="pathbar"><button onClick={()=>setPath('/')} title="Alle Speicherorte" aria-label="Alle Speicherorte"><Home size={16}/></button><div className="crumbs"><button onClick={()=>setPath('/')}>Speicherorte</button>{location&&<span><ChevronRight size={14}/><button onClick={()=>setPath(location.virtualPath)}>{location.name}</button></span>}{relativeParts.map((part,index)=><span key={`${part}-${index}`}><ChevronRight size={14}/><button onClick={()=>setPath(`${location?.virtualPath}/${relativeParts.slice(0,index+1).join('/')}`)}>{part}</button></span>)}</div></div><div className="paneHeaderActions"><div className="paneViewToggle" role="group" aria-label={`Ansicht für ${title}`}><button className={viewMode==='list'?'active':''} aria-label={`${title} als Liste anzeigen`} aria-pressed={viewMode==='list'} onClick={()=>onViewModeChange('list')} title="Listenansicht"><List/></button><button className={viewMode==='grid'?'active':''} aria-label={`${title} als Kacheln anzeigen`} aria-pressed={viewMode==='grid'} onClick={()=>onViewModeChange('grid')} title="Kachelansicht"><LayoutGrid/></button></div><button className="paneRefresh" onClick={()=>void load()} title="Ordner aktualisieren" aria-label="Ordner aktualisieren"><RefreshCw size={16} className={loading?'spin':''}/></button></div></header>
    <div className={`paneSearch ${deepSearch?'deepActive':''}`}><div className="searchInputRow"><Search/><input aria-label={`${title} rekursiv durchsuchen`} value={query} onChange={event=>{setQuery(event.target.value);if(event.target.value)setDeepSearch(true)}} placeholder="Diesen Ordner und alle Unterordner durchsuchen"/>{searching&&<LoaderCircle className="spin"/>}{deepSearch&&<button onClick={clearDeepSearch} title="Suche schließen" aria-label="Suche schließen"><X/></button>}</div><div className="searchPresets" aria-label="Dateityp auswählen">{SEARCH_PRESETS.map(({kind,label,emoji})=>{const active=deepSearch&&searchKind===kind;return <button key={kind} className={active?'active':''} aria-pressed={active} title={active?`${label}-Filter ausschalten`:`${label}-Filter einschalten`} onClick={()=>{if(active){clearDeepSearch();return}setSearchKind(kind);setDeepSearch(true)}}><span className="presetEmoji" aria-hidden="true">{emoji}</span>{label}{active&&<X className="presetClose"/>}</button>})}</div></div>
    <div className="paneContent">{error?<div className="paneError" role="alert"><TriangleAlert size={32}/><strong>Zugriff nicht möglich</strong><span>{error}</span><button onClick={()=>void load()}>Erneut versuchen</button></div>:searchError?<div className="paneError" role="alert"><TriangleAlert size={32}/><strong>Suche nicht möglich</strong><span>{searchError}</span><button onClick={()=>setSearchRevision(value=>value+1)}>Erneut versuchen</button></div>:viewMode==='grid'?grid:table}{searching&&<div className="searchScanOverlay" role="status" aria-live="polite"><div className="searchScanCard"><div className="searchScanHead"><span>{searchDone?<CheckSquare2/>:<FolderSearch/>}</span><div><strong>{searchDone?'Suche abgeschlossen':searchProgress.phase==='preparing'?'Ordner werden erfasst':`${searchLabel} werden gesucht`}</strong><small>{searchProgress.phase==='preparing'?`${searchProgress.discovered} Elemente gefunden`:`${searchProgress.scanned} von ${searchProgress.total} Elementen geprüft`}</small></div><b>{searchProgress.phase==='preparing'?'…':`${searchProgress.percent}%`}</b></div><div className={`searchScanTrack ${searchProgress.phase==='preparing'?'preparing':''}`} role="progressbar" aria-label="Suchfortschritt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={searchProgress.phase==='scanning'?searchProgress.percent:undefined}><i style={searchProgress.phase==='scanning'?{transform:`scaleX(${searchProgress.percent/100})`}:undefined}/></div><div className="searchScanStats"><span>{searchDone?<CheckSquare2/>:<LoaderCircle className="spin"/>}{searchDone?'Treffer werden angezeigt':searchProgress.phase==='preparing'?'Suche wird vorbereitet':'Unterordner werden durchsucht'}</span><span>{searchProgress.found} Treffer</span></div><small>{searchDone?'Fertig. Die gefundenen Dateien werden jetzt angezeigt.':'Aktiven Filter erneut anklicken, um abzubrechen.'}</small></div></div>}</div>
    <footer><span>{searching?<LoaderCircle className="spin"/>:<FileText/>}{searching?'Unterordner werden gescannt':`${shown.length} ${deepSearch?'Treffer':'Elemente'}`}</span>{deepSearch&&<span><FolderSearch/>{searchMeta.scanned} geprüft{searchMeta.truncated?' · Limit erreicht':''}</span>}<span><CheckSquare2/>{selected.length} ausgewählt</span>{location?.readOnly&&<span><LockKeyhole/> Nur Lesen</span>}</footer>
  </section>;
}
