# Sicherheit

FilePilot verwaltet echte Dateien und sollte wie ein Administrationswerkzeug
behandelt werden.

## Private Meldung

Dieses Repository ist privat. Sicherheitsprobleme bitte nicht in öffentlichen
Issues veröffentlichen, sondern direkt und vertraulich an den Repository-Inhaber
melden. Dabei Version, Plattform, Reproduktionsschritte und mögliche Auswirkungen
angeben; echte Zugangsdaten und Dateiinhalte vorher entfernen.

## Unterstützte Version

Sicherheitskorrekturen werden nur für die jeweils aktuelle Version gepflegt.

## Sichere Bereitstellung

- `APP_PASSWORD` und `TOKEN_SECRET` individuell und stark setzen.
- Das Repository und das Container-Paket privat halten.
- FilePilot nicht ohne HTTPS und zusätzliche Zugriffskontrolle ins Internet stellen.
- Nur benötigte Hostpfade in den Container einbinden; für reine Archive `:ro` nutzen.
- `/config` sichern, weil dort Einstellungen, Anmeldedaten, Verlauf und Papierkorb liegen.
- Container und Abhängigkeiten regelmäßig neu bauen und aktualisieren.
