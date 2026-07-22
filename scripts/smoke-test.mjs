import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import net from 'node:net';

const projectRoot = resolve(import.meta.dirname, '..');

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Backend ist nicht rechtzeitig gestartet');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const appData = await mkdtemp(join(tmpdir(), 'filepilot-smoke-'));
const fileRoot = await mkdtemp(join(tmpdir(), 'filepilot-search-'));
const externalRoot = await mkdtemp(join(tmpdir(), 'filepilot-external-'));
await mkdir(join(fileRoot, 'Fotos', 'Urlaub'), {recursive: true});
await mkdir(join(fileRoot, 'Dokumente', 'Archiv'), {recursive: true});
await mkdir(join(fileRoot, 'Quelle'), {recursive: true});
await mkdir(join(fileRoot, 'Ziel'), {recursive: true});
await writeFile(join(fileRoot, 'Fotos', 'Urlaub', 'strand.jpg'), 'smoke-image');
await writeFile(join(fileRoot, 'Fotos', 'Urlaub', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="cyan"/></svg>');
await writeFile(join(fileRoot, 'Dokumente', 'Archiv', 'report.docx'), 'smoke-document');
await writeFile(join(fileRoot, 'Dokumente', 'Archiv', 'notes.txt'), 'FilePilot text preview');
await writeFile(join(fileRoot, 'Quelle', 'transfer-test.bin'), Buffer.alloc(2 * 1024 * 1024, 0x5a));
await writeFile(join(fileRoot, 'Quelle', 'external-copy-test.txt'), 'source-must-remain');
await writeFile(join(fileRoot, 'Quelle', 'trash-restore-test.txt'), 'restore-me');
await writeFile(join(fileRoot, 'Quelle', 'trash-remove-test.txt'), 'remove-me');
const port = await freePort();
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const child = spawn(process.execPath, [tsxCli, 'server/src/index.ts'], {
  cwd: projectRoot,
  env: {...process.env, PORT: String(port), APP_DATA: appData, APP_PASSWORD: 'admin', TOKEN_SECRET: 'smoke-test-secret-with-at-least-32-characters'},
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  await waitForServer(`${base}/health`);

  const unauthorized = await fetch(`${base}/bootstrap`);
  assert(unauthorized.status === 401, `Bootstrap ohne Auth lieferte ${unauthorized.status}`);

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({password: 'admin'})
  });
  const loginData = await login.json();
  assert(login.ok && loginData.token, 'Login lieferte kein Token');
  assert(login.headers.get('set-cookie')?.includes('HttpOnly'), 'Login setzte kein HttpOnly-Cookie');

  const queryToken = await fetch(`${base}/bootstrap?token=${encodeURIComponent(loginData.token)}`);
  assert(queryToken.status === 401, 'Token in Query-Parametern wurde unerwartet akzeptiert');

  const authenticated = await fetch(`${base}/bootstrap`, {headers: {authorization: `Bearer ${loginData.token}`}});
  assert(authenticated.ok, `Authentifizierter Bootstrap lieferte ${authenticated.status}`);

  const settings = await fetch(`${base}/settings`, {
    method: 'PUT',
    headers: {'content-type': 'application/json', authorization: `Bearer ${loginData.token}`},
    body: JSON.stringify({settings: {favorites: ['/', '/@/manual-smoke/Fotos/Urlaub'], rememberWorkspace: false, defaultLeftLocationId: 'favorite:/@/manual-smoke/Fotos/Urlaub', defaultRightLocationId: 'manual-external', manualLocations: [{id: 'manual-smoke', name: 'Smoke-Test', rootPath: fileRoot, readOnly: false, enabled: true}, {id: 'manual-external', name: 'Externer Test-Speicher', rootPath: externalRoot, readOnly: false, enabled: true}]}})
  });
  assert(settings.ok, 'Temporärer Such-Speicherort konnte nicht angelegt werden');
  const settingsData = await settings.json();
  const folderUploadBody = new FormData();
  folderUploadBody.append('files', new Blob(['nested upload']), 'upload.txt');
  folderUploadBody.append('destination', '/@/manual-smoke');
  folderUploadBody.append('relativePaths', JSON.stringify(['PC-Ordner/Unterordner/upload.txt']));
  folderUploadBody.append('directories', JSON.stringify(['PC-Ordner', 'PC-Ordner/Unterordner', 'PC-Ordner/Leer']));
  const folderUpload = await fetch(`${base}/upload`, {method: 'POST', headers: {authorization: `Bearer ${loginData.token}`}, body: folderUploadBody});
  const folderUploadData = await folderUpload.json();
  assert(folderUpload.ok && folderUploadData.files === 1 && folderUploadData.directories === 3, 'Ordner-Upload meldete keine vollständige Struktur');
  const uploadedFolder = await fetch(`${base}/list?path=${encodeURIComponent('/@/manual-smoke/PC-Ordner/Unterordner')}`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  const emptyUploadedFolder = await fetch(`${base}/list?path=${encodeURIComponent('/@/manual-smoke/PC-Ordner/Leer')}`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  assert(uploadedFolder.items?.some(item => item.name === 'upload.txt') && Array.isArray(emptyUploadedFolder.items) && emptyUploadedFolder.items.length === 0, 'Ordner-Upload erhielt Datei- oder Leerordnerstruktur nicht');
  assert(settingsData.startPaths?.left === '/@/manual-smoke/Fotos/Urlaub' && settingsData.startPaths?.right === '/@/manual-external' && settingsData.settings?.rememberWorkspace === false, 'Favorit, Speicherort oder Arbeitsbereich-Einstellung wurde nicht übernommen');

  const imageSearch = await fetch(`${base}/search?path=${encodeURIComponent('/@/manual-smoke')}&kind=images&scan=1`, {headers: {authorization: `Bearer ${loginData.token}`}});
  const imageData = await imageSearch.json();
  assert(imageSearch.ok && imageData.items?.length === 2 && imageData.items.some(item => item.name === 'strand.jpg') && imageData.items.some(item => item.name === 'logo.svg'), 'Rekursive Bildersuche fand nicht alle verschachtelten Bilddateien');
  assert(imageData.items.every(item => item.parentPath?.endsWith('/Fotos/Urlaub')), 'Bildersuche lieferte keinen Fundpfad');

  const streamedSearch = await fetch(`${base}/search?path=${encodeURIComponent('/@/manual-smoke')}&kind=images&scan=1&stream=1`, {headers: {authorization: `Bearer ${loginData.token}`}});
  const searchEvents = (await streamedSearch.text()).trim().split('\n').map(line => JSON.parse(line));
  assert(streamedSearch.ok && searchEvents.some(event => event.type === 'preparing') && searchEvents.some(event => event.type === 'start' && event.total > 0), 'Live-Suche lieferte keine Vorbereitungs- oder Startmeldung');
  assert(searchEvents.some(event => event.type === 'progress' && event.percent === 100) && searchEvents.some(event => event.type === 'result' && event.items?.length === 2), 'Live-Suche erreichte nicht 100 Prozent oder lieferte keine Treffer');

  const collectionPaths=['/@/manual-smoke/Fotos/Urlaub/strand.jpg','/@/manual-smoke/Dokumente/Archiv/notes.txt'];
  const collectionDownload=await fetch(`${base}/download?paths=${encodeURIComponent(JSON.stringify(collectionPaths))}&preservePaths=1`,{headers:{authorization:`Bearer ${loginData.token}`}});
  const collectionZip=Buffer.from(await collectionDownload.arrayBuffer()).toString('latin1');
  assert(collectionDownload.ok,`ZIP-Sammlung lieferte Status ${collectionDownload.status}: ${collectionZip.slice(0,300)}`);
  assert(collectionDownload.headers.get('content-disposition')?.includes('FilePilot-Sammlung.zip'),`ZIP-Sammlung hatte einen unerwarteten Dateinamen: ${collectionDownload.headers.get('content-disposition')}`);
  assert(collectionZip.includes('Smoke-Test/Fotos/Urlaub/strand.jpg')&&collectionZip.includes('Smoke-Test/Dokumente/Archiv/notes.txt'),'ZIP-Sammlung erhielt die Ordnerstruktur verschiedener Auswahlen nicht');
  assert(collectionZip.includes('FilePilot-Inhaltsverzeichnis.txt')&&collectionPaths.every(sourcePath=>collectionZip.includes(sourcePath)),'ZIP-Sammlung enthielt kein Inhaltsverzeichnis mit den Ursprungspfaden');

  const transferStream = await fetch(`${base}/transfer-stream`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${loginData.token}`},
    body: JSON.stringify({paths: ['/@/manual-smoke/Quelle/transfer-test.bin'], destination: '/@/manual-smoke/Ziel', mode: 'copy'})
  });
  const transferEvents = (await transferStream.text()).trim().split('\n').map(line => JSON.parse(line));
  assert(transferStream.ok && transferEvents.some(event => event.type === 'start' && event.total === 2 * 1024 * 1024), 'Transfer-Fortschritt meldete keine korrekte Gesamtgröße');
  assert(transferEvents.some(event => event.type === 'progress' && event.percent === 100) && transferEvents.some(event => event.type === 'result' && event.ok), 'Transfer erreichte nicht 100 Prozent oder lieferte kein Ergebnis');
  const transferTarget = await fetch(`${base}/list?path=${encodeURIComponent('/@/manual-smoke/Ziel')}`, {headers: {authorization: `Bearer ${loginData.token}`}});
  const transferTargetData = await transferTarget.json();
  assert(transferTarget.ok && transferTargetData.items?.some(item => item.name === 'transfer-test.bin' && item.size === 2 * 1024 * 1024), 'Gestreamter Transfer erzeugte keine vollständige Zieldatei');

  const externalTransfer = await fetch(`${base}/transfer-stream`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${loginData.token}`},
    body: JSON.stringify({paths: ['/@/manual-smoke/Quelle/external-copy-test.txt'], destination: '/@/manual-external', mode: 'move'})
  });
  const externalEvents = (await externalTransfer.text()).trim().split('\n').map(line => JSON.parse(line));
  assert(externalTransfer.ok && externalEvents.some(event => event.type === 'result' && event.mode === 'copy'), 'Speicherübergreifendes Verschieben wurde nicht sicher in Kopieren umgewandelt');
  const sourceAfterExternalCopy = await fetch(`${base}/list?path=${encodeURIComponent('/@/manual-smoke/Quelle')}`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  const externalTarget = await fetch(`${base}/list?path=${encodeURIComponent('/@/manual-external')}`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  assert(sourceAfterExternalCopy.items?.some(item => item.name === 'external-copy-test.txt'), 'Quelldatei wurde beim Kopieren auf einen anderen Speicher entfernt');
  assert(externalTarget.items?.some(item => item.name === 'external-copy-test.txt'), 'Datei wurde nicht auf den anderen Speicher kopiert');

  const history = await fetch(`${base}/history`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  assert(history.items?.some(item => item.action === 'copy' && item.status === 'success'), 'Aktivitätsverlauf enthält den erfolgreichen Kopiervorgang nicht');
  const detailedTransferHistory = history.items?.find(item => item.action === 'copy' && item.sourcePaths?.includes('/@/manual-smoke/Quelle/transfer-test.bin'));
  assert(detailedTransferHistory?.resultPaths?.some(path => path.endsWith('/Ziel/transfer-test.bin')) && detailedTransferHistory.destination === '/@/manual-smoke/Ziel', 'Aktivitätsverlauf enthält keine getrennten Quell-, Ziel- und Ergebnispfade');
  assert(detailedTransferHistory.bytes === 2 * 1024 * 1024 && detailedTransferHistory.durationMs >= 0, 'Aktivitätsverlauf enthält keine Übertragungsgröße oder Dauer');
  const safeCopyHistory = history.items?.find(item => item.sourcePaths?.includes('/@/manual-smoke/Quelle/external-copy-test.txt'));
  assert(safeCopyHistory?.requestedAction === 'move' && safeCopyHistory.action === 'copy', 'Aktivitätsverlauf dokumentiert die sichere Umwandlung von Verschieben zu Kopieren nicht');
  const clearHistory = await fetch(`${base}/history`, {method: 'DELETE', headers: {authorization: `Bearer ${loginData.token}`}});
  assert(clearHistory.ok, 'Aktivitätsverlauf konnte nicht gesammelt gelöscht werden');
  const emptyHistory = await fetch(`${base}/history`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  assert(Array.isArray(emptyHistory.items) && emptyHistory.items.length === 0, 'Aktivitätsverlauf war nach dem Löschen nicht leer');

  const trashHeaders = {'content-type': 'application/json', authorization: `Bearer ${loginData.token}`};
  const moveToTrash = await fetch(`${base}/delete-stream`, {
    method: 'POST', headers: trashHeaders,
    body: JSON.stringify({paths: ['/@/manual-smoke/Quelle/trash-restore-test.txt', '/@/manual-smoke/Quelle/trash-remove-test.txt', '/@/manual-smoke/Quelle/bereits-entfernt.txt']})
  });
  const deleteEvents = (await moveToTrash.text()).trim().split('\n').map(line => JSON.parse(line));
  assert(moveToTrash.ok && deleteEvents.some(event => event.type === 'progress') && deleteEvents.some(event => event.type === 'result' && event.trashed === true && event.skipped === 1), 'Dateien wurden nicht mit Fortschritt in den FilePilot-Papierkorb verschoben');
  const sourceAfterTrash = await fetch(`${base}/list?path=${encodeURIComponent('/@/manual-smoke/Quelle')}`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  assert(!sourceAfterTrash.items?.some(item => item.name.startsWith('trash-')), 'Gelöschte Dateien sind im Ursprungsordner sichtbar geblieben');
  const trashItems = await fetch(`${base}/trash`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  const restoreItem = trashItems.items?.find(item => item.name === 'trash-restore-test.txt');
  const removeItem = trashItems.items?.find(item => item.name === 'trash-remove-test.txt');
  assert(restoreItem?.originalPath === '/@/manual-smoke/Quelle/trash-restore-test.txt' && removeItem?.id, 'Papierkorb enthielt keine vollständigen Einträge mit Ursprungsort');
  const restoreTrash = await fetch(`${base}/trash/restore`, {method: 'POST', headers: trashHeaders, body: JSON.stringify({ids: [restoreItem.id]})});
  assert(restoreTrash.ok, 'Datei konnte nicht aus dem Papierkorb wiederhergestellt werden');
  const sourceAfterRestore = await fetch(`${base}/list?path=${encodeURIComponent('/@/manual-smoke/Quelle')}`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  assert(sourceAfterRestore.items?.some(item => item.name === 'trash-restore-test.txt'), 'Wiederhergestellte Datei fehlt am Ursprungsort');
  const deletePermanent = await fetch(`${base}/trash`, {method: 'DELETE', headers: trashHeaders, body: JSON.stringify({ids: [removeItem.id]})});
  assert(deletePermanent.ok, 'Ausgewählter Papierkorb-Eintrag konnte nicht endgültig gelöscht werden');
  await fetch(`${base}/delete`, {method: 'POST', headers: trashHeaders, body: JSON.stringify({paths: ['/@/manual-smoke/Quelle/trash-restore-test.txt']})});
  const emptyTrash = await fetch(`${base}/trash/all`, {method: 'DELETE', headers: {authorization: `Bearer ${loginData.token}`}});
  assert(emptyTrash.ok, 'Papierkorb konnte nicht vollständig geleert werden');
  const trashAfterEmpty = await fetch(`${base}/trash`, {headers: {authorization: `Bearer ${loginData.token}`}}).then(response => response.json());
  assert(Array.isArray(trashAfterEmpty.items) && trashAfterEmpty.items.length === 0, 'Papierkorb war nach dem Leeren nicht leer');

  const svgRaw = await fetch(`${base}/raw?path=${encodeURIComponent('/@/manual-smoke/Fotos/Urlaub/logo.svg')}`, {headers: {authorization: `Bearer ${loginData.token}`}});
  assert(svgRaw.ok && svgRaw.headers.get('content-type')?.startsWith('image/svg+xml'), 'SVG wurde nicht als Bild ausgeliefert');
  assert(svgRaw.headers.get('content-disposition')?.startsWith('attachment'), 'SVG wurde unerwartet als aktives Dokument ausgeliefert');

  const mediaInfo = await fetch(`${base}/info?path=${encodeURIComponent('/@/manual-smoke/Fotos/Urlaub/logo.svg')}`, {headers: {authorization: `Bearer ${loginData.token}`}});
  const mediaInfoData = await mediaInfo.json();
  assert(mediaInfo.ok && mediaInfoData.mimeType === 'image/svg+xml' && mediaInfoData.extension === 'svg', 'Dateiinformationen enthielten keinen MIME-Typ oder keine Endung');
  assert(mediaInfoData.media?.streams?.some(stream => stream.codec === 'svg'), 'Technische Medienanalyse erkannte die SVG-Spur nicht');

  const wordSearch = await fetch(`${base}/search?path=${encodeURIComponent('/@/manual-smoke')}&q=report&kind=word&scan=1`, {headers: {authorization: `Bearer ${loginData.token}`}});
  const wordData = await wordSearch.json();
  assert(wordSearch.ok && wordData.items?.length === 1 && wordData.items[0].name === 'report.docx', 'Rekursive Word-Suche fand die verschachtelte Datei nicht');

  const textPreview = await fetch(`${base}/text-preview?path=${encodeURIComponent('/@/manual-smoke/Dokumente/Archiv/notes.txt')}`, {headers: {authorization: `Bearer ${loginData.token}`}});
  const textPreviewData = await textPreview.json();
  assert(textPreview.ok && textPreviewData.text === 'FilePilot text preview' && textPreviewData.truncated === false, 'Geschützte Textvorschau lieferte nicht den erwarteten Inhalt');

  const firstChange = await fetch(`${base}/auth/change-password`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${loginData.token}`},
    body: JSON.stringify({currentPassword: 'admin', newPassword: 'smoke-password-one'})
  });
  const firstChangeData = await firstChange.json();
  assert(firstChange.ok && firstChangeData.token, 'Erster Passwortwechsel fehlgeschlagen');

  const secondChange = await fetch(`${base}/auth/change-password`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${firstChangeData.token}`},
    body: JSON.stringify({currentPassword: 'smoke-password-one', newPassword: 'smoke-password-two'})
  });
  assert(secondChange.ok, 'Atomarer zweiter Passwortwechsel fehlgeschlagen');

  console.log('Smoke-Test bestanden: Health, Auth, ZIP-Sammlung, Papierkorb, Wiederherstellung, endgültiges Löschen, Live-Suchfortschritt, Transferfortschritt, sichere speicherübergreifende Kopie, rekursive Bildersuche, sichere SVG-Vorschau, Medienmetadaten, Textvorschau, Fundpfade und Passwortwechsel');
} finally {
  child.kill();
  await rm(appData, {recursive: true, force: true});
  await rm(fileRoot, {recursive: true, force: true});
  await rm(externalRoot, {recursive: true, force: true});
}
