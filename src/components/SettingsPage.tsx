import {useEffect,useMemo,useState} from 'react';
import {
  AppWindow,
  Check,
  Columns3,
  DatabaseBackup,
  Eye,
  EyeOff,
  FolderCog,
  FolderPlus,
  HardDrive,
  KeyRound,
  LayoutGrid,
  List,
  LockKeyhole,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react';
import {api,AppSettings,Bootstrap,formatSize,Location,ManualLocation,token} from '../lib/api';

type Props={
  bootstrap:Bootstrap;
  onSaved:(value:Bootstrap)=>void;
  notify:(message:string)=>void;
};

function Toggle({checked,onChange,label,description}:{checked:boolean;onChange:(value:boolean)=>void;label:string;description?:string}){
  return <label className="toggleRow"><span><strong>{label}</strong>{description&&<small>{description}</small>}</span><button type="button" className={`toggle ${checked?'on':''}`} aria-pressed={checked} onClick={()=>onChange(!checked)}><i/></button></label>;
}

function StorageIcon({location}:{location:Location}){
  if(location.kind==='unraid')return <Server/>;
  if(location.source==='manual')return <FolderCog/>;
  return <HardDrive/>;
}

function favoriteOptionLabel(favorite:string,locations:Location[]){
  if(favorite==='/')return 'Alle Speicherorte';
  const match=favorite.match(/^\/@\/([^/]+)(?:\/(.*))?$/);
  const location=locations.find(item=>item.id===match?.[1]);
  const segments=(match?.[2]||'').split('/').filter(Boolean).map(value=>decodeURIComponent(value));
  if(!segments.length)return location?.name||favorite;
  const name=segments.at(-1)||favorite;
  const parent=segments.slice(0,-1).join(' / ');
  return `${name} — ${location?.name||'Speicherort'}${parent?` / ${parent}`:''}`;
}

function StartLocationSelect({value,onChange,locations,favorites}:{value:string;onChange:(value:string)=>void;locations:Location[];favorites:string[]}){
  return <select value={value} onChange={event=>onChange(event.target.value)}>
    <option value="">Automatisch</option>
    <optgroup label="Speicherorte">{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</optgroup>
    <optgroup label="Favoriten">{favorites.map(favorite=><option key={favorite} value={`favorite:${favorite}`}>{favoriteOptionLabel(favorite,locations)}</option>)}</optgroup>
  </select>;
}

export function SettingsPage({bootstrap,onSaved,notify}:Props){
  const[settings,setSettings]=useState<AppSettings>(structuredClone(bootstrap.settings));
  const[saving,setSaving]=useState(false);
  const[rescanning,setRescanning]=useState(false);
  const[currentPassword,setCurrentPassword]=useState('');
  const[newPassword,setNewPassword]=useState('');
  const[confirmPassword,setConfirmPassword]=useState('');
  const[changingPassword,setChangingPassword]=useState(false);

  useEffect(()=>setSettings(structuredClone(bootstrap.settings)),[bootstrap]);

  const autoLocations=useMemo(()=>bootstrap.locations.filter(location=>location.source==='auto'),[bootstrap.locations]);
  const activeLocations=bootstrap.locations.filter(location=>location.enabled&&location.available);

  function patch<K extends keyof AppSettings>(key:K,value:AppSettings[K]){
    setSettings(current=>({...current,[key]:value}));
  }

  function updateManual(id:string,values:Partial<ManualLocation>){
    patch('manualLocations',settings.manualLocations.map(location=>location.id===id?{...location,...values}:location));
  }

  function addManual(){
    const rootPath=bootstrap.platform==='win32'?'C:\\Users\\Admin\\Documents':'/data/Media';
    patch('manualLocations',[...settings.manualLocations,{id:`manual-${crypto.randomUUID()}`,name:'Neuer Speicherort',rootPath,readOnly:false,enabled:true}]);
  }

  function removeManual(id:string){
    patch('manualLocations',settings.manualLocations.filter(location=>location.id!==id));
  }

  function toggleAuto(location:Location,enabled:boolean){
    const next=new Set(settings.disabledAutoLocationIds);
    if(enabled)next.delete(location.id);else next.add(location.id);
    patch('disabledAutoLocationIds',[...next]);
  }

  async function save(){
    setSaving(true);
    try{
      const response=await api<Bootstrap>('/settings',{method:'PUT',body:JSON.stringify({settings})});
      onSaved(response);
      notify('Einstellungen gespeichert');
    }catch(error:any){
      notify(`Fehler: ${error?.message||'Einstellungen konnten nicht gespeichert werden'}`);
    }finally{
      setSaving(false);
    }
  }

  async function rescan(){
    setRescanning(true);
    try{
      const response=await api<Bootstrap>('/locations/rescan',{method:'POST'});
      onSaved(response);
      notify('Speicherorte neu erkannt');
    }catch(error:any){notify(`Fehler: ${error.message}`)}finally{setRescanning(false)}
  }

  async function changePassword(){
    if(newPassword!==confirmPassword)return notify('Die neuen Passwörter stimmen nicht überein');
    if(newPassword.length<8)return notify('Das neue Passwort braucht mindestens 8 Zeichen');
    setChangingPassword(true);
    try{
      const response=await api<{token:string}>('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});
      localStorage.setItem('filepilot-token',response.token||token());
      setCurrentPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      notify('Passwort geändert');
    }catch(error:any){notify(`Fehler: ${error.message}`)}finally{setChangingPassword(false)}
  }

  return <div className="settingsPage">
    <header className="settingsHeader"><div><h1><SlidersHorizontal/> Einstellungen</h1><p>Speicherorte, Darstellung und Sicherheit von FilePilot verwalten.</p></div><div><button className="secondaryButton" onClick={()=>void rescan()} disabled={rescanning}><RefreshCw className={rescanning?'spin':''}/>{rescanning?'Suche…':'Neu erkennen'}</button><button className="primaryButton" onClick={()=>void save()} disabled={saving}><Save/>{saving?'Speichert…':'Speichern'}</button></div></header>

    <section className="settingsSection"><div className="sectionTitle"><HardDrive/><div><h2>Automatisch erkannte Speicherorte</h2><p>Windows-Laufwerke und der auf Unraid eingebundene Datenpfad erscheinen hier automatisch.</p></div></div>
      <div className="locationGrid">{autoLocations.map(location=>{
        const enabled=!settings.disabledAutoLocationIds.includes(location.id);
        return <article className={`locationCard ${!location.available?'unavailable':''}`} key={location.id}><div className="locationIcon"><StorageIcon location={location}/></div><div className="locationInfo"><strong>{location.name}</strong><code>{location.rootPath}</code><span>{location.available?`${formatSize(location.freeBytes)} frei von ${formatSize(location.totalBytes)}`:'Zurzeit nicht erreichbar'}</span></div><div className="locationActions"><span className={`status ${location.available?'ok':'bad'}`}>{location.available?<><Check/>Erkannt</>:<><X/>Offline</>}</span><button type="button" className={`toggle ${enabled?'on':''}`} onClick={()=>toggleAuto(location,!enabled)}><i/></button></div></article>
      })}{!autoLocations.length&&<div className="settingsEmpty"><HardDrive/><span>Noch keine automatischen Speicherorte erkannt.</span></div>}</div>
    </section>

    <section className="settingsSection"><div className="sectionTitle"><FolderPlus/><div><h2>Eigene Speicherorte</h2><p>Hier kannst du zusätzliche absolute Ordnerpfade freigeben. Im Docker-Container müssen diese Pfade zusätzlich als Volume eingebunden sein.</p></div><button className="secondaryButton sectionAction" onClick={addManual}><Plus/>Speicherort hinzufügen</button></div>
      <div className="manualLocations">{settings.manualLocations.map(location=>{
        const runtime=bootstrap.locations.find(item=>item.id===location.id);
        return <article className="manualLocation" key={location.id}><div className="manualLocationTop"><FolderCog/><input aria-label="Name" value={location.name} onChange={event=>updateManual(location.id,{name:event.target.value})}/><span className={`status ${runtime?.available?'ok':'bad'}`}>{runtime?.available?<><Check/>Erreichbar</>:<><X/>Nicht geprüft</>}</span><button className="iconButton dangerIcon" title="Speicherort entfernen" onClick={()=>removeManual(location.id)}><Trash2/></button></div><label>Absoluter Ordnerpfad<input value={location.rootPath} onChange={event=>updateManual(location.id,{rootPath:event.target.value})} placeholder={bootstrap.platform==='win32'?'D:\\Daten':'/data/Media'}/></label><div className="inlineToggles"><Toggle checked={location.enabled} onChange={value=>updateManual(location.id,{enabled:value})} label="Aktiv"/><Toggle checked={location.readOnly} onChange={value=>updateManual(location.id,{readOnly:value})} label="Nur Lesen"/></div></article>
      })}{!settings.manualLocations.length&&<div className="settingsEmpty"><FolderCog/><span>Keine zusätzlichen Speicherorte eingerichtet.</span></div>}</div>
    </section>

    <section className="settingsSection"><div className="sectionTitle"><AppWindow/><div><h2>Startansicht</h2><p>Lege Speicherorte oder Favoriten für die ersten Tabs und die maximale Zahl gleichzeitig sichtbarer Bereiche fest.</p></div></div><div className="settingsColumns"><label>Erster Tab<StartLocationSelect value={settings.defaultLeftLocationId} onChange={value=>patch('defaultLeftLocationId',value)} locations={activeLocations} favorites={settings.favorites}/></label><label>Zweiter Tab<StartLocationSelect value={settings.defaultRightLocationId} onChange={value=>patch('defaultRightLocationId',value)} locations={activeLocations} favorites={settings.favorites}/></label></div><div className="paneCountSetting"><div><Columns3/><span><strong>Bereiche nebeneinander</strong><small>Tabs bleiben erhalten; gleichzeitig werden höchstens so viele Bereiche angezeigt.</small></span></div><div className="paneCountChoices" role="group" aria-label="Bereiche nebeneinander">{([1,2,3,4] as const).map(count=><button type="button" key={count} className={settings.paneCount===count?'active':''} aria-pressed={settings.paneCount===count} onClick={()=>patch('paneCount',count)}>{count}</button>)}</div></div></section>

    <section className="settingsSection"><div className="sectionTitle"><Palette/><div><h2>Darstellung</h2><p>Lege den Standard für neu geöffnete Tabs fest. In jedem Bereich kannst du die Ansicht anschließend unabhängig umstellen.</p></div></div><div className="settingsOptions"><div className="choiceGroup"><span>Standardansicht</span><button className={settings.viewMode==='list'?'active':''} onClick={()=>patch('viewMode','list')}><List/>Liste</button><button className={settings.viewMode==='grid'?'active':''} onClick={()=>patch('viewMode','grid')}><LayoutGrid/>Kacheln</button></div><div className="choiceGroup"><span>Akzent</span>{(['blue','green','purple','orange'] as const).map(accent=><button key={accent} className={`accentChoice ${accent} ${settings.accent===accent?'active':''}`} onClick={()=>patch('accent',accent)}><i/>{accent==='blue'?'Blau':accent==='green'?'Grün':accent==='purple'?'Lila':'Orange'}</button>)}</div><Toggle checked={settings.showHidden} onChange={value=>patch('showHidden',value)} label="Versteckte Dateien anzeigen" description="Dateien und Ordner, deren Name mit einem Punkt beginnt."/><Toggle checked={settings.hideExtensions} onChange={value=>patch('hideExtensions',value)} label="Dateiendungen ausblenden" description="Beispiel: urlaub.jpg wird als urlaub angezeigt."/><Toggle checked={settings.foldersFirst} onChange={value=>patch('foldersFirst',value)} label="Ordner immer zuerst"/><Toggle checked={settings.compactRows} onChange={value=>patch('compactRows',value)} label="Kompakte Listenzeilen"/></div></section>

    <section className="settingsSection"><div className="sectionTitle"><DatabaseBackup/><div><h2>Dateioperationen</h2><p>Bestimme, wie Löschen und Sicherheitsabfragen funktionieren.</p></div></div><div className="settingsOptions"><Toggle checked={settings.trashEnabled} onChange={value=>patch('trashEnabled',value)} label="Papierkorb verwenden" description="Gelöschte Dateien werden unter dem AppData-Pfad gespeichert und nicht sofort endgültig entfernt."/><Toggle checked={settings.confirmDelete} onChange={value=>patch('confirmDelete',value)} label="Vor dem Löschen nachfragen"/></div><div className="infoBanner"><ShieldCheck/><div><strong>Container-Schutz</strong><span>FilePilot kann auf Unraid nur Pfade sehen, die im Docker-Template als Volume eingebunden wurden.</span></div></div></section>

    <section className="settingsSection"><div className="sectionTitle"><KeyRound/><div><h2>Passwort ändern</h2><p>Verwende mindestens 8 Zeichen und ändere das Startpasswort vor einem dauerhaften Einsatz.</p></div></div><div className="passwordGrid"><label>Aktuelles Passwort<div className="inputWithIcon"><LockKeyhole/><input type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)}/></div></label><label>Neues Passwort<div className="inputWithIcon"><KeyRound/><input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={event=>setNewPassword(event.target.value)}/></div></label><label>Neues Passwort bestätigen<div className="inputWithIcon"><KeyRound/><input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)}/></div></label><button className="secondaryButton passwordButton" onClick={()=>void changePassword()} disabled={changingPassword}>{changingPassword?'Ändert…':'Passwort ändern'}</button></div></section>

    <section className="settingsSection systemInfo"><div className="sectionTitle"><ShieldCheck/><div><h2>Systeminformationen</h2><p>Diese Angaben helfen beim Einrichten und bei der Fehlersuche.</p></div></div><dl><dt>FilePilot</dt><dd>Version {bootstrap.version}</dd><dt>Plattform</dt><dd>{bootstrap.platform}{bootstrap.isDocker?' · Docker-Container':' · lokaler Start'}</dd><dt>AppData</dt><dd><code>{bootstrap.appDataPath}</code></dd><dt>Aktive Speicherorte</dt><dd>{activeLocations.length}</dd></dl></section>

    <div className="settingsSaveBar"><span><ShieldCheck/>Änderungen werden dauerhaft im AppData-Ordner gespeichert.</span><button className="primaryButton" onClick={()=>void save()} disabled={saving}><Save/>{saving?'Speichert…':'Einstellungen speichern'}</button></div>
  </div>;
}
