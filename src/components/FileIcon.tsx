import {
  Archive,
  Database,
  Disc3,
  File,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileKey2,
  FileLock2,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderArchive,
  FolderCog,
  HardDrive,
  Server,
  type LucideIcon
} from 'lucide-react';
import type {FileItem} from '../lib/api';

const image = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','ico','tif','tiff','heic','avif']);
const video = new Set(['mp4','mkv','avi','mov','webm','m4v','wmv','flv','mpeg','mpg']);
const audio = new Set(['mp3','wav','flac','ogg','m4a','aac','wma','opus']);
const archive = new Set(['zip','rar','7z','tar','gz','bz2','xz','tgz','iso']);
const code = new Set(['js','jsx','ts','tsx','html','css','scss','sass','less','php','py','go','rs','java','kt','c','cpp','h','hpp','sh','ps1','bat','cmd','vue','svelte']);
const text = new Set(['txt','md','log','rtf','pdf','doc','docx','odt','ini','conf','cfg','yaml','yml','toml']);
const sheets = new Set(['xls','xlsx','ods','csv']);
const data = new Set(['db','sqlite','sqlite3','mdb','sql']);
const config = new Set(['env','npmrc','gitignore','dockerfile']);
const key = new Set(['pem','key','crt','cer','pfx','p12','pub']);

export function fileEmoji(item:FileItem){
  if(item.locationRoot)return item.locationKind==='unraid'?'🗄️':'💾';
  const raw=item.name.toLowerCase();
  if(item.type==='directory'){
    if(raw.includes('bild')||raw.includes('photo')||raw.includes('image'))return '🖼️';
    if(raw.includes('video')||raw.includes('film')||raw.includes('movie'))return '🎬';
    if(raw.includes('musik')||raw.includes('music')||raw.includes('audio'))return '🎵';
    if(raw.includes('download'))return '📥';
    if(raw.includes('backup')||raw.includes('archiv'))return '🛟';
    if(raw.includes('docker'))return '🐳';
    if(raw==='appdata'||raw.includes('config'))return '⚙️';
    if(raw.includes('dokument')||raw.includes('document'))return '📝';
    return '📁';
  }
  if(item.type==='symlink')return '🔗';
  const ext=raw.includes('.')?raw.split('.').pop()||'':raw;
  if(image.has(ext))return '🖼️';
  if(video.has(ext))return '🎬';
  if(audio.has(ext))return '🎵';
  if(archive.has(ext))return ext==='iso'?'💿':'📦';
  if(code.has(ext)||ext==='json')return '💻';
  if(sheets.has(ext))return '📊';
  if(data.has(ext))return '🗃️';
  if(key.has(ext))return '🔐';
  if(config.has(ext)||raw==='dockerfile')return '⚙️';
  if(ext==='pdf')return '📕';
  if(['doc','docx','odt','rtf'].includes(ext))return '📝';
  if(text.has(ext))return '📄';
  return '📎';
}

export function FileEmoji({item,className=''}:{item:FileItem;className?:string}){
  return <span className={`fileEmoji ${className}`} aria-hidden="true">{fileEmoji(item)}</span>;
}

export function FileIcon({item,size=19}:{item:FileItem;size?:number}){
  const icon=(Icon:LucideIcon,tone:string)=><span className={`fileTypeIcon ${tone}`}><Icon size={size}/></span>;
  if(item.locationRoot){
    if(item.locationKind==='unraid')return icon(Server,'type-server');
    return icon(HardDrive,'type-drive');
  }
  if(item.type==='directory'){
    const lower=item.name.toLowerCase();
    if(lower.includes('backup')||lower.includes('archiv'))return icon(FolderArchive,'type-archive');
    if(lower==='appdata'||lower.includes('config'))return icon(FolderCog,'type-config');
    return icon(Folder,'type-folder');
  }
  if(item.type==='symlink')return icon(FileLock2,'type-link');
  const raw=item.name.toLowerCase();
  const ext=raw.includes('.')?raw.split('.').pop()||'':raw;
  if(image.has(ext))return icon(FileImage,'type-image');
  if(video.has(ext))return icon(FileVideo,'type-video');
  if(audio.has(ext))return icon(FileMusic,'type-audio');
  if(archive.has(ext))return icon(ext==='iso'?Disc3:Archive,'type-archive');
  if(code.has(ext))return icon(FileCode2,'type-code');
  if(ext==='json')return icon(FileJson,'type-json');
  if(sheets.has(ext))return icon(FileSpreadsheet,'type-sheet');
  if(data.has(ext))return icon(Database,'type-data');
  if(key.has(ext))return icon(FileKey2,'type-key');
  if(config.has(ext)||raw==='dockerfile')return icon(FileCog,'type-config');
  if(text.has(ext))return icon(FileText,'type-text');
  return icon(File,'type-file');
}
