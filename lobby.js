import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
const $=id=>document.getElementById(id);
let auth,db,uid=null,room=null,role=null,unsubscribe=null,current=null;
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(){const b=new Uint8Array(8);crypto.getRandomValues(b);return Array.from(b,n=>alphabet[n%alphabet.length]).join('')}
function notice(msg){$('notice').textContent=msg}
function error(e){console.error(e);notice('ERROR: '+(e?.message||String(e)))}
const slots=['host','guest','host2','guest2'];
const slotUid=(r,slot)=>r[slot==='host'?'hostUid':slot==='guest'?'guestUid':slot+'Uid'];
const slotReady=(r,slot)=>!!r[slot==='host'?'hostReady':slot==='guest'?'guestReady':slot+'Ready'];
const sideOf=slot=>slot.startsWith('host')?'STAR LEAGUE':'KO-DAN';
const team=(r,side)=>slots.filter(slot=>slot.startsWith(side)&&!!slotUid(r,slot));
const launchBlockers=r=>{const h=team(r,'host'),g=team(r,'guest'),missing=[];if(!h.length||!g.length||h.length!==g.length)missing.push('NEED EQUAL TEAMS (CURRENTLY '+h.length+' VS '+g.length+')');if(h.length===2&&r.scenario==='swarm')missing.push('SWARM SUPPORTS 1v1 ONLY');for(const slot of [...h,...g])if(!slotReady(r,slot))missing.push((slot==='host'?'GS-01':slot==='host2'?'GS-02':slot==='guest'?'DF-01':'DF-02')+' NOT READY');return missing};
const balanced=r=>launchBlockers(r).length===0;
function show(r){
 current=r;
 const host=team(r,'host'),guest=team(r,'guest'),equal=host.length===guest.length&&host.length>0,blockers=launchBlockers(r),ready=blockers.length===0;
 $('scenarioSettings').hidden=role!=='host';
 $('scenarioChoice').value=r.scenario||'duel';$('lobbyAsteroids').checked=!!r.asteroids;drawAsteroidPreview(!!r.asteroids);
 $('scenarioStatus').textContent=(r.scenario==='swarm'?'KO-DAN SWARM (EXPERIMENTAL)':'GUNSTAR DUEL')+(r.asteroids?' · ASTEROIDS':' · CLEAR SPACE');
 $('launch').disabled=!ready;$('launch').textContent=ready?'LAUNCH ONLINE BATTLE · READY':'LAUNCH LOCKED · '+(equal?'WAITING FOR READY':'UNEVEN TEAMS');$('launch').title=ready?'All pilots ready to launch':blockers.join(' · ');$('launchHint').textContent=ready?'✓ ALL PILOTS READY · 1v1 OR 2v2 MISSION CAN START':'LAUNCH REQUIREMENTS: '+blockers.join(' · ');$('launchHint').className=ready?'ok':'wait';
 $('roomPanel').hidden=false;$('roomCode').textContent=room;
 $('side').textContent=sideOf(role)+' · '+(role.endsWith('2')?'PILOT 2':'PILOT 1');
 $('hostState').textContent=host.map(slot=>(slot==='host'?'P1':'P2')+': '+(slotReady(r,slot)?'READY':'WAITING')).join(' · ')||'AWAITING PILOT';
 $('guestState').textContent=guest.map(slot=>(slot==='guest'?'P1':'P2')+': '+(slotReady(r,slot)?'READY':'WAITING')).join(' · ')||'AWAITING PILOT';
 $('balanceState').textContent=host.length+' vs '+guest.length+(equal?' · BALANCED':' · UNEVEN — LAUNCH BLOCKED');
 $('balanceState').className=equal?'ok':'wait';
 $('sessionState').textContent=ready?'ALL PILOTS READY · LAUNCH ENABLED':blockers.join(' · ');
 $('ready').textContent=slotReady(r,role)?'CANCEL READY':'MARK READY';$('ready').disabled=false;
}
function subscribe(code){unsubscribe?.();room=code;unsubscribe=onSnapshot(doc(db,'rooms',room),snap=>{
 if(!snap.exists()){notice('Room no longer exists.');return}
 const data=snap.data();role=slots.find(slot=>slotUid(data,slot)===uid);
 if(!role){notice('You are not a member of this room.');return}
 show(data);notice('Connected to room '+room+'. Lobby updates are live.');
},error)}
async function createRoom(){if(!uid)return;try{
 $('create').disabled=true;let code;for(let i=0;i<5;i++){code=randomCode();if(!(await getDoc(doc(db,'rooms',code))).exists())break;}
 await setDoc(doc(db,'rooms',code),{hostUid:uid,guestUid:null,host2Uid:null,guest2Uid:null,hostReady:false,guestReady:false,host2Ready:false,guest2Ready:false,createdAt:serverTimestamp(),scenario:'duel',asteroids:false});
 subscribe(code);history.replaceState(null,'','#room='+code);
}catch(e){error(e)}finally{$('create').disabled=false}}
async function joinRoom(code){if(!uid)return;code=code.toUpperCase().trim();
 if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code)){notice('Enter a valid 8-character room code.');return}
 try{
 const ref=doc(db,'rooms',code),snap=await getDoc(ref);
 if(!snap.exists()){notice('Room not found.');return}
 const r=snap.data();
 if(slots.some(slot=>slotUid(r,slot)===uid)){subscribe(code);history.replaceState(null,'','#room='+code);return}
 const faction=$('joinFaction').value;
 const slot=await runTransaction(db,async tx=>{
  const current=await tx.get(ref);if(!current.exists())throw Error('Room not found');
  const data=current.data();
  if(slots.some(x=>slotUid(data,x)===uid))return slots.find(x=>slotUid(data,x)===uid);
  const available=(faction==='host'?['host','host2']:['guest','guest2']).find(x=>!slotUid(data,x));
  if(!available)throw Error('This faction already has two pilots.');
  const field=available==='host'?'hostUid':available==='guest'?'guestUid':available+'Uid';
  tx.update(ref,{[field]:uid});
  return available;
 });
 subscribe(code);history.replaceState(null,'','#room='+code);
 }catch(e){error(e)}
}
const asteroidPositions=[[6,3],[7,4],[8,7],[10,5],[12,8],[14,4]];
function drawAsteroidPreview(enabled){
 const canvas=$('asteroidPreview');if(!canvas)return;
 const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
 ctx.clearRect(0,0,w,h);ctx.fillStyle='#081a25';ctx.fillRect(0,0,w,h);
 const scale=Math.min((w-40)/24,(h-28)/16),point=(q,r)=>[22+scale*(q+r/2),16+scale*.87*r];
 for(let q=0;q<19;q++)for(let r=0;r<13;r++){const [x,y]=point(q,r);ctx.beginPath();ctx.arc(x,y,1.1,0,Math.PI*2);ctx.fillStyle='#265263';ctx.fill()}
 if(enabled)for(const [q,r] of asteroidPositions){const [x,y]=point(q,r);ctx.beginPath();for(let i=0;i<7;i++){const a=i*Math.PI*2/7,rad=i%2?6:8;i?ctx.lineTo(x+rad*Math.cos(a),y+rad*Math.sin(a)):ctx.moveTo(x+rad*Math.cos(a),y+rad*Math.sin(a))}ctx.closePath();ctx.fillStyle='#9d6a35';ctx.fill();ctx.strokeStyle='#ffc65b';ctx.lineWidth=1.4;ctx.stroke()}
 ctx.font='12px monospace';ctx.fillStyle=enabled?'#ffc65b':'#9ab1bc';ctx.fillText(enabled?'6 ASTEROIDS · ENABLED':'CLEAR SPACE · NO ASTEROIDS',12,h-10);
}
async function saveScenario(){
 if(role!=='host'||!room||!current)return;
 const button=$('saveScenario');button.disabled=true;
 try{
  const asteroid=$('lobbyAsteroids').checked,scenario=$('scenarioChoice').value;
  await updateDoc(doc(db,'rooms',room),{scenario,asteroids:asteroid,hostReady:false,guestReady:false,host2Ready:false,guest2Ready:false});
  notice('SAVED: '+(asteroid?'ASTEROID FIELD ENABLED (6 ROCKS)':'CLEAR SPACE')+'. All pilots must ready up again.');
 }catch(e){error(e);$('lobbyAsteroids').checked=!!current.asteroids;drawAsteroidPreview(!!current.asteroids)}
 finally{button.disabled=false}
}
$('saveScenario').onclick=saveScenario;
$('lobbyAsteroids').addEventListener('change',()=>{drawAsteroidPreview($('lobbyAsteroids').checked);saveScenario()});
$('scenarioChoice').addEventListener('change',saveScenario);
$('create').onclick=createRoom;$('join').onclick=()=>joinRoom($('codeInput').value);
$('launch').onclick=()=>{if(!current||!balanced(current)){notice('Launch blocked: '+(current?launchBlockers(current).join(' · '):'ROOM NOT LOADED'));return}location.href='./online-battle.html#room='+room};
$('ready').onclick=async()=>{if(!room||!role||!current)return;try{
 const field=role+'Ready';
 await updateDoc(doc(db,'rooms',room),{[field]:!slotReady(current,role)});
}catch(e){error(e)}};
$('copy').onclick=async()=>{const url=new URL(location.href);url.hash='room='+room;try{await navigator.clipboard.writeText(url.toString());notice('Invitation link copied.')}catch{notice('Share this URL: '+url.toString())}};
$('leave').onclick=()=>{unsubscribe?.();unsubscribe=null;room=null;role=null;current=null;$('roomPanel').hidden=true;history.replaceState(null,'',location.pathname);notice('Left room view. Your room membership remains reserved so you can reconnect using the same browser.')} ;
if(!firebaseConfig.apiKey||firebaseConfig.apiKey==='REPLACE_ME'||firebaseConfig.projectId==='REPLACE_ME'){$('authStatus').textContent='Firebase configuration required';$('setupHint').hidden=false;notice('Follow SETUP.md to configure the Firebase project.')}else{try{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);onAuthStateChanged(auth,async user=>{if(!user){try{await signInAnonymously(auth)}catch(e){error(e)}return}uid=user.uid;$('authStatus').textContent='CONNECTED · ANONYMOUS PILOT';$('create').disabled=false;$('join').disabled=false;const match=location.hash.match(/room=([A-HJ-NP-Z2-9]{8})/i);if(match&&!room)await joinRoom(match[1]);});}catch(e){error(e)}}
