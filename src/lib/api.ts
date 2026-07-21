export type FileItem = {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  freeBytes?: number;
  modified: string;
  hidden?: boolean;
  locationRoot?: boolean;
  locationId?: string;
  locationKind?: 'drive' | 'unraid' | 'folder' | 'volume';
  readOnly?: boolean;
  parentPath?: string;
};

export type ManualLocation = {
  id: string;
  name: string;
  rootPath: string;
  readOnly: boolean;
  enabled: boolean;
};

export type Location = ManualLocation & {
  source: 'auto' | 'manual';
  kind: 'drive' | 'unraid' | 'folder' | 'volume';
  available: boolean;
  virtualPath: string;
  totalBytes?: number;
  freeBytes?: number;
};

export type AppSettings = {
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
  defaultLeftLocationId: string;
  defaultRightLocationId: string;
  disabledAutoLocationIds: string[];
  manualLocations: ManualLocation[];
};

export type Bootstrap = {
  platform: string;
  isDocker: boolean;
  appDataPath: string;
  settings: AppSettings;
  locations: Location[];
  startPaths: { left: string; right: string };
  version: string;
};

const base = '/api';
export const token = () => localStorage.getItem('filepilot-token') || '';

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token()}`);
  const response = await fetch(base + url, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem('filepilot-token');
    location.reload();
    throw new Error('Sitzung abgelaufen');
  }
  if (!response.ok) {
    let message = `Fehler (${response.status})`;
    try { message = (await response.json()).error || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const formatSize = (value?: number) => {
  const n = Number(value || 0);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

export const displayFileName = (name: string, hideExtension: boolean, isDirectory: boolean) => {
  if (!hideExtension || isDirectory || name.startsWith('.')) return name;
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(0, index) : name;
};
