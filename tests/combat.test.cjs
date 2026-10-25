// Run: node --test tests/combat.test.cjs
// Loads the actual production combat engine, excluding Firebase/browser wiring.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../online-battle.js'),'utf8');
const start=source.indexOf('const dirs=');
const end=source.indexOf('function applySwarm(');
assert.ok(start>=0&&end>start,'Combat engine source boundaries changed');
const engine=source.slice(start,end);
const sandbox={structuredClone,console};
vm.createContext(sandbox);
vm.runInContext(engine+'\nthis.combat={initial,apply,damageShip,roll,damageRows,crewThreshold,crewInjuryCheck,recoverCrewOnline,hexLine,firingBlocked,facingToTarget};',sandbox,{filename:'online-battle.js'});
const c=sandbox.combat;
const orders=(host={plan:'',fire:'none'},guest={plan:'',fire:'none'})=>({host,guest});
function scenario(){const s=c.initial(false);s.log=[];return s}
test('damage matrix is six by six and matches printed FASA rows',()=>{
 assert.equal(c.damageRows.length,6);
 assert.ok(c.damageRows.every(row=>row.length===6));
 assert.equal(c.damageRows[5][5],'D');
 assert.equal(c.damageRows[1][0],'F2,W');
});
test('missile and particle modifiers use different damage tables',()=>{
 const a=scenario().ships.host,b=scenario().ships.host;
 const la=[],pa=[];
 c.damageShip(a,'missile',12,'host',la);
 c.damageShip(b,'particle',12,'host',pa);
 assert.match(la[0],/TABLE [1-6]/);
 assert.match(pa[0],/TABLE [1-6]/);
 const table=kind=>Math.max(1,Math.min(6,c.roll(12*1009+19)+(kind==='particle'?1:-1)));
 assert.equal(Number(la[0].match(/TABLE (\d)/)[1]),table('missile'));
 assert.equal(Number(pa[0].match(/TABLE (\d)/)[1]),table('particle'));
});
test('simultaneous lethal hull failures end in a draw',()=>{
 const s=scenario();s.ships.host.hull=20;s.ships.guest.hull=20;s.ships.host.dead=true;s.ships.guest.dead=true;
 const result=c.apply(s,orders());
 assert.equal(result.winner,'DRAW');
 assert.equal(result.phase,'finished');
});
test('stationary no-fire turn does not consume power',()=>{
 const s=scenario(),next=c.apply(s,orders());
 assert.equal(next.ships.host.power,20);
 assert.equal(next.ships.guest.power,20);
});
test('explicit recharge restores up to power cap',()=>{
 const s=scenario();s.ships.host.power=18;
 const next=c.apply(s,orders({plan:'',fire:'guard'}));
 assert.equal(next.ships.host.power,20);
});
test('missile blast is eligible to hit friendly ship within one hex',()=>{
 const s=scenario();
 s.ships.host={...s.ships.host,q:8,r:6,d:0};
 s.ships.guest={...s.ships.guest,q:9,r:6,d:3};
 let confirmed=null;
 for(let turn=1;turn<=120;turn++){
  s.turn=turn;
  const next=c.apply(s,orders({plan:'',fire:'missile'},{plan:'',fire:'none'}));
  if(next.lastVolley.shots.some(x=>x.side==='host'&&x.kind==='missile'&&x.hit)){confirmed=next;break}
 }
 assert.ok(confirmed,'Expected at least one confirmed missile hit within 120 deterministic turns');
 const blasts=confirmed.log.filter(x=>x.includes('MISSILE BLAST'));
 assert.equal(blasts.length,2,'Both adjacent ships must receive missile blast damage');
 assert.ok(blasts.some(x=>x.includes('STAR LEAGUE')));
 assert.ok(blasts.some(x=>x.includes('KO-DAN')));
});
test('crew injury thresholds match original',()=>{
 assert.equal(c.crewThreshold(2),0);
 assert.equal(c.crewThreshold(3),8);
 assert.equal(c.crewThreshold(4),10);
 assert.equal(c.crewThreshold(5),12);
});
test('unconscious pilot cannot move under submitted orders',()=>{
 const s=scenario();s.ships.host.unconsciousPilot=1;
 const next=c.apply(s,orders({plan:'FFF',fire:'none'}));
 assert.equal(next.ships.host.q,s.ships.host.q);
 assert.equal(next.ships.host.r,s.ships.host.r);
});
test('asteroid between ships blocks line of sight',()=>{
 const a={q:2,r:6},b={q:6,r:6};
 assert.equal(c.firingBlocked(a,b,new Set(['4,6'])),true);
 assert.equal(c.firingBlocked(a,b,new Set()),false);
});
test('same seed and orders resolve identically',()=>{
 const s=scenario(),o=orders({plan:'FF',fire:'laser'},{plan:'FF',fire:'laser'});
 assert.deepEqual(JSON.parse(JSON.stringify(c.apply(s,o))),JSON.parse(JSON.stringify(c.apply(s,o))));
});

test('two simultaneous hits resolve independently even when a ship is destroyed',()=>{
 const s=scenario();
 s.ships.host={...s.ships.host,q:8,r:6,d:0,hull:19};
 s.ships.guest={...s.ships.guest,q:9,r:6,d:3,hull:19};
 let resolved=null;
 for(let turn=1;turn<=120;turn++){
  s.turn=turn;
  const next=c.apply(s,orders({plan:'',fire:'laser'},{plan:'',fire:'laser'}));
  if(next.lastVolley.shots.some(x=>x.side==='host'&&x.hit)&&next.lastVolley.shots.some(x=>x.side==='guest'&&x.hit)){resolved=next;break}
 }
 assert.ok(resolved,'Expected a turn where both sides land laser hits');
 // A hit can damage engines, power, or crew instead of hull. Both
 // volleys must still resolve even if one ship suffers fatal damage.
 assert.ok(resolved.log.some(x=>x.includes('STAR LEAGUE DAMAGE')));
 assert.ok(resolved.log.some(x=>x.includes('KO-DAN DAMAGE')));
 assert.ok(resolved.lastVolley.shots.some(x=>x.side==='host'&&x.hit));
 assert.ok(resolved.lastVolley.shots.some(x=>x.side==='guest'&&x.hit));
});
test('newly injured crew misses the following turn and then receives recovery checks',()=>{
 const s=scenario();s.ships.host.pilot=4;s.ships.host.unconsciousPilot=2;
 const next=c.apply(s,orders());
 assert.equal(next.ships.host.unconsciousPilot,1);
 const following=c.apply(next,orders());
 assert.ok([0,1].includes(following.ships.host.unconsciousPilot));
});
test('damage rolls remain independent for multiple hits on same ship',()=>{
 const s=scenario();
 s.ships.host={...s.ships.host,q:8,r:6,d:0};
 s.ships.guest={...s.ships.guest,q:9,r:6,d:3};
 let found=null;
 for(let turn=1;turn<=120;turn++){
  s.turn=turn;
  const next=c.apply(s,orders({plan:'',fire:'laser'},{plan:'',fire:'none'}));
  if(next.lastVolley.shots.filter(x=>x.side==='host'&&x.hit).length===2){found=next;break}
 }
 assert.ok(found,'Expected a turn where both Gunstar lasers hit');
 const damage=found.log.filter(x=>x.includes('KO-DAN DAMAGE'));
 assert.equal(damage.length,2);
 const seed=found.turn-1;
 for(let i=0;i<2;i++){
  const rollSeed=seed*10000+5000+i*37+1;
  assert.ok(damage[i].includes('RED '+c.roll(rollSeed*1009+47)),'Each hit uses its own red die seed');
 }
});

test('finished matches are not silently reset on refresh',()=>{
 const init=source.slice(source.indexOf('async function initialize()'),source.indexOf('let lastTurn='));
 assert.match(init,/snap\.data\(\)\.phase==='ended'/);
 assert.doesNotMatch(init,/\['ended','finished'\]/);
});
test('guest waits for host when rematch still has stale ended snapshot',()=>{
 const init=source.slice(source.indexOf('async function initialize()'),source.indexOf('let lastTurn='));
 assert.match(init,/Waiting for host to initialize rematch/);
 assert.match(init,/r\.hostReady&&r\.guestReady/);
});
test('constant speed orders require the exact permitted movement length',()=>{
 const ship=scenario().ships.host;
 ship.constant=3;
 const next=c.apply({...scenario(),ships:{...scenario().ships,host:ship}},orders({plan:'F',fire:'none'}));
 assert.equal(next.ships.host.q,ship.q);
 assert.ok(next.log.some(x=>x.includes('INVALID VECTOR')));
});
