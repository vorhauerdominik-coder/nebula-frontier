const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 3000);
// Set SERVER_HZ=30 or SERVER_HZ=60 in Render environment variables or locally.
// The physics simulation and network snapshots use independent schedules.
const SERVER_HZ = Number(process.env.SERVER_HZ) === 60 ? 60 : 30;
const TICK_MS = 1000 / SERVER_HZ;
const SNAPSHOT_MS = 1000 / SERVER_HZ;

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
  goliath: { name: "Goliath", price: 90000, currency: "uridium", hp: 356000, nanoHull: 356000, shield: 310, speed: 300, lasers: 15, generators: 15, extra: 3, cargo: 1500, damage: 39, color: "#5ee7ff" },
  leviathan: { name: "Leviathan X", price: 4000, hp: 300, shield: 250, speed: 165, damage: 34, color: "#ff6caa" }
};
// V36 Galaxy Gates: server-authoritative energy, assembly, waves and rewards.
const GATE_DEFS={alpha:{name:"Alpha",parts:34,waves:5,enemyHp:120,rewardUri:800,rewardXp:1500},beta:{name:"Beta",parts:48,waves:7,enemyHp:240,rewardUri:1600,rewardXp:3000},gamma:{name:"Gamma",parts:82,waves:9,enemyHp:400,rewardUri:3200,rewardXp:6000},delta:{name:"Delta",parts:128,waves:11,enemyHp:650,rewardUri:5500,rewardXp:10000},hades:{name:"Hades",parts:45,waves:10,enemyHp:800,rewardUri:4500,rewardXp:9000,group:true}};
const GATE_PART_CHANCE=0.30;
function ensureGates(p){p.galaxyGates ||= {};for(const [id,def] of Object.entries(GATE_DEFS)){const g=p.galaxyGates[id] ||= {parts:0,completed:0,ready:0,run:null};g.parts=Math.max(0,Math.min(def.parts,Math.floor(Number(g.parts)||0)));g.ready=Math.max(0,Math.floor(Number(g.ready)||0));g.completed=Math.max(0,Math.floor(Number(g.completed)||0));g.placed=Boolean(g.placed);}p.gateEnergy=Math.max(0,Math.floor(Number(p.gateEnergy)||0));}
// V39: Hades party membership is authoritative and kept in server memory.
const hadesParties=new Map();
const hadesInvites=new Map();
function onlinePilot(name){return [...sessions.values()].find(ss=>ss.profile?.username===name);}
function hadesPartyOf(name){return [...hadesParties.values()].find(g=>g.members.includes(name));}
function hadesView(p){const party=hadesPartyOf(p.username);return {party:party?{leader:party.leader,members:party.members,started:party.started}:null,invites:(hadesInvites.get(p.username)||[]).filter(x=>hadesParties.has(x))};}
function partyBroadcast(party,text){for(const name of party.members){const ss=onlinePilot(name);if(ss)for(const [ws,session] of sessions)if(session===ss){send(ws,{type:'notice',text});sendProfile(ws);}}}
function moveToHades(ss,owner){const p=ss.profile,old=p.map,arena=ensureGateArena(owner,'hades');p.map=arena;p.x=1100;p.y=1220;saveSession(ss);for(const [ws,session] of sessions)if(session===ss){send(ws,{type:'mapChanged',map:arena});sendProfile(ws);sendState(ws);}broadcast({type:'presence',map:old,players:onlineSnapshot(old)});}
function playerPortals(p){const list=portalList(p.map);if(gateArenaInfo(p.map))return [{id:"gate_exit",to:homeMap(p.faction),name:"Zurück zur Heimatbasis X1",x:1100,y:1450,active:true}];if(p.map!==`${({astra:"a",vortex:"v",helix:"h"}[p.faction]||p.map[0])}x1`)return list;ensureGates(p);const party=hadesPartyOf(p.username);if(party?.started&&party.leader!==p.username)list.push({id:'hades_party_join',to:p.map,name:'Hades-Gruppe beitreten',x:Math.round(MAPS[p.map].width*.32)+500,y:Math.round(MAPS[p.map].height*.48),active:true});return list.concat(Object.entries(p.galaxyGates).filter(([id,g])=>(g.placed||g.run)).map(([id,g],i)=>({id:`galaxy_${id}`,to:p.map,name:`${GATE_DEFS[id].name} Galaxy Gate`,gate:id,x:Math.round(MAPS[p.map].width*.32)+i*115,y:Math.round(MAPS[p.map].height*.48),active:true})));}
function gateView(p){ensureGates(p);return {energy:p.gateEnergy,defs:GATE_DEFS,gates:p.galaxyGates};}
const LASER_TYPES={
 x1:{name:"X1",mult:1,price:50,amount:100},
 x2:{name:"X2",mult:2,price:160,amount:100},
 x3:{name:"X3",mult:3,price:70,uridiumPrice:70,amount:100},
 x4:{name:"X4",mult:4,uridiumPrice:115,amount:100},
 x6:{name:"X6",mult:6,uridiumPrice:210,amount:100},
 sab:{name:"SAB",mult:1,uridiumPrice:95,amount:100,shieldDrain:true}
};
const ROCKET_TYPES={
 plt2020:{name:"PLT-2020",damage:35,price:160,amount:10},
 plt2023:{name:"PLT-2023",damage:65,price:320,amount:10},
 plt2026:{name:"PLT-2026",damage:105,uridiumPrice:85,amount:10},
 plt3030:{name:"PLT-3030",damage:175,uridiumPrice:150,amount:10}
};
const CPU_ITEMS=[
 {id:"cpu_rocket",name:"AUTO-Raketen-CPU",price:1800,desc:"Automatischer Einzelschuss alle 2,5 Sekunden auf nahe Gegner. Extra: Zielsuche bis 550 Einheiten."},
 {id:"cpu_launcher",name:"AUTO-Launcher-CPU",uridiumPrice:650,desc:"Automatische 3er/5er-Launchersalven alle 5 Sekunden. Extra: Priorisiert stärkere Gegner."}
];
const LAUNCHERS={
 launcher3:{name:"3er-Raketenlauncher",slots:3,price:2000},
 launcher5:{name:"5er-Raketenlauncher",slots:5,uridiumPrice:900}
};
const LASER_MARKET=Object.entries(LASER_TYPES).map(([id,v])=>({id:"laser_"+id,name:v.name+" Laser-Munition × "+v.amount,amount:v.amount,price:v.price,uridiumPrice:v.uridiumPrice,desc:v.shieldDrain?"Entzieht gegnerische Schilde und lädt deine auf":v.mult+"× Laser-Grundschaden"}));
const ROCKET_MARKET=Object.entries(ROCKET_TYPES).map(([id,v])=>({id:"rocket_"+id,name:v.name+" × "+v.amount,amount:v.amount,price:v.price,uridiumPrice:v.uridiumPrice,desc:v.damage+" Schaden je Rakete"}));
const LAUNCHER_MARKET=Object.entries(LAUNCHERS).map(([id,v])=>({id,name:v.name,price:v.price,uridiumPrice:v.uridiumPrice,desc:"Salve mit "+v.slots+" Raketen, 4 Sekunden Nachladezeit"}));

const PREMIUM_ITEMS=[
 {id:"elite_cells",name:"Elite-Laserzellen × 100",uridiumPrice:75,amount:100,desc:"Exklusive Munitionsreserve"},
 {id:"quantum_rockets",name:"Quantenraketen × 20",uridiumPrice:110,amount:20,desc:"Hochwertige Raketenmunition"},
 {id:"premium_repair",name:"Premium-Reparatur × 10",uridiumPrice:60,amount:10,desc:"Schnelle Reparaturversorgung"},
 {id:"premium_boost",name:"Elite-Schadensbooster (30 Min.)",uridiumPrice:150,duration:1800,desc:"+20 % Schaden für 30 Minuten"}
];
const PREMIUM_BY_ID=Object.fromEntries(PREMIUM_ITEMS.map(i=>[i.id,i]));
const MARKET = {
 ammo:[
  {id:"pulse_cells",name:"Pulszellen × 100",price:90,amount:100,desc:"Spezialmunition für den Puls-Laser"},
  {id:"plasma_cells",name:"Plasmazellen × 50",price:230,amount:50,desc:"Verstärkte Plasmamunition"},
  {id:"piercing_cells",name:"Panzerbrecher × 40",price:320,amount:40,desc:"Hoher Bonus gegen Gegner"}
 ],
 resources:[
  {id:"ore",name:"Nebulium-Erz × 10",price:130,amount:10,desc:"Rohstoff für spätere Herstellung"},
  {id:"crystals",name:"Quantenkristalle × 5",price:210,amount:5,desc:"Seltener Hangar-Rohstoff"},
  {id:"alloy",name:"Titanlegierung × 5",price:180,amount:5,desc:"Material für Schiffstechnik"}
 ],
 boosters:[
  {id:"damage_boost",name:"Schadensbooster",price:650,duration:900,desc:"+20 % Laserschaden für 15 Minuten"},
  {id:"speed_boost",name:"Antriebsbooster",price:500,duration:900,desc:"+15 % Tempo für 15 Minuten"},
  {id:"xp_boost",name:"XP-Booster",price:550,duration:900,desc:"+25 % XP für 15 Minuten"}
 ],
 rockets:[
  {id:"rocket_basic",name:"Nova-Raketen × 10",price:160,amount:10,desc:"30 zusätzlicher Schaden pro Rakete"},
  {id:"rocket_heavy",name:"Titan-Raketen × 10",price:350,amount:10,desc:"65 zusätzlicher Schaden pro Rakete"},
  {id:"rocket_emp",name:"EMP-Raketen × 5",price:390,amount:5,desc:"90 zusätzlicher Schaden pro Rakete"}
 ],
 weapons:[
  {id:"cannon",name:"Schwere Kanone",price:500,desc:"Kaufbare Primärwaffe"},
  {id:"plasma",name:"Plasma-Laser",price:1300,desc:"Kaufbare Primärwaffe"}
 ],
 equipment:[
  {id:"repair_kit",name:"Reparatur-Kit × 3",price:170,amount:3,desc:"Repariert 70 Hüllenpunkte"},
  {id:"shield_cell",name:"Schildzelle × 3",price:180,amount:3,desc:"Lädt 80 Schildpunkte"},
  {id:"warp_charge",name:"Warp-Ladung × 2",price:250,amount:2,desc:"Reserveenergie für spätere Systeme"}
 ]
};
MARKET.equipment.push(CPU_ITEMS[0]);PREMIUM_ITEMS.push(CPU_ITEMS[1]);PREMIUM_BY_ID.cpu_launcher=CPU_ITEMS[1];
MARKET.ammo.push(...LASER_MARKET.filter(i=>i.price!==undefined));
MARKET.rockets.push(...ROCKET_MARKET.filter(i=>i.price!==undefined));
MARKET.equipment.push(...LAUNCHER_MARKET.filter(i=>i.price!==undefined));
PREMIUM_ITEMS.push(...LASER_MARKET.filter(i=>i.uridiumPrice!==undefined),...ROCKET_MARKET.filter(i=>i.uridiumPrice!==undefined),...LAUNCHER_MARKET.filter(i=>i.uridiumPrice!==undefined));
for(const item of PREMIUM_ITEMS)PREMIUM_BY_ID[item.id]=item;
const MARKET_ITEMS=Object.fromEntries(Object.values(MARKET).flat().map(i=>[i.id,i]));
// V31: Permanent equipment is separate from consumable ammunition.
const EQUIPMENT={laser_lf4:{name:"LF-4 Ultra-Elite-Laser",kind:"lasers",maxDamage:200,lootOnly:true},laser_mk1:{name:"LF-1 Laser",kind:"lasers",price:350},laser_mk2:{name:"LF-2 Laser",kind:"lasers",price:1100},laser_lf3:{name:"LF-3 Laserkanone",kind:"lasers",uridiumPrice:10000,maxDamage:175},generator_shield:{name:"SG-1 Schildgenerator",kind:"generators",price:420},generator_speed:{name:"GT-1 Antrieb",kind:"generators",price:580},extra_repair:{name:"Reparaturmodul",kind:"extras",price:700}};
const EQUIPMENT_KINDS=["lasers","generators","extras"];
function equipmentSlots(ship,kind){return Math.max(0,Math.min(30,Number(ship[kind]??({lasers:8,generators:8,extras:2}[kind]))));}
function ensureLoadouts(p){
 p.equipmentInventory ||= {};
 if(!p.loadouts||typeof p.loadouts!=="object")p.loadouts={};
 for(const id of ["1","2"]){
  const load=p.loadouts[id] ||= {};
  for(const kind of EQUIPMENT_KINDS){if(!Array.isArray(load[kind]))load[kind]=[];load[kind]=load[kind].filter(v=>v===null||EQUIPMENT[v]?.kind===kind).slice(0,30);}
 }
 p.activeLoadout=["1","2"].includes(String(p.activeLoadout))?String(p.activeLoadout):"1";
}
function equippedCount(p,id){return Object.values(p.loadouts||{}).reduce((n,l)=>n+EQUIPMENT_KIN.reduce((a,k)=>a+(l[k]||[]).filter(v=>v===id).length,0),0);}
const START_INVENTORY={pulse_cells:250,plasma_cells:0,piercing_cells:0,rocket_basic:3,rocket_heavy:0,rocket_emp:0,repair_kit:2,shield_cell:2};
function initializeInventory(p){
 p.laserAmmo ||= "x1";p.rocketAmmo ||= "plt2020";p.launcher ||= null;
 p.cpus ||= {rocket:false,launcher:false};p.cpuEnabled ||= {rocket:false,launcher:false};
p.inventory ||= {...START_INVENTORY};p.boosters ||= {};p.weapons ||= {pulse:1,cannon:0,plasma:0};}
function activeBooster(p,id){return Number(p.boosters?.[id]||0)>Date.now();}
const MAX_DRONES = 8;
const dronePrice = count => 200 * (count + 1);
const FACTIONS=["Astra","Vortex","Helix"];
const FACTION_PREFIX={Astra:"a",Vortex:"v",Helix:"h"};
const PREFIX_FACTION={a:"Astra",v:"Vortex",h:"Helix"};
const MAPS={};
const COLORS={a:["#071a34","#12223b","#171331","#122c36","#25162f","#122d30","#301c30","#0a1d3b"],v:["#241026","#321b30","#251528","#361b28","#30172b","#261632","#31132c","#28132b"],h:["#122b23","#12382d","#1a2e23","#16352f","#21392b","#10332d","#27382d","#13302b"]};
for(const [prefix,faction] of Object.entries(PREFIX_FACTION))for(let n=1;n<=8;n++){
 MAPS[`${prefix}x${n}`]={name:`${faction} X${n}`,width:2600+n*160,height:1900+n*100,minLevel:1,tint:COLORS[prefix][n-1],danger:n,faction};
}
for(let n=1;n<=3;n++)MAPS[`z${n}`]={name:["Nebelpassage Z1","Trümmergürtel Z2","Void-Grenze Z3"][n-1],width:3000,height:2200,minLevel:1,tint:["#222139","#222b34","#301932"][n-1],danger:5+n,neutral:true};
// V38: Instanced, playable Galaxy Gate arenas. Each owner has an isolated arena.
function gateArenaId(owner,id){return `gg_${owner}_${id}`;}
function gateArenaInfo(map){const match=/^gg_([A-Za-z0-9_]{3,18})_(alpha|beta|gamma|delta|hades)$/.exec(map||"");return match?{owner:match[1],id:match[2]}:null;}
function ensureGateArena(owner,id){const map=gateArenaId(owner,id);if(!MAPS[map])MAPS[map]={name:`${GATE_DEFS[id].name} Galaxy Gate`,width:2200,height:1600,minLevel:1,tint:{alpha:"#081e37",beta:"#231331",gamma:"#2a1721",delta:"#1d133c",hades:"#133529"}[id],danger:8,gateArena:true};return map;}
function spawnGateWave(owner,id){const map=ensureGateArena(owner,id);const session=[...sessions.values()].find(x=>x.profile?.username===owner);const g=session?.profile?.galaxyGates?.[id];if(!g?.run)return;for(const [key,n] of npcs)if(n.map===map)npcs.delete(key);
 const def=GATE_DEFS[id],wave=g.run.wave,count=Math.min(9,2+Math.ceil(wave/2));g.run.remaining=count;
 for(let i=0;i<count;i++){const hp=Math.round(def.enemyHp*(1+(wave-1)*.22));const a=i*Math.PI*2/count;const npc={id:"gate-npc-"+nextId++,map,x:1100+Math.cos(a)*470,y:800+Math.sin(a)*340,hp,maxHp:hp,shield:Math.round(hp*.35),maxShield:Math.round(hp*.35),faction:"Gate",kind:wave===def.waves?"sentinel":wave>def.waves/2?"raider":"interceptor",damage:Math.round(8+wave*2),reward:0,fire:1.8,target:null,gateOwner:owner,gateId:id};npcs.set(npc.id,npc);}
 for(const [ws,ss] of sessions)if(ss.profile?.map===map)sendState(ws);
}
function finishGateNpc(n){const info=gateArenaInfo(n.map);if(!info)return false;const ss=[...sessions.values()].find(x=>x.profile?.username===info.owner),p=ss?.profile,g=p?.galaxyGates?.[info.id];if(!g?.run)return true;
 g.run.remaining=Math.max(0,(g.run.remaining||1)-1);if(g.run.remaining>0)return true;
 const def=GATE_DEFS[info.id];if(g.run.wave<def.waves){g.run.wave++;saveSession(ss);for(const [ws,session] of sessions)if(session===ss)sendProfile(ws);setTimeout(()=>spawnGateWave(info.owner,info.id),1800);for(const [ws,s] of sessions)if(s.profile?.map===n.map)send(ws,{type:"notice",text:`${def.name}: Welle ${g.run.wave}/${def.waves} beginnt!`});}
 else{g.run=null;g.completed++;const party=info.id==='hades'?hadesParties.get(info.owner):null;const recipients=party?.started?party.members:[info.owner];for(const name of recipients){const rs=onlinePilot(name);if(!rs)continue;const rp=rs.profile;if(rp.map!==n.map)continue;rp.uridium+=def.rewardUri;rp.xp+=def.rewardXp;rp.credits+=def.rewardUri*2;levelUp(rp);saveSession(rs);for(const [ws,session] of sessions)if(session===rs)sendProfile(ws);}if(party){party.started=false;party.members=[party.leader];partyBroadcast(party,'Hades abgeschlossen! Gruppe kann neu aufgebaut werden.');}for(const [ws,s] of sessions)if(s.profile?.map===n.map)send(ws,{type:"notice",text:`${def.name} abgeschlossen! +${def.rewardUri} Uridium und +${def.rewardXp} XP. Nutze das Ausgangsportal.`});}
 return true;}
const LEGACY_MAPS={frontier:"x1",asteroid:"x3",nebula:"x6"};
const homeMap=faction=>(FACTION_PREFIX[faction]||"a")+"x1";
function migrateMap(map,faction){
 if(MAPS[map])return map;
 const legacy=LEGACY_MAPS[map]||map;
 if(/^x[1-8]$/.test(legacy))return (FACTION_PREFIX[faction]||"a")+legacy;
 return homeMap(faction);
}
// Fixed star-system graph: home sectors X1 and X8; branching routes and neutral corridors.
const SYSTEM_EDGES=[
 ["1","2"],["2","3"],["2","4"],["3","5"],["3","6"],
 ["4","6"],["4","7"],["5","7"],["5","8"],["6","7"],["7","8"]
];
function portalList(mapId){
 const m=MAPS[mapId];if(!m)return[];
 const destinations=[];
 if(/^z[1-3]$/.test(mapId)){
  const z=Number(mapId[1]);
  if(z>1)destinations.push(`z${z-1}`);
  if(z<3)destinations.push(`z${z+1}`);
  for(const prefix of Object.keys(PREFIX_FACTION))destinations.push(`${prefix}x${z===1?4:z===2?6:7}`);
 }else{
  const prefix=mapId[0],n=mapId.slice(2);
  for(const [u,v] of SYSTEM_EDGES)if(u===n||v===n)destinations.push(`${prefix}x${u===n?v:u}`);
  if(n==="4")destinations.push("z1");
  if(n==="6")destinations.push("z2");
  if(n==="7")destinations.push("z3");
 }
 return destinations.map((to,i)=>({
  id:`jump_${i}`,to,active:true,
  x: i%2===0?135:m.width-135,
  y: Math.round(m.height*(.18+(Math.floor(i/2)+1)*.16)% (m.height-250))+125
 }));
}
const sessions = new Map();
const players = new Map();
const npcs = new Map();
const projectiles = new Map();
const bonusBoxes = new Map();
let nextId = 1;
const BOXES_PER_MAP = 9;
const PIRATE_BOXES_PER_MAP = 3;
const PIRATE_RESPAWN_MS = 120000;
const BOOTY_KEY_PRICE = 6400;
const LF4_DROP_CHANCE = 0.005;
const pirateBoxes = new Map();
function spawnPirateBox(map){const m=MAPS[map];if(!m)return;const id="pirate-"+nextId++;pirateBoxes.set(id,{id,map,x:100+Math.random()*(m.width-200),y:100+Math.random()*(m.height-200)});}
function pirateBoxesOnMap(map){return [...pirateBoxes.values()].filter(b=>b.map===map).map(({id,x,y})=>({id,x,y}));}
const BOX_RESPAWN_MS = 18000;
const BOX_LOOT = [
  {kind:"credits", amounts:[10,15,20,25,35,50], weight:34},
  {kind:"uridium", amounts:[1,2,3,4,5], weight:12},
  {kind:"laser_x1", amounts:[10,15,20,30,40], weight:19},
  {kind:"laser_x2", amounts:[5,10,15,20], weight:10},
  {kind:"laser_x3", amounts:[3,5,8,10], weight:5},
  {kind:"rocket_plt2020", amounts:[1,2,3,4], weight:12},
  {kind:"rocket_plt2023", amounts:[1,2,3], weight:6},
  {kind:"rocket_plt2026", amounts:[1,2], weight:2}
];
function spawnBonusBox(map){
  const m=MAPS[map];if(!m)return;
  const id="box-"+nextId++;
  bonusBoxes.set(id,{id,map,x:100+Math.random()*(m.width-200),y:100+Math.random()*(m.height-200)});
}
function boxesOnMap(map){return [...bonusBoxes.values()].filter(b=>b.map===map).map(({id,x,y})=>({id,x,y}));}
function rollBoxLoot(){
  const total=BOX_LOOT.reduce((n,l)=>n+l.weight,0);let r=Math.random()*total;
  const chosen=BOX_LOOT.find(l=>(r-=l.weight)<0)||BOX_LOOT[0];
  return {kind:chosen.kind,amount:chosen.amounts[Math.floor(Math.random()*chosen.amounts.length)]};
}
for(const map of Object.keys(MAPS))for(let i=0;i<BOXES_PER_MAP;i++)spawnBonusBox(map);
for(const map of Object.keys(MAPS))for(let i=0;i<PIRATE_BOXES_PER_MAP;i++)spawnPirateBox(map);

let lastTick = Date.now();
let boss = { name:"Void Titan", id: "boss-1", x: 1200, y: 850, hp: 1800, maxHp: 1800, alive: true, respawnAt: 0, fire: 1.8 };

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
    username, faction, credits: 300, uridium: 0, xp: 0, level: 1, kills: 0,
    ship: "scout", drones: 0, ownedShips: ["scout"], weapons: { pulse: 1, cannon: 0, plasma: 0 },
    upgrades: { damage: 0, shield: 0, armor: 0, drone: 0 }, map: homeMap(faction), x: 1200, y: 850,
    hp: 100, shield: 80, quest: { kills: 0, boss: false, claimed: false },
    inventory: {...START_INVENTORY,laser_x1:300,rocket_plt2020:10}, laserAmmo:"x1",rocketAmmo:"plt2020",launcher:null, boosters: {}, createdAt: new Date().toISOString()
  };
}
function cleanProfile(p) {
  ensureGates(p);
  const ship = SHIPS[p.ship] || SHIPS.scout;
  return {
    username: p.username, faction: p.faction, credits: p.credits, uridium:Math.max(0,Math.floor(Number(p.uridium)||0)), xp: p.xp, level: p.level,
    kills: p.kills, drones: Math.max(0,Math.min(MAX_DRONES,Number(p.drones)||0)), ship: p.ship, ownedShips: p.ownedShips, weapons: p.weapons, upgrades: p.upgrades,
    map: p.map, x: p.x, y: p.y, hp: Math.min(p.hp, ship.hp + (p.upgrades.armor||0) * 25),
    shield: Math.min(p.shield, ship.shield + p.upgrades.shield * 15), quest: p.quest,
    galaxyGates:gateView(p),hadesParty:hadesView(p),bootyKeys:Math.max(0,Math.floor(Number(p.bootyKeys)||0)),inventory:p.inventory||{},equipmentInventory:p.equipmentInventory||{},loadouts:p.loadouts||{},activeLoadout:p.activeLoadout||"1",equipmentCatalog:EQUIPMENT,boosters:p.boosters||{},market:{...MARKET,premium:PREMIUM_ITEMS},
    laserAmmo:p.laserAmmo||"x1",rocketAmmo:p.rocketAmmo||"plt2020",launcher:p.launcher||null,cpus:p.cpus,cpuEnabled:p.cpuEnabled
  };
}
function send(ws, data) {
  if(ws.readyState!==WebSocket.OPEN)return;
  // Do not queue stale snapshots for a client with a slow connection.
  if(data.type==="state"&&ws.bufferedAmount>256*1024)return;
  ws.send(JSON.stringify(data));
}
function broadcast(data, except = null) {
  for (const [ws, session] of sessions) if (ws !== except && session.profile?.map === data.map) send(ws, data);
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
    type: "state", serverHz:SERVER_HZ, self: cleanProfile(p),
    players: onlineSnapshot(p.map),
    npcs: [...npcs.values()].filter(n => n.map === p.map).map(n => ({...n})),
    projectiles: [...projectiles.values()].filter(q => q.map === p.map).map(q => ({...q})),
    boss: p.map === "z3" ? boss : null,
    portals:playerPortals(p),bonusBoxes:boxesOnMap(p.map),pirateBoxes:pirateBoxesOnMap(p.map),
    autoCpu:{rocket:{readyAt:(sessions.get(ws)?.lastAutoRocket||0)+2500},launcher:{readyAt:(sessions.get(ws)?.lastAutoLauncher||0)+5000}},
    serverTime: Date.now()
  });
}
function systemChat(text, map) { broadcast({ type: "chat", channel: "system", text, map, at: Date.now() }); }
function makeNpc(map) {
  const m = MAPS[map];
  const id = "npc-" + nextId++;
  const sector=Number(map.slice(1)),bossGuard=sector>=6;
  const kinds=["scout","interceptor","raider","sentinel"];
  const kind=sector>=7?"sentinel":kinds[Math.min(3,Math.floor((sector-1)/2))];
  const hp=55+sector*18+(kind==="sentinel"?95:0);
  npcs.set(id, { id, map, x: Math.random()*m.width, y: Math.random()*m.height, hp, maxHp:hp, shield:Math.round(hp*.45), maxShield:Math.round(hp*.45), faction: bossGuard?"Rogue":"NPC", kind, damage:5+sector*3, reward:15+sector*12, fire: 1+Math.random()*2, target:null });
}
for (const map of Object.keys(MAPS)) for (let i=0;i=((/^.x[18]$/.test(map))?0:map==="z3"?10:map.startsWith("z")?9:10);i++) makeNpc(map);
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
    p.weapons ||= {pulse:1,cannon:0};p.weapons.plasma ||= 0;
    p.upgrades ||= {damage:0,shield:0};p.upgrades.armor ||= 0;p.upgrades.drone ||= 0;
    p.ownedShips ||= ["scout"];ensureLoadouts(p);p.drones ||= 0;p.uridium=Math.max(0,Math.floor(Number(p.uridium)||0));initializeInventory(p);
    if(gateArenaInfo(p.map)){const gi=gateArenaInfo(p.map);ensureGateArena(gi.owner,gi.id);if(gi.owner!==p.username||!p.galaxyGates?.[gi.id]?.run)p.map=homeMap(p.faction);}p.map=migrateMap(p.map,p.faction);
    p.x=Math.max(30,Math.min(MAPS[p.map].width-30,Number(p.x)||1200));
    p.y=Math.max(30,Math.min(MAPS[p.map].height-30,Number(p.y)||850));
    // Prevent duplicate active sessions for the same account.
    for (const [other, os] of sessions) if (os.profile?.username === username) { send(other,{type:"error",text:"Dein Account wurde an anderer Stelle angemeldet."}); other.close(); }
    const id = "p-" + nextId++;
    sessions.set(ws, { id, profile: p, lastShot: 0, lastMove: Date.now() });
    players.set(id, { id, profile: p, ws });
    if(gateArenaInfo(p.map)&&![...npcs.values()].some(n=>n.map===p.map))spawnGateWave(p.username,gateArenaInfo(p.map).id);send(ws, { type:"authenticated", self:cleanProfile(p), ships:SHIPS, maps:MAPS, players:onlineSnapshot(p.map), npcs:[...npcs.values()].filter(n=>n.map===p.map), boss:p.map==="z3"?boss:null,portals:playerPortals(p),bonusBoxes:boxesOnMap(p.map),pirateBoxes:pirateBoxesOnMap(p.map) });
    broadcast({type:"presence",map:p.map,players:onlineSnapshot(p.map)});
    systemChat(`${username} ist dem Sektor beigetreten.`, p.map);
    return;
  }
  if (!session?.profile) return sendError(ws, "Bitte zuerst anmelden.");
  const p = session.profile;
  const ship = SHIPS[p.ship] || SHIPS.scout;
  if(msg.type==="ping"){
    const seq=Number(msg.seq);
    if(Number.isSafeInteger(seq)&&seq>=0)send(ws,{type:"pong",seq});
    return;
  }
  if(msg.type==='hadesCreate'){
    if(hadesPartyOf(p.username))return sendError(ws,'Du bist bereits in einer Hades-Gruppe.');
    if(p.map!==homeMap(p.faction))return sendError(ws,'Erstelle die Gruppe auf X1.');
    hadesParties.set(p.username,{leader:p.username,members:[p.username],started:false});sendProfile(ws);return;
  }
  if(msg.type==='hadesInvite'){
    const party=hadesParties.get(p.username),name=String(msg.username||'').trim();
    if(!party||party.started)return sendError(ws,'Nur der Gruppenleiter kann vor dem Start einladen.');
    if(party.members.length>=5)return sendError(ws,'Gruppe ist voll.');
    const target=onlinePilot(name);if(!target||target.profile.faction!==p.faction||target.profile.map!==homeMap(p.faction)||name===p.username)return sendError(ws,'Pilot muss online, derselben Fraktion und auf X1 sein.');
    if(hadesPartyOf(name))return sendError(ws,'Pilot ist schon in einer Gruppe.');
    const invites=hadesInvites.get(name)||[];if(!invites.includes(p.username))invites.push(p.username);hadesInvites.set(name,invites);
    for(const [w,ss] of sessions)if(ss===target){sendProfile(w);send(w,{type:'notice',text:`Hades-Einladung von ${p.username} erhalten! In der Kommandozentrale annehmen.`});}return;
  }
  if(msg.type==='hadesAccept'){
    const leader=String(msg.leader||''),invites=hadesInvites.get(p.username)||[],party=hadesParties.get(leader);
    if(!invites.includes(leader)||!party||party.started||party.members.length>=5||hadesPartyOf(p.username)||p.map!==homeMap(p.faction)||onlinePilot(leader)?.profile.faction!==p.faction)return sendError(ws,'Einladung nicht mehr gültig.');
    party.members.push(p.username);hadesInvites.delete(p.username);partyBroadcast(party,`${p.username} ist der Hades-Gruppe beigetreten.`);return;
  }
  if(msg.type==='hadesLeave'){
    const party=hadesPartyOf(p.username);if(!party||party.started)return sendError(ws,'Während des laufenden Gates kann die Gruppe nicht verlassen werden.');
    if(party.leader===p.username)hadesParties.delete(p.username);else party.members=party.members.filter(x=>x!==p.username);
    sendProfile(ws);if(party.leader!==p.username)partyBroadcast(party,`${p.username} hat die Gruppe verlassen.`);return;
  }
  if(msg.type==="buyGateEnergy"){
    const count=Number(msg.count||1);if(!Number.isInteger(count)||count<1||count>100)return sendError(ws,"1 bis 100 Energie pro Kauf.");
    if(p.uridium<count*100)return sendError(ws,"Nicht genug Uridium.");
    ensureGates(p);p.uridium-=count*100;p.gateEnergy+=count;saveSession(session);sendProfile(ws);return;
  }
  if(msg.type==="spinGate"){
    ensureGates(p);const id=String(msg.gate||"");const def=GATE_DEFS[id];if(!def)return sendError(ws,"Unbekanntes Gate.");
    const count=Number(msg.count||1);if(!Number.isInteger(count)||count<1||count>100||p.gateEnergy<count)return sendError(ws,"Nicht genug Gate-Energie.");
    const g=p.galaxyGates[id];let gained=0;
    for(let i=0;i<count;i++){if(Math.random()<GATE_PART_CHANCE&&g.parts<def.parts){g.parts++;gained++;}}
    p.gateEnergy-=count;saveSession(session);sendProfile(ws);send(ws,{type:"notice",text:`${def.name}: ${gained} neue Teile aus ${count} Spins.`});return;
  }
  if(msg.type==="assembleGate"){
    ensureGates(p);const id=String(msg.gate||"");const def=GATE_DEFS[id];if(!def)return sendError(ws,"Unbekanntes Gate.");const g=p.galaxyGates[id];
    if(g.parts<def.parts)return sendError(ws,"Noch nicht alle Portalteile gesammelt.");
    g.parts=0;g.ready++;saveSession(session);sendProfile(ws);return;
  }
  if(msg.type==="placeGate"){
    ensureGates(p);const id=String(msg.gate||"");const def=GATE_DEFS[id];if(!def)return sendError(ws,"Unbekanntes Gate.");const g=p.galaxyGates[id];
    if(g.parts<def.parts&&g.ready<1)return sendError(ws,"Sammle zuerst alle Portalteile.");
    if(g.placed)return sendError(ws,"Gate steht bereits auf deiner X1-Heimatmap.");
    if(g.ready<1){g.parts=0;g.ready++;}
    g.placed=true;saveSession(session);sendProfile(ws);sendState(ws);send(ws,{type:"notice",text:`${def.name} wurde auf deiner X1-Heimatmap platziert!`});return;
  }
  if(msg.type==="startGate"){
    ensureGates(p);const id=String(msg.gate||"");const def=GATE_DEFS[id];if(!def)return sendError(ws,"Unbekanntes Gate.");const g=p.galaxyGates[id];
    if(g.run)return sendError(ws,"Dieses Gate läuft bereits.");if(!g.placed)return sendError(ws,"Platziere das Gate zuerst auf X1.");if(p.map!==`${({astra:"a",vortex:"v",helix:"h"}[p.faction]||p.map[0])}x1`)return sendError(ws,"Starte das Gate auf deiner X1-Heimatmap.");if(g.ready<1)return sendError(ws,"Du musst das Gate zuerst zusammensetzen.");
    if(def.group){const party=hadesParties.get(p.username);if(!party||party.members.length<2||party.members.length>5||party.members.some(name=>onlinePilot(name)?.profile.map!==p.map))return sendError(ws,"Hades benötigt eine eingeladene Gruppe mit 2–5 Piloten auf X1.");}
    g.ready--;g.placed=false;g.run={wave:1,hp:def.enemyHp,started:Date.now(),lastHit:0};saveSession(session);sendProfile(ws);return;
  }
  if(msg.type==="attackGate"){
    ensureGates(p);const id=String(msg.gate||"");const def=GATE_DEFS[id];if(!def)return sendError(ws,"Unbekanntes Gate.");const g=p.galaxyGates[id],r=g.run;if(!r)return sendError(ws,"Gate ist nicht aktiv.");if(gateArenaInfo(p.map))return sendError(ws,"Bekämpfe die NPCs direkt auf der Gate-Karte.");
    const now=Date.now();if(now-r.lastHit<1200)return sendError(ws,"Waffen laden nach.");r.lastHit=now;
    const load=p.loadouts?.[p.activeLoadout||"1"]?.lasers||[];const firepower=load.reduce((n,item)=>n+(item==="laser_lf4"?200:item==="laser_lf3"?175:item==="laser_mk2"?85:item==="laser_mk1"?45:0),0);
    const damage=Math.max(35,Math.floor((SHIPS[p.ship]?.damage||12)+firepower));r.hp=Math.max(0,r.hp-damage);
    if(r.hp===0){if(r.wave<def.waves){r.wave++;r.hp=Math.round(def.enemyHp*(1+(r.wave-1)*0.22));}else{g.run=null;g.completed++;p.uridium+=def.rewardUri;p.xp+=def.rewardXp;p.credits+=def.rewardUri*2;levelUp(p);send(ws,{type:"notice",text:`${def.name} geschafft! +${def.rewardUri} Uridium, +${def.rewardXp} XP.`});}}
    saveSession(session);sendProfile(ws);return;
  }
  if(msg.type==="buyBootyKey"){
    const count=Number(msg.count||1);
    if(!Number.isInteger(count)||count<1||count>10)return sendError(ws,"Ungültige Schlüsselanzahl (1–10).");
    if((p.uridium||0)<BOOTY_KEY_PRICE*count)return sendError(ws,"Nicht genügend Uridium für Booty Keys.");
    p.uridium-=BOOTY_KEY_PRICE*count;p.bootyKeys=(p.bootyKeys||0)+count;
    saveSession(session);saveDb();sendProfile(ws);
    return send(ws,{type:"notice",text:`${count} Booty Key(s) für ${BOOTY_KEY_PRICE*count} Uridium gekauft.`});
  }
  if(msg.type==="openPirateBox"){
    const id=String(msg.id||""),box=pirateBoxes.get(id);
    if(!box||box.map!==p.map)return;
    if(Math.hypot(p.x-box.x,p.y-box.y)>90)return sendError(ws,"Fliege näher an die grüne Piratenbox.");
    if((p.bootyKeys||0)<1)return sendError(ws,"Du brauchst einen Booty Key (im Hangar kaufen).");
    pirateBoxes.delete(id);p.bootyKeys--;
    ensureLoadouts(p);
    let reward;
    if(Math.random()<LF4_DROP_CHANCE){p.equipmentInventory.laser_lf4=(p.equipmentInventory.laser_lf4||0)+1;reward="ULTRA SELTEN: LF-4 Laser erhalten!";}
    else {const uri=10+Math.floor(Math.random()*41);p.uridium=(p.uridium||0)+uri;reward=`+${uri} Uridium`;}
    saveSession(session);saveDb();sendProfile(ws);
    send(ws,{type:"notice",text:`Grüne Piratenbox: ${reward}`});
    broadcast({type:"pirateRemoved",map:p.map,id});
    const map=p.map;
    setTimeout(()=>{spawnPirateBox(map);broadcast({type:"pirateSpawned",map,boxes:pirateBoxesOnMap(map)});},PIRATE_RESPAWN_MS);
    return;
  }
  if(msg.type==="collectBonus"){
    const id=String(msg.id||"");
    const box=bonusBoxes.get(id);
    if(!box||box.map!==p.map)return;
    if(Math.hypot(p.x-box.x,p.y-box.y)>90)return sendError(ws,"Fliege näher an die Bonusbox.");
    // Atomic deletion before reward: only one player can collect a box.
    bonusBoxes.delete(id);
    const loot=rollBoxLoot();
    if(loot.kind==="credits")p.credits+=loot.amount;
    else if(loot.kind==="uridium")p.uridium=(p.uridium||0)+loot.amount;
    else p.inventory[loot.kind]=(p.inventory[loot.kind]||0)+loot.amount;
    saveSession(session);saveDb();sendProfile(ws);
    const names={credits:"Credits",uridium:"Uridium",laser_x1:"X1-Lasermunition",laser_x2:"X2-Lasermunition",laser_x3:"X3-Lasermunition",rocket_plt2020:"PLT-2020 Raketen",rocket_plt2023:"PLT-2023 Raketen",rocket_plt2026:"PLT-2026 Raketen"};
    send(ws,{type:"notice",text:`Bonusbox: +${loot.amount} ${names[loot.kind]}!`});
    broadcast({type:"bonusRemoved",map:p.map,id});
    const map=p.map;
    setTimeout(()=>{spawnBonusBox(map);broadcast({type:"bonusSpawned",map,boxes:boxesOnMap(map)});},BOX_RESPAWN_MS);
    return;
  }
  if (msg.type === "move") {
    const map = MAPS[p.map];
    const x = Number(msg.x), y = Number(msg.y);
    if (!Number.isFinite(x)||!Number.isFinite(y)) return;
    // Server clamps movement to plausible per-message displacement.
    const now=Date.now(), dt=Math.min(.25,Math.max(0,(now-(session.lastMove||now-50))/1000));
    if(dt<.012)return;
    const dx=x-p.x,dy=y-p.y,limit=(ship.speed*(activeBooster(p,"speed_boost")?1.15:1))*dt+3,dist=Math.hypot(dx,dy);
    if(dist>limit){p.x+=dx/dist*limit;p.y+=dy/dist*limit;}else{p.x=x;p.y=y;}
    p.x=Math.max(20,Math.min(map.width-20,p.x));p.y=Math.max(20,Math.min(map.height-20,p.y));session.lastMove=now;
    return;
  }
  if (msg.type === "shoot") {
    const now=Date.now(); if(now-session.lastShot<240)return; session.lastShot=now;
    const angle=Number(msg.angle); if(!Number.isFinite(angle))return;
    const weapon=msg.weapon==="plasma"&&p.weapons.plasma>0?"plasma":p.weapons.cannon>0&&msg.weapon==="cannon"?"cannon":"pulse";
    // Permanent laser damage is based on the currently selected configuration.
    // LF-3 contributes up to 175 base damage per equipped cannon and consumes
    // the same single ammunition unit as the existing shot (not per cannon).
    ensureLoadouts(p);
    const equippedLasers=(p.loadouts[p.activeLoadout]?.lasers||[]).slice(0,equipmentSlots(ship,"lasers"));
    const lf3Count=equippedLasers.filter(id=>id==="laser_lf3").length;
    const lf4Count=equippedLasers.filter(id=>id==="laser_lf4").length;
    const damage=(weapon==="plasma"?Math.floor(ship.damage*1.65):weapon==="cannon"?32:ship.damage)+p.upgrades.damage*4+lf3Count*175+lf4Count*200;
    const selected=LASER_TYPES[p.laserAmmo]&&p.laserAmmo||"x1";
    const ammoType="laser_"+selected;
    const hasLaser=(p.inventory[ammoType]||0)>0;
    const effective=hasLaser?selected:"x1";
    if(hasLaser){p.inventory[ammoType]--;session.ammoDirty=true;}
    const isSab=effective==="sab";
    const finalDamage=Math.round(damage*(isSab?1:LASER_TYPES[effective].mult)*(activeBooster(p,"damage_boost")?1.2:1));
    const id="shot-"+nextId++;
    projectiles.set(id,{id,owner:session.id,username:p.username,faction:p.faction,map:p.map,x:p.x+Math.cos(angle)*24,y:p.y+Math.sin(angle)*24,vx:Math.cos(angle)*(weapon==="plasma"?520:650),vy:Math.sin(angle)*(weapon==="plasma"?520:650),life:1.2,damage:finalDamage,weapon,ammo:effective,shieldDrain:isSab});
    // Purchased support drones only; one extra projectile per owned drone.
    const count=Math.max(0,Math.min(MAX_DRONES,Number(p.drones)||0));
    if(count && now-(session.lastDroneShot||0)>=1100){
      session.lastDroneShot=now;
      for(let i=0;i<count;i++){
        const da=angle,orbit=now*.0016+i*Math.PI*2/count;
        const ox=p.x+Math.cos(orbit)*39,oy=p.y+Math.sin(orbit)*25;
        const did="drone-"+nextId++;
        projectiles.set(did,{id:did,owner:session.id,username:p.username,faction:p.faction,map:p.map,x:ox+Math.cos(da)*22,y:oy+Math.sin(da)*22,vx:Math.cos(da)*690,vy:Math.sin(da)*690,life:1.1,damage:Math.max(2,Math.floor(finalDamage*(.16+(p.upgrades.drone||0)*.045))),weapon:"drone"});
      }
    }
    return;
  }
  if (msg.type === "chat") {
    const text=String(msg.text||"").trim().slice(0,180); if(!text)return;
    broadcast({type:"chat",channel:"player",text,username:p.username,faction:p.faction,map:p.map,at:Date.now()});
    return;
  }
  if (msg.type === "usePortal") {
    const portal=playerPortals(p).find(t=>t.id===msg.id);
    if(portal?.id==='hades_party_join'){
      const party=hadesPartyOf(p.username);if(!party?.started)return sendError(ws,'Keine laufende Hades-Gruppe.');
      if(Math.hypot(p.x-portal.x,p.y-portal.y)>165)return sendError(ws,'Fliege näher an das Gruppenportal.');
      moveToHades(session,party.leader);return;
    }
    if(portal?.gate){const g=p.galaxyGates?.[portal.gate];if(!g?.placed&&!g?.run)return sendError(ws,"Gate nicht platziert.");if(g?.run){const previous=p.map,arena=ensureGateArena(p.username,portal.gate);p.map=arena;p.x=1100;p.y=1220;saveSession(session);send(ws,{type:"mapChanged",map:arena});sendProfile(ws);sendState(ws);broadcast({type:"presence",map:previous,players:onlineSnapshot(previous)});return;}if(Math.hypot(p.x-portal.x,p.y-portal.y)>165)return sendError(ws,"Fliege näher an das Galaxy Gate.");const id=portal.gate,def=GATE_DEFS[id];if(def.group){const party=hadesParties.get(p.username);if(!party||party.members.length<2||party.members.length>5||party.members.some(name=>onlinePilot(name)?.profile.map!==p.map))return sendError(ws,"Hades braucht eine eingeladene Gruppe von 2–5 Spielern auf X1.");}if(g.ready<1||g.run)return sendError(ws,"Gate nicht bereit.");g.ready--;g.placed=false;g.run={wave:1,hp:def.enemyHp,started:Date.now(),lastHit:0};const previous=p.map;const arena=ensureGateArena(p.username,id);p.map=arena;p.x=1100;p.y=1220;saveSession(session);sendProfile(ws);if(id==="hades"){const party=hadesParties.get(p.username);party.started=true;for(const name of party.members){const ss=onlinePilot(name);if(ss&&ss!==session)moveToHades(ss,p.username);}partyBroadcast(party,"Hades gestartet! Kämpft gemeinsam gegen die Wellen.");}spawnGateWave(p.username,id);send(ws,{type:"mapChanged",map:arena});sendState(ws);broadcast({type:"presence",map:previous,players:onlineSnapshot(previous)});send(ws,{type:"notice",text:`${def.name} betreten! Besiege die NPC-Wellen und nutze danach das Ausgangsportal.`});return;}
    if(portal?.id==="gate_exit"){if(Math.hypot(p.x-portal.x,p.y-portal.y)>165)return sendError(ws,"Fliege näher zum Ausgang.");const old=p.map;p.map=homeMap(p.faction);p.x=MAPS[p.map].width/2;p.y=MAPS[p.map].height/2;saveSession(session);send(ws,{type:"mapChanged",map:p.map});sendProfile(ws);sendState(ws);broadcast({type:"presence",map:old,players:onlineSnapshot(old)});return;}
    if(!portal)return sendError(ws,"Unbekanntes Sprungportal.");
    if(Math.hypot(p.x-portal.x,p.y-portal.y)>165)return sendError(ws,"Fliege näher an das Portal (165 Einheiten).");
    if(Date.now()-(session.lastPortal||0)<1800)return;
    session.lastPortal=Date.now();
    const old=p.map,destination=MAPS[portal.to];
    p.map=portal.to;
    p.x=portal.id==="east"?210:portal.id==="west"?destination.width-210:destination.width/2;
    p.y=portal.id==="neutral"?destination.height-230:portal.id.startsWith("gate_")?destination.height/2:destination.height/2;
    saveDb();
    send(ws,{type:"mapChanged",map:p.map});sendState(ws);
    broadcast({type:"presence",map:old,players:onlineSnapshot(old)});
    broadcast({type:"presence",map:p.map,players:onlineSnapshot(p.map)});
    send(ws,{type:"notice",text:`Hyperraumsprung nach ${destination.name} erfolgreich!`});
    return;
  }
  if (msg.type === "switchMap") {
    return sendError(ws,"Nutze die Sprungportale im Sektor, um die Karte zu wechseln.");
  }
  if(msg.type==="toggleCpu"){
    const kind=String(msg.kind||"");
    if(!["rocket","launcher"].includes(kind)||!p.cpus[kind])return sendError(ws,"CPU nicht eingebaut.");
    p.cpuEnabled[kind]=!!msg.enabled;
    saveSession(session);saveDb();sendProfile(ws);
    return send(ws,{type:"notice",text:(kind==="rocket"?"Raketen-CPU":"Launcher-CPU")+(p.cpuEnabled[kind]?" aktiviert.":" deaktiviert.")});
  }
  if(msg.type==="setLoadout"){
    ensureLoadouts(p);
    const id=String(msg.config||"");if(!["1","2"].includes(id))return sendError(ws,"Ungültige Konfiguration.");
    p.activeLoadout=id;saveSession(session);saveDb();sendProfile(ws);return;
  }
  if(msg.type==="buyEquipment"){
    ensureLoadouts(p);
    const id=String(msg.item||""),item=EQUIPMENT[id];if(!item)return sendError(ws,"Unbekanntes Ausrüstungsteil.");
    if(item.lootOnly)return sendError(ws,"LF-4 gibt es nur aus grünen Piratenboxen.");
    if(item.uridiumPrice!==undefined ? p.uridium<item.uridiumPrice : p.credits<item.price)return sendError(ws,item.uridiumPrice!==undefined?"Nicht genügend Uridium.":"Nicht genügend Credits.");
    if((p.equipmentInventory[id]||0)>=100)return sendError(ws,"Inventarlimit erreicht.");
    if(item.uridiumPrice!==undefined)p.uridium-=item.uridiumPrice;else p.credits-=item.price;p.equipmentInventory[id]=(p.equipmentInventory[id]||0)+1;
    saveSession(session);saveDb();sendProfile(ws);return send(ws,{type:"notice",text:item.name+" gekauft."});
  }
  if(msg.type==="equipItem"||msg.type==="unequipItem"){
    ensureLoadouts(p);
    const kind=String(msg.kind||""),slot=Number(msg.slot),load=p.loadouts[p.activeLoadout];
    if(!EQUIPMENT_KIN.includes(kind)||!Number.isInteger(slot)||slot<0||slot>=equipmentSlots(ship,kind))return sendError(ws,"Ungültiger Ausrüstungsplatz.");
    const current=load[kind][slot]||null;
    if(msg.type==="unequipItem"){
      if(!current)return sendError(ws,"Dieser Platz ist leer.");
      load[kind][slot]=null;
    }else{
      const id=String(msg.item||""),item=EQUIPMENT[id];
      if(!item||item.kind!==kind)return sendError(ws,"Dieses Item passt nicht in den Platz.");
      if(Math.max(0,Number(p.equipmentInventory[id])||0)<=equippedCount(p,id))return sendError(ws,"Kein freies Exemplar im Inventar.");
      load[kind][slot]=id;
    }
    saveSession(session);saveDb();sendProfile(ws);return;
  }
  if(msg.type==="selectAmmo"){
    const kind=String(msg.kind||""),id=String(msg.id||"");
    if(kind==="laser"&&LASER_TYPES[id])p.laserAmmo=id;
    else if(kind==="rocket"&&ROCKET_TYPES[id])p.rocketAmmo=id;
    else return sendError(ws,"Unbekannte Munition.");
    saveSession(session);sendProfile(ws);return;
  }
  if(msg.type==="buyPremium"){
    const item=PREMIUM_BY_ID[String(msg.item||"")];
    if(!item)return sendError(ws,"Unbekannter Uridium-Artikel.");
    p.uridium=Math.max(0,Math.floor(Number(p.uridium)||0));
    if(p.uridium<item.uridiumPrice)return sendError(ws,"Nicht genügend Uridium.");
    if(item.id==="cpu_launcher"){
      if(p.cpus.launcher)return sendError(ws,"Launcher-CPU bereits vorhanden.");
      p.cpus.launcher=true;p.cpuEnabled.launcher=true;
    }else if(LAUNCHERS[item.id]){
      if(p.launcher===item.id)return sendError(ws,"Launcher bereits ausgerüstet.");
      p.launcher=item.id;
    }else if(item.duration)p.boosters[item.id]=Math.max(Date.now(),Number(p.boosters[item.id])||0)+item.duration*1000;
    else{
      const current=Math.max(0,Number(p.inventory[item.id])||0);
      if(current+item.amount>999999)return sendError(ws,"Inventargrenze erreicht.");
      p.inventory[item.id]=current+item.amount;
    }
    p.uridium-=item.uridiumPrice;saveSession(session);saveDb();sendProfile(ws);
    send(ws,{type:"notice",text:`${item.name} für ${item.uridiumPrice} Uridium gekauft.`});return;
  }
  if (msg.type === "buyMarket") {
    const id=String(msg.item||"");const item=MARKET_ITEMS[id];
    if(!item)return sendError(ws,"Unbekannter Shop-Artikel.");
    if(p.credits<item.price)return sendError(ws,"Nicht genügend Credits.");
    if(id==="cpu_rocket"){
      if(p.cpus.rocket)return sendError(ws,"Raketen-CPU bereits vorhanden.");
      p.cpus.rocket=true;p.cpuEnabled.rocket=true;
    }else if(LAUNCHERS[id]){
      if(p.launcher===id)return sendError(ws,"Launcher bereits ausgerüstet.");
      p.launcher=id;
    }else if(id==="cannon"||id==="plasma"){
      if(p.weapons[id])return sendError(ws,"Diese Waffe besitzt du bereits.");
      p.weapons[id]=1;
    }else if(item.duration){
      p.boosters[id]=Math.max(Date.now(),Number(p.boosters[id])||0)+item.duration*1000;
    }else{
      const existing=Number(p.inventory[id]||0);
      if(existing+item.amount>999999)return sendError(ws,"Inventargrenze erreicht.");
      p.inventory[id]=existing+item.amount;
    }
    p.credits-=item.price;saveSession(session);saveDb();sendProfile(ws);
    send(ws,{type:"notice",text:`Gekauft: ${item.name} (-${item.price} Credits)`});return;
  }
  if (msg.type === "useItem") {
    const id=String(msg.item||"");
    if(!["repair_kit","shield_cell"].includes(id))return sendError(ws,"Dieses Item kann nicht direkt benutzt werden.");
    if(!(p.inventory[id]>0))return sendError(ws,"Kein Item vorhanden.");
    p.inventory[id]--;
    if(id==="repair_kit")p.hp=Math.min(ship.hp+(p.upgrades.armor||0)*25,p.hp+70);
    else p.shield=Math.min(ship.shield+(p.upgrades.shield||0)*15,p.shield+80);
    saveSession(session);saveDb();sendProfile(ws);return;
  }
  if (msg.type === "fireRocket") {
    const now=Date.now(),angle=Number(msg.angle);
    if(!Number.isFinite(angle))return;
    const kind=ROCKET_TYPES[msg.rocket]?msg.rocket:(p.rocketAmmo||"plt2020");
    const rocket=ROCKET_TYPES[kind],ammoId="rocket_"+kind;
    if(!rocket)return sendError(ws,"Unbekannte Rakete.");
    if(!(p.inventory[ammoId]>0))return sendError(ws,"Keine "+rocket.name+" vorhanden.");
    const slots=LAUNCHERS[p.launcher]?.slots||1;
    const cooldown=slots>1?4000:1300;
    if(now-(session.lastRocket||0)<cooldown)return;
    const count=Math.min(slots,p.inventory[ammoId]);
    p.inventory[ammoId]-=count;session.lastRocket=now;
    for(let i=0;i<count;i++){
      const offset=(i-(count-1)/2)*.085,ang=angle+offset,id="rocket-"+nextId++;
      projectiles.set(id,{id,owner:session.id,username:p.username,faction:p.faction,map:p.map,
        x:p.x+Math.cos(ang)*24,y:p.y+Math.sin(ang)*24,
        vx:Math.cos(ang)*400,vy:Math.sin(ang)*400,life:1.8,damage:rocket.damage,weapon:"rocket",rocket:kind});
    }
    saveSession(session);saveDb();sendProfile(ws);return;
  }
  if (msg.type === "buyShip") {
    const id=String(msg.ship||""), def=SHIPS[id]; if(!def)return sendError(ws,"Unbekanntes Schiff.");
    if(p.ownedShips.includes(id)) { if(p.ship===id)return sendError(ws,"Dieses Schiff ist bereits ausgerüstet."); }
    else { if(def.currency==="uridium"){if(p.uridium<def.price)return sendError(ws,"Nicht genug Uridium.");p.uridium-=def.price;}else{if(p.credits<def.price)return sendError(ws,"Nicht genug Credits.");p.credits-=def.price;}p.ownedShips.push(id); }
    p.ship=id;p.hp=def.hp+(p.upgrades.armor||0)*25;p.shield=def.shield+p.upgrades.shield*15;saveDb();sendProfile(ws);send(ws,{type:"notice",text:`Schiff ${def.name} ausgerüstet.`});return;
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
    if(["damage","shield","armor","drone"].includes(kind)){
      const level=p.upgrades[kind]||0,price=(kind==="drone"?250:kind==="armor"?200:150)*(level+1);
      if(p.credits<price)return sendError(ws,"Nicht genug Credits.");
      if(level>=8)return sendError(ws,"Maximales Upgrade-Level erreicht.");
      p.credits-=price;p.upgrades[kind]=level+1;
      if(kind==="armor")p.hp=Math.min(SHIPS[p.ship].hp+p.upgrades.armor*25,p.hp+25);
      if(kind==="shield")p.shield=Math.min(SHIPS[p.ship].shield+p.upgrades.shield*15,p.shield+30);
      saveDb();sendProfile(ws);send(ws,{type:"notice",text:`Upgrade gekauft: ${({damage:"Waffenschaden",shield:"Schildtechnik",armor:"Panzerung",drone:"Drohnenlaser"})[kind]} ${level+1}. Stufe`});return;
    }
    if(kind==="plasma"){
      if(p.weapons.plasma)return sendError(ws,"Plasma-Laser bereits gekauft.");
      if(p.credits<1300)return sendError(ws,"Plasma-Laser kostet 1.300 Credits.");
      p.credits-=1300;p.weapons.plasma=1;saveDb();sendProfile(ws);
      send(ws,{type:"notice",text:"Plasma-Laser freigeschaltet (Taste 5)."});return;
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
    p.quest.claimed=true;p.credits+=250;p.uridium=(p.uridium||0)+30;p.xp+=100;levelUp(p);saveDb();sendProfile(ws);send(ws,{type:"notice",text:"Quest abgeschlossen: +250 Credits, +30 Uridium, +100 XP"});return;
  }
  if (msg.type === "attackBoss") {
    if(p.map!=="z3")return sendError(ws,"Der Boss befindet sich in der Void-Grenze Z3.");
    if(!boss.alive)return sendError(ws,"Der Boss wird gerade neu aufgebaut.");
    // Boss damage is applied by nearby shots only; this action simply acknowledges.
    return;
  }
  if (msg.type === "save") { saveDb(); return send(ws,{type:"notice",text:"Spielstand gespeichert."}); }
}
function levelUp(p){while(p.xp>=p.level*100){p.xp-=p.level*100;p.level++;p.credits+=50;}}
// Server-authoritative floating combat text for everyone in the same arena.
function combatFloat(map,x,y,amount,kind="damage") {
  const value=Math.round(Math.max(0,Number(amount)||0));
  if(!value)return;
  for(const session of sessions.values())if(session.profile?.map===map)
    send(session.ws,{type:"combatFloat",map,x,y,amount:value,kind});
}
function applyShieldHullDamage(p,amount){
  const beforeShield=Math.max(0,p.shield||0),beforeHp=Math.max(0,p.hp||0);
  const absorbed=Math.min(beforeShield,amount);
  p.shield=beforeShield-absorbed;
  p.hp=Math.max(0,beforeHp-Math.max(0,amount-absorbed));
  return {shield:absorbed,hull:beforeHp-p.hp};
}
function damageNpc(n, q) {
  if(q.shieldDrain){
    const owner=players.get(q.owner);
    if(owner){
      const p=owner.profile,cap=SHIPS[p.ship].shield+(p.upgrades.shield||0)*15;
      const stolen=Math.min(Math.max(0,n.shield||0),Math.max(0,q.damage),Math.max(0,cap-p.shield));
      n.shield=Math.max(0,(n.shield||0)-stolen);p.shield+=stolen;combatFloat(n.map,n.x,n.y,stolen,"shield");
      if(stolen>0){saveSession(sessions.get(owner.ws));sendProfile(owner.ws);}
    }
    return;
  }
  let damage=q.damage;
  if((n.shield||0)>0){const absorbed=Math.min(n.shield,damage);n.shield-=absorbed;damage-=absorbed;}
  n.hp-=damage;
  combatFloat(n.map,n.x,n.y,q.damage,"damage");
  if(n.hp<=0){
    const owner=players.get(q.owner);
    if(owner){const p=owner.profile;p.credits+=n.reward||25;p.uridium=(p.uridium||0)+(Number(n.map.slice(1))>=5?2:1);p.xp+=Math.round((15+Number(n.map.slice(1))*7)*(activeBooster(p,"xp_boost")?1.25:1));p.kills++;if(!p.quest.claimed)p.quest.kills++;levelUp(p);saveSession(sessions.get(owner.ws));send(owner.ws,{type:"reward",credits:p.credits,uridium:p.uridium,xp:p.xp,level:p.level,kills:p.kills,quest:p.quest});}
    broadcast({type:"npcDestroyed",map:n.map,x:n.x,y:n.y,kind:n.kind,credits:n.reward});
    npcs.delete(n.id);if(!finishGateNpc(n))setTimeout(()=>makeNpc(n.map),4500);
  }
}
function fireCpuRockets(session,kind,now){
 const p=session.profile;
 if(!p||!p.cpuEnabled?.[kind]||!p.cpus?.[kind])return;
 if(kind==="launcher"&&!LAUNCHERS[p.launcher])return;
 const cooldown=kind==="launcher"?5000:2500;
 const key=kind==="launcher"?"lastAutoLauncher":"lastAutoRocket";
 if(now-(session[key]||0)<cooldown)return;
 const ammo=ROCKET_TYPES[p.rocketAmmo]?p.rocketAmmo:"plt2020";
 const ammoId="rocket_"+ammo,stock=Math.max(0,Number(p.inventory[ammoId])||0);
 if(!stock)return;
 const range=kind==="launcher"?650:550;
 const enemies=[...npcs.values()].filter(n=>n.map===p.map&&n.hp>0&&Math.hypot(n.x-p.x,n.y-p.y)<=range);
 if(p.map==="z3"&&boss.alive&&Math.hypot(boss.x-p.x,boss.y-p.y)<=range)
   enemies.push({x:boss.x,y:boss.y,hp:boss.hp,kind:"boss"});
 if(!enemies.length)return;
 enemies.sort((a,b)=>kind==="launcher"?(b.hp-a.hp):Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
 const target=enemies[0],base=Math.atan2(target.y-p.y,target.x-p.x);
 const count=Math.min(stock,kind==="launcher"?LAUNCHERS[p.launcher].slots:1);
 p.inventory[ammoId]-=count;session[key]=now;session.ammoDirty=true;
 for(let i=0;i<count;i++){
  const ang=base+(i-(count-1)/2)*.045,id="auto-"+nextId++;
  projectiles.set(id,{id,owner:session.id,username:p.username,faction:p.faction,map:p.map,
   x:p.x+Math.cos(ang)*24,y:p.y+Math.sin(ang)*24,
   vx:Math.cos(ang)*460,vy:Math.sin(ang)*460,life:1.9,damage:ROCKET_TYPES[ammo].damage,weapon:"rocket",rocket:ammo});
 }
}
// V43: continuous collision detection prevents fast projectiles tunnelling through ships.
function segmentHitsCircle(ax,ay,bx,by,cx,cy,r){
  const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
  const t=len2>0?Math.max(0,Math.min(1,((cx-ax)*dx+(cy-ay)*dy)/len2)):0;
  return Math.hypot(cx-(ax+t*dx),cy-(ay+t*dy))<=r;
}
function tick(){
  const now=Date.now(),dt=Math.min(.05,(now-lastTick)/1000);lastTick=now;
  for(const session of sessions.values())if(session.profile){
    fireCpuRockets(session,"rocket",now);
    fireCpuRockets(session,"launcher",now);
  }
  for(const [id,q] of projectiles){
    const oldX=q.x,oldY=q.y;
    q.x+=q.vx*dt;q.y+=q.vy*dt;q.life-=dt;
    if(q.life<=0){projectiles.delete(id);continue;}
    let hit=false;
    for(const n of npcs.values())if(q.owner!=="npc"&&n.map===q.map&&segmentHitsCircle(oldX,oldY,q.x,q.y,n.x,n.y,20)){damageNpc(n,q);hit=true;break;}
    if(!hit&&q.owner!=="npc"&&boss.alive&&q.map==="z3"&&segmentHitsCircle(oldX,oldY,q.x,q.y,boss.x,boss.y,70)){
      if(!q.shieldDrain){boss.hp-=q.damage;combatFloat(q.map,boss.x,boss.y,q.damage,"damage");}hit=true;
      if(boss.hp<=0){boss.hp=0;boss.alive=false;const owner=players.get(q.owner);if(owner){const p=owner.profile;p.credits+=1200;p.uridium=(p.uridium||0)+80;p.xp+=activeBooster(p,"xp_boost")?625:500;p.quest.boss=true;levelUp(p);saveSession(sessions.get(owner.ws));send(owner.ws,{type:"reward",credits:p.credits,uridium:p.uridium,xp:p.xp,level:p.level,quest:p.quest});send(owner.ws,{type:"notice",text:"BOSS BESIEGT! +1200 Credits, +80 Uridium"});}boss.respawnAt=Date.now()+60000;}
    }
    if(!hit){
      for(const target of players.values()){
        const p=target.profile;
        if(target.id===q.owner||p.map!==q.map||(q.owner!=="npc"&&p.faction===q.faction))continue;
        if(segmentHitsCircle(oldX,oldY,q.x,q.y,p.x,p.y,18)){
          if(q.shieldDrain&&q.owner!=="npc"){
            const stolen=Math.min(Math.max(0,p.shield),q.damage);
            p.shield-=stolen;combatFloat(p.map,p.x,p.y,stolen,"shield");
            const attacker=players.get(q.owner);
            if(attacker&&stolen>0){
              const ap=attacker.profile,cap=SHIPS[ap.ship].shield+(ap.upgrades.shield||0)*15;
              ap.shield=Math.min(cap,ap.shield+stolen);
              saveSession(sessions.get(attacker.ws));
            }
          }else {applyShieldHullDamage(p,q.damage);combatFloat(p.map,p.x,p.y,q.damage,"damage");}
          if(p.hp<=0){p.hp=SHIPS[p.ship].hp+(p.upgrades.armor||0)*25;p.shield=SHIPS[p.ship].shield+p.upgrades.shield*15;p.x=MAPS[p.map].width/2;p.y=MAPS[p.map].height/2;const attacker=players.get(q.owner);if(attacker){attacker.profile.credits+=75;attacker.profile.xp+=50;levelUp(attacker.profile);send(attacker.ws,{type:"notice",text:"PvP-Abschuss! +75 Credits"});saveSession(sessions.get(attacker.ws));}}
          p.lastCombatHit=now;
          saveSession(sessions.get(target.ws));hit=true;break;
        }
      }
    }
    if(hit)projectiles.delete(id);
  }
  // Shield regenerates after 6 seconds without damage, capped by equipped ship.
  for(const pilot of players.values()){
    const p=pilot.profile;
    if(!p||p.hp<=0||now-(p.lastCombatHit||0)<6000)continue;
    const cap=(SHIPS[p.ship]?.shield||80)+(p.upgrades?.shield||0)*15;
    if(p.shield<cap)p.shield=Math.min(cap,p.shield+Math.max(2,cap*.025)*dt);
  }
  if(!boss.alive&&Date.now()>=boss.respawnAt){boss.alive=true;boss.hp=boss.maxHp;}
  // Server-authoritative pursuit: at most six NPCs are assigned to any pilot.
  // Refresh assignments periodically; orbit slots remain stable between updates.
  if(now-(tick.lastNpcTargets||0)>=650){
    tick.lastNpcTargets=now;
    const counts=new Map();
    const pilots=[...players.values()].filter(v=>v.profile?.hp>0);
    for(const n of npcs.values()){
      const candidates=pilots.filter(v=>v.profile.map===n.map&&Math.hypot(v.profile.x-n.x,v.profile.y-n.y)<850)
        .sort((a,b)=>Math.hypot(a.profile.x-n.x,a.profile.y-n.y)-Math.hypot(b.profile.x-n.x,b.profile.y-n.y));
      let selected=null;
      for(const v of candidates)if((counts.get(v.id)||0)<6){selected=v;break;}
      n.target=selected?.id||null;
      if(selected){n.orbitSlot=counts.get(selected.id)||0;counts.set(selected.id,n.orbitSlot+1);}
    }
  }
  // Steer towards evenly distributed orbit positions, with capped velocity.
  for(const n of npcs.values()){
    const target=n.target&&players.get(n.target);
    if(!target||target.profile.map!==n.map)continue;
    const p=target.profile,slot=n.orbitSlot||0;
    const angle=slot*Math.PI/3+now*.00022;
    const radius=125+((slot%2)*20);
    const goalX=p.x+Math.cos(angle)*radius,goalY=p.y+Math.sin(angle)*radius;
    const dx=goalX-n.x,dy=goalY-n.y,dist=Math.hypot(dx,dy);
    if(dist>3){const step=Math.min(dist,Math.min(115,dist*1.7)*dt);
      n.x=Math.max(25,Math.min(MAPS[n.map].width-25,n.x+dx/dist*step));
      n.y=Math.max(25,Math.min(MAPS[n.map].height-25,n.y+dy/dist*step));
    }
  }
  // Sector defenders fire at nearby pilots; server owns damage and shield calculations.
  if(now-(tick.lastNpcFire||0)>2400){
    tick.lastNpcFire=now;
    for(const n of npcs.values()){
      const target=n.target&&players.get(n.target);
      if(!target||target.profile.map!==n.map||Math.hypot(target.profile.x-n.x,target.profile.y-n.y)>350)continue;
      if(!target)continue;
      const p=target.profile,ang=Math.atan2(p.y-n.y,p.x-n.x);
      const id="enemy-"+nextId++;
      projectiles.set(id,{id,owner:"npc",username:"NPC",faction:"NPC",map:n.map,x:n.x,y:n.y,
        vx:Math.cos(ang)*290,vy:Math.sin(ang)*290,life:1.3,damage:n.damage,weapon:"enemy"});
    }
  }
  // Persist ammunition usage periodically, including players who only fight.
  if(now-(tick.lastInventorySave||0)>12000){
    tick.lastInventorySave=now;
    let changed=false;
    for(const session of sessions.values())if(session.ammoDirty){session.ammoDirty=false;saveSession(session);changed=true;}
    if(changed)saveDb();
  }
  // Periodic server snapshots keep remote ships synchronized.
  // Exactly one sector-filtered snapshot per 100 ms, rather than timer-modulo jitter.
  if(now-(tick.lastSnapshot||0)>=SNAPSHOT_MS){
    tick.lastSnapshot=now;
    for(const [ws,s] of sessions)if(s.profile)sendState(ws);
  }
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
  send(ws,{type:"hello",message:"Willkommen bei Nebula Frontier MMO",serverHz:SERVER_HZ});
  ws.on("message",raw=>{try{const msg=JSON.parse(raw.toString());onMessage(ws,msg);}catch{sendError(ws,"Ungültige Nachricht.");}});
  ws.on("close",()=>{const s=sessions.get(ws);if(s?.profile){const p=s.profile;saveSession(s);players.delete(s.id);broadcast({type:"presence",map:p.map,players:onlineSnapshot(p.map)});systemChat(`${p.username} hat den Sektor verlassen.`,p.map);saveDb();}sessions.delete(ws);});
});
// Fixed-step scheduling: 30/60 physics steps per second, without multiplying
// movement speed when switching rates. Node timers may drift under load.
setInterval(tick,TICK_MS);
setInterval(()=>{saveDb();},30000);
server.listen(PORT,()=>console.log(`Nebula Frontier MMO läuft auf http://localhost:${PORT} | SERVER_HZ=${SERVER_HZ}`));
