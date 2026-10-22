# Render-Fix V44

Behebt die Endlosschleife beim NPC-Spawn in `server.js` (fehlendes `<` in der `for`-Bedingung). Diese verursachte beim Serverstart den Heap-Out-of-Memory-Absturz.

Projektdateien wie gewohnt nach GitHub hochladen. Empfohlen: Node.js 22 LTS statt Node 26.
