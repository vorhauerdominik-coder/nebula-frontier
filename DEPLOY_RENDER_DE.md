# Online stellen auf Render (Testversion)

## 1. GitHub
1. Melde dich bei https://github.com an und erstelle ein neues Repository namens `nebula-frontier-mmo`.
2. Lade den Inhalt dieses Ordners in das Repository hoch (die Dateien und Ordner direkt, nicht den äußeren ZIP-Ordner).
3. Stelle sicher, dass `server.js`, `package.json`, `render.yaml` und `public/` im Hauptverzeichnis des Repositories liegen.

## 2. Render
1. Öffne https://render.com und melde dich an.
2. Wähle **New + → Blueprint** und verbinde dein GitHub-Konto.
3. Wähle das Repository `nebula-frontier-mmo` und bestätige die Erstellung des Services.
4. Warte, bis der Deploy-Status **Live** anzeigt, und öffne die angezeigte `onrender.com`-Adresse.

## Hinweise
- Der kostenlose Render-Dienst kann nach 15 Minuten ohne eingehenden Traffic einschlafen und beim nächsten Aufruf ungefähr eine Minute zum Aufwachen brauchen.
- Der kostenlose Dienst hat ein flüchtiges Dateisystem. Gespeicherte Spielprofile können bei Neustarts, Redeploys oder dem Einschlafen verloren gehen. Verwende diese Einstellung daher nur zum Ausprobieren, nicht für ein dauerhaftes Spiel mit wichtigen Accounts.
- Der Code wurde auf Syntax geprüft; der vollständige Serverbetrieb und ein öffentlicher Deploy wurden noch nicht end-to-end getestet.
