// Offline AI controller for the same tactical interface used by multiplayer.
import {initial,initialSwarm,apply,predict,moveLimit,turnLimit,weaponTargets,weaponArc,usableWeaponKinds,fireControlCrewReason,rocksFor,distance,dirs,NQ,NR,activeFleet,isSwarm} from './local-combat-engine.js';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
let scenario=params.get('scenario')==='swarm'?'swarm':'duel';
let asteroids=params.get('asteroids')!=='off',seed=Number(params.get('seed'))||1984;
let state, movementOrders=null, targetDraft={}, selectedWeapon='laser', zoom=1, showArcs=true;
const face=['EAST','SOUTHEAST','SOUTHWEST','WEST','NORTHWEST','NORTHEAST'];
const player=()=>state?.ships.host;
const enemy=()=>isSwarm(state)?activeFleet(state).map(([id,s])=>({id,...s})):state?[{id:'DF-01',...state.ships.guest}]:[];
const set=(id,val)=>{const el=$(id);if(el)el.textContent=val};
const message=msg=>set('status',msg);
function aiVector(ship,target){
 if(!ship||ship.dead||ship.pilot>=6||ship.unconsciousPilot===1)return '';
 const limit=moveLimit(ship),max=Math.min(limit,ship.type==='swarm'?3:5);
 let best='',bestScore=-Infinity;
 const consider=plan=>{
  let p;try{p=predict(ship,plan)}catch{return}
  if(p.q<0||p.q>=NQ||p.r<0||p.r>=NR)return;
  const range=distance(p,target),delta=Math.abs(((Math.atan2(target.r-p.r,target.q-p.q)*3/Math.PI+6)%6)-p.d);
  const score=-range*2-Math.min(delta,6-delta)*0.8+plan.length*.12;
  if(score>bestScore){bestScore=score;best=plan}
 };
 let queue=[''];for(let n=0;n<=max;n++){const next=[];for(const plan of queue){consider(plan);if(n<max)for(const c of ['F','L','R'])next.push(plan+c)}queue=next}
 return best;
}
function aiOrders(){
 if(scenario==='duel'){
  const foe=state.ships.guest,ours=state.ships.host;
  const plan=aiVector(foe,ours);
  return {plan,fire:foe.power>0?'laser+particle':'none',arc:0,portLaserArc:0,starboardLaserArc:0};
 }
 const fleetPlans={};for(const [id,ship] of activeFleet(state))fleetPlans[id]=aiVector(ship,state.ships.host);
 return {plan:'',fire:'laser',fleetPlans};
}
function chosenWeapons(){return ['laser','particle','missile'].filter(k=>$(k).checked).join('+')||'none'}
function moveDraft(){
 const plan=$('plan').value.trim().toUpperCase();
 try{predict(player(),plan);return {plan,fire:chosenWeapons(),arc:Number($('arc').value),portLaserArc:Number($('portLaserArc').value),starboardLaserArc:Number($('starboardLaserArc').value)}}
 catch(e){message('INVALID VECTOR: '+e.message);return null}
}
function start(){
 scenario=$('localScenario').value;asteroids=$('localAsteroids').value==='on';
 seed=Number($('localSeed').value)||1984;
 if(!Number.isInteger(seed)||seed<1||seed>4294967295){message('ENTER A VALID BATTLE SEED');return}
 state=scenario==='swarm'?initialSwarm(asteroids,seed):initial(asteroids,seed);
 state.log=['LOCAL AI '+scenario.toUpperCase()+' · SEED '+seed,...state.log];
 movementOrders=null;targetDraft={};$('plan').value='';
 $('laser').checked=true;$('particle').checked=true;$('missile').checked=false;
 render();
}
function beginTargeting(){
 if(!state||state.phase!=='orders')return;
 const our=moveDraft();if(!our)return;
 const ai=aiOrders();
 movementOrders={host:our,guest:ai};
 state=apply(state,movementOrders,'move');
 if(state.phase==='targeting'){targetDraft={};message('MOVEMENT RESOLVED · ASSIGN WEAPON TARGETS')}
 $('plan').value='';render();
}
function firingTargets(){
 const ship=player(),raw=chosenWeapons();
 let kinds=raw.split('+').filter(x=>x!=='none');
 kinds=usableWeaponKinds(ship,'host',kinds);
 const cap=Math.max(1,3-Math.max(Math.floor((ship.engine||0)/4),Math.floor((ship.hull||0)/8)));
 kinds=kinds.slice(0,cap);
 const rows=[];
 const reason=fireControlCrewReason(ship,'host');
 if(reason)return '<div class="movement-restrictions critical">'+reason+'</div>';
 if(ship.blossomRecharge&&scenario==='swarm')return '<div class="movement-restrictions warning">MANDATORY DEATH BLOSSOM RECHARGE — NO FIRING</div>';
 for(const kind of kinds){
  const count=kind==='laser'?Math.max(0,2-(ship.laserLoss||0)):1;
  for(let i=0;i<count;i++){
   const id=kind+(i+1),arc=weaponArc('host',movementOrders.host,kind,i);
   const options=weaponTargets(state,'host',kind,i,arc,movementOrders.host);
   if(!options.length)continue;
   if(targetDraft[id]===undefined)targetDraft[id]=options[0].id;
   const selected=targetDraft[id];
   rows.push('<label>'+kind.toUpperCase()+' '+(i+1)+'</label><select class="target-assignment" data-weapon="'+id+'"><option value="none">HOLD FIRE</option>'+options.map(t=>'<option value="'+t.id+'"'+(selected===t.id?' selected':'')+'>'+(t.id.startsWith('asteroid:')?'CLEAR ASTEROID '+t.id.slice(9):t.id.toUpperCase())+' · '+t.range+' HEX · TO HIT '+t.toHit+'</option>').join('')+'</select>');
  }
 }
 return rows.join('')||'<small>No legal weapon targets. You may hold fire.</small>';
}
function commitFiring(){
 if(!state||state.phase!=='targeting')return;
 const host={...movementOrders.host,fire:chosenWeapons(),targets:targetDraft};
 if($('recharge').dataset.queued==='true'){host.fire='guard';host.targets={}}
 const enemyOrder={...movementOrders.guest};
 state=apply(state,{host,guest:enemyOrder},'fire');
 movementOrders=null;targetDraft={};$('recharge').dataset.queued='false';
 $('plan').value='';render();
}
function fireBlossom(){
 if(scenario!=='swarm'||state?.phase!=='targeting')return;
 const ship=player();
 if(ship.power<4||ship.power>10||ship.blossomRecharge||ship.gunner>=6||ship.unconsciousGunner===1){message('DEATH BLOSSOM REQUIRES 4–10 POWER AND A READY GUNNER');return}
 const missileCount=Math.min(ship.missiles,Number(window.prompt('Optional photon missiles during six rotations (0–4):','0'))||0);
 const count=Math.max(0,missileCount),selection=Array.from({length:6},(_,i)=>i<count);
 const host={...movementOrders.host,fire:'blossom',blossomMissiles:selection};
 state=apply(state,{host,guest:movementOrders.guest},'fire');
 movementOrders=null;targetDraft={};$('plan').value='';render();
}
function render(){
 if(!state)return;
 const ship=player(),phase=state.phase,ordersPhase=phase==='orders';
 $('localScenario').value=scenario;$('localAsteroids').value=asteroids?'on':'off';$('localSeed').value=String(seed);
 set('identity','LOCAL AI · '+(scenario==='swarm'?'1v14 SWARM':'1v1 DUEL'));
 set('turn',state.turn);set('quickTurn','TURN '+state.turn+' · '+(ordersPhase?'MOVEMENT':phase==='targeting'?'TARGETING':phase.toUpperCase()));
 set('quickShip','GS-01 · STAR LEAGUE');set('quickResources','POWER '+ship.power+'/20 · HULL '+ship.hp+'/20 · MISSILES '+ship.missiles);
 set('phaseLabel',ordersPhase?'MOVEMENT · PLOT VECTOR':phase==='targeting'?'TARGETING · SELECT WEAPON TARGETS':'BATTLE COMPLETE');
 set('phaseHelp',ordersPhase?'Plot your Gunstar vector; AI orders resolve simultaneously.':phase==='targeting'?'Choose targets after all ships move.':'Start a new mission.');
 $('movementControls').hidden=!ordersPhase;$('arcSettings').hidden=!ordersPhase;$('targetingPanel').hidden=phase!=='targeting';
 $('plan').disabled=!ordersPhase;
 for(const id of ['addF','addL','addR','undoPlan','clearPlan'])$(id).disabled=!ordersPhase;
 $('submit').disabled=phase==='finished';$('submit').textContent=ordersPhase?'COMMIT MOVEMENT':phase==='targeting'?'LOCK WEAPON TARGETS':'MISSION COMPLETE';
 $('recharge').disabled=phase!=='targeting'||scenario==='swarm'&&!!ship.blossomRecharge;
 $('blossom').disabled=scenario!=='swarm'||phase!=='targeting'||ship.power<4||ship.power>10||!!ship.blossomRecharge;
 $('blossom').title='Death Blossom: six clockwise volleys, then mandatory recharge';
 set('allowedMoves',moveLimit(ship)+' / '+(scenario==='swarm'?5:5));set('allowedTurns',turnLimit(ship)+' / 3');
 const restrictions=[ship.stabilizer?'STABILIZER DAMAGED · RANDOM MANOEUVRE':'',ship.restrict?'STEERING · '+ship.restrict:'',ship.half?'HALF SPEED ×'+ship.half:'',ship.constant!=null?'LOCKED SPEED '+ship.constant:'',ship.unconsciousPilot?'PILOT UNCONSCIOUS':'',ship.blossomRecharge?'DEATH BLOSSOM RECHARGE':''].filter(Boolean);
 set('movementRestrictions',restrictions.join(' · ')||'Movement systems nominal.');
 set('moveChips',$('plan').value||'HOLD');set('movementRemaining',$('plan').value.length+' / '+moveLimit(ship)+' steps');
 try{const p=predict(ship,$('plan').value.toUpperCase());set('preview','END HEX '+p.q+','+p.r+' · '+face[p.d])}catch(e){set('preview','INVALID VECTOR: '+e.message)}
 set('shipName','GS-01 · GUNSTAR');set('shipFaction','STAR LEAGUE');
 set('power',ship.power+' / 20');$('powerBar').style.width=Math.max(0,ship.power*5)+'%';
 set('hull',ship.hull+' / 20');$('hullBar').style.width=Math.max(0,ship.hull*5)+'%';
 set('moveLimit',moveLimit(ship)+' STEPS / '+turnLimit(ship)+' TURNS');
 set('missiles',ship.missiles+' REMAINING');set('targetPenalty','+'+ship.aim);
 set('systems',Math.max(1,3-Math.max(Math.floor((ship.engine||0)/4),Math.floor((ship.hull||0)/8))));
 set('crew',(ship.pilot>=6?'KILLED':ship.unconsciousPilot?'UNCONSCIOUS':'READY')+' / '+(ship.gunner>=6?'KILLED':ship.unconsciousGunner?'UNCONSCIOUS':'READY'));
 set('damage','FUSELAGE '+ship.hull+' · ENGINE '+ship.engine+' · TARGETING '+ship.aim);
 set('enemyHull',scenario==='duel'?state.ships.guest.hull:'SWARM CONTACTS '+activeFleet(state).length);
 set('flightDetail',restrictions.join(' · ')||'ALL FLIGHT SYSTEMS NOMINAL');set('weaponDetail','LASERS '+Math.max(0,2-ship.laserLoss)+' · PARTICLE '+(!ship.particleLost?'READY':'DAMAGED')+' · PHOTON '+(!ship.missileLost?'READY':'DAMAGED'));
 set('crewDetail','PILOT INJURY '+ship.pilot+' · GUNNER INJURY '+ship.gunner+' · LIFE SUPPORT '+(ship.life||'OK'));
 set('heading',face[ship.d]);set('range',enemy().length?Math.min(...enemy().map(x=>distance(ship,x)))+' HEX':'NO CONTACTS');
 set('target','DECLARED AFTER MOVEMENT');
 set('asteroidSync',asteroids?'ASTEROID FIELD ACTIVE · '+state.asteroids.length+' ROCKS':'CLEAR SPACE');
 set('swarmScenario',scenario==='swarm'?'1v14 SWARM · VS COMPUTER':'1v1 DUEL · VS COMPUTER');
 set('hostOrder',ordersPhase?'PLOTTING':phase==='targeting'?'DECLARING TARGETS':'—');set('guestOrder','COMPUTER · AUTOMATIC');
 set('latestEvent',state.log?.[0]||'Mission active');set('log',(state.log||[]).join('\n'));
 $('fleetStatus').hidden=scenario!=='swarm';
 if(scenario==='swarm')$('fleetStatus').innerHTML=Object.entries(state.fleet).map(([id,x])=>'<div class="fleet-ship enemy '+(x.dead?'lost':'')+'">'+id+' · '+(x.dead?'DESTROYED':x.q+','+x.r)+'</div>').join('');
 $('weaponTargetRows').innerHTML=phase==='targeting'?firingTargets():'';
 document.querySelectorAll('select.target-assignment').forEach(el=>el.onchange=()=>{targetDraft[el.dataset.weapon]=el.value});
 $('blossom').disabled=scenario!=='swarm'||phase!=='targeting'||ship.power<4||ship.power>10||!!ship.blossomRecharge;
 $('battleResult').hidden=phase!=='finished';
 if(phase==='finished'){set('resultTitle',state.winner==='STAR LEAGUE'?'STAR LEAGUE VICTORY':state.winner==='KO-DAN'?'KO-DAN VICTORY':'BATTLE COMPLETE');set('resultDescription','Turn '+state.turn+' · '+state.winner)}
 $('reset').disabled=false;set('status',phase==='finished'?'BATTLE COMPLETE · START A NEW MISSION':ordersPhase?'PLOT VECTOR AND COMMIT':'SELECT TARGETS AND LOCK FIRE');
 draw();
}
function draw(){
 const canvas=$('map'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
 ctx.clearRect(0,0,w,h);ctx.fillStyle='#040a15';ctx.fillRect(0,0,w,h);
 const R=Math.min((w-50)/(Math.sqrt(3)*(NQ+NR/2)),(h-50)/(1.5*NR+.5))*zoom;
 const cx=w/2-Math.sqrt(3)*(NQ/2+NR/4)*R,cy=h/2-1.5*(NR-1)/2*R;
 const point=(q,r)=>[cx+Math.sqrt(3)*(q+r/2)*R,cy+1.5*r*R];
 const hex=(q,r,color,stroke='#174255')=>{const [x,y]=point(q,r);ctx.beginPath();for(let k=0;k<6;k++){const a=Math.PI/3*k+Math.PI/6;k?ctx.lineTo(x+R*.92*Math.cos(a),y+R*.92*Math.sin(a)):ctx.moveTo(x+R*.92*Math.cos(a),y+R*.92*Math.sin(a))}ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=stroke;ctx.stroke()};
 for(let q=0;q<NQ;q++)for(let r=0;r<NR;r++)hex(q,r,'#081829');
 for(const key of rocksFor(state)){const [q,r]=key.split(',').map(Number);hex(q,r,'#684821','#c89550')}
 const mark=(q,r,d,label,color,dead=false)=>{if(dead)return;const [x,y]=point(q,r);const angle=d*Math.PI/3,rx=R*.5;ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(rx,0);ctx.lineTo(-rx*.7,-rx*.58);ctx.lineTo(-rx*.7,rx*.58);ctx.closePath();ctx.fill();ctx.restore();ctx.fillStyle=color;ctx.font='bold '+Math.max(9,R*.4)+'px monospace';ctx.textAlign='center';ctx.fillText(label,x,y-R*.8)};
 const a=player();mark(a.q,a.r,a.d,'GS-01','#66f7ff',a.dead);
 for(const t of enemy())mark(t.q,t.r,t.d,t.id,'#ff657c',t.dead);
}
$('submit').onclick=()=>state?.phase==='orders'?beginTargeting():commitFiring();
$('newLocalMission').onclick=start;$('reset').onclick=start;
$('addF').onclick=()=>add('F');$('addL').onclick=()=>add('L');$('addR').onclick=()=>add('R');
function add(x){const val=$('plan').value+x;try{predict(player(),val);$('plan').value=val;render()}catch(e){message(e.message)}}
$('undoPlan').onclick=()=>{$('plan').value=$('plan').value.slice(0,-1);render()};
$('clearPlan').onclick=()=>{$('plan').value='';render()};
$('plan').addEventListener('input',render);
$('recharge').onclick=()=>{$('recharge').dataset.queued=$('recharge').dataset.queued==='true'?'false':'true';message($('recharge').dataset.queued==='true'?'RECHARGE QUEUED · HOLD FIRE':'RECHARGE CANCELLED')};
$('blossom').onclick=fireBlossom;
$('zoomIn').onclick=()=>{zoom=Math.min(1.6,zoom+.15);draw()};
$('zoomOut').onclick=()=>{zoom=Math.max(.6,zoom-.15);draw()};
$('center').onclick=()=>{zoom=1;draw()};
$('toggleArcs').onclick=()=>{showArcs=!showArcs;$('toggleArcs').textContent=showArcs?'HIDE ARCS':'SHOW ARCS';draw()};
$('help').onclick=()=>$('helpDialog').showModal();
$('closeHelp').onclick=()=>$('helpDialog').close();
$('copyBattleReport').onclick=()=>navigator.clipboard?.writeText((state?.log||[]).join('\n'));
for(const id of ['laser','particle','missile'])$(id).addEventListener('change',()=>{targetDraft={};render()});
$('resolve').disabled=true;
$('localScenario').value=scenario;$('localAsteroids').value=asteroids?'on':'off';$('localSeed').value=seed;
start();
window.__localBattleTest={state:()=>structuredClone(state),restart:start,aiOrders,advance:()=>$('submit').click()};
