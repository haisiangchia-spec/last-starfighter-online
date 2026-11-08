// Offline AI controller for the same tactical interface used by multiplayer.
import {initial,initialSwarm,apply,predict,moveLimit,turnLimit,weaponTargets,weaponArc,usableWeaponKinds,fireControlCrewReason,rocksFor,distance,dirs,NQ,NR,activeFleet,isSwarm} from './local-combat-engine.js';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
let scenario=params.get('scenario')==='swarm'?'swarm':'duel';
const randomSeed=()=>{if(typeof crypto!=='undefined'&&crypto.getRandomValues){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]||1}return 1+Math.floor(Math.random()*4294967294)};
let asteroids=params.get('asteroids')!=='off',seed=Number(params.get('seed'))||randomSeed();
let state, movementOrders=null, targetDraft={}, zoom=1, showArcs=true;
let volleyQueue=[], volleyIndex=-1, volleyTimer=null;
let blossomMode=false,blossomArcs=Array(6).fill(0),blossomMissiles=Array(6).fill(false),blossomTargets=Array.from({length:6},()=>({}));
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
function stopVolley(){if(volleyTimer!==null)clearTimeout(volleyTimer);volleyTimer=null;volleyQueue=[];volleyIndex=-1;}
function playVolley(shots){
 stopVolley();volleyQueue=(shots||[]).filter(s=>s.from&&s.to);if(!volleyQueue.length)return;
 $('fireStatus').textContent='FIRING REPLAY · '+volleyQueue.length+' SHOT(S)';
 const next=()=>{
  volleyIndex++;
  if(volleyIndex>=volleyQueue.length){volleyTimer=null;volleyIndex=-1;set('fireStatus','VOLLEY COMPLETE · '+volleyQueue.length+' SHOT(S)');draw();return}
  const s=volleyQueue[volleyIndex];
  set('fireStatus','SHOT '+(volleyIndex+1)+' / '+volleyQueue.length+' · '+s.kind.toUpperCase()+' · '+(s.hit?'HIT':'MISS'));
  draw();volleyTimer=setTimeout(next,650);
 };next();
}
function start(mode='random'){
 stopVolley();set('fireStatus','FIRE EFFECTS APPEAR HERE WHEN VOLLEY RESOLVES');
 scenario=$('localScenario').value;asteroids=$('localAsteroids').value==='on';
 if(mode==='manual'){
  seed=Number($('localSeed').value);
  if(!Number.isInteger(seed)||seed<1||seed>4294967295){message('ENTER A VALID BATTLE SEED');return}
 }else{
  const previous=seed;
  do{seed=randomSeed()}while(seed===previous);
  $('localSeed').value=String(seed);
 }
 state=scenario==='swarm'?initialSwarm(asteroids,seed):initial(asteroids,seed);
 state.log=['LOCAL AI '+scenario.toUpperCase()+' · SEED '+seed,...state.log];
 movementOrders=null;targetDraft={};blossomMode=false;blossomArcs=Array(6).fill(0);blossomMissiles=Array(6).fill(false);blossomTargets=Array.from({length:6},()=>({}));$('plan').value='';$('recharge').dataset.queued='false';
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
 if(!rows.length){
  const asteroidOptions=weaponTargets(state,'host','missile',0,0,movementOrders.host).filter(t=>t.id.startsWith('asteroid:'));
  const missileReady=!ship.missileLost&&(ship.missiles??0)>0;
  if(!asteroids||!(state.asteroids||[]).length)return '<div class="movement-restrictions warning">NO TARGETS IN RANGE / ARC. There are no asteroids on this map. You may hold fire.</div>';
  if(!missileReady)return '<div class="movement-restrictions warning">NO LEGAL TARGETS. PHOTON MISSILES '+(ship.missileLost?'DAMAGED':'DEPLETED')+'; asteroid targeting requires an operational missile.</div>';
  if(asteroidOptions.length&&!$('missile').checked){
   return '<div class="movement-restrictions warning">NO SHIP TARGETS FOR THE SELECTED WEAPONS. '+asteroidOptions.length+' ASTEROID HEX(ES) CAN BE TARGETED WITH PHOTON MISSILES.</div><button type="button" id="chooseAsteroidMissile" class="primary">SELECT PHOTON MISSILE · ASTEROID</button>';
  }
  return '<div class="movement-restrictions warning">NO LEGAL TARGETS FOR SELECTED WEAPONS. Photon missiles can target asteroids up to 8 hexes ahead, within the forward firing arc and with a clear line of sight. No asteroid currently meets those conditions.</div>';
 }
 return rows.join('');
}

function blossomRows(){
 const ship=player(),rows=['<div class="movement-restrictions warning"><strong>DEATH BLOSSOM · SIX CLOCKWISE FIRING ORIENTATIONS</strong><p>All operational lasers and particle cannon fire at every orientation unless you select HOLD FIRE. Up to four optional photon missiles can be allocated. Each shot resolves before the next.</p></div>'];
 for(let r=0;r<6;r++){
  const heading=(ship.d+r+1)%6,aim=structuredClone(state);
  aim.ships.host.d=heading;
  const arc=blossomArcs[r];
  rows.push('<section class="panel" style="padding:10px"><strong>ROTATION '+(r+1)+'/6 · '+face[heading]+'</strong>');
  rows.push('<label>LASER TURRET ARC</label><select class="blossom-arc" data-rotation="'+r+'">'+[[0,'FORWARD'],[5,'PORT'],[1,'STARBOARD']].map(([v,n])=>'<option value="'+v+'"'+(arc===v?' selected':'')+'>'+n+'</option>').join('')+'</select>');
  for(const kind of ['laser','particle','missile']){
   if(kind==='particle'&&ship.particleLost||kind==='missile'&&(ship.missileLost||ship.missiles<1))continue;
   const count=kind==='laser'?Math.max(0,2-(ship.laserLoss||0)):1;
   for(let i=0;i<count;i++){
    const key=kind+(i+1),weaponArc=kind==='laser'?arc:0;
    if(kind==='missile'){
     rows.push('<label><input class="blossom-missile" type="checkbox" data-rotation="'+r+'" '+(blossomMissiles[r]?'checked':'')+'> FIRE OPTIONAL PHOTON MISSILE</label>');
     if(!blossomMissiles[r])continue;
    }
    const targets=weaponTargets(aim,'host',kind,i,weaponArc,{arc:weaponArc});
    if(blossomTargets[r][key]===undefined)blossomTargets[r][key]=targets[0]?.id||'none';
    const current=blossomTargets[r][key];
    rows.push('<label>'+kind.toUpperCase()+' '+(i+1)+'</label><select class="blossom-target" data-rotation="'+r+'" data-weapon="'+key+'"><option value="none">HOLD FIRE</option>'+targets.map(t=>'<option value="'+t.id+'"'+(current===t.id?' selected':'')+'>'+(t.id.startsWith('asteroid:')?'ASTEROID '+t.id.slice(9):t.id.toUpperCase())+' · '+t.range+' HEX · TO HIT '+t.toHit+'</option>').join('')+'</select>');
   }
  }
  rows.push('</section>');
 }
 return rows.join('');
}
function commitFiring(){
 if(!state||state.phase!=='targeting')return;
 const host={...movementOrders.host,fire:chosenWeapons(),targets:targetDraft};
 if(blossomMode){host.fire='blossom';host.blossomArcs=blossomArcs;host.blossomMissiles=blossomMissiles;host.blossomTargets=blossomTargets}
 else if($('recharge').dataset.queued==='true'){host.fire='guard';host.targets={}}
 const enemyOrder={...movementOrders.guest};
 state=apply(state,{host,guest:enemyOrder},'fire');
 const resolvedShots=state.lastVolley?.shots||[];
 movementOrders=null;targetDraft={};blossomMode=false;$('recharge').dataset.queued='false';
 $('plan').value='';render();playVolley(resolvedShots);
}
function fireBlossom(){
 if(scenario!=='swarm'||state?.phase!=='targeting')return;
 const ship=player();
 if(!blossomMode&&(ship.power<4||ship.power>10||ship.blossomRecharge||ship.gunner>=6||ship.unconsciousGunner===1)){
  message('DEATH BLOSSOM REQUIRES 4–10 POWER AND A READY GUNNER');return;
 }
 blossomMode=!blossomMode;targetDraft={};render();
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
 $('movementCommitWrap').hidden=!ordersPhase;
 $('fireCommitWrap').hidden=phase!=='targeting';
 $('submit').disabled=!ordersPhase;
 $('fireSubmit').disabled=phase!=='targeting';
 $('recharge').disabled=phase!=='targeting'||blossomMode||!!movementOrders?.host?.plan?.length||scenario==='swarm'&&!!ship.blossomRecharge;
 $('blossom').disabled=scenario!=='swarm'||phase!=='targeting'||(!blossomMode&&(ship.power<4||ship.power>10||!!ship.blossomRecharge||ship.gunner>=6||ship.unconsciousGunner===1));
 $('blossom').title='Death Blossom: six clockwise volleys, then mandatory recharge';
 set('allowedMoves',moveLimit(ship)+' / '+(scenario==='swarm'?5:5));set('allowedTurns',turnLimit(ship)+' / 3');
 const restrictions=[ship.stabilizer?'STABILIZER DAMAGED · RANDOM MANOEUVRE':'',ship.restrict?'STEERING · '+ship.restrict:'',ship.half?'HALF SPEED ×'+ship.half:'',ship.constant!=null?'LOCKED SPEED '+ship.constant:'',ship.unconsciousPilot?'PILOT UNCONSCIOUS':'',ship.blossomRecharge?'DEATH BLOSSOM RECHARGE':''].filter(Boolean);
 set('movementRestrictions',restrictions.join(' · ')||'Movement systems nominal.');
 $('moveChips').innerHTML=[...$('plan').value.toUpperCase()].map((step,i)=>'<span class="chip">'+(i+1)+' · '+({F:'FWD',L:'LEFT',R:'RIGHT'}[step]||'?')+'</span>').join('')||'<span class="muted">HOLD POSITION</span>';
 set('movementRemaining',$('plan').value.length+' / '+moveLimit(ship)+' steps · route preview on map');
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
 $('weaponTargetRows').innerHTML=phase==='targeting'?(blossomMode?blossomRows():firingTargets()):'';
 $('fireSubmit').textContent=blossomMode?'FIRE DEATH BLOSSOM':'LOCK WEAPON TARGETS';
 $('blossom').textContent=blossomMode?'CANCEL DEATH BLOSSOM':'DEATH BLOSSOM';
 document.querySelectorAll('select.blossom-arc').forEach(el=>el.onchange=()=>{const r=Number(el.dataset.rotation);blossomArcs[r]=Number(el.value);blossomTargets[r]={};render()});
 document.querySelectorAll('select.blossom-target').forEach(el=>el.onchange=()=>{blossomTargets[Number(el.dataset.rotation)][el.dataset.weapon]=el.value});
 document.querySelectorAll('input.blossom-missile').forEach(el=>el.onchange=()=>{
  const r=Number(el.dataset.rotation);blossomMissiles[r]=el.checked;
  if(blossomMissiles.filter(Boolean).length>Math.min(4,ship.missiles)){blossomMissiles[r]=false;message('NO MORE PHOTON MISSILES AVAILABLE')}
  render()
 });
 document.querySelectorAll('select.target-assignment').forEach(el=>el.onchange=()=>{targetDraft[el.dataset.weapon]=el.value});
 const asteroidButton=$('chooseAsteroidMissile');
 if(asteroidButton)asteroidButton.onclick=()=>{
  $('missile').checked=true;
  // Prioritize the selected photon launcher without changing the simulation's weapon capacity.
  if(Math.max(1,3-Math.max(Math.floor((ship.engine||0)/4),Math.floor((ship.hull||0)/8)))===1){
   $('laser').checked=false;$('particle').checked=false;
  }
  targetDraft={};render();
 };
 $('blossom').disabled=scenario!=='swarm'||phase!=='targeting'||(!blossomMode&&(ship.power<4||ship.power>10||!!ship.blossomRecharge||ship.gunner>=6||ship.unconsciousGunner===1));
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
 if(showArcs&&!player().dead){
  const ship=player(),arc=Number($('arc').value)||0;
  const allowed=({0:[5,0,1],1:[0,1,2],5:[4,5,0],3:[2,3,4]})[arc]||[5,0,1];
  for(let q=0;q<NQ;q++)for(let r=0;r<NR;r++){
   if(q===ship.q&&r===ship.r||distance(ship,{q,r})>10)continue;
   const dq=q-ship.q,dr=r-ship.r;
   let best=0,bestScore=-Infinity;
   for(let d=0;d<6;d++){const [x,y]=dirs[d],dot=x*dq+y*dr;
    if(dot>bestScore){bestScore=dot;best=d}}
   const relative=(best-ship.d+6)%6;
   if(allowed.includes(relative))hex(q,r,'rgba(45,207,227,.09)','rgba(45,207,227,.15)');
  }
 }
 for(const key of rocksFor(state)){const [q,r]=key.split(',').map(Number);hex(q,r,'#684821','#c89550')}
 const mark=(q,r,d,label,color,dead=false)=>{if(dead)return;const [x,y]=point(q,r);const angle=d*Math.PI/3,rx=R*.5;ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(rx,0);ctx.lineTo(-rx*.7,-rx*.58);ctx.lineTo(-rx*.7,rx*.58);ctx.closePath();ctx.fill();ctx.restore();ctx.fillStyle=color;ctx.font='bold '+Math.max(9,R*.4)+'px monospace';ctx.textAlign='center';ctx.fillText(label,x,y-R*.8)};
 const a=player();
 // Plot a live, uncommitted movement route on the tactical map. Each F/L/R
 // moves one hex *before* changing the heading, exactly as predict() does.
 // Keep the original ship visible: a cyan ghost marks the current planned
 // location, and numbered waypoints show how each additional step changes it.
 const plan=state.phase==='orders'?$('plan').value.trim().toUpperCase():'';
 let route=null;
 if(plan&&/^[FLR]{1,5}$/.test(plan)){
  try{
   predict(a,plan); // Validate the complete route before presenting a legal ghost.
   route=[{q:a.q,r:a.r,d:a.d}];
   for(let n=1;n<=plan.length;n++)route.push(predict(a,plan.slice(0,n)));
  }catch(e){route=null}
 }
 if(route?.length>1){
  ctx.save();
  ctx.strokeStyle='#50ffe7';ctx.lineWidth=Math.max(2,R*.085);
  ctx.setLineDash([Math.max(4,R*.22),Math.max(3,R*.15)]);
  ctx.beginPath();route.forEach((p,i)=>{const [x,y]=point(p.q,p.r);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
  ctx.stroke();ctx.setLineDash([]);
  for(let i=1;i<route.length;i++){
   const p=route[i],[x,y]=point(p.q,p.r);
   hex(p.q,p.r,'rgba(20,135,140,.22)','#72ffe3');
   ctx.fillStyle='#e7fffb';ctx.font='bold '+Math.max(11,R*.48)+'px monospace';
   ctx.textAlign='center';ctx.fillText(String(i),x+R*.28,y-R*.31);
  }
  ctx.restore();
 }
 mark(a.q,a.r,a.d,route?'GS-01 · START':'GS-01','#66f7ff',a.dead);
 for(const t of enemy())mark(t.q,t.r,t.d,t.id,'#ff657c',t.dead);
 // Repaint the last resolved shot over the final ship positions, never a fabricated outcome.
 if(volleyIndex>=0&&volleyQueue[volleyIndex]){
  const s=volleyQueue[volleyIndex],start=point(s.from.q,s.from.r);
  // A miss veers into an unoccupied nearby hex; a hit terminates on its true target.
  let endHex={...s.to};
  if(!s.hit){
   const occupied=[player(),...enemy()].filter(x=>!x.dead);
   const options=dirs.map(([dq,dr])=>({q:s.to.q+dq,r:s.to.r+dr})).filter(p=>p.q>=0&&p.q<NQ&&p.r>=0&&p.r<NR&&!occupied.some(x=>x.q===p.q&&x.r===p.r));
   if(options.length)endHex=options[(volleyIndex+s.from.q+s.from.r)%options.length];
  }
  const end=point(endHex.q,endHex.r),color=s.kind==='laser'?'#ff477a':s.kind==='particle'?'#69e8ff':'#ffd263';
  ctx.save();ctx.shadowColor=color;ctx.shadowBlur=18;ctx.strokeStyle=color;ctx.lineWidth=Math.max(4,R*.16);ctx.beginPath();ctx.moveTo(...start);ctx.lineTo(...end);ctx.stroke();
  ctx.shadowBlur=0;ctx.fillStyle=s.hit?'#aaffcb':'#ffdd94';ctx.font='bold '+Math.max(16,R*.58)+'px monospace';ctx.textAlign='center';ctx.fillText(s.hit?'HIT':'MISS',end[0],end[1]-R*.75);ctx.restore();
 }
 if(route?.length>1){
  const final=route[route.length-1];
  mark(final.q,final.r,final.d,'PLANNED · '+plan.length,'#76ffe0',a.dead);
 }
}
$('map').onclick=e=>{
 const canvas=$('map'),rect=canvas.getBoundingClientRect();
 const scale=Math.min(rect.width/canvas.width,rect.height/canvas.height);
 const marginX=(rect.width-canvas.width*scale)/2,marginY=(rect.height-canvas.height*scale)/2;
 const x=(e.clientX-rect.left-marginX)/scale,y=(e.clientY-rect.top-marginY)/scale;
 const R=Math.min((canvas.width-50)/(Math.sqrt(3)*(NQ+NR/2)),(canvas.height-50)/(1.5*NR+.5))*zoom;
 const cx=canvas.width/2-Math.sqrt(3)*(NQ/2+NR/4)*R,cy=canvas.height/2-1.5*(NR-1)/2*R;
 const candidates=[{id:'GS-01',...state.ships.host},...enemy()].filter(x=>!x.dead);
 const distances=candidates.map(ship=>({ship,d:Math.hypot(x-(cx+Math.sqrt(3)*(ship.q+ship.r/2)*R),y-(cy+1.5*ship.r*R))})).sort((a,b)=>a.d-b.d);
 if(!distances.length||distances[0].d>Math.max(13,R*.9))return;
 const ship=distances[0].ship;
 set('inspectTitle',ship.id+' · '+(ship.id==='GS-01'?'GUNSTAR':scenario==='swarm'?'SWARM FIGHTER':'DECK FIGHTER'));
 $('inspectBody').innerHTML=[
  ['HEX / HEADING',ship.q+','+ship.r+' / '+face[ship.d]],
  ['STATUS',ship.dead?'DESTROYED':ship.pilot>=6?'PILOT KILLED':'ACTIVE'],
  ['FUSELAGE DAMAGE',(ship.hull||0)+' / 20'],
  ['ENGINE DAMAGE',ship.engine||0],['MOVEMENT CAP',moveLimit(ship)+' HEX / '+turnLimit(ship)+' TURNS'],
  ['STEERING RESTRICTION',ship.restrict||'NONE'],['STABILIZER',ship.stabilizer?'DAMAGED · RANDOM MANOEUVRE':'NOMINAL'],
  ['SPEED RESTRICTION',ship.constant!=null?'LOCKED TO '+ship.constant+' HEX':ship.half?'HALF SPEED · '+ship.half+' HIT(S)':'NONE'],
  ['PENDING ENGINE EFFECTS',[ship.nextRestrict?'STEERING':null,ship.nextStabilizer?'STABILIZER':null,ship.nextHalf?'HALF SPEED':null,ship.nextConstant?'SPEED LOCK':null].filter(Boolean).join(', ')||'NONE'],
  ['PILOT CONTROL',ship.unconsciousPilot?'UNCONSCIOUS':'AVAILABLE'],['TARGETING DAMAGE',ship.aim||0],
  ['POWER',ship.power||0],['MISSILES',ship.missiles||0],
  ['PILOT INJURY',ship.pilot||0],['GUNNER INJURY',ship.gunner||0],
  ['LASERS',Math.max(0,(ship.type==='swarm'?1:ship.id==='GS-01'?2:3)-(ship.laserLoss||0))+' OPERATIONAL · '+(ship.laserLoss||0)+' LOST'],
  ['PARTICLE CANNON',ship.particleLost?'DESTROYED':'READY'],
  ['PHOTON SYSTEM',ship.missileLost?'DESTROYED':'READY'],
  ['FIRE CONTROL',ship.unconsciousGunner?'GUNNER UNCONSCIOUS':'GUNNER AVAILABLE'],
  ['POWERED WEAPON GROUPS',Math.max(1,3-Math.max(Math.floor((ship.engine||0)/4),Math.floor((ship.hull||0)/8)))]
 ].map(([k,v])=>'<div class="telemetry-line"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
 $('inspectDialog').showModal();
};
$('closeInspect').onclick=()=>$('inspectDialog').close();
$('submit').onclick=beginTargeting;
$('fireSubmit').onclick=commitFiring;
$('newLocalMission').onclick=()=>start('manual');
$('randomLocalMission').onclick=()=>start('random');
$('reset').onclick=()=>start('random');
$('addF').onclick=()=>add('F');$('addL').onclick=()=>add('L');$('addR').onclick=()=>add('R');
function add(x){const val=$('plan').value+x;try{predict(player(),val);$('plan').value=val;render()}catch(e){message(e.message)}}
$('undoPlan').onclick=()=>{$('plan').value=$('plan').value.slice(0,-1);render()};
$('clearPlan').onclick=()=>{$('plan').value='';render()};
$('plan').addEventListener('input',render);
$('arc').addEventListener('change',render);
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
window.__localBattleTest={state:()=>structuredClone(state),restart:start,aiOrders,advance:()=>$(state?.phase==='targeting'?'fireSubmit':'submit').click(),setGunstarPower:value=>{if(!params.has('battle_test'))throw Error('Test fixture disabled');player().power=value;render()}};
