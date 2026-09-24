const {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,shell,safeStorage}=require("electron");const path=require("path"),fs=require("fs");const {spawn}=require("child_process");let win,tray,engine;const file=()=>path.join(app.getPath("userData"),"settings.json");const secretFile=()=>path.join(app.getPath("userData"),"credentials.bin");const mrpSecretFile=()=>path.join(app.getPath("userData"),"credentials-mrp.bin");const airplaySecretFile=()=>path.join(app.getPath("userData"),"credentials-airplay.bin");const devicesFile=()=>path.join(app.getPath("userData"),"apple-tvs.json");function getDevices(){try{return JSON.parse(fs.readFileSync(devicesFile(),"utf8"))}catch{return[]}}function saveDevices(v){fs.writeFileSync(devicesFile(),JSON.stringify(v,null,2))}function storeCredential(v){if(!v)return;if(!safeStorage.isEncryptionAvailable())throw new Error("Windows credential encryption is unavailable");fs.writeFileSync(secretFile(),safeStorage.encryptString(v))}function loadCredential(){try{return safeStorage.decryptString(fs.readFileSync(secretFile()))}catch{return""}}function storeMrpCredential(v){if(!v)return;if(!safeStorage.isEncryptionAvailable())throw new Error("Windows credential encryption is unavailable");fs.writeFileSync(mrpSecretFile(),safeStorage.encryptString(v))}function loadMrpCredential(){try{return safeStorage.decryptString(fs.readFileSync(mrpSecretFile()))}catch{return""}}function storeAirplayCredential(v){if(!v)return;if(!safeStorage.isEncryptionAvailable())throw new Error("Windows credential encryption is unavailable");fs.writeFileSync(airplaySecretFile(),safeStorage.encryptString(v))}function loadAirplayCredential(){try{return safeStorage.decryptString(fs.readFileSync(airplaySecretFile()))}catch{return""}}function redact(v){return String(v||"").replace(/((?:Credentials?|companion-credentials)\s*[:=]?\s*)[^,\r\n\s]+/gi,"$1[redacted]").replace(/(--companion-credentials\s+)[^\s]+/gi,"$1[redacted]")}function get(){try{return JSON.parse(fs.readFileSync(file(),"utf8"))}catch{return{startWithWindows:false,startMinimized:false,minimizeToTray:true,richPresence:true,artwork:true,timer:true,autoReconnect:true}}}function save(s){fs.writeFileSync(file(),JSON.stringify(s,null,2));app.setLoginItemSettings({openAtLogin:!!s.startWithWindows,openAsHidden:!!s.startMinimized})}function engineEnv(){const s=get();return {...process.env,DISCORD_CLIENT_ID:s.discordClientId||process.env.DISCORD_CLIENT_ID||"1552334405635153970",APPLE_TV_ID:s.appleTvId||"",APPLE_TV_HOST:s.appleTvHost||"",APPLE_TV_VLC_HOST:"",VLC_HOST:s.vlcHost||"",RECONNECT_MS:String(s.reconnectMs||5000),DISCORD_AUTO_RECONNECT:s.autoReconnect===false?"0":"1",SHOW_ARTWORK:s.artwork===false?"0":"1",SHOW_TIMER:s.timer===false?"0":"1",APPLE_TV_CREDENTIALS:loadCredential(),APPLE_TV_MRP_CREDENTIALS:loadMrpCredential(),APPLE_TV_AIRPLAY_CREDENTIALS:loadAirplayCredential(),PYTHON_EXE:(app.isPackaged&&fs.existsSync(path.join(process.resourcesPath,"runtime","bin","atvremote.exe")))?"__BUNDLED_ATVREMOTE__":(process.env.PYTHON_EXE||"python"),ATVREMOTE_EXE:(app.isPackaged?path.join(process.resourcesPath,"runtime","bin","atvremote.exe"):"")}}function startEngine(){if(engine)return;engine=spawn(process.execPath,[path.join(__dirname,"..","src","index.js")],{windowsHide:true,env:{...engineEnv(),ELECTRON_RUN_AS_NODE:"1"},stdio:["ignore","pipe","pipe"]});const send=(channel,value)=>{try{if(win&&!win.isDestroyed()&&win.webContents&&!win.webContents.isDestroyed())win.webContents.send(channel,value)}catch{}};const out=d=>{const t=redact(d.toString());if(t.trim())console.log("[engine]",t.trim());send("engine:log",t)};engine.stdout.on("data",out);engine.stderr.on("data",out);engine.on("close",()=>{engine=null;send("engine:status","stopped")});send("engine:status","running")}function stopEngine(){if(engine){engine.kill();engine=null}}function restartEngine(){stopEngine();setTimeout(startEngine,400)}
function create(){win=new BrowserWindow({width:920,height:680,minWidth:760,minHeight:560,title:"Watching Now on AppleTV",icon:path.join(__dirname,"..","build","icon.png"),webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false}});win.setMenuBarVisibility(false);win.loadFile(path.join(__dirname,"index.html"));win.on("minimize",e=>{if(get().minimizeToTray){e.preventDefault();win.hide()}});win.on("close",e=>{if(!app.isQuitting&&get().minimizeToTray){e.preventDefault();win.hide()}})}function trayIcon(){const iconPath=path.join(__dirname,"..","build","icon.png");if(fs.existsSync(iconPath))return nativeImage.createFromPath(iconPath).resize({width:16,height:16});const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="3" y="6" width="26" height="19" rx="5" fill="#6675ff"/><rect x="7" y="10" width="18" height="11" rx="2" fill="#101522"/></svg>`;return nativeImage.createFromDataURL("data:image/svg+xml;base64,"+Buffer.from(svg).toString("base64")).resize({width:16,height:16})}app.whenReady().then(()=>{create();tray=new Tray(trayIcon());tray.setToolTip("Watching Now on AppleTV");tray.setContextMenu(Menu.buildFromTemplate([{label:"Open Watching Now on AppleTV",click:()=>{win.show();win.focus()}},{type:"separator"},{label:"Exit",click:()=>{app.isQuitting=true;app.quit()}}]));tray.on("click",()=>{win.show();win.focus()});tray.on("double-click",()=>{win.show();win.focus()});if(get().startMinimized)win.hide();startEngine()});app.on("window-all-closed",()=>{});ipcMain.handle("settings:get",()=>get());ipcMain.handle("settings:save",(_,s)=>{save(s);return get()});ipcMain.handle("setup:complete",(_,s)=>{s.setupComplete=true;save(s);restartEngine();return get()});ipcMain.handle("open:website",()=>shell.openExternal("https://benesch.dev"));ipcMain.handle("engine:restart",()=>{restartEngine();return true});ipcMain.handle("engine:status",()=>engine?"running":"stopped");app.on("before-quit",()=>{app.isQuitting=true;stopEngine()});
function atvCommand(args){const bundled=path.join(process.resourcesPath||"","runtime","bin","atvremote.exe");if(app.isPackaged&&fs.existsSync(bundled))return{exe:bundled,args};return{exe:"python",args:["-X","utf8","-m","pyatv.scripts.atvremote",...args]}}function runAtv(args,onLine){return new Promise((resolve,reject)=>{const c=atvCommand(args);const p=spawn(c.exe,c.args,{windowsHide:true,env:{...process.env,PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8"}});let out="",err="";p.stdout.on("data",d=>{const t=d.toString();out+=t;if(onLine)onLine(t)});p.stderr.on("data",d=>{err+=d.toString()});p.on("error",reject);p.on("close",code=>code===0?resolve(out):reject(new Error(redact(err||out||("atvremote exited "+code)).trim())))})}
ipcMain.handle("apple:discover",async()=>{const out=await runAtv(["--scan-protocols","companion","scan"]);const devices=[];let cur=null;for(const raw of out.replace(/\r/g,"").split("\n")){const line=raw.trim();const head=line.match(/^Name:\s*(.+)$/i);if(head){if(cur)devices.push(cur);cur={name:head[1]};continue}if(!cur)continue;let m=line.match(/^Address:\s*(.+)$/i);if(m)cur.host=m[1].trim();m=line.match(/^Identifier:\s*(.+)$/i);if(m)cur.id=m[1].trim();if(/^Identifiers:\s*$/i.test(line))cur._ids=true;else if(cur._ids&&(m=line.match(/^-\s*(.+)$/))) {if(!cur.id)cur.id=m[1].trim()}}if(cur)devices.push(cur);return devices.filter(d=>d.id||d.host)});
let pairing=null,pairingText="",pairingDevice=null,mrpPairing=null,mrpPairingText="";
ipcMain.handle("apple:pair:start",async(_,device)=>{if(pairing)try{pairing.kill()}catch{};pairingDevice=device;pairingText="";return await new Promise((resolve,reject)=>{const rawArgs=[...(device.host?["--scan-hosts",device.host]:[]),"--protocol","companion","pair"];const c=atvCommand(rawArgs);const p=spawn(c.exe,c.args,{windowsHide:true,stdio:["pipe","pipe","pipe"],env:{...process.env,PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8"}});pairing=p;let settled=false;const check=d=>{pairingText+=d.toString();if(!settled&&/PIN|pin|Enter/i.test(pairingText)){settled=true;resolve({ready:true})}};p.stdout.on("data",check);p.stderr.on("data",check);p.on("error",reject);p.on("close",code=>{if(!settled){pairing=null;reject(new Error(redact(pairingText).trim()||("Pairing exited "+code)))}})})});
ipcMain.handle("apple:pair:pin",async(_,pin)=>{if(!pairing?.stdin?.writable)throw new Error("Pairing session is not active");return await new Promise((resolve,reject)=>{let finished=false;const done=()=>{if(finished)return;finished=true;const credential=(pairingText.match(/Credentials:\s*([^\r\n]+)/i)||pairingText.match(/credential[s]?\s*[:=]\s*([^\r\n]+)/i))?.[1]?.trim();if(!credential)return reject(new Error("Pairing completed but no Companion credential was returned"));try{storeCredential(credential);const s=get();s.appleTvId=pairingDevice?.id||s.appleTvId;s.appleTvHost=pairingDevice?.host||s.appleTvHost;s.appleTvName=pairingDevice?.name||s.appleTvName;s.setupComplete=true;save(s);const all=getDevices(),d={id:s.appleTvId,host:s.appleTvHost,name:s.appleTvName};const i=all.findIndex(x=>(x.id&&x.id===d.id)||(x.host&&x.host===d.host));if(i>=0)all[i]=d;else all.push(d);saveDevices(all);pairing=null;restartEngine();resolve({ok:true,device:s.appleTvName||"Apple TV"})}catch(e){reject(e)}};pairing.once("close",code=>code===0?done():reject(new Error(redact(pairingText).trim()||("Pairing failed "+code))));pairing.stdin.write(String(pin).trim()+"\n");pairing.stdin.end()})});

ipcMain.handle("apple:mrp:status",()=>({paired:!!loadMrpCredential()}));
ipcMain.handle("apple:protocols",async()=>{const s=get();const out=await runAtv([...(s.appleTvHost?["--scan-hosts",s.appleTvHost]:[]),"scan"]);return redact(out)});
ipcMain.handle("apple:mrp:pair:start",async()=>{if(mrpPairing)try{mrpPairing.kill()}catch{};const s=get();if(!s.appleTvHost&&!s.appleTvId)throw new Error("Pair/select an Apple TV first");mrpPairingText="";return await new Promise((resolve,reject)=>{const rawArgs=[...(s.appleTvHost?["--scan-hosts",s.appleTvHost]:[]),...(s.appleTvId?["--id",s.appleTvId]:[]),"--protocol","mrp","pair"];const cmd=atvCommand(rawArgs);const p=spawn(cmd.exe,cmd.args,{windowsHide:true,stdio:["pipe","pipe","pipe"],env:{...process.env,PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8"}});mrpPairing=p;let settled=false;const check=d=>{mrpPairingText+=d.toString();if(!settled&&/PIN|pin|Enter/i.test(mrpPairingText)){settled=true;resolve({ready:true})}};p.stdout.on("data",check);p.stderr.on("data",check);p.on("error",reject);p.on("close",code=>{if(!settled){mrpPairing=null;reject(new Error(redact(mrpPairingText)
  .replace(/^.*DeprecationWarning: There is no current event loop.*\r?\n?/gmi,"")
  .replace(/^\s*loop = asyncio\.get_event_loop\(\)\s*\r?\n?/gmi,"")
  .replace(/Traceback[\s\S]*?pyatv\.exceptions\.NoServiceError:\s*no service available for Protocol\.MRP[\s\S]*/i,"MRP is not advertised by this Apple TV.")
  .trim()||("MRP pairing exited "+code)))}})})});
ipcMain.handle("apple:mrp:pair:pin",async(_,pin)=>{if(!mrpPairing?.stdin?.writable)throw new Error("MRP pairing session is not active");return await new Promise((resolve,reject)=>{let finished=false;const done=()=>{if(finished)return;finished=true;const credential=(mrpPairingText.match(/Credentials:\\s*([^\\r\\n]+)/i)||mrpPairingText.match(/credential[s]?\\s*[:=]\\s*([^\\r\\n]+)/i))?.[1]?.trim();if(!credential)return reject(new Error("MRP pairing completed but no credential was returned"));try{storeMrpCredential(credential);mrpPairing=null;restartEngine();resolve({ok:true})}catch(e){reject(e)}};mrpPairing.once("close",code=>code===0?done():reject(new Error(redact(mrpPairingText).trim()||("MRP pairing failed "+code))));mrpPairing.stdin.write(String(pin).trim()+"\\n");mrpPairing.stdin.end()})});
ipcMain.handle("apple:list",()=>({devices:getDevices(),activeId:get().appleTvId||""}));ipcMain.handle("apple:select",(_,d)=>{const s=get();s.appleTvId=d.id||"";s.appleTvHost=d.host||"";s.appleTvName=d.name||"Apple TV";save(s);const all=getDevices(),i=all.findIndex(x=>x.id===d.id);if(i<0){all.push(d);saveDevices(all)}restartEngine();return true});ipcMain.handle("apple:forget",()=>{try{fs.unlinkSync(secretFile())}catch{}try{fs.unlinkSync(mrpSecretFile())}catch{}try{fs.unlinkSync(airplaySecretFile())}catch{}const s=get();const id=s.appleTvId;saveDevices(getDevices().filter(d=>d.id!==id));delete s.appleTvId;delete s.appleTvHost;delete s.appleTvName;s.setupComplete=false;save(s);restartEngine();return true});

ipcMain.handle("apple:nowplaying:probe",async()=>{const s=get();const credential=loadCredential();if(!s.appleTvHost)throw new Error("Select an Apple TV first");if(!credential)throw new Error("Pair the Apple TV first");const script=path.join(__dirname,"..","runtime","companion_nowplaying_probe.py");if(app.isPackaged)throw new Error("Now Playing probe is currently available in developer mode only");return await new Promise((resolve,reject)=>{const p=spawn(process.env.PYTHON_EXE||"python",["-X","utf8",script,"--host",s.appleTvHost,...(s.appleTvId?["--id",s.appleTvId]:[]),"--credentials",credential],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8"}});let out="",err="";p.stdout.on("data",d=>out+=d.toString());p.stderr.on("data",d=>err+=d.toString());p.on("error",reject);p.on("close",code=>{const safeOut=redact(out).trim(),safeErr=redact(err).trim();code===0?resolve(safeOut):reject(new Error(safeErr||safeOut||("Probe exited "+code)))})})});

ipcMain.handle("apple:nowplaying:deep-probe",async()=>{const s=get();const credential=loadCredential();if(!s.appleTvHost)throw new Error("Select an Apple TV first");if(!credential)throw new Error("Pair the Apple TV first");if(app.isPackaged)throw new Error("Deep probe is currently available in developer mode only");const code=[
"import asyncio,json,pyatv,sys",
"async def m():",
" loop=asyncio.get_running_loop()",
" cs=await pyatv.scan(loop,hosts=[sys.argv[1]])",
" c=cs[0]",
" svc=c.get_service(pyatv.const.Protocol.Companion)",
" svc.credentials=sys.argv[2]",
" a=await pyatv.connect(c,loop)",
" try:",
"  objs={'atv':a,'metadata':a.metadata,'apps':a.apps}",
"  out={}",
"  for k,o in objs.items():",
"   out[k]=sorted([n for n in dir(o) if not n.startswith('__') and any(x in n.lower() for x in ('play','media','app','event','dispatch','message','session','protocol','connection')) and not any(x in n.lower() for x in ('credential','password','secret'))])",
"  print(json.dumps(out,indent=2))",
" finally:a.close()",
"asyncio.run(m())"
].join("\n");return await new Promise((resolve,reject)=>{const p=spawn(process.env.PYTHON_EXE||"python",["-X","utf8","-c",code,s.appleTvHost,credential],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8"}});let out="",err="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);p.on("error",reject);p.on("close",code=>code===0?resolve(redact(out).trim()):reject(new Error(redact(err||out||("Probe exited "+code)).trim())))})});

ipcMain.handle("apple:nowplaying:raw",async()=>{const s=get();const credential=loadCredential();if(!s.appleTvHost)throw new Error("Select an Apple TV first");if(!credential)throw new Error("Pair the Apple TV first");if(app.isPackaged)throw new Error("Raw Now Playing probe is currently available in developer mode only");const code=[
"import asyncio,json,pyatv,sys,base64,plistlib",
"def unarchive(v):",
" if not isinstance(v,bytes): return safe(v)",
" try:",
"  p=plistlib.loads(v)",
"  if not isinstance(p,dict) or '$objects' not in p or '$top' not in p:return safe(p)",
"  objs=p['$objects']",
"  def uid(x): return x.data if isinstance(x,plistlib.UID) else x",
"  def dec(x,seen=None):",
"   seen=set() if seen is None else seen",
"   if isinstance(x,plistlib.UID):",
"    i=uid(x)",
"    if i in seen:return '<cycle>'",
"    return dec(objs[i],seen|{i})",
"   if isinstance(x,dict):",
"    out={}",
"    for k,val in x.items():",
"     if k=='$class':continue",
"     dk=dec(k,seen) if isinstance(k,plistlib.UID) else str(k)",
"     out[str(dk)]=dec(val,seen)",
"    return out",
"   if isinstance(x,list):return [dec(y,seen) for y in x]",
"   if isinstance(x,bytes):return {'bytes':len(x),'base64':base64.b64encode(x).decode()}",
"   return x",
"  return dec(p['$top'].get('root'))",
" except Exception as e:return {'decode_error':type(e).__name__+': '+str(e),'raw':safe(v)}",
"def safe(v):",
" if isinstance(v,bytes): return unarchive(v)",
" if isinstance(v,dict): return {str(k):safe(x) for k,x in v.items() if 'credential' not in str(k).lower() and 'password' not in str(k).lower()}",
" if isinstance(v,(list,tuple)): return [safe(x) for x in v]",
" if isinstance(v,(str,int,float,bool)) or v is None:return v",
" return str(v)",
"async def m():",
" loop=asyncio.get_running_loop(); cs=await pyatv.scan(loop,hosts=[sys.argv[1]]); c=cs[0]",
" svc=c.get_service(pyatv.const.Protocol.Companion); svc.credentials=sys.argv[2]",
" a=await pyatv.connect(c,loop)",
" try:",
"  setup=a._protocol_handlers.get(pyatv.const.Protocol.Companion)",
"  api=None",
"  if setup:",
"   interfaces=getattr(setup,'interfaces',{})",
"   if isinstance(interfaces,dict):",
"    for x in interfaces.values():",
"     candidate=getattr(x,'api',None)",
"     if candidate is not None and hasattr(candidate,'_send_command') and hasattr(candidate,'subscribe_event'): api=candidate;break",
"  if api is None: raise RuntimeError('CompanionAPI object not found')",
"  events=[]",
"  def make_cb(name):",
"   async def cb(data): events.append({'event':name,'data':safe(data)})",
"   return cb",
"  names=['NowPlayingInfo']",
"  for n in names:",
"   try: api.listen_to(n,make_cb(n)); await api.subscribe_event(n)",
"   except Exception: pass",
"  responses={}",
"  for cmd in ('FetchCurrentNowPlayingInfoEvent','FetchUpNextInfoEvent'):",
"   try: responses[cmd]=safe(await api._send_command(cmd,{}))",
"   except Exception as e: responses[cmd]={'error':type(e).__name__+': '+str(e)}",
"  await asyncio.sleep(6)",
"  print(json.dumps({'responses':responses,'events':events},ensure_ascii=False,indent=2))",
" finally:a.close()",
"asyncio.run(m())"
].join("\n");return await new Promise((resolve,reject)=>{const p=spawn(process.env.PYTHON_EXE||"python",["-X","utf8","-c",code,s.appleTvHost,credential],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8"}});let out="",err="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);p.on("error",reject);p.on("close",code=>code===0?resolve(redact(out).trim()):reject(new Error(redact(err||out||("Probe exited "+code)).trim())))})});
