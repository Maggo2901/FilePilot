type BrandMarkProps={className?:string;title?:string};

export function BrandMark({className='',title}:BrandMarkProps){
  return <img className={className} src="/branding/logos/filepilot-mark.svg" alt={title||''} aria-hidden={title?undefined:true} draggable={false}/>;
}

export function BrandLogo({className='',title='FilePilot – Dateimanager'}:{className?:string;title?:string}){
  return <img className={className} src="/branding/logos/filepilot-logo-dark.svg" alt={title} draggable={false}/>;
}

export function BrandLockup({compact=false}:{compact?:boolean}){
  return <div className={`brandLockup ${compact?'compactBrand':''}`}><BrandMark/><span><strong>FilePilot</strong></span></div>;
}
