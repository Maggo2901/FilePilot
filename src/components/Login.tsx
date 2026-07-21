import {FormEvent,useState} from 'react';
import {ArrowRight,Eye,EyeOff,LoaderCircle,Lock,ShieldCheck,Sparkles} from 'lucide-react';
import {BrandLogo} from './Brand';

export function Login(){
  const[p,setP]=useState('');
  const[e,setE]=useState('');
  const[busy,setBusy]=useState(false);
  const[showPassword,setShowPassword]=useState(false);

  async function submit(ev:FormEvent){
    ev.preventDefault();
    setBusy(true);
    setE('');
    try{
      const r=await fetch('/api/auth/login',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({password:p})
      });
      const text=await r.text();
      let d:any={};
      try{d=text?JSON.parse(text):{}}catch{
        throw new Error('Das Backend antwortet nicht korrekt. Bitte prüfe, ob npm run dev vollständig läuft.');
      }
      if(!r.ok)throw new Error(d.error||`Anmeldung fehlgeschlagen (${r.status})`);
      if(!d.token)throw new Error('Vom Backend wurde kein Login-Token zurückgegeben.');
      localStorage.setItem('filepilot-token',d.token);
      location.reload();
    }catch(x:any){
      setE(x?.message||'Anmeldung fehlgeschlagen');
    }finally{
      setBusy(false);
    }
  }

  return <main className="login">
    <div className="loginMotion" aria-hidden="true">
      <i className="loginAurora auroraOne"/><i className="loginAurora auroraTwo"/>
      <span className="loginOrbit orbitOne"><i/></span><span className="loginOrbit orbitTwo"><i/></span>
      <span className="dataRoute routeOne"><i/></span><span className="dataRoute routeTwo"><i/></span>
      <span className="signalDot dotOne"/><span className="signalDot dotTwo"/><span className="signalDot dotThree"/>
    </div>

    <div className="loginStage">
    <section className="loginHero" aria-label="FilePilot">
      <div className="loginHeroBadge"><Sparkles/> PRIVATE FILE OPERATIONS</div>
      <div className="loginHeroMark" aria-hidden="true"><span/><img src="/branding/logos/filepilot-mark.svg" alt=""/></div>
      <div className="loginHeroCopy"><span>DEIN DATEISYSTEM. DEIN KURS.</span><h2>Bereit zum<br/><em>Abheben?</em></h2><p>Verwalte Unraid, Docker und lokale Laufwerke in einer schnellen, privaten Kommandozentrale.</p></div>
      <div className="loginHeroFacts"><span><b>01</b> Lokal & privat</span><span><b>02</b> Mehrere Bereiche</span><span><b>03</b> Volle Kontrolle</span></div>
    </section>

    <div className="loginBridge" aria-hidden="true"><span/><i/><b/></div>

    <form onSubmit={submit}>
      <h1 className="srOnly">Bei FilePilot anmelden</h1>
      <div className="loginPanelTop"><span><i/> SYSTEM BEREIT</span><span><ShieldCheck/> GESCHÜTZT</span></div>
      <div className="loginBrand"><BrandLogo title="FilePilot Logo"/></div>
      <div className="loginWelcome"><strong>Willkommen zurück</strong><p>Melde dich an und setze deinen Kurs fort.</p></div>
      <label htmlFor="login-password"><Lock size={16}/> Passwort</label>
      <div className="loginPasswordField"><input id="login-password" autoFocus type={showPassword?'text':'password'} autoComplete="current-password" value={p} onChange={event=>setP(event.target.value)} placeholder="Passwort eingeben" aria-invalid={Boolean(e)} aria-describedby={e?'login-error':undefined}/><button type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'Passwort ausblenden':'Passwort anzeigen'} title={showPassword?'Passwort ausblenden':'Passwort anzeigen'}>{showPassword?<EyeOff/>:<Eye/>}</button></div>
      <button className="loginSubmit" disabled={busy}>{busy?<><LoaderCircle className="spin"/>Verbindung wird hergestellt…</>:<>Dateimanager öffnen<ArrowRight/></>}</button>
      {e&&<div id="login-error" className="error" role="alert">{e}</div>}
      <div className="loginTrust"><ShieldCheck/><span><strong>Sichere lokale Anmeldung</strong><small>Deine Zugangsdaten verlassen dieses System nicht.</small></span></div>
      <small className="loginFooter">FILEPILOT · PRIVATE FILE OPERATIONS</small>
    </form>
    </div>
  </main>
}
