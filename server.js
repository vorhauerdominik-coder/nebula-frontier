const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "players.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}");
let db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

const SHIPS = {
  scout: { name: "Wespe", price: 0, hp: 100, shield: 80, speed: 245, damage: 12, color: "#63eaff" },
  interceptor: { name: "Phantom", price: 450, hp: 125, shield: 100, speed: 285, damage: 15, color: "#8dffb2" },
  destroyer: { name: "Titan", price: 1000, hp: 210, shield: 150, speed: 185, damage: 25, color: "#ffb45c" },
  spectre: { name: "Spectre", price: 1700, hp: 145, shield: 210, speed: 235, damage: 20, color: "#c3a0ff" },
  falcon: { name: "Falcon Mk-II", price: 2400, hp: 175, shield: 175, speed: 265, damage: 23, color: "#ffdc80" },
  leviathan: { name: "Leviathan X", price: 4000, hp: 300, shield: 250, speed: 165, damage: 34, color: "#ff6caa" }
};
const MAX_DRONES = 8;
const dronePrice = count => 200 * (count + 1);
const MAPS = {
  frontier: { name: "Grenzgebiet", width: 2400, height: 1700, minLevel: 1, tint: "#07162d" },
  asteroid: { name: "Asteroidengürtel", width: 2800, height: 1900, minLevel: 2, tint: "#17152b" },
  nebula: { name: "Nebelmeer", width: 3200, height: 2100, minLevel: 4, tint: "#20132e" }
};
const FACTIONS = ["Astra", "Vortex", "Helix"];
const sessions = new Map();
const players = new Map();
const npcs = new Map();
const projectiles = new Map();
let nextId = 1;
let lastTick = Date.now();
let boss = { id: "boss-1", x: 1200, y: 850, hp: 1800, maxHp: 1800, alive: true, respawnAt: 0, fire: 1.8 };

function saveDb() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, record) {
  const actual = crypto.scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function freshProfile(username, faction) {
  return {
    username, faction, credits: 300, xp: 0, level: 1, kills: 0,
    ship: "scout", drones: 0, ownedShips: ["scout"], weapons: { pulse: 1, cannon: 0 },
    upgrades: { damage: 0, shield: 0 }, map: "frontier", x: 1200, y: 850,
    hp: 100, shield: 80, quest: { kills: 0, boss: false, claimed: false },
    createdAt: new Date().toISOString()
  };
}
function cleanProfile(p) {
  const ship = SHIPS[p.ship] || SHIPS.scout;
  return {
    username: p.username, faction: p.faction, credits: p.credits, xp: p.xp, level: p.level,
    kills: p.kills, drones: Math.max(0,Math.min(MAX_DRONES,Number(p.drones)||0)), ship: p.ship, ownedShips: p.ownedShips, weapons: p.weapons, upgrades: p.upgrades,
    map: p.map, x: p.x, y: p.y, hp: Math.min(p.hp, ship.hp + p.upgrades.shield * 10),
    shield: Math.min(p.shield, ship.shield + p.upgrades.shield * 15), quest: p.quest
  };
}
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function broadcast(data, except = null) {
  for (const [ws, session] of sessions) if (ws !== except && session.profile.map === data.map) send(ws, data);
}
function onlineSnapshot(map) {
  return [...players.values()].filter(p => p.profile.map === map).map(p => ({
    id: p.id, username: p.profile.username, faction: p.profile.faction, ship: p.profile.ship,
    x: p.profile.x, y: p.profile.y, drones: Math.max(0,Math.min(MAX_DRONES,Number(p.profile.drones)||0)), hp: p.profile.hp, maxHp: SHIPS[p.profile.ship].hp, level: p.profile.level
  }));
}
function sendState(ws) {
  const s = sessions.get(ws); if (!s) return;
  const p = s.profile;
  send(ws, {
    type: "state", self: cleanProfile(p), ships: SHIPS, maps: MAPS,
    players: onlineSnapshot(p.map),
    npcs: [...npcs.values()].filter(n => n.map === p.map).map(n => ({...n})),
    projectiles: [...projectiles.values()].filter(q => q.map === p.map).map(q => ({...q})),
    boss: p.map === "nebula" ? boss : null,
    serverTime: Date.now()
  });
}
function systemChat(text, map) { broadcast({ type: "chat", channel: "system", text, map, at: Date.now() }); }
function makeNpc(map) {
  const m = MAPS[map];
  const id = "npc-" + nextId++;
  const bossGuard = map === "nebula";
  npcs.set(id, { id, map, x: Math.random()*m.width, y: Math.random()*m.height, hp: bossGuard?100:40, maxHp:bossGuard?100:40, faction: bossGuard?"Rogue":"NPC", kind: bossGuard?"guard":"drone", fire: 1+Math.random()*2, target:null });
}
for (const map of Object.keys(MAPS)) for (let i=0;i<(map==="nebula"?8:14);i++) makeNpc(map);
function profileFor(ws) { const s=sessions.get(ws); return s && s.profile; }
function sendError(ws, text) { send(ws, { type: "error", text }); }
function saveSession(s) { if (s && s.profile) { const p=s.profile; if (db[p.username]) db[p.username].profile=p; } }
function sendProfile(ws) { const s=sessions.get(ws); if(s) send(ws,{type:"profile",profile:cleanProfile(s.profile),ships:SHIPS,maps:MAPS}); }

function onMessage(ws, msg) {
  if (!msg || typeof msg.type !== "string") return;
  const session = sessions.get(ws);
  if (msg.type === "register" || msg.type === "login") {
    if (session?.profile) return sendError(ws, "Du bist bereits angemeldet.");
    const username = String(msg.username || "").trim();
    const password = String(msg.password || "");
    if (!/^[A-Za-z0-9_]{3,18}$/.test(username)) return sendError(ws, "Name: 3–18 Zeichen, nur Buchstaben, Zahlen und _.");
    if (password.length < 8 || password.length > 100) return sendError(ws, "Das Passwort muss mindestens 8 Zeichen lang sein.");
    let record = db[username];
    if (msg.type === "register") {
      if (record) return sendError(ws, "Dieser Name ist bereits vergeben.");
      const creds = hashPassword(password);
      const faction = FACTIONS.includes(msg.faction) ? msg.faction : FACTIONS[Math.floor(Math.random()*FACTIONS.length)];
      record = db[username] = { ...creds, profile: freshProfile(username, faction) };
      saveDb();
    } else {
      if (!record || !verifyPassword(password, record)) return sendError(ws, "Login fehlgeschlagen. Name oder Passwort falsch.");
      record.profile ||= freshProfile(username, FACTIONS[0]);
    }
    const p = record.profile;
    // Prevent duplicate active sessions for the same account.
    for (const [other, os] of sessions) if (os.profile?.username === username) { send(other,{type:"error",text:"Dein Account wurde an anderer Stelle angemeldet."}); other.close(); }
    const id = "p-" + nextId++;
    sessions.set(ws, { id, profile: p, lastShot: 0, lastMove: Date.now() });
    players.set(id, { id, profile: p, ws });
    send(ws, { type:"authenticated", self:cleanProfile(p), ships:SHIPS, maps:MAPS, players:onlineSnapshot(p.map), npcs:[...npcs.values()].filter(n=>n.map===p.map), boss:p.map==="nebula"?boss:null });
    broadcast({type:"presence",map:p.map,players:onlineSnapshot(p.map)});
    systemChat(`${username} ist dem Sektor beigetreten.`, p.map);
    return;
  }
  if (!session?.profile) return sendError(ws, "Bitte zuerst anmelden.");
  const p = session.profile;
  const ship = SHIPS[p.ship] || SHIPS.scout;
  if (msg.type === "move") {
    const map = MAPS[p.map];
    const x = Number(msg.x), y = Number(msg.y);
    if (!Number.isFinite(x)||!Number.isFinite(y)) return;
    // Server clamps movement to plausible per-message displacement.
    const now=Date.now(), dt=Math.min(.25,Math.max(.016,(now-session.lastMove)/1000));
    const dx=x-p.x,dy=y-p.y,limit=(ship.speed+40)*dt+16,dist=Math.hypot(dx,dy);
    if(dist>limit){p.x+=dx/dist*limit;p.y+=dy/dist*limit;}else{p.x=x;p.y=y;}
    p.x=Math.max(20,Math.min(map.width-20,p.x));p.y=Math.max(20,Math.min(map.height-20,p.y));session.lastMove=now;
    return;
  }
  if (msg.type === "shoot") {
    const now=Date.now(); if(now-session.lastShot<240)return; session.lastShot=now;
    const angle=Number(msg.angle); if(!Number.isFinite(angle))return;
    const weapon=p.weapons.cannon>0&&msg.weapon==="cannon"?"cannon":"pulse";
    const damage=(weapon==="cannon"?32:ship.damage)+p.upgrades.damage*4;
    const id="shot-"+nextId++;
    projectiles.set(id,{id,owner:session.id,username:p.username,faction:p.faction,map:p.map,x:p.x+Math.cos(angle)*24,y:p.y+Math.sin(angle)*24,vx:Math.cos(angle)*650,vy:Math.sin(angle)*650,life:1.2,damage,weapon});
    // Purchased support drones only; one extra projectile per owned drone.
    const count=Math.max(0,Math.min(MAX_DRONES,Number(p.drones)||0));
    if(count && now-(session.lastDroneShot||0)>=1100){
      session.lastDroneShot=now;
      for(let i=0;i<count;i++){
        const da=angle,orbit=now*.0016+i*Math.PI*2/count;
        const ox=p.x+Math.cos(orbit)*39,oy=p.y+Math.sin(orbit)*25;
        const did="drone-"+nextId++;
        projectiles.set(did,{id:did,owner:session.id,username:p.username,faction:p.faction,map:p.map,x:ox+Math.cos(da)*22,y:oy+Math.sin(da)*22,vx:Math.cos(da)*690,vy:Math.sin(da)*690,life:1.1,damage:Math.max(2,Math.floor(damage*.16)),weapon:"drone"});
      }
    }
    return;
  }
  if (msg.type === "chat") {
    const text=String(msg.text||"").trim().slice(0,180); if(!text)return;
    broadcast({type:"chat",channel:"player",text,username:p.username,faction:p.faction,map:p.map,at:Date.now()});
    return;
  }
  if (msg.type === "switchMap") {
    const map=MAPS[msg.map]; if(!map)return sendError(ws,"Unbekannte Karte.");
    if(p.level<map.minLevel)return sendError(ws,`Diese Karte benötigt Level ${map.minLevel}.`);
    const old=p.map; p.map=msg.map;p.x=map.width/2;p.y=map.height/2;p.hp=SHIPS[p.ship].hp;p.shield=SHIPS[p.ship].shield;
    saveDb(); send(ws,{type:"mapChanged",map:p.map});sendState(ws);
    broadcast({type:"presence",map:old,players:onlineSnapshot(old)});
    broadcast({type:"presence",map:p.map,players:onlineSnapshot(p.map)});
    return;
  }
  if (msg.type === "buyShip") {
    const id=String(msg.ship||""), def=SHIPS[id]; if(!def)return sendError(ws,"Unbekanntes Schiff.");
    if(p.ownedShips.includes(id)) { if(p.ship===id)return sendError(ws,"Dieses Schiff ist bereits ausgerüstet."); }
    else { if(p.credits<def.price)return sendError(ws,"Nicht genug Credits.");p.credits-=def.price;p.ownedShips.push(id); }
    p.ship=id;p.hp=def.hp;p.shield=def.shield;saveDb();sendProfile(ws);send(ws,{type:"notice",text:`Schiff ${def.name} ausgerüstet.`});return;
  }
  if (msg.type === "buyDrone") {
    const count = Math.max(0,Math.min(MAX_DRONES,Number(p.drones)||0));
    if(count >= MAX_DRONES) return sendError(ws,"Alle acht Drohnenplätze sind bereits belegt.");
    const price=dronePrice(count);
    if(p.credits < price) return sendError(ws,`Die nächste Drohne kostet ${price} Credits.`);
    p.credits-=price;p.drones=count+1;
    saveDb();sendProfile(ws);
    send(ws,{type:"notice",text:`Begleitdrohne ${p.drones}/${MAX_DRONES} gekauft! -${price} Credits`});
    broadcast({type:"presence",map:p.map,players:onlineSnapshot(p.map)});
    return;
  }
  if (msg.type === "buyUpgrade") {
    const kind=String(msg.upgrade||"");
    if(kind==="damage"||kind==="shield"){
      const level=p.upgrades[kind]||0,price=150*(level+1);
      if(p.credits<price)return sendError(ws,"Nicht genug Credits.");
      if(level>=8)return sendError(ws,"Maximales Upgrade-Level erreicht.");
      p.credits-=price;p.upgrades[kind]=level+1;
      if(kind==="shield")p.shield=Math.min(SHIPS[p.ship].shield+p.upgrades.shield*15,p.shield+30);
      saveDb();sendProfile(ws);send(ws,{type:"notice",text:`Upgrade gekauft: ${kind==="damage"?"Waffenschaden":"Schildtechnik"} ${level+1}. Stufe`});return;
    }
    if(kind==="cannon"){
      if(p.weapons.cannon)return sendError(ws,"Schwere Kanone bereits gekauft.");
      if(p.credits<500)return sendError(ws,"Schwere Kanone kostet 500 Credits.");
      p.credits-=500;p.weapons.cannon=1;saveDb();sendProfile(ws);send(ws,{type:"notice",text:"Schwere Kanone freigeschaltet."});return;
    }
  }
  if (msg.type === "claimQuest") {
    if(p.quest.claimed)return sendError(ws,"Diese Quest wurde bereits abgeholt.");
    if(p.quest.kills<5)return sendError(ws,"Questziel: Zerstöre 5 NPC-Drohnen.");
    p.quest.claimed=true;p.credits+=250;p.xp+=100;levelUp(p);saveDb();sendProfile(ws);send(ws,{type:"notice",text:"Quest abgeschlossen: +250 Credits, +100 XP"});return;
  }
  if (msg.type === "attackBoss") {
    if(p.map!=="nebula")return sendError(ws,"Der Boss befindet sich im Nebelmeer.");
    if(!boss.alive)return sendError(ws,"Der Boss wird gerade neu aufgebaut.");
    // Boss damage is applied by nearby shots only; this action simply acknowledges.
    return;
  }
  if (msg.type === "save") { saveDb(); return send(ws,{type:"notice",text:"Spielstand gespeichert."}); }
}
function levelUp(p){while(p.xp>=p.level*100){p.xp-=p.level*100;p.level++;p.credits+=50;}}
function damageNpc(n, q) {
  n.hp-=q.damage;
  if(n.hp<=0){
    const owner=players.get(q.owner);
    if(owner){const p=owner.profile;p.credits+=n.kind==="guard"?45:25;p.xp+=n.kind==="guard"?35:20;p.kills++;if(!p.quest.claimed)p.quest.kills++;levelUp(p);saveSession(sessions.get(owner.ws));send(owner.ws,{type:"reward",credits:p.credits,xp:p.xp,level:p.level,kills:p.kills,quest:p.quest});}
    npcs.delete(n.id);setTimeout(()=>makeNpc(n.map),4500);
  }
}
function tick(){
  const now=Date.now(),dt=Math.min(.05,(now-lastTick)/1000);lastTick=now;
  for(const [id,q] of projectiles){
    q.x+=q.vx*dt;q.y+=q.vy*dt;q.life-=dt;
    if(q.life<=0){projectiles.delete(id);continue;}
    let hit=false;
    for(const n of npcs.values())if(n.map===q.map&&Math.hypot(n.x-q.x,n.y-q.y)<20){damageNpc(n,q);hit=true;break;}
    if(!hit&&boss.alive&&q.map==="nebula"&&Math.hypot(boss.x-q.x,boss.y-q.y)<70){
      boss.hp-=q.damage;hit=true;
      if(boss.hp<=0){boss.hp=0;boss.alive=false;const owner=players.get(q.owner);if(owner){const p=owner.profile;p.credits+=1200;p.xp+=500;p.quest.boss=true;levelUp(p);saveSession(sessions.get(owner.ws));send(owner.ws,{type:"reward",credits:p.credits,xp:p.xp,level:p.level,quest:p.quest});send(owner.ws,{type:"notice",text:"BOSS BESIEGT! +1200 Credits"});}boss.respawnAt=Date.now()+60000;}
    }
    if(!hit){
      for(const target of players.values()){
        const p=target.profile;
        if(target.id===q.owner||p.map!==q.map||p.faction===q.faction)continue;
        if(Math.hypot(p.x-q.x,p.y-q.y)<18){
          if(p.shield>0)p.shield=Math.max(0,p.shield-q.damage);else p.hp=Math.max(0,p.hp-q.damage);
          if(p.hp<=0){p.hp=SHIPS[p.ship].hp;p.shield=SHIPS[p.ship].shield;p.x=MAPS[p.map].width/2;p.y=MAPS[p.map].height/2;const attacker=players.get(q.owner);if(attacker){attacker.profile.credits+=75;attacker.profile.xp+=50;levelUp(attacker.profile);send(attacker.ws,{type:"notice",text:"PvP-Abschuss! +75 Credits"});saveSession(sessions.get(attacker.ws));}}
          saveSession(sessions.get(target.ws));hit=true;break;
        }
      }
    }
    if(hit)projectiles.delete(id);
  }
  if(!boss.alive&&Date.now()>=boss.respawnAt){boss.alive=true;boss.hp=boss.maxHp;}
  // Periodic server snapshots keep remote ships synchronized.
  if(now%100<50)for(const [ws,s] of sessions)if(s.profile)sendState(ws);
}
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml"};
const server=http.createServer((req,res)=>{
  let urlPath=decodeURIComponent((req.url||"/").split("?")[0]);
  if(urlPath==="/")urlPath="/index.html";
  const file=path.normalize(path.join(PUBLIC,urlPath));
  if(!file.startsWith(PUBLIC)){res.writeHead(403);return res.end("Forbidden");}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});return res.end("Not found");}
    res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"});res.end(data);});
});
const wss=new WebSocketServer({server});
wss.on("connection",ws=>{
  sessions.set(ws,{profile:null});
  send(ws,{type:"hello",message:"Willkommen bei Nebula Frontier MMO"});
  ws.on("message",raw=>{try{const msg=JSON.parse(raw.toString());onMessage(ws,msg);}catch{sendError(ws,"Ungültige Nachricht.");}});
  ws.on("close",()=>{const s=sessions.get(ws);if(s?.profile){const p=s.profile;saveSession(s);players.delete(s.id);broadcast({type:"presence",map:p.map,players:onlineSnapshot(p.map)});systemChat(`${p.username} hat den Sektor verlassen.`,p.map);saveDb();}sessions.delete(ws);});
});
setInterval(tick,50);
setInterval(()=>{saveDb();for(const [ws,s] of sessions)if(s.profile)sendState(ws);},1000);
server.listen(PORT,()=>console.log(`Nebula Frontier MMO läuft auf http://localhost:${PORT}`));
