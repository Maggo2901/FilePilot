import express, { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import multer from 'multer';
import { createRequire } from 'node:module';
import mime from 'mime-types';

const require = createRequire(import.meta.url);
const archiver: any = require('archiver');
const ffprobePath = require('@derhuerst/ffprobe-static') as string | null;

type ProbeStream = Record<string, any>;
type ProbeResult = { format?: Record<string, any>; streams?: ProbeStream[] };

function cleanTags(value:unknown){
  if(!value||typeof value!=='object')return {};
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).slice(0,40).map(([key,item])=>[key,String(item).slice(0,500)]));
}

function parseRate(value:unknown){
  if(typeof value!=='string'||!value||value==='0/0')return undefined;
  const[numerator,denominator]=value.split('/').map(Number);
  if(!Number.isFinite(numerator)||!Number.isFinite(denominator)||!denominator)return undefined;
  return Math.round(numerator/denominator*1000)/1000;
}

async function probeMedia(filePath:string):Promise<any|null>{
  if(!ffprobePath||!fssync.existsSync(ffprobePath))return null;
  return new Promise(resolve=>{
    const child=spawn(ffprobePath,['-v','error','-show_format','-show_streams','-print_format','json',filePath],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='';
    let settled=false;
    const finish=(value:any)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value)};
    const timer=setTimeout(()=>{child.kill();finish(null)},12000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{if(stdout.length<2_000_000)stdout+=chunk;else{child.kill();finish(null)}});
    child.on('error',()=>finish(null));
    child.on('close',code=>{
      if(code!==0||!stdout)return finish(null);
      try{
        const data=JSON.parse(stdout) as ProbeResult;
        const format=data.format||{};
        finish({
          formatName:format.format_name,
          formatLongName:format.format_long_name,
          duration:Number.isFinite(Number(format.duration))?Number(format.duration):undefined,
          bitRate:Number.isFinite(Number(format.bit_rate))?Number(format.bit_rate):undefined,
          probeScore:Number.isFinite(Number(format.probe_score))?Number(format.probe_score):undefined,
          tags:cleanTags(format.tags),
          streams:(data.streams||[]).slice(0,32).map(stream=>({
            index:stream.index,
            type:stream.codec_type,
            codec:stream.codec_name,
            codecLongName:stream.codec_long_name,
            profile:stream.profile,
            width:stream.width,
            height:stream.height,
            pixelFormat:stream.pix_fmt,
            frameRate:parseRate(stream.avg_frame_rate)||parseRate(stream.r_frame_rate),
            bitRate:Number.isFinite(Number(stream.bit_rate))?Number(stream.bit_rate):undefined,
            channels:stream.channels,
            channelLayout:stream.channel_layout,
            sampleRate:Number.isFinite(Number(stream.sample_rate))?Number(stream.sample_rate):undefined,
            bitsPerSample:stream.bits_per_sample||stream.bits_per_raw_sample,
            sampleAspectRatio:stream.sample_aspect_ratio,
            displayAspectRatio:stream.display_aspect_ratio,
            colorSpace:stream.color_space,
            colorRange:stream.color_range,
            fieldOrder:stream.field_order,
            language:stream.tags?.language,
            title:stream.tags?.title||stream.tags?.handler_name,
            default:Boolean(stream.disposition?.default),
            forced:Boolean(stream.disposition?.forced),
            tags:cleanTags(stream.tags)
          }))
        });
      }catch{finish(null)}
    });
  });
}

function loadLocalEnv() {
  const envFile = path.join(process.cwd(), '.env');
  if (!fssync.existsSync(envFile)) return;
  for (const rawLine of fssync.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 8080);
const IS_WINDOWS = process.platform === 'win32';
const IS_DOCKER = fssync.existsSync('/.dockerenv') || process.env.FILEPILOT_DOCKER === 'true';
const DEFAULT_APP_DATA = IS_DOCKER ? '/config' : path.join(process.cwd(), '.filepilot');
const APP_DATA = path.resolve(process.env.APP_DATA || DEFAULT_APP_DATA);
const ENV_PASSWORD = process.env.APP_PASSWORD || 'admin';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
if (IS_PRODUCTION) {
  const configuredPassword = process.env.APP_PASSWORD?.trim() || '';
  const configuredSecret = process.env.TOKEN_SECRET?.trim() || '';
  if (configuredPassword.length < 12 || /^(admin|password|change-this-password)$/i.test(configuredPassword)) {
    throw new Error('APP_PASSWORD muss in Produktion mindestens 12 Zeichen lang und individuell gesetzt sein.');
  }
  if (configuredSecret.length < 32 || /replace-this|development-secret|bitte-einen/i.test(configuredSecret)) {
    throw new Error('TOKEN_SECRET muss in Produktion explizit mit mindestens 32 zufälligen Zeichen gesetzt sein.');
  }
}
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 10240) * 1024 * 1024;
const ENV_TRASH_ENABLED = process.env.TRASH_ENABLED !== 'false';
const ENV_FILE_ROOT = process.env.FILE_ROOT ? path.resolve(process.env.FILE_ROOT) : '';
const SETTINGS_FILE = path.join(APP_DATA, 'settings.json');
const AUTH_FILE = path.join(APP_DATA, 'auth.json');
const UPLOAD_DIR = path.join(APP_DATA, 'uploads');
const TRASH_DIR = path.join(APP_DATA, 'trash');
const TOKEN_SECRET_FILE = path.join(APP_DATA, '.token-secret');
const HISTORY_FILE = path.join(APP_DATA, 'history.jsonl');

fssync.mkdirSync(APP_DATA, { recursive: true });
fssync.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadTokenSecret() {
  const configured = process.env.TOKEN_SECRET?.trim() || '';
  const placeholder = !configured || configured === 'filepilot-development-secret' || /replace-with|bitte-einen/i.test(configured);
  if (!placeholder && configured.length >= 32) return configured;
  try {
    const stored = fssync.readFileSync(TOKEN_SECRET_FILE, 'utf8').trim();
    if (stored.length >= 32) return stored;
  } catch { /* create a persistent local secret below */ }
  const generated = crypto.randomBytes(48).toString('base64url');
  fssync.writeFileSync(TOKEN_SECRET_FILE, generated, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

const SECRET = loadTokenSecret();

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '2mb' }));

type LocationKind = 'drive' | 'unraid' | 'folder' | 'volume';
type LocationSource = 'auto' | 'manual';

type ManualLocation = {
  id: string;
  name: string;
  rootPath: string;
  readOnly: boolean;
  enabled: boolean;
};

type StoredSettings = {
  favorites: string[];
  showHidden: boolean;
  hideExtensions: boolean;
  foldersFirst: boolean;
  compactRows: boolean;
  confirmDelete: boolean;
  trashEnabled: boolean;
  viewMode: 'list' | 'grid';
  accent: 'blue' | 'green' | 'purple' | 'orange';
  paneCount: 1 | 2 | 3 | 4;
  rememberWorkspace: boolean;
  defaultLeftLocationId: string;
  defaultRightLocationId: string;
  disabledAutoLocationIds: string[];
  manualLocations: ManualLocation[];
};

type Location = ManualLocation & {
  source: LocationSource;
  kind: LocationKind;
  available: boolean;
  virtualPath: string;
  totalBytes?: number;
  freeBytes?: number;
};

type AuthState = { salt: string; hash: string; version: number };
type HistoryEntry = { id:string; at:string; action:string; status:'success'|'error'; title:string; detail?:string; count?:number; paths?:string[]; error?:string; sourcePaths?:string[]; resultPaths?:string[]; destination?:string; bytes?:number; durationMs?:number; requestedAction?:string };
type TrashMetadata = { deletedAt:string; originalPath:string; originalParent:string; originalName:string; locationId:string };
type TrashResolved = { id:string; locationId:string; dataName:string; fullPath:string; metadataPath:string; metadata?:TrashMetadata };

const DEFAULT_SETTINGS: StoredSettings = {
  favorites: ['/'],
  showHidden: false,
  hideExtensions: false,
  foldersFirst: true,
  compactRows: false,
  confirmDelete: true,
  trashEnabled: ENV_TRASH_ENABLED,
  viewMode: 'list',
  accent: 'blue',
  paneCount: 2,
  rememberWorkspace: true,
  defaultLeftLocationId: '',
  defaultRightLocationId: '',
  disabledAutoLocationIds: [],
  manualLocations: []
};

let settingsCache: StoredSettings | null = null;
let authState: AuthState | null = null;
let locationCache: { at: number; locations: Location[] } | null = null;
let historyWrite:Promise<void>=Promise.resolve();

function recordHistory(entry:Omit<HistoryEntry,'id'|'at'>){
  const record:HistoryEntry={id:crypto.randomUUID(),at:new Date().toISOString(),...entry,paths:entry.paths?.slice(0,20),sourcePaths:entry.sourcePaths?.slice(0,20),resultPaths:entry.resultPaths?.slice(0,20)};
  historyWrite=historyWrite.catch(()=>undefined).then(async()=>{
    await fs.mkdir(APP_DATA,{recursive:true});
    await fs.appendFile(HISTORY_FILE,`${JSON.stringify(record)}\n`,'utf8');
    const stats=await fs.stat(HISTORY_FILE);
    if(stats.size>2_000_000){
      const lines=(await fs.readFile(HISTORY_FILE,'utf8')).trim().split('\n').slice(-500);
      await fs.writeFile(HISTORY_FILE,`${lines.join('\n')}\n`,'utf8');
    }
  }).catch(error=>console.error('Verlauf konnte nicht gespeichert werden',error));
  return historyWrite;
}

async function readHistory(){
  try{
    const lines=(await fs.readFile(HISTORY_FILE,'utf8')).trim().split('\n').filter(Boolean).slice(-300).reverse();
    return lines.flatMap(line=>{try{return[JSON.parse(line) as HistoryEntry]}catch{return[]}});
  }catch(error:any){
    if(error?.code==='ENOENT')return[];
    throw error;
  }
}

function encodedTrashId(locationId:string,dataName:string){
  return Buffer.from(JSON.stringify([locationId,dataName])).toString('base64url');
}

async function resolveTrashId(id:unknown):Promise<TrashResolved>{
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.from(String(id||''),'base64url').toString('utf8'))}catch{throw new Error('Ungültiger Papierkorb-Eintrag')}
  if(!Array.isArray(parsed)||parsed.length!==2)throw new Error('Ungültiger Papierkorb-Eintrag');
  const[locationId,dataName]=parsed.map(String);
  if(!/^[a-zA-Z0-9_-]{3,80}$/.test(locationId)||!dataName||path.basename(dataName)!==dataName||dataName.endsWith('.trashinfo.json'))throw new Error('Ungültiger Papierkorb-Eintrag');
  const fullPath=path.join(TRASH_DIR,locationId,dataName);
  const metadataPath=`${fullPath}.trashinfo.json`;
  let metadata:TrashMetadata|undefined;
  try{metadata=JSON.parse(await fs.readFile(metadataPath,'utf8')) as TrashMetadata}catch{/* legacy entry */}
  return{id:String(id),locationId,dataName,fullPath,metadataPath,metadata};
}

async function listTrash(){
  await fs.mkdir(TRASH_DIR,{recursive:true});
  const locations=await getLocations(true);
  const output:Array<Record<string,unknown>>=[];
  for(const locationEntry of await fs.readdir(TRASH_DIR,{withFileTypes:true})){
    if(!locationEntry.isDirectory()||!/^[a-zA-Z0-9_-]{3,80}$/.test(locationEntry.name))continue;
    const directory=path.join(TRASH_DIR,locationEntry.name);
    const location=locations.find(item=>item.id===locationEntry.name);
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      if(entry.name.endsWith('.trashinfo.json'))continue;
      const fullPath=path.join(directory,entry.name);
      const stat=await fs.lstat(fullPath).catch(()=>null);
      if(!stat)continue;
      const resolved=await resolveTrashId(encodedTrashId(locationEntry.name,entry.name));
      const legacyName=entry.name.includes('__')?entry.name.slice(entry.name.lastIndexOf('__')+2):entry.name;
      output.push({id:resolved.id,name:resolved.metadata?.originalName||legacyName,type:stat.isDirectory()?'directory':stat.isSymbolicLink()?'symlink':'file',size:stat.size,deletedAt:resolved.metadata?.deletedAt||stat.mtime.toISOString(),originalPath:resolved.metadata?.originalPath,location:location?.name||locationEntry.name,restorable:Boolean(location?.enabled&&location.available&&!location.readOnly)});
    }
  }
  return output.sort((a,b)=>String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

function b64(input: string) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function createToken() {
  const payload = b64(JSON.stringify({ exp: Date.now() + 7 * 86400000, v: authState?.version || 0 }));
  return `${payload}.${sign(payload)}`;
}

function validToken(token = '') {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return parsed.exp > Date.now() && Number(parsed.v || 0) === Number(authState?.version || 0);
  } catch {
    return false;
  }
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')): AuthState {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash, version: (authState?.version || 0) + 1 };
}

function verifyPassword(password: string) {
  if (!authState) {
    const supplied = Buffer.from(password);
    const expected = Buffer.from(ENV_PASSWORD);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
  const supplied = Buffer.from(crypto.scryptSync(password, authState.salt, 64).toString('hex'));
  const expected = Buffer.from(authState.hash);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function loadAuth() {
  try {
    const parsed = JSON.parse(await fs.readFile(AUTH_FILE, 'utf8')) as Partial<AuthState>;
    if (typeof parsed.salt !== 'string' || typeof parsed.hash !== 'string' || !Number.isInteger(parsed.version)) {
      throw new Error('Ungültige Authentifizierungsdatei');
    }
    authState = parsed as AuthState;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    authState = null;
  }
}

async function writePrivateJson(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function auth(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/auth/login' || req.path === '/health') return next();
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const cookie = req.header('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('filepilot_token='));
  const token = bearer || (cookie ? decodeURIComponent(cookie.slice('filepilot_token='.length)) : '');
  if (!validToken(token)) return res.status(401).json({ error: 'Nicht angemeldet' });
  if (bearer && !cookie) {
    res.cookie('filepilot_token', bearer, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 7 * 86400000, path: '/' });
  }
  next();
}

async function exists(target: string) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${crypto.createHash('sha1').update(value.toLowerCase()).digest('hex').slice(0, 10)}`;
}

function cleanName(value: unknown, fallback: string) {
  const name = String(value || '').trim().replace(/[\r\n\t]/g, ' ');
  return name.slice(0, 80) || fallback;
}

function validateFileName(value: unknown) {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) throw new Error('Ungültiger Datei- oder Ordnername');
  return name;
}

function normalizeStoredSettings(input: Partial<StoredSettings> = {}): StoredSettings {
  const manualLocations = Array.isArray(input.manualLocations)
    ? input.manualLocations.slice(0, 50).map((entry, index) => ({
        id: /^[a-zA-Z0-9_-]{3,80}$/.test(String(entry?.id || '')) ? String(entry.id) : `manual-${crypto.randomUUID()}`,
        name: cleanName(entry?.name, `Speicherort ${index + 1}`),
        rootPath: String(entry?.rootPath || '').trim(),
        readOnly: Boolean(entry?.readOnly),
        enabled: entry?.enabled !== false
      }))
    : [];
  const favorites = Array.isArray(input.favorites) ? input.favorites.filter(x => typeof x === 'string').slice(0, 40) : ['/'];
  const startChoice = (value: unknown) => {
    const choice = String(value || '');
    return choice.startsWith('favorite:') && !favorites.includes(choice.slice('favorite:'.length)) ? '' : choice;
  };

  return {
    favorites,
    showHidden: Boolean(input.showHidden),
    hideExtensions: Boolean(input.hideExtensions),
    foldersFirst: input.foldersFirst !== false,
    compactRows: Boolean(input.compactRows),
    confirmDelete: input.confirmDelete !== false,
    trashEnabled: input.trashEnabled !== false,
    viewMode: input.viewMode === 'grid' ? 'grid' : 'list',
    accent: ['blue', 'green', 'purple', 'orange'].includes(String(input.accent)) ? input.accent as StoredSettings['accent'] : 'blue',
    paneCount: [1, 2, 3, 4].includes(Number(input.paneCount)) ? Number(input.paneCount) as StoredSettings['paneCount'] : 2,
    rememberWorkspace: input.rememberWorkspace !== false,
    defaultLeftLocationId: startChoice(input.defaultLeftLocationId),
    defaultRightLocationId: startChoice(input.defaultRightLocationId),
    disabledAutoLocationIds: Array.isArray(input.disabledAutoLocationIds) ? input.disabledAutoLocationIds.map(String).slice(0, 100) : [],
    manualLocations
  };
}

async function getSettings() {
  if (settingsCache) return settingsCache;
  try {
    settingsCache = normalizeStoredSettings(JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8')));
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS, favorites: [...DEFAULT_SETTINGS.favorites], manualLocations: [], disabledAutoLocationIds: [] };
  }
  return settingsCache;
}

async function saveSettings(settings: StoredSettings) {
  settingsCache = normalizeStoredSettings(settings);
  await fs.mkdir(APP_DATA, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settingsCache, null, 2));
  locationCache = null;
  return settingsCache;
}

async function locationStats(rootPath: string) {
  try {
    const stat = await fs.statfs(rootPath);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(freeBytes) || totalBytes <= 0 || freeBytes < 0) return {};
    return { totalBytes, freeBytes };
  } catch {
    return {};
  }
}

async function createAutoLocation(rootPath: string, name: string, kind: LocationKind): Promise<Location | null> {
  try {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) return null;
    const id = stableId('auto', path.resolve(rootPath));
    return {
      id,
      name,
      rootPath: path.resolve(rootPath),
      readOnly: false,
      enabled: true,
      source: 'auto',
      kind,
      available: true,
      virtualPath: `/@/${id}`,
      ...(await locationStats(rootPath))
    };
  } catch {
    return null;
  }
}

async function discoverAutoLocations() {
  const locations: Location[] = [];
  const seen = new Set<string>();
  const add = async (rootPath: string, name: string, kind: LocationKind) => {
    const normalized = path.resolve(rootPath);
    const key = IS_WINDOWS ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return;
    const location = await createAutoLocation(normalized, name, kind);
    if (location) {
      seen.add(key);
      locations.push(location);
    }
  };

  if (IS_WINDOWS) {
    await Promise.all(Array.from({ length: 24 }, (_, index) => String.fromCharCode(67 + index)).map(async letter => {
      const rootPath = `${letter}:\\`;
      if (await exists(rootPath)) await add(rootPath, `Laufwerk ${letter}:`, 'drive');
    }));
    locations.sort((a, b) => a.rootPath.localeCompare(b.rootPath));
  } else {
    if (ENV_FILE_ROOT && await exists(ENV_FILE_ROOT)) {
      const unraidLike = ENV_FILE_ROOT === '/data' || ENV_FILE_ROOT === '/mnt/user';
      await add(ENV_FILE_ROOT, unraidLike ? 'Unraid – alle Shares' : `Daten – ${path.basename(ENV_FILE_ROOT) || ENV_FILE_ROOT}`, unraidLike ? 'unraid' : 'folder');
    }
    if (await exists('/mnt/user')) await add('/mnt/user', 'Unraid – alle Shares', 'unraid');
    if (await exists('/data')) await add('/data', 'Unraid – alle Shares', 'unraid');

    if (process.platform === 'darwin' && await exists('/Volumes')) {
      for (const entry of await fs.readdir('/Volumes', { withFileTypes: true })) {
        if (entry.isDirectory()) await add(path.join('/Volumes', entry.name), entry.name, 'volume');
      }
    }

    if (!locations.length) await add(os.homedir(), 'Persönlicher Ordner', 'folder');
  }

  return locations;
}

async function getLocations(includeDisabled = true) {
  if (locationCache && Date.now() - locationCache.at < 10000) {
    return includeDisabled ? locationCache.locations : locationCache.locations.filter(x => x.enabled && x.available);
  }

  const settings = await getSettings();
  const auto = await discoverAutoLocations();
  const autoIds = new Set(auto.map(x => x.id));
  const disabled = new Set(settings.disabledAutoLocationIds);
  const locations: Location[] = auto.map(location => ({ ...location, enabled: !disabled.has(location.id) }));

  for (const manual of settings.manualLocations) {
    if (autoIds.has(manual.id)) continue;
    const absolute = path.resolve(manual.rootPath || '.');
    const available = Boolean(manual.rootPath) && await exists(absolute);
    locations.push({
      ...manual,
      rootPath: absolute,
      source: 'manual',
      kind: 'folder',
      available,
      virtualPath: `/@/${manual.id}`,
      ...(available ? await locationStats(absolute) : {})
    });
  }

  locationCache = { at: Date.now(), locations };
  return includeDisabled ? locations : locations.filter(x => x.enabled && x.available);
}

type ResolvedPath = { location: Location; fullPath: string; virtualPath: string; isLocationRoot: boolean };

async function resolveVirtual(virtualPath: string): Promise<ResolvedPath> {
  const clean = String(virtualPath || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const match = clean.match(/^\/@\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/);
  if (!match) throw new Error('Ungültiger Speicherpfad');

  const locations = await getLocations(true);
  const location = locations.find(x => x.id === match[1]);
  if (!location || !location.enabled || !location.available) throw new Error('Dieser Speicherort ist nicht verfügbar oder deaktiviert');

  const segments = (match[2] || '').split('/').filter(Boolean);
  const fullPath = path.resolve(location.rootPath, ...segments);
  const relative = path.relative(location.rootPath, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Ungültiger Pfad');

  // Prevent an intermediate directory symlink from escaping the configured
  // location even though the visible path passed the lexical check above.
  const [realRoot, realTarget] = await Promise.all([fs.realpath(location.rootPath), fs.realpath(fullPath)]);
  const realRelative = path.relative(realRoot, realTarget);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error('Der Pfad verlässt den freigegebenen Speicherort');
  }

  return {
    location,
    fullPath,
    virtualPath: virtualFromFull(location, fullPath),
    isLocationRoot: !relative
  };
}

function virtualFromFull(location: Location, fullPath: string) {
  const relative = path.relative(location.rootPath, fullPath).split(path.sep).filter(Boolean).join('/');
  return relative ? `${location.virtualPath}/${relative}` : location.virtualPath;
}

function assertWritable(resolved: ResolvedPath) {
  if (resolved.location.readOnly) throw new Error(`„${resolved.location.name}“ ist schreibgeschützt`);
}

function assertNotLocationRoot(resolved: ResolvedPath) {
  if (resolved.isLocationRoot) throw new Error('Der komplette Speicherort kann nicht verändert werden');
}

async function uniquePath(target: string) {
  if (!(await exists(target))) return target;
  const extension = path.extname(target);
  const base = extension ? target.slice(0, -extension.length) : target;
  let index = 1;
  while (await exists(`${base} (${index})${extension}`)) index += 1;
  return `${base} (${index})${extension}`;
}

async function copyRecursive(source: string, destination: string) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error('Symbolische Links werden aus Sicherheitsgründen nicht kopiert');
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const name of await fs.readdir(source)) {
      await copyRecursive(path.join(source, name), path.join(destination, name));
    }
  } else {
    await fs.copyFile(source, destination);
  }
}

async function moveAcrossDevices(source: string, destination: string) {
  try {
    await fs.rename(source, destination);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    await copyRecursive(source, destination);
    await fs.rm(source, { recursive: true, force: true });
  }
}

type TransferStats = { bytes: number; files: number };

async function transferStats(target:string):Promise<TransferStats>{
  const stat=await fs.lstat(target);
  if(stat.isSymbolicLink())throw new Error('Symbolische Links werden aus Sicherheitsgründen nicht übertragen');
  if(!stat.isDirectory())return{bytes:stat.size,files:1};
  let bytes=0;
  let files=0;
  for(const name of await fs.readdir(target)){
    const child=await transferStats(path.join(target,name));
    bytes+=child.bytes;
    files+=child.files;
  }
  return{bytes,files};
}

async function copyFileProgress(source:string,destination:string,onBytes:(amount:number)=>void,onFile:()=>void){
  let input:Awaited<ReturnType<typeof fs.open>>|undefined;
  let output:Awaited<ReturnType<typeof fs.open>>|undefined;
  let destinationCreated=false;
  try{
    try{input=await fs.open(source,'r')}catch(error){throw transferOperationError(error,'Quelle öffnen',source)}
    try{output=await fs.open(destination,'wx');destinationCreated=true}catch(error){throw transferOperationError(error,'Ziel anlegen',destination)}
    const buffer=Buffer.allocUnsafe(1024*1024);
    let position=0;
    while(true){
      let bytesRead=0;
      try{({bytesRead}=await input.read(buffer,0,buffer.length,position))}catch(error){throw transferOperationError(error,'Quelle lesen',source)}
      if(!bytesRead)break;
      let written=0;
      while(written<bytesRead){
        try{
          const result=await output.write(buffer,written,bytesRead-written,position+written);
          if(result.bytesWritten<=0)throw new Error('Das Laufwerk hat keine Daten angenommen');
          written+=result.bytesWritten;
        }catch(error){throw transferOperationError(error,'Ziel schreiben',destination)}
      }
      position+=bytesRead;
      onBytes(bytesRead);
    }
    try{await output.sync()}catch(error){throw transferOperationError(error,'Ziel synchronisieren',destination)}
    await output.close();
    output=undefined;
    await input.close();
    input=undefined;
    onFile();
  }catch(error){
    await output?.close().catch(()=>undefined);
    await input?.close().catch(()=>undefined);
    if(destinationCreated)await fs.rm(destination,{force:true}).catch(()=>undefined);
    throw error;
  }
}

function transferOperationError(error:any,operation:string,filePath:string){
  const wrapped:any=new Error(error?.message||`${operation} fehlgeschlagen`);
  wrapped.code=error?.code;
  wrapped.errno=error?.errno;
  wrapped.syscall=error?.syscall;
  wrapped.path=error?.path||filePath;
  wrapped.filePilotOperation=operation;
  return wrapped;
}

function transferFileError(error:any,destination:string){
  if(!error?.filePilotOperation)return error;
  const operation=String(error.filePilotOperation);
  const technical=[error?.code,error?.syscall].filter(Boolean).join(' / ');
  const target=String(error?.path||destination);
  let guidance='Bitte prüfe, ob die Datei noch von einem anderen Programm verwendet wird.';
  if(operation.startsWith('Ziel'))guidance='Bitte prüfe freien Speicherplatz, Dateisystemgrenzen und ob bereits eine gleichnamige Datei geöffnet ist.';
  if(operation.startsWith('Quelle'))guidance='Bitte prüfe, ob die Quelldatei geöffnet, verschoben oder nicht mehr erreichbar ist.';
  const wrapped:any=new Error(`${operation} fehlgeschlagen: „${target}“.${technical?` Technisch: ${technical}.`:''} ${guidance}`);
  wrapped.code=error.code;
  return wrapped;
}

async function copyRecursiveProgress(source:string,destination:string,onBytes:(amount:number)=>void,onFile:()=>void){
  const stat=await fs.lstat(source);
  if(stat.isSymbolicLink())throw new Error('Symbolische Links werden aus Sicherheitsgründen nicht kopiert');
  if(stat.isDirectory()){
    await fs.mkdir(destination,{recursive:true});
    for(const name of await fs.readdir(source))await copyRecursiveProgress(path.join(source,name),path.join(destination,name),onBytes,onFile);
    return;
  }
  await copyFileProgress(source,destination,onBytes,onFile);
}

async function moveProgress(source:string,destination:string,stats:TransferStats,onBytes:(amount:number)=>void,onFile:()=>void){
  try{
    await fs.rename(source,destination);
    onBytes(stats.bytes);
    for(let index=0;index<stats.files;index+=1)onFile();
  }catch(error:any){
    if(error?.code!=='EXDEV')throw error;
    await copyRecursiveProgress(source,destination,onBytes,onFile);
    await fs.rm(source,{recursive:true,force:true});
  }
}

async function removeRecursiveProgress(target:string,onBytes:(amount:number)=>void,onItem:()=>void):Promise<void>{
  let stat;
  try{stat=await fs.lstat(target)}catch(error:any){if(error?.code==='ENOENT')return;throw error}
  if(stat.isDirectory()&&!stat.isSymbolicLink()){
    for(const name of await fs.readdir(target))await removeRecursiveProgress(path.join(target,name),onBytes,onItem);
    try{await fs.rmdir(target)}catch(error:any){if(error?.code!=='ENOENT')throw error}
    onItem();
    return;
  }
  try{await fs.unlink(target)}catch(error:any){if(error?.code!=='ENOENT')throw error}
  onBytes(stat.size);
  onItem();
}

async function deleteStats(target:string):Promise<{bytes:number;items:number}>{
  const stat=await fs.lstat(target);
  if(!stat.isDirectory()||stat.isSymbolicLink())return{bytes:stat.size,items:1};
  let bytes=0;
  let items=1;
  for(const name of await fs.readdir(target)){
    const child=await deleteStats(path.join(target,name));
    bytes+=child.bytes;
    items+=child.items;
  }
  return{bytes,items};
}

async function dirSize(target: string): Promise<number> {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const name of await fs.readdir(target)) total += await dirSize(path.join(target, name));
  return total;
}

function publicLocation(location: Location) {
  return {
    id: location.id,
    name: location.name,
    rootPath: location.rootPath,
    readOnly: location.readOnly,
    enabled: location.enabled,
    source: location.source,
    kind: location.kind,
    available: location.available,
    virtualPath: location.virtualPath,
    totalBytes: location.totalBytes,
    freeBytes: location.freeBytes
  };
}

async function bootstrapPayload() {
  const settings = await getSettings();
  const locations = await getLocations(true);
  const active = locations.filter(x => x.enabled && x.available);
  const byId = (id: string) => active.find(x => x.id === id)?.virtualPath;
  const startPath = async (choice: string) => {
    if (!choice.startsWith('favorite:')) return byId(choice);
    const favorite = choice.slice('favorite:'.length);
    if (!settings.favorites.includes(favorite)) return undefined;
    if (favorite === '/') return favorite;
    try {
      const resolved = await resolveVirtual(favorite);
      return (await fs.stat(resolved.fullPath)).isDirectory() ? resolved.virtualPath : undefined;
    } catch {
      return undefined;
    }
  };
  const left = await startPath(settings.defaultLeftLocationId) || active[0]?.virtualPath || '/';
  const right = await startPath(settings.defaultRightLocationId) || active[1]?.virtualPath || left;
  return {
    platform: process.platform,
    isDocker: IS_DOCKER,
    appDataPath: APP_DATA,
    settings,
    locations: locations.map(publicLocation),
    startPaths: { left, right },
    version: '1.1.0'
  };
}

app.use('/api', auth);

app.get('/api/history',async(_req,res,next)=>{
  try{res.json({items:await readHistory()})}catch(error){next(error)}
});

app.delete('/api/history',async(_req,res,next)=>{
  try{
    await historyWrite;
    await fs.writeFile(HISTORY_FILE,'','utf8');
    res.json({ok:true});
  }catch(error){next(error)}
});

app.get('/api/trash',async(_req,res,next)=>{
  try{res.json({items:await listTrash()})}catch(error){next(error)}
});

app.post('/api/trash/restore',async(req,res,next)=>{
  try{
    const ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[];
    if(!ids.length)throw new Error('Keine Papierkorb-Einträge ausgewählt');
    const restored:string[]=[];
    const originals:string[]=[];
    for(const id of ids){
      const item=await resolveTrashId(id);
      const locations=await getLocations(true);
      const location=locations.find(entry=>entry.id===item.locationId&&entry.enabled&&entry.available);
      if(!location)throw new Error('Der ursprüngliche Speicherort ist nicht verfügbar');
      if(location.readOnly)throw new Error(`„${location.name}“ ist schreibgeschützt`);
      let destinationDirectory=location.rootPath;
      if(item.metadata?.originalParent){
        try{destinationDirectory=(await resolveVirtual(item.metadata.originalParent)).fullPath}catch{/* restore to location root */}
      }
      const name=item.metadata?.originalName||(item.dataName.includes('__')?item.dataName.slice(item.dataName.lastIndexOf('__')+2):item.dataName);
      const target=await uniquePath(path.join(destinationDirectory,name));
      originals.push(item.metadata?.originalPath||item.dataName);
      await moveAcrossDevices(item.fullPath,target);
      await fs.rm(item.metadataPath,{force:true});
      restored.push(virtualFromFull(location,target));
    }
    await recordHistory({action:'restore',status:'success',title:'Aus Papierkorb wiederhergestellt',detail:`${restored.length} Element(e)`,count:restored.length,paths:restored,sourcePaths:originals,resultPaths:restored});
    res.json({ok:true,paths:restored});
  }catch(error){next(error)}
});

app.delete('/api/trash',async(req,res,next)=>{
  try{
    const ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[];
    if(!ids.length)throw new Error('Keine Papierkorb-Einträge ausgewählt');
    const removed:string[]=[];
    for(const id of ids){
      const item=await resolveTrashId(id);
      removed.push(item.metadata?.originalPath||item.dataName);
      await fs.rm(item.fullPath,{recursive:true,force:true});
      await fs.rm(item.metadataPath,{force:true});
    }
    await recordHistory({action:'delete-permanent',status:'success',title:'Endgültig aus Papierkorb gelöscht',detail:`${ids.length} Element(e)`,count:ids.length,sourcePaths:removed});
    res.json({ok:true});
  }catch(error){next(error)}
});

app.delete('/api/trash/all',async(_req,res,next)=>{
  try{
    const count=(await listTrash()).length;
    await fs.rm(TRASH_DIR,{recursive:true,force:true});
    await fs.mkdir(TRASH_DIR,{recursive:true});
    await recordHistory({action:'empty-trash',status:'success',title:'Papierkorb geleert',detail:`${count} Element(e) endgültig gelöscht`,count});
    res.json({ok:true,count});
  }catch(error){next(error)}
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

app.post('/api/auth/login', (req, res) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const previous = loginAttempts.get(key);
  const attempts = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + LOGIN_WINDOW_MS } : previous;
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    res.setHeader('Retry-After', String(Math.ceil((attempts.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' });
  }
  const supplied = String(req.body?.password || '');
  if (!verifyPassword(supplied)) {
    attempts.count += 1;
    loginAttempts.set(key, attempts);
    return res.status(401).json({ error: 'Falsches Passwort' });
  }
  loginAttempts.delete(key);
  const token = createToken();
  res.cookie('filepilot_token', token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 7 * 86400000, path: '/' });
  res.json({ token });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('filepilot_token', { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/' });
  res.json({ ok: true });
});

app.post('/api/auth/change-password', async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!verifyPassword(currentPassword)) return res.status(401).json({ error: 'Das aktuelle Passwort ist falsch' });
    if (newPassword.length < 8) throw new Error('Das neue Passwort muss mindestens 8 Zeichen lang sein');
    authState = hashPassword(newPassword);
    await writePrivateJson(AUTH_FILE, authState);
    const token = createToken();
    res.cookie('filepilot_token', token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 7 * 86400000, path: '/' });
    res.json({ ok: true, token });
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, version: '1.1.0' }));
app.get('/api/bootstrap', async (_req, res, next) => {
  try {
    res.json(await bootstrapPayload());
  } catch (error) {
    next(error);
  }
});

app.get('/api/list', async (req, res, next) => {
  try {
    const requested = String(req.query.path || '/');
    if (requested === '/') {
      const locations = await getLocations(false);
      const items = await Promise.all(locations.map(async location => {
        let modified = new Date().toISOString();
        try { modified = (await fs.stat(location.rootPath)).mtime.toISOString(); } catch { /* ignore */ }
        return {
          name: location.name,
          path: location.virtualPath,
          type: 'directory',
          size: location.totalBytes || 0,
          freeBytes: location.freeBytes,
          modified,
          hidden: false,
          locationRoot: true,
          locationId: location.id,
          locationKind: location.kind,
          readOnly: location.readOnly
        };
      }));
      return res.json({ path: '/', label: 'Speicherorte', items });
    }

    const resolved = await resolveVirtual(requested);
    const entries = await fs.readdir(resolved.fullPath, { withFileTypes: true });
    const items = (await Promise.all(entries.map(async entry => {
      const fullPath = path.join(resolved.fullPath, entry.name);
      try {
        const stat = await fs.lstat(fullPath);
        return {
          name: entry.name,
          path: virtualFromFull(resolved.location, fullPath),
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
          hidden: entry.name.startsWith('.'),
          locationId: resolved.location.id,
          readOnly: resolved.location.readOnly
        };
      } catch { return null; }
    }))).filter(item => item !== null);
    res.json({ path: resolved.virtualPath, label: resolved.location.name, location: publicLocation(resolved.location), items });
  } catch (error) {
    next(error);
  }
});

const SEARCH_KINDS = new Set(['all', 'images', 'videos', 'audio', 'word', 'spreadsheets', 'pdf', 'archives', 'code', 'folders']);
const SEARCH_EXTENSIONS: Record<string, Set<string>> = {
  images: new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'avif']),
  videos: new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg']),
  audio: new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'opus']),
  word: new Set(['doc', 'docx', 'odt', 'rtf', 'txt', 'md']),
  spreadsheets: new Set(['xls', 'xlsx', 'ods', 'csv']),
  pdf: new Set(['pdf']),
  archives: new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso']),
  code: new Set(['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'scss', 'sass', 'less', 'php', 'py', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'h', 'hpp', 'sh', 'ps1', 'bat', 'cmd', 'vue', 'svelte', 'json', 'yaml', 'yml', 'toml'])
};

function matchesSearchKind(entry: fssync.Dirent, kind: string) {
  if (kind === 'all') return true;
  if (kind === 'folders') return entry.isDirectory();
  if (!entry.isFile()) return false;
  const extension = path.extname(entry.name).slice(1).toLowerCase();
  return SEARCH_EXTENSIONS[kind]?.has(extension) || false;
}

app.get('/api/search', async (req, res, next) => {
  const streamed = req.query.stream === '1';
  let streamStarted = false;
  const send = (event: object) => {
    if (!streamed || res.writableEnded || res.destroyed) return;
    res.write(`${JSON.stringify(event)}\n`);
  };
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const requestedKind = String(req.query.kind || 'all').toLowerCase();
    const kind = SEARCH_KINDS.has(requestedKind) ? requestedKind : 'all';
    const scanAll = req.query.scan === '1';
    if (streamed) {
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      streamStarted = true;
    }
    if (!query && kind === 'all' && !scanAll) {
      const payload = { items: [], scanned: 0, truncated: false };
      if (streamed) { send({ type: 'result', ...payload }); return res.end(); }
      return res.json(payload);
    }
    const requested = String(req.query.path || '/');
    const starts = requested === '/'
      ? (await getLocations(false)).map(location => ({ location, fullPath: location.rootPath }))
      : [await resolveVirtual(requested)];
    const results: object[] = [];
    const maxResults = 1000;
    const maxEntries = 50000;
    const candidates: { location: Location; directory: string; entry: fssync.Dirent }[] = [];
    let scanned = 0;
    let truncated = false;
    let clientDisconnected = false;
    let lastProgressAt = 0;
    res.on('close', () => { if (!res.writableEnded) clientDisconnected = true; });

    async function discover(location: Location, directory: string, depth: number) {
      if (clientDisconnected) return;
      if (depth > 20 || candidates.length >= maxEntries) {
        truncated = true;
        return;
      }
      let entries: fssync.Dirent[];
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (clientDisconnected) return;
        if (candidates.length >= maxEntries) {
          truncated = true;
          break;
        }
        candidates.push({ location, directory, entry });
        const now = Date.now();
        if (streamed && now - lastProgressAt >= 100) {
          lastProgressAt = now;
          send({ type: 'preparing', discovered: candidates.length });
        }
        if (entry.isDirectory()) await discover(location, path.join(directory, entry.name), depth + 1);
      }
    }

    send({ type: 'preparing', discovered: 0 });
    for (const start of starts) await discover(start.location, start.fullPath, 0);
    if (clientDisconnected) return;
    const total = candidates.length;
    send({ type: 'start', total });
    lastProgressAt = 0;
    for (const candidate of candidates) {
      if (clientDisconnected) return;
      if (results.length >= maxResults) { truncated = true; break; }
      scanned += 1;
      const { location, directory, entry } = candidate;
      const fullPath = path.join(directory, entry.name);
      const nameMatches = !query || entry.name.toLowerCase().includes(query);
      if (nameMatches && matchesSearchKind(entry, kind)) {
        const stat = await fs.lstat(fullPath).catch(() => null);
        if (stat) results.push({
          name: entry.name,
          path: virtualFromFull(location, fullPath),
          parentPath: virtualFromFull(location, directory),
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
          hidden: entry.name.startsWith('.'),
          locationId: location.id,
          readOnly: location.readOnly
        });
      }
      const now = Date.now();
      if (streamed && (now - lastProgressAt >= 100 || scanned === total)) {
        lastProgressAt = now;
        send({ type: 'progress', scanned, total, found: results.length, percent: total ? Math.round(scanned / total * 100) : 100 });
      }
    }
    const payload = { items: results, scanned, truncated };
    if (streamed) {
      if (scanned < total) send({ type: 'progress', scanned, total, found: results.length, percent: 100, limited: true });
      send({ type: 'result', ...payload });
      return res.end();
    }
    res.json(payload);
  } catch (error) {
    if (streamStarted) {
      send({ type: 'error', error: (error as any)?.message || 'Suche fehlgeschlagen' });
      return res.end();
    }
    next(error);
  }
});

app.post('/api/folder', async (req, res, next) => {
  try {
    const parent = await resolveVirtual(String(req.body?.parent || ''));
    assertWritable(parent);
    const name = validateFileName(req.body?.name);
    await fs.mkdir(path.join(parent.fullPath, name), { recursive: false });
    const createdPath=virtualFromFull(parent.location,path.join(parent.fullPath,name));
    await recordHistory({action:'folder',status:'success',title:'Ordner erstellt',detail:name,paths:[createdPath],destination:parent.virtualPath,resultPaths:[createdPath]});
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/rename', async (req, res, next) => {
  try {
    const source = await resolveVirtual(String(req.body?.path || ''));
    assertWritable(source);
    assertNotLocationRoot(source);
    const name = validateFileName(req.body?.name);
    const destination = path.join(path.dirname(source.fullPath), name);
    if (await exists(destination)) throw new Error('Am Ziel existiert bereits ein Element mit diesem Namen');
    await fs.rename(source.fullPath, destination);
    const renamedPath=virtualFromFull(source.location,destination);
    await recordHistory({action:'rename',status:'success',title:'Element umbenannt',detail:`${path.basename(source.fullPath)} → ${name}`,count:1,paths:[source.virtualPath,renamedPath],sourcePaths:[source.virtualPath],resultPaths:[renamedPath],destination:path.posix.dirname(renamedPath)});
    res.json({ path: renamedPath });
  } catch (error) {
    next(error);
  }
});

app.post('/api/transfer', async (req, res, next) => {
  try {
    const requestedMode = req.body?.mode === 'copy' ? 'copy' : 'move';
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.map(String) : [];
    if (!paths.length) throw new Error('Keine Dateien ausgewählt');
    const destination = await resolveVirtual(String(req.body?.destination || ''));
    assertWritable(destination);
    const destinationStat = await fs.stat(destination.fullPath);
    if (!destinationStat.isDirectory()) throw new Error('Das Ziel ist kein Ordner');
    const output: string[] = [];

    for (const virtualPath of paths) {
      const source = await resolveVirtual(virtualPath);
      assertNotLocationRoot(source);
      const mode = requestedMode === 'move' && source.location.id === destination.location.id ? 'move' : 'copy';
      if (mode === 'move') assertWritable(source);
      let target = await uniquePath(path.join(destination.fullPath, path.basename(source.fullPath)));
      const sourceRelativeTarget = path.relative(source.fullPath, target);
      if (sourceRelativeTarget && !sourceRelativeTarget.startsWith('..') && !path.isAbsolute(sourceRelativeTarget)) {
        throw new Error('Ein Ordner kann nicht in sich selbst kopiert oder verschoben werden');
      }
      if (mode === 'copy') await copyRecursive(source.fullPath, target);
      else await moveAcrossDevices(source.fullPath, target);
      output.push(virtualFromFull(destination.location, target));
    }

    await recordHistory({action:requestedMode,status:'success',title:requestedMode==='copy'?'Auswahl kopiert':'Auswahl verschoben',detail:`${paths.length} Element(e)`,count:paths.length,paths:[...paths,...output],sourcePaths:paths,resultPaths:output,destination:destination.virtualPath});
    res.json({ ok: true, paths: output });
  } catch (error) {
    next(error);
  }
});

app.post('/api/transfer-stream', async (req, res) => {
  res.status(200);
  res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('X-Accel-Buffering','no');
  res.flushHeaders();
  const send=(payload:Record<string,unknown>)=>{if(!res.writableEnded&&!res.destroyed)res.write(`${JSON.stringify(payload)}\n`)};
  let historyMode:'copy'|'move'=req.body?.mode==='copy'?'copy':'move';
  const historyPaths=Array.isArray(req.body?.paths)?req.body.paths.map(String):[];
  const historyDestination=String(req.body?.destination||'');
  try{
    const requestedMode=req.body?.mode==='copy'?'copy':'move';
    const paths=Array.isArray(req.body?.paths)?req.body.paths.map(String):[];
    if(!paths.length)throw new Error('Keine Dateien ausgewählt');
    const destination=await resolveVirtual(String(req.body?.destination||''));
    assertWritable(destination);
    if(!(await fs.stat(destination.fullPath)).isDirectory())throw new Error('Das Ziel ist kein Ordner');
    const sources:ResolvedPath[]=[];
    for(const virtualPath of paths){
      const source=await resolveVirtual(virtualPath);
      assertNotLocationRoot(source);
      sources.push(source);
    }
    const mode=requestedMode==='move'&&sources.every(source=>source.location.id===destination.location.id)?'move':'copy';
    historyMode=mode;
    send({type:'preparing',mode,count:paths.length});

    const plans=[] as Array<{source:ResolvedPath;target:string;stats:TransferStats}>;
    let total=0;
    let totalFiles=0;
    for(const source of sources){
      if(mode==='move')assertWritable(source);
      const target=await uniquePath(path.join(destination.fullPath,path.basename(source.fullPath)));
      const sourceRelativeTarget=path.relative(source.fullPath,target);
      if(sourceRelativeTarget&&!sourceRelativeTarget.startsWith('..')&&!path.isAbsolute(sourceRelativeTarget))throw new Error('Ein Ordner kann nicht in sich selbst kopiert oder verschoben werden');
      const stats=await transferStats(source.fullPath);
      total+=stats.bytes;
      totalFiles+=stats.files;
      plans.push({source,target,stats});
    }

    let loaded=0;
    let completedFiles=0;
    let current='';
    let lastProgressAt=0;
    const startedAt=Date.now();
    const progress=(force=false)=>{
      const now=Date.now();
      if(!force&&now-lastProgressAt<100)return;
      lastProgressAt=now;
      const elapsedSeconds=Math.max(.001,(now-startedAt)/1000);
      const speed=loaded/elapsedSeconds;
      const fraction=total>0?loaded/total:totalFiles>0?completedFiles/totalFiles:1;
      send({type:'progress',mode,loaded,total,completedFiles,totalFiles,current,percent:Math.max(0,Math.min(100,Math.round(fraction*100))),speed,etaSeconds:speed>0&&total>loaded?(total-loaded)/speed:0});
    };
    send({type:'start',mode,total,totalFiles,count:paths.length});

    const output:string[]=[];
    for(const plan of plans){
      current=path.basename(plan.source.fullPath);
      progress(true);
      try{
        const addBytes=(amount:number)=>{loaded+=amount;progress(false)};
        const finishFile=()=>{completedFiles+=1;progress(true)};
        if(mode==='copy')await copyRecursiveProgress(plan.source.fullPath,plan.target,addBytes,finishFile);
        else await moveProgress(plan.source.fullPath,plan.target,plan.stats,addBytes,finishFile);
        output.push(virtualFromFull(destination.location,plan.target));
      }catch(error){
        throw transferFileError(error,plan.target);
      }
    }
    loaded=total;
    completedFiles=totalFiles;
    progress(true);
    send({type:'result',ok:true,mode,paths:output,loaded,total,totalFiles,durationMs:Date.now()-startedAt});
    await recordHistory({action:mode,status:'success',title:mode==='copy'?'Auswahl kopiert':'Auswahl verschoben',detail:`${paths.length} Element(e) → ${destination.location.name}`,count:paths.length,paths:[...paths,...output],sourcePaths:paths,resultPaths:output,destination:destination.virtualPath,bytes:total,durationMs:Date.now()-startedAt,requestedAction:requestedMode});
    res.end();
  }catch(error:any){
    await recordHistory({action:historyMode,status:'error',title:historyMode==='copy'?'Kopieren fehlgeschlagen':'Verschieben fehlgeschlagen',detail:historyDestination,count:historyPaths.length,paths:historyPaths,sourcePaths:historyPaths,destination:historyDestination,error:error?.message||'Übertragung fehlgeschlagen'});
    send({type:'error',error:error?.message||'Übertragung fehlgeschlagen'});
    res.end();
  }
});

app.post('/api/delete', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.map(String) : [];
    if (!paths.length) throw new Error('Keine Dateien ausgewählt');
    if (settings.trashEnabled) await fs.mkdir(TRASH_DIR, { recursive: true });

    for (const virtualPath of paths) {
      const source = await resolveVirtual(virtualPath);
      assertWritable(source);
      assertNotLocationRoot(source);
      if (settings.trashEnabled) {
        const locationTrash = path.join(TRASH_DIR, source.location.id);
        await fs.mkdir(locationTrash, { recursive: true });
        const deletedAt=new Date().toISOString();
        const stamp = deletedAt.replace(/[:.]/g, '-');
        const destination = path.join(locationTrash, `${stamp}__${crypto.randomUUID()}__${path.basename(source.fullPath)}`);
        const metadata:TrashMetadata={deletedAt,originalPath:source.virtualPath,originalParent:path.posix.dirname(source.virtualPath),originalName:path.basename(source.fullPath),locationId:source.location.id};
        await moveAcrossDevices(source.fullPath, destination);
        await writePrivateJson(`${destination}.trashinfo.json`,metadata).catch(error=>console.error('Papierkorb-Metadaten konnten nicht gespeichert werden',error));
      } else {
        await fs.rm(source.fullPath, { recursive: true, force: true });
      }
    }
    await recordHistory({action:'delete',status:'success',title:settings.trashEnabled?'In Papierkorb verschoben':'Endgültig gelöscht',detail:`${paths.length} Element(e)`,count:paths.length,paths,sourcePaths:paths,destination:settings.trashEnabled?'FilePilot-Papierkorb':undefined});
    res.json({ ok: true, trashed: settings.trashEnabled });
  } catch (error) {
    next(error);
  }
});

app.post('/api/delete-stream',async(req,res)=>{
  res.status(200);
  res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('X-Accel-Buffering','no');
  res.flushHeaders();
  const send=(payload:Record<string,unknown>)=>{if(!res.writableEnded&&!res.destroyed)res.write(`${JSON.stringify(payload)}\n`)};
  const requestedPaths=Array.isArray(req.body?.paths)?[...new Set<string>(req.body.paths.map(String))]:[];
  try{
    if(!requestedPaths.length)throw new Error('Keine Dateien ausgewählt');
    const settings=await getSettings();
    if(settings.trashEnabled)await fs.mkdir(TRASH_DIR,{recursive:true});
    send({type:'preparing',trashed:settings.trashEnabled,count:requestedPaths.length});

    const plans=[] as Array<{source:ResolvedPath;stats:{bytes:number;items:number}}>;
    const skipped:string[]=[];
    let total=0;
    let totalFiles=0;
    for(const virtualPath of requestedPaths){
      try{
        const source=await resolveVirtual(virtualPath);
        assertWritable(source);
        assertNotLocationRoot(source);
        const stats=await deleteStats(source.fullPath);
        total+=stats.bytes;
        totalFiles+=stats.items;
        plans.push({source,stats});
      }catch(error:any){
        if(error?.code==='ENOENT'){skipped.push(virtualPath);continue}
        throw error;
      }
    }

    let loaded=0;
    let completedFiles=0;
    let current='';
    let lastProgressAt=0;
    const startedAt=Date.now();
    const progress=(force=false)=>{
      const now=Date.now();
      if(!force&&now-lastProgressAt<100)return;
      lastProgressAt=now;
      const elapsedSeconds=Math.max(.001,(now-startedAt)/1000);
      const fraction=total>0?loaded/total:totalFiles>0?completedFiles/totalFiles:1;
      const rate=total>0?loaded/elapsedSeconds:completedFiles/elapsedSeconds;
      const remaining=total>0?total-loaded:totalFiles-completedFiles;
      send({type:'progress',trashed:settings.trashEnabled,loaded,total,completedFiles,totalFiles,current,percent:Math.max(0,Math.min(100,Math.round(fraction*100))),speed:total>0?rate:0,etaSeconds:rate>0&&remaining>0?remaining/rate:0});
    };
    send({type:'start',trashed:settings.trashEnabled,total,totalFiles,count:plans.length,skipped:skipped.length});

    for(const plan of plans){
      current=path.basename(plan.source.fullPath);
      progress(true);
      const addBytes=(amount:number)=>{loaded+=amount;progress(false)};
      const finishItem=()=>{completedFiles+=1;progress(true)};
      if(settings.trashEnabled){
        const locationTrash=path.join(TRASH_DIR,plan.source.location.id);
        await fs.mkdir(locationTrash,{recursive:true});
        const deletedAt=new Date().toISOString();
        const stamp=deletedAt.replace(/[:.]/g,'-');
        const destination=path.join(locationTrash,`${stamp}__${crypto.randomUUID()}__${path.basename(plan.source.fullPath)}`);
        const metadata:TrashMetadata={deletedAt,originalPath:plan.source.virtualPath,originalParent:path.posix.dirname(plan.source.virtualPath),originalName:path.basename(plan.source.fullPath),locationId:plan.source.location.id};
        await moveProgress(plan.source.fullPath,destination,{bytes:plan.stats.bytes,files:plan.stats.items},addBytes,finishItem);
        await writePrivateJson(`${destination}.trashinfo.json`,metadata).catch(error=>console.error('Papierkorb-Metadaten konnten nicht gespeichert werden',error));
      }else{
        await removeRecursiveProgress(plan.source.fullPath,addBytes,finishItem);
      }
    }
    loaded=total;
    completedFiles=totalFiles;
    progress(true);
    const durationMs=Date.now()-startedAt;
    await recordHistory({action:'delete',status:'success',title:settings.trashEnabled?'In Papierkorb verschoben':'Endgültig gelöscht',detail:`${plans.length} Element(e)${skipped.length?`, ${skipped.length} bereits entfernt`:''}`,count:plans.length,paths:requestedPaths,sourcePaths:requestedPaths,destination:settings.trashEnabled?'FilePilot-Papierkorb':undefined,bytes:total,durationMs});
    send({type:'result',ok:true,trashed:settings.trashEnabled,loaded,total,totalFiles,skipped:skipped.length,durationMs});
    res.end();
  }catch(error:any){
    await recordHistory({action:'delete',status:'error',title:'Löschen fehlgeschlagen',detail:`${requestedPaths.length} Element(e)`,count:requestedPaths.length,paths:requestedPaths,sourcePaths:requestedPaths,error:error?.message||'Löschen fehlgeschlagen'});
    send({type:'error',error:error?.message||'Löschen fehlgeschlagen'});
    res.end();
  }
});

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: MAX_UPLOAD } });
app.post('/api/upload', upload.array('files'), async (req, res, next) => {
  try {
    const destination = await resolveVirtual(String(req.body?.destination || ''));
    assertWritable(destination);
    const safeRelativePath=(value:unknown)=>{
      const segments=String(value||'').replace(/\\/g,'/').split('/').filter(Boolean);
      if(!segments.length||segments.some(segment=>segment==='.'||segment==='..'))throw new Error('Ungültiger Upload-Pfad');
      return segments.map(validateFileName).join(path.sep);
    };
    let relativePaths:unknown[]=[];
    let directories:unknown[]=[];
    try{
      relativePaths=JSON.parse(String(req.body?.relativePaths||'[]'));
      directories=JSON.parse(String(req.body?.directories||'[]'));
    }catch{throw new Error('Ungültige Upload-Ordnerstruktur')}
    if(!Array.isArray(relativePaths)||!Array.isArray(directories))throw new Error('Ungültige Upload-Ordnerstruktur');
    const ensureUploadDirectory=async(relative:string)=>{
      let current=destination.fullPath;
      for(const segment of relative.split(path.sep).filter(Boolean)){
        current=path.join(current,segment);
        try{
          const stat=await fs.lstat(current);
          if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`Upload-Ziel „${segment}“ ist kein sicherer Ordner`);
        }catch(error:any){
          if(error?.code!=='ENOENT')throw error;
          try{await fs.mkdir(current)}catch(createError:any){
            if(createError?.code!=='EEXIST')throw createError;
            const stat=await fs.lstat(current);
            if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`Upload-Ziel „${segment}“ ist kein sicherer Ordner`);
          }
        }
      }
    };
    for(const directory of directories){
      const relative=safeRelativePath(directory);
      await ensureUploadDirectory(relative);
    }
    const uploaded:string[]=[];
    const files=req.files as Express.Multer.File[]||[];
    for (let index=0;index<files.length;index+=1) {
      const file=files[index];
      const relative=safeRelativePath(relativePaths[index]||file.originalname);
      const parent=path.dirname(relative);
      if(parent!=='.')await ensureUploadDirectory(parent);
      const target=await uniquePath(path.join(destination.fullPath,relative));
      await moveAcrossDevices(file.path, target);
      uploaded.push(virtualFromFull(destination.location,target));
    }
    await recordHistory({action:'upload',status:'success',title:'Dateien hochgeladen',detail:`${uploaded.length} Datei(en)${directories.length?`, ${directories.length} Ordner`:''} → ${destination.location.name}`,count:uploaded.length,paths:uploaded,resultPaths:uploaded,destination:destination.virtualPath});
    res.json({ok:true,files:uploaded.length,directories:directories.length});
  } catch (error) {
    for (const file of (req.files as Express.Multer.File[] || [])) await fs.rm(file.path, { force: true }).catch(() => undefined);
    next(error);
  }
});

app.get('/api/raw', async (req, res, next) => {
  try {
    const resolved = await resolveVirtual(String(req.query.path || ''));
    const stat = await fs.lstat(resolved.fullPath);
    if (stat.isDirectory()) throw new Error('Ordner können hier nicht geöffnet werden');
    if (stat.isSymbolicLink()) throw new Error('Symbolische Links können nicht direkt geöffnet werden');
    const contentType = mime.lookup(resolved.fullPath) || 'application/octet-stream';
    const inlineTypes = /^(image\/(?:jpeg|png|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)|video\/(?:mp4|webm|quicktime|ogg)|audio\/(?:mpeg|wav|x-wav|ogg|flac|mp4|opus|aac)|application\/pdf)$/;
    res.type(contentType);
    if (!inlineTypes.test(contentType)) {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(resolved.fullPath))}`);
    }
    res.sendFile(resolved.fullPath);
  } catch (error) {
    next(error);
  }
});

const TEXT_PREVIEW_LIMIT = 1024 * 1024;

app.get('/api/text-preview', async (req, res, next) => {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const resolved = await resolveVirtual(String(req.query.path || ''));
    const stat = await fs.lstat(resolved.fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Nur reguläre Textdateien können angezeigt werden');
    const length = Math.min(stat.size, TEXT_PREVIEW_LIMIT);
    const buffer = Buffer.alloc(length);
    handle = await fs.open(resolved.fullPath, 'r');
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const content = buffer.subarray(0, bytesRead);
    let text: string;
    let encoding = 'UTF-8';
    if (content[0] === 0xff && content[1] === 0xfe) {
      text = content.subarray(2).toString('utf16le');
      encoding = 'UTF-16 LE';
    } else if (content[0] === 0xfe && content[1] === 0xff) {
      const utf16Length = content.length - 2 - ((content.length - 2) % 2);
      const swapped = Buffer.from(content.subarray(2, 2 + utf16Length));
      swapped.swap16();
      text = swapped.toString('utf16le');
      encoding = 'UTF-16 BE';
    } else {
      if (content.includes(0)) throw new Error('Diese Datei enthält Binärdaten und kann nicht als Text angezeigt werden');
      text = content.toString('utf8');
    }
    res.json({ text, size: stat.size, truncated: stat.size > bytesRead, encoding });
  } catch (error) {
    next(error);
  } finally {
    await handle?.close().catch(() => undefined);
  }
});

app.get('/api/download', async (req, res, next) => {
  try {
    const raw = String(req.query.paths || '[]');
    let virtualPaths: string[];
    try { virtualPaths = JSON.parse(raw); } catch { virtualPaths = raw.split('|').filter(Boolean); }
    if (!Array.isArray(virtualPaths) || !virtualPaths.length) throw new Error('Keine Dateien ausgewählt');
    const resolved = await Promise.all(virtualPaths.map(item => resolveVirtual(String(item))));
    for (const item of resolved) assertNotLocationRoot(item);
    await recordHistory({action:'download',status:'success',title:'Auswahl heruntergeladen',detail:`${resolved.length} Element(e)`,count:resolved.length,paths:virtualPaths,sourcePaths:virtualPaths,destination:'Browser-Download'});

    if (resolved.length === 1 && (await fs.stat(resolved[0].fullPath)).isFile()) return res.download(resolved[0].fullPath);
    res.attachment('FilePilot-Auswahl.zip');
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', next);
    zip.pipe(res);
    for (const item of resolved) {
      const stat = await fs.stat(item.fullPath);
      stat.isDirectory() ? zip.directory(item.fullPath, path.basename(item.fullPath)) : zip.file(item.fullPath, { name: path.basename(item.fullPath) });
    }
    await zip.finalize();
  } catch (error) {
    next(error);
  }
});

app.get('/api/info', async (req, res, next) => {
  try {
    const resolved = await resolveVirtual(String(req.query.path || ''));
    const stat = await fs.lstat(resolved.fullPath);
    const itemType = stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file';
    const extension = itemType === 'file' ? path.extname(resolved.fullPath).slice(1).toLowerCase() : '';
    const mimeType = itemType === 'file' ? (mime.lookup(resolved.fullPath) || 'application/octet-stream') : '';
    const media = itemType === 'file' && /^(audio|video|image)\//.test(String(mimeType)) ? await probeMedia(resolved.fullPath) : null;
    res.json({
      path: resolved.virtualPath,
      absolutePath: resolved.fullPath,
      location: resolved.location.name,
      name: path.basename(resolved.fullPath),
      type: itemType,
      extension,
      mimeType,
      size: await dirSize(resolved.fullPath),
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
      accessed: stat.atime.toISOString(),
      changed: stat.ctime.toISOString(),
      mode: (stat.mode & 0o777).toString(8),
      uid: stat.uid,
      gid: stat.gid,
      inode: stat.ino,
      hardLinks: stat.nlink,
      blockSize: stat.blksize,
      allocatedSize: stat.blocks ? stat.blocks * 512 : undefined,
      readOnly: resolved.location.readOnly,
      media
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/settings', async (_req, res, next) => {
  try {
    res.json(await bootstrapPayload());
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings', async (req, res, next) => {
  try {
    const nextSettings = normalizeStoredSettings(req.body?.settings || req.body || {});
    const seenPaths = new Set<string>();
    for (const location of nextSettings.manualLocations) {
      if (!location.rootPath) throw new Error(`Beim Speicherort „${location.name}“ fehlt der Pfad`);
      if (!path.isAbsolute(location.rootPath)) throw new Error(`Der Pfad von „${location.name}“ muss absolut sein`);
      const normalized = path.resolve(location.rootPath);
      const comparison = IS_WINDOWS ? normalized.toLowerCase() : normalized;
      if (seenPaths.has(comparison)) throw new Error(`Der Pfad „${normalized}“ wurde doppelt eingetragen`);
      seenPaths.add(comparison);
      if (location.enabled) {
        const stat = await fs.stat(normalized).catch(() => null);
        if (!stat?.isDirectory()) throw new Error(`Der Ordner „${normalized}“ wurde nicht gefunden`);
      }
      location.rootPath = normalized;
    }
    await saveSettings(nextSettings);
    await recordHistory({action:'settings',status:'success',title:'Einstellungen gespeichert'});
    res.json(await bootstrapPayload());
  } catch (error) {
    next(error);
  }
});

app.post('/api/locations/rescan', async (_req, res, next) => {
  try {
    locationCache = null;
    await recordHistory({action:'rescan',status:'success',title:'Speicherorte neu erkannt'});
    res.json(await bootstrapPayload());
  } catch (error) {
    next(error);
  }
});

app.use('/api', async (error: any, req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  const actions:Record<string,{action:string;title:string}>={
    '/folder':{action:'folder',title:'Ordner erstellen fehlgeschlagen'},
    '/rename':{action:'rename',title:'Umbenennen fehlgeschlagen'},
    '/transfer':{action:'transfer',title:'Übertragung fehlgeschlagen'},
    '/delete':{action:'delete',title:'Löschen fehlgeschlagen'},
    '/upload':{action:'upload',title:'Upload fehlgeschlagen'},
    '/trash/restore':{action:'restore',title:'Wiederherstellen fehlgeschlagen'},
    '/trash':{action:'delete-permanent',title:'Endgültiges Löschen fehlgeschlagen'},
    '/trash/all':{action:'empty-trash',title:'Papierkorb leeren fehlgeschlagen'},
    '/settings':{action:'settings',title:'Einstellungen speichern fehlgeschlagen'},
    '/locations/rescan':{action:'rescan',title:'Speicherorte erkennen fehlgeschlagen'}
  };
  const historyAction=actions[req.path];
  if(historyAction){
    const sourcePaths=Array.isArray(req.body?.paths)?req.body.paths.map(String):req.body?.path?[String(req.body.path)]:undefined;
    const destination=req.body?.destination||req.body?.parent;
    await recordHistory({...historyAction,status:'error',detail:req.body?.name?String(req.body.name):undefined,count:sourcePaths?.length,sourcePaths,destination:destination?String(destination):undefined,error:error?.message||'Aktion fehlgeschlagen'});
  }
  const status = error?.code === 'ENOENT' ? 404 : error?.code === 'EACCES' || error?.code === 'EPERM' ? 403 : 400;
  res.status(status).json({ error: error?.message || 'Unbekannter Fehler' });
});

const dist = path.resolve(process.cwd(), 'dist');
if (fssync.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

await loadAuth();
await getSettings();
app.listen(PORT, '0.0.0.0', () => {
  if(process.env.FILEPILOT_DEV_ORCHESTRATOR){
    const useColor=Boolean(process.stdout.isTTY&&!process.env.NO_COLOR);
    const green=(value:string)=>useColor?`\x1b[38;2;52;211;153m${value}\x1b[0m`:value;
    const muted=(value:string)=>useColor?`\x1b[38;2;148;163;184m${value}\x1b[0m`:value;
    console.log(`\n  ${green('✓')} ${muted(`FilePilot API bereit · Port ${PORT} · ${process.platform} · Docker ${IS_DOCKER?'ja':'nein'}`)}`);
    console.log(`  ${muted(`AppData: ${APP_DATA}`)}\n`);
  }else{
    console.log(`FilePilot 1.1.0 läuft auf Port ${PORT}`);
    console.log(`Plattform: ${process.platform}; Docker: ${IS_DOCKER ? 'ja' : 'nein'}; AppData: ${APP_DATA}`);
  }
});
