# Nebula Frontier MMO

Eigenständiges 2D-Space-MMO-Prototyp-Projekt mit Node.js, WebSocket und HTML Canvas.

## Voraussetzungen
- Node.js 18 oder neuer
- Internetzugang beim ersten Installieren der Abhängigkeit `ws`

## Starten
1. Entpacke das ZIP.
2. Öffne ein Terminal in diesem Ordner.
3. Installiere die Abhängigkeit:
   ```bash
   npm install
   ```
4. Starte den Server:
   ```bash
   npm start
   ```
5. Öffne http://localhost:3000 im Browser.
6. Erstelle einen Account. Öffne einen zweiten Browser oder ein privates Fenster, um einen weiteren Piloten zu testen.

## Enthalten
- Registrierung und Login mit Passwort-Hashing (Node.js scrypt)
- Serverseitig gespeicherte Accounts und Profile in `data/players.json`
- Mehrere Karten mit Level-Voraussetzungen
- Drei Fraktionen: Astra, Vortex und Helix
- Mehrere Schiffe, Credits, Shop, Waffen- und Schild-Upgrades
- NPC-Drohnen, PvP gegen Spieler anderer Fraktionen, Boss im Nebelmeer
- Questfortschritt und Belohnungen
- Live-Positionen, Sektor-Piloten und Chat via WebSocket

## Wichtige Hinweise
Dies ist ein lauffähiger **MMO-Prototyp**, kein produktionsreifer öffentlicher MMO-Server. Für einen öffentlichen Betrieb solltest du mindestens HTTPS/WSS, Rate Limits, stärkere serverseitige Bewegungs-/Kampfvalidierung, Datenbankmigrationen, Backups, Moderation, Abuse-Schutz und Monitoring ergänzen. Passwörter werden gehasht, aber es gibt noch keine E-Mail-Verifizierung oder Passwort-Wiederherstellung.

Die Spielstände werden lokal in `data/players.json` gespeichert. Halte den Serverprozess am Laufen, damit Spieler miteinander online sind. Wenn du den Server auf einem VPS hostest, müssen Port 3000 (oder der konfigurierte Port) erreichbar sein; für HTTPS empfiehlt sich ein Reverse Proxy.
