<div align="center">
  <img src="public/branding/logos/filepilot-logo-dark.svg" alt="FilePilot" width="360">
  <p><strong>Dateien. Klar auf Kurs.</strong></p>
  <p>Ein privater, moderner Dateimanager für Unraid, Docker und Windows.</p>
</div>

> [!IMPORTANT]
> FilePilot besitzt Schreib-, Verschiebe- und Löschzugriff auf alle eingebundenen
> Pfade. Halte Repository und Anwendung privat, verwende starke Zugangsdaten und
> veröffentliche Port `8080` nicht ungeschützt im Internet.

## Portainer auf Unraid – Installation aus dem privaten GitHub-Repository

Dies ist der empfohlene Installationsweg. Portainer lädt das private Repository,
baut das Image mit dem enthaltenen `Dockerfile` und startet den Stack aus
`docker-compose.yml`.

### 1. Privates GitHub-Repository vorbereiten

1. Auf GitHub ein **privates** Repository erstellen, beispielsweise `filepilot`.
2. Dieses Projekt auf den Branch `main` hochladen.
3. Für Portainer einen Fine-grained Personal Access Token erstellen:
   - Repository-Zugriff nur für das FilePilot-Repository
   - Berechtigung **Contents: Read-only**
   - Token sicher kopieren; GitHub zeigt ihn nur einmal an

Der Token gehört ausschließlich in Portainers Repository-Authentifizierung. Er
darf weder in `.env`, `docker-compose.yml` noch in Git eingecheckt werden.

### 2. Stack in Portainer anlegen

In Portainer **Stacks → Add stack → Repository** öffnen und eintragen:

| Portainer-Feld | Wert |
|---|---|
| Name | `filepilot` |
| Repository URL | `https://github.com/DEIN-NAME/filepilot.git` |
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Authentication | aktivieren |
| Username | dein GitHub-Benutzername |
| Personal Access Token | der Read-only-Token aus Schritt 1 |

Falls Portainer die Option anbietet, kann **GitOps updates** aktiviert werden,
damit der Stack regelmäßig den `main`-Branch prüft. Automatische Updates sollten
erst nach einem erfolgreichen Backup von `/config` aktiviert werden.

### 3. Pflichtvariablen in Portainer setzen

Unter **Environment variables** mindestens diese Werte anlegen:

| Name | Empfohlener Wert | Bedeutung |
|---|---|---|
| `APP_PASSWORD` | eigenes Passwort mit mindestens 12 Zeichen | Login für FilePilot |
| `TOKEN_SECRET` | mindestens 32 zufällige Zeichen | Signiert lokale Sitzungen |
| `PUID` | `99` | Unraid-Benutzer `nobody` |
| `PGID` | `100` | Unraid-Gruppe `users` |
| `UMASK` | `0000` | neue Dateien für Unraid beschreibbar |
| `FILEPILOT_PORT` | `8080` | Port im lokalen Netzwerk |
| `MAX_UPLOAD_MB` | `10240` | maximales Upload-Limit in MB |
| `TRASH_ENABLED` | `true` | internen FilePilot-Papierkorb verwenden |

Ein Secret lässt sich auf einem vertrauenswürdigen Rechner erzeugen:

```powershell
# PowerShell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

```bash
# Linux / Unraid-Terminal
openssl rand -base64 48
```

### 4. Zugriff auf alle Unraid-Shares

Der mitgelieferte Stack bindet folgende Hostpfade ein:

```yaml
volumes:
  - /mnt/user:/data:rw
  - /mnt/user/appdata/filepilot:/config:rw
```

- `/mnt/user:/data:rw` stellt FilePilot alle Unraid User-Shares mit Lese- und
  Schreibzugriff bereit.
- `/mnt/user/appdata/filepilot:/config:rw` speichert Einstellungen,
  Authentifizierung, Aktivitätsverlauf und FilePilot-Papierkorb dauerhaft.
- `PUID=99` und `PGID=100` entsprechen der üblichen Unraid-Zuordnung
  `nobody:users`.

Für Unassigned Devices oder andere Pfade eine weitere Bind-Mount-Zeile ergänzen,
zum Beispiel:

```yaml
volumes:
  - /mnt/user:/data:rw
  - /mnt/user/appdata/filepilot:/config:rw
  - /mnt/disks/USB_Backup:/storage/usb-backup:rw
```

Danach in FilePilot unter **Einstellungen → Speicherorte** den Containerpfad
`/storage/usb-backup` hinzufügen. Soll ein Bereich niemals verändert werden,
statt `:rw` einfach `:ro` verwenden.

> [!NOTE]
> FilePilot kann Linux-/Unraid-Dateirechte nicht umgehen. Wenn ein Share trotz
> `:rw` nicht beschreibbar ist, im Unraid-Terminal Eigentümer und Rechte prüfen.
> Niemals pauschal Systemverzeichnisse wie `/`, `/boot` oder `/var/run` einbinden.

### 5. Deploy und Anmeldung

**Deploy the stack** anklicken, den Health-Status abwarten und öffnen:

```text
http://DEINE-UNRAID-IP:8080
```

Anmeldung mit dem in `APP_PASSWORD` gesetzten Passwort. Beim Containerstart
stoppt FilePilot bewusst mit einer klaren Fehlermeldung, wenn Produktionspasswort
oder Token-Secret fehlen bzw. unsicher sind.

### Stack aktualisieren

Änderungen zuerst nach GitHub pushen. Anschließend in Portainer beim Stack
**Pull and redeploy** bzw. **Update the stack** ausführen und das erneute Pullen
des Images/Repositorys aktivieren. `/config` bleibt durch das Volume erhalten.

## Was FilePilot kann

- Ein bis vier Dateibereiche gleichzeitig, mit Browser-artigen Tabs
- Listen- oder Kachelansicht individuell je Bereich
- Automatische Erkennung von Windows-Laufwerken und Docker-/Unraid-Speichern
- Rekursive Suche in allen Unterordnern mit Live-Prozentanzeige
- Schnellfilter für Bilder, Video, Musik, Text/Word, Tabellen/Excel, PDF,
  Archive, Code und Ordner; aktive Filter sind wieder abwählbar
- Vorschau für Bilder inklusive SVG, Video, Audio, PDF, Text, Markdown, Logs,
  JSON und viele Codeformate
- Erweiterte Metadaten für Medien: Codec, Auflösung, Bildrate, Tonspuren,
  Bitrate, Abtastrate, Kanäle und Tags, soweit in der Datei vorhanden
- Kopieren und Verschieben per Toolbar, Kontextmenü, Drag-and-drop oder
  `Strg+C`, `Strg+X` und `Strg+V`
- Transfers mit Prozentwert, Geschwindigkeit und geschätzter Restzeit, während
  die Oberfläche weiter benutzbar bleibt
- Upload, Umbenennen, ZIP-Download, Mehrfachauswahl und `Entf` zum Löschen
- App-eigener Papierkorb mit Wiederherstellen, endgültigem Löschen und Leeren
- Detaillierter Aktivitätsverlauf als eigene Seite
- Favoriten, individuelle Startorte und speicherortspezifischer Schreibschutz
- Responsives, festes App-Layout und branded Login ohne Seiten-Scrollen

## Datenschutz und Sicherheitsmodell

FilePilot läuft vollständig auf deiner eigenen Maschine. Es gibt keinen externen
Cloud-Dienst und keine Telemetrie. Der Container sieht ausschließlich explizit
eingebundene Pfade. Pfadvalidierung, Authentifizierung, Rate Limits,
Sicherheitsheader und der Schutz vor symbolischen Link-Ausbrüchen werden im
Backend erzwungen.

Empfehlungen:

- Nur im vertrauenswürdigen LAN oder hinter einem HTTPS-Reverse-Proxy betreiben.
- Für Zugriff aus dem Internet zusätzlich VPN oder vorgeschaltetes SSO nutzen.
- `/config` regelmäßig sichern.
- Den Unraid-Share-Zugriff nach dem Prinzip der geringsten Rechte einschränken.
- GitHub Dependabot, CodeQL und die CI-Prüfungen aktiviert lassen.

Weitere Hinweise stehen in [SECURITY.md](SECURITY.md).

## Lokal unter Windows entwickeln

Voraussetzung ist Node.js 22 oder neuer. Eine aktuelle LTS-Version wird für die
Entwicklung empfohlen.

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

In `.env` mindestens sichere Werte für `APP_PASSWORD` und `TOKEN_SECRET` setzen.
Vite zeigt die tatsächlich verwendete Frontend-Adresse im Terminal an; das
Backend läuft standardmäßig auf `http://localhost:8080`.

Beim lokalen Start erkennt FilePilot erreichbare Laufwerke wie `C:\`, `D:\` und
`E:\` automatisch. Die App besitzt genau die Rechte des Windows-Kontos, unter
dem Node.js läuft.

## Produktions-Build ohne Docker

```bash
npm ci
npm run build
```

Danach mit gesetzten Produktionsvariablen starten:

```powershell
$env:NODE_ENV = 'production'
$env:APP_PASSWORD = 'DEIN-SEHR-STARKES-PASSWORT'
$env:TOKEN_SECRET = 'DEIN-ZUFAELLIGES-SECRET-MIT-MINDESTENS-32-ZEICHEN'
npm start
```

## Docker Compose ohne Portainer

```bash
cp .env.example .env
# APP_PASSWORD und TOKEN_SECRET in .env ändern
docker compose up -d --build
docker compose ps
```

## Qualität und Release

```bash
npm run ci
npm audit --audit-level=high
```

GitHub Actions prüft TypeScript, Backend-Smoke-Tests, Frontend-Build,
Abhängigkeiten und Docker-Build. CodeQL analysiert JavaScript/TypeScript.
Ein Tag wie `v1.1.0` veröffentlicht zusätzlich ein Multi-Arch-Image nach GHCR.

### Erstmalig zu GitHub hochladen

```bash
git remote add origin https://github.com/DEIN-NAME/filepilot.git
git push -u origin main
```

Vor jedem Push kontrollieren:

```bash
git status
git diff --cached
```

Die Verzeichnisse `.filepilot`, `.agents`, `node_modules`, `dist` und das rohe
Branding-Paket sind absichtlich ausgeschlossen. Zugangsdaten gehören nur in die
lokale `.env` oder in Portainers Environment-Variablen.

## Entwicklungswerkzeuge

Die ausgewählten Codex-Rollen für Frontend, Backend, AppSec, DevOps, Git,
Dokumentation, Tests, Accessibility, UI und Release-Prüfung lassen sich lokal
installieren mit:

```powershell
npm run agents:install
```

Diese Entwicklungsagenten und die lokal installierten Skills sind nicht Teil des
Produktionscontainers.

## Lizenz

**Privat und proprietär – alle Rechte vorbehalten.** Dieses Repository ist nicht
Open Source. Nutzung und Verteilung sind ausschließlich dem Urheber gestattet.
Siehe [LICENSE](LICENSE).
