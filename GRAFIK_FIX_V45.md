# Nebula Frontier V45 – Grafik-Fix

Behebt `Uncaught TypeError: Cannot read properties of undefined (reading '0')` in `drawNebulaBackdrop`.

Ursache: Kartenkennungen ohne numerische Endung führten zu `NaN` als Index der Hintergrund-Farbpalette. Dadurch brach die gesamte Canvas-Zeichnung ab. Jetzt gibt es einen sicheren Standardwert.

Enthält auch den NPC-Spawn-Endlosschleifen-Fix aus V44.

ZIP entpacken und alle Dateien ins GitHub-Repository hochladen. Anschließend Render deployen.
