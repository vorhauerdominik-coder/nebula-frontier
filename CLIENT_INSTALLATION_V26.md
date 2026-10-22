# Nebula Frontier V26 – installierbarer Client

## Handy (Android)
Spiel über die HTTPS-Render-Adresse in Chrome öffnen, auf **CLIENT INSTALLIEREN** klicken. Falls kein Dialog erscheint: Browsermenü → **App installieren** / **Zum Startbildschirm hinzufügen**.

## iPhone/iPad
In Safari öffnen → Teilen → **Zum Home-Bildschirm**. Apple zeigt nicht auf allen Versionen einen Installationsdialog.

## PC (ohne EXE)
In Chrome oder Edge Spiel öffnen → **CLIENT INSTALLIEREN** oder Installationssymbol in der Adressleiste. Läuft dann im eigenen App-Fenster.

## Optional: Windows-EXE selbst bauen
Das Verzeichnis `desktop-client` ist ein Electron-Clientprojekt, **keine fertige EXE**.
1. Node.js LTS auf dem Windows-PC installieren.
2. `cd desktop-client`
3. `npm install`
4. **Wichtig:** Die öffentliche Render-URL in `desktop-client/main.js` prüfen. Alternativ `NEBULA_SERVER_URL` als Umgebungsvariable setzen.
5. `npm run build:win`
6. Installer in `desktop-client/dist/` suchen.

Der Electron-Client verbindet sich zum bestehenden Online-Server; er enthält keinen eigenen Spielserver und kann nicht offline spielen.
Für macOS/Linux gibt es die Skripte `build:mac` / `build:linux` (Build am jeweiligen Betriebssystem empfohlen).
PWA-Installation braucht HTTPS (localhost ist die Ausnahme).
Die Service-Worker-Caches enthalten nur statische Assets; WebSocket-Verbindungen und Login bleiben online.
