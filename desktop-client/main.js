const {app,BrowserWindow,shell,session}=require('electron');
const GAME_URL=process.env.NEBULA_SERVER_URL||'https://nebula-frontier-mmo.onrender.com';
function validUrl(input){try{const u=new URL(input);return ['https:','http:'].includes(u.protocol)&&(!['http:'].includes(u.protocol)||['localhost','127.0.0.1'].includes(u.hostname));}catch{return false;}}
if(!validUrl(GAME_URL))throw new Error('Ungültige NEBULA_SERVER_URL');
app.whenReady().then(()=>{
 const win=new BrowserWindow({width:1280,height:820,minWidth:800,minHeight:550,backgroundColor:'#071426',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:require('path').join(__dirname,'preload.js')}});
 win.removeMenu();
 win.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith(new URL(GAME_URL).origin)){return {action:'allow',overrideBrowserWindowOptions:{webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}};}if(validUrl(url))shell.openExternal(url);return {action:'deny'};});
 win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==new URL(GAME_URL).origin)event.preventDefault();});
 win.loadURL(GAME_URL);
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
