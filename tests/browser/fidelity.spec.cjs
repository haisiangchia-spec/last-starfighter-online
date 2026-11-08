const {test,expect}=require('@playwright/test');
const url='/index.html?emulator=1';
let pilotSequence=0;
async function openPilot(browser){
 const context=await browser.newContext();const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await expect(page.locator('#authStatus')).toContainText('CONNECTED',{timeout:30000});
 await page.locator('#pilotName').fill('TEST PILOT '+(++pilotSequence));
 return {context,page,errors};
}

test('lobby requires a name, randomizes initial faction and seed, and defaults asteroids on',async({browser})=>{
 const pilot=await openPilot(browser);
 try{
  const page=pilot.page;
  await page.locator('#pilotName').fill('');
  await page.locator('#create').click();
  await expect(page.locator('#notice')).toContainText('Enter your pilot name');
  await expect(page.locator('#roomPanel')).toBeHidden();
  await page.locator('#pilotName').fill('Commander Vega');
  await page.locator('#create').click();
  await expect(page.locator('#roomPanel')).toBeVisible();
  await expect(page.locator('#side')).toContainText('Commander Vega');
  await expect(page.locator('#lobbyAsteroids')).toBeChecked();
  await expect(page.locator('#asteroidPreview')).toHaveCount(0);
  await expect(page.locator('#joinFaction')).toHaveCount(0);
  const seed=Number(await page.locator('#seedStatus').textContent());
  expect(Number.isInteger(seed)&&seed>=1&&seed<=4294967295).toBe(true);
  // An independently generated room gets a new random seed, not a fixed default.
  await page.locator('#create').click();
  await expect(page.locator('#roomPanel')).toBeVisible();
  const second=Number(await page.locator('#seedStatus').textContent());
  expect(second).not.toBe(seed);
  expect(pilot.errors).toEqual([]);
 }finally{await pilot.context.close()}
});
test('local AI duel, clear-space Swarm, asteroid Swarm and hot-seat render without exceptions',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [scenario,mode,asteroids,count,facing] of [
  ['duel','ai','none',2,3],['swarm','ai','none',15,0],['swarm','ai','field',15,3],['duel','hotseat','none',2,3]
 ]){
  await page.goto('/game.html?scenario='+scenario+'&mode='+mode);
  await page.locator('#asteroids').selectOption(asteroids);
  await page.locator('#new').click();
  const data=await page.evaluate(()=>({...window.__starfighterTestState(),canvas:document.querySelector('canvas').getBoundingClientRect().width}));
  expect(data.ships).toHaveLength(count);expect(data.ships[0].id).toBe('GS-01');
  expect(data.ships[1].d).toBe(facing);expect(data.canvas).toBeGreaterThan(100);
  if(scenario==='swarm'){
   expect(data.ships.slice(1,8).map(s=>s.r)).toEqual([3,4,5,6,7,8,9]);
   expect(data.ships.slice(8).map(s=>s.r)).toEqual([3,4,5,6,7,8,9]);
  }
 }
 expect(errors).toEqual([]);
});
test('local hot-seat requires separate sealed orders and advances after both players commit',async({page})=>{
 await page.goto('/game.html?scenario=duel&mode=hotseat');
 await expect(page.locator('#status')).toContainText('STAR LEAGUE');
 await page.locator('#execute').click();
 await expect(page.locator('#status')).toContainText('KO-DAN');
 await expect(page.locator('#turn')).toHaveText('01');
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await expect(page.locator('#localTargetPanel')).toBeVisible();
 await expect(page.locator('#status')).toContainText('STAR LEAGUE');
 await page.locator('#execute').click();
 await expect(page.locator('#status')).toContainText('KO-DAN');
 await page.locator('#execute').click();
 await expect(page.locator('#turn')).toHaveText('02',{timeout:30000});
});
test('local hot-seat keeps orders sealed and advances through three complete turns',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/game.html?scenario=duel&mode=hotseat');
 for(let round=1;round<=3;round++){
  await expect(page.locator('#turn')).toHaveText(String(round).padStart(2,'0'));
  await expect(page.locator('#status')).toContainText('STAR LEAGUE');
  await page.locator('#execute').click();
  await expect(page.locator('#status')).toContainText('KO-DAN');
  await expect(page.locator('#turn')).toHaveText(String(round).padStart(2,'0'));
  await page.locator('#execute').click();
  await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
  await expect(page.locator('#localTargetPanel')).toBeVisible();
  await expect(page.locator('#status')).toContainText('STAR LEAGUE');
  await page.locator('#execute').click();
  await expect(page.locator('#status')).toContainText('KO-DAN');
  await page.locator('#execute').click();
  await expect(page.locator('#turn')).toHaveText(String(round+1).padStart(2,'0'),{timeout:30000});
 }
 expect(errors).toEqual([]);
});
test('local versus-computer duel resolves movement, targeting and firing',async({page})=>{
 await page.goto('/game.html?scenario=duel&mode=ai');
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await expect(page.locator('#localTargetPanel')).toBeVisible();
 await page.locator('#execute').click();
 await expect(page.locator('#turn')).toHaveText('02',{timeout:30000});
});
for(const size of [1,2])test('real Firebase emulator human '+size+'v'+size+' sealed orders and turn resolution',async({browser})=>{
 const pilots=[];
 try{
  for(let i=0;i<size*2;i++)pilots.push(await openPilot(browser));
  const host=pilots[0].page;await host.locator('#create').click();
  await expect(host.locator('#roomPanel')).toBeVisible();
  const code=(await host.locator('#roomCode').textContent()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  for(let i=1;i<pilots.length;i++){
   const p=pilots[i].page;
   await p.locator('#codeInput').fill(code);await p.locator('#join').click();
   await expect(p.locator('#roomPanel')).toBeVisible();
  }
  await expect(host.locator('#lobbyAsteroids')).toBeChecked();
  await expect(host.locator('#asteroidPreview')).toHaveCount(0);
  await host.locator('#battleSeed').fill('43112');
  await host.locator('#battleSeed').dispatchEvent('change');
  await expect(host.locator('#seedStatus')).toHaveText('43112');
  for(const {page} of pilots){await page.locator('#ready').click()}
  await expect(host.locator('#launch')).toBeEnabled({timeout:20000});
  for(const {page} of pilots){
   await page.goto('/online-battle.html?emulator=1#room='+code);
   await expect(page.locator('#turn')).toHaveText('1',{timeout:30000});
   await expect(page.locator('#asteroidSync')).toContainText('ASTEROID FIELD ACTIVE');
  }
  const asteroidLabels=await Promise.all(pilots.map(async({page})=>(await page.locator('#asteroidSync').textContent()).trim()));
  expect(new Set(asteroidLabels).size).toBe(1);
  expect(asteroidLabels[0]).toMatch(/^ASTEROID FIELD ACTIVE · [0-9]+ ROCKS$/);
  if(size===2){for(const {page} of pilots){await expect(page.locator('#fleetStatus')).toBeVisible();for(const ship of ['GS-01','GS-02','DF-01','DF-02'])await expect(page.locator('#fleetStatus')).toContainText(ship)}}
  // Each round now has two synchronized commits: sealed movement, then targets.
  async function playRound(round){
   for(const {page} of pilots){
    await expect(page.locator('#submit')).toHaveText('COMMIT MOVEMENT',{timeout:30000});
    await expect(page.locator('#laser')).toBeEnabled();
    await page.locator('#submit').click();
    await expect(page.locator('#status')).not.toContainText('ORDER REJECTED',{timeout:15000});
   }
   if(round===2){
    // Reconnect after movement but before target declaration. The synchronized
    // board must remain in targeting, with legal default targets regenerated.
    const reconnecting=pilots[pilots.length-1].page;
    await reconnecting.reload();
    await expect(reconnecting.locator('#targetingPanel')).toBeVisible({timeout:30000});
    await expect(reconnecting.locator('#turn')).toHaveText(String(round));
    await expect(reconnecting.locator('#submit')).toHaveText('LOCK WEAPON TARGETS');
   }
   for(const {page} of pilots){
    await expect(page.locator('#targetingPanel')).toBeVisible({timeout:30000});
    await expect(page.locator('#turn')).toHaveText(String(round));
    await expect(page.locator('#submit')).toHaveText('LOCK WEAPON TARGETS');
    const assignments=page.locator('select.target-assignment');
    if(await assignments.count()){
     const options=await assignments.first().locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
     const selected=await assignments.first().inputValue();
     // A valid firing solution is preselected rather than HOLD FIRE.
     expect(selected).toBe(options.length>1?options[1]:'none');
     // Even a preselected target may be overridden to hold fire.
     if(round===1){
      await assignments.first().selectOption('none');
      await expect(assignments.first()).toHaveValue('none');
     }
    }
    // Targets must be independently selectable for each weapon.
    if(size===2){
     const assignments=page.locator('select.target-assignment');
     expect(await assignments.count()).toBeGreaterThanOrEqual(1);
    }
   }
   for(let i=0;i<pilots.length;i++){
    const page=pilots[i].page;
    await page.locator('#submit').click();
    await expect(page.locator('#status')).not.toContainText('ORDER REJECTED',{timeout:15000});
    if(round===3&&i===0){
     // Reload a pilot who has already committed. Duplicate target submissions
     // must remain disabled until the remaining pilots finish this phase.
     await expect(page.locator('#submit')).toBeDisabled({timeout:30000});
     await page.reload();
     await expect(page.locator('#targetingPanel')).toBeVisible({timeout:30000});
     await expect(page.locator('#submit')).toBeDisabled();
    }
   }
   for(const {page} of pilots){
    await expect(page.locator('#turn')).toHaveText(String(round+1),{timeout:30000});
    await expect(page.locator('#targetingPanel')).toBeHidden();
   }
  }
  await playRound(1);
  const reconnect=pilots[pilots.length-1].page;
  await reconnect.reload();
  await expect(reconnect.locator('#turn')).toHaveText('2',{timeout:30000});
  await expect(reconnect.locator('#asteroidSync')).toContainText('ASTEROID FIELD ACTIVE');
  for(const round of [2,3])await playRound(round);
  for(const {errors} of pilots)expect(errors).toEqual([]);
 }finally{await Promise.all(pilots.map(p=>p.context.close()))}
});

test('Death Blossom presents six independently selectable rotation volleys and forces recharge',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/game.html?scenario=swarm&mode=ai&battle_test=1');
 await page.evaluate(()=>{
  const game=window.__battleTest;
  game.setup('swarm',{mode:'ai',asteroids:'none'});
  game.damage('GS-01',{power:8});
  // Isolate the special-fire sequence: no incoming Swarm damage can prevent activation.
  for(let i=1;i<=14;i++)game.damage('SW-'+String(i).padStart(2,'0'),{laserLoss:1});
 });
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('BLOSSOM-DECISION',{timeout:30000});
 await expect(page.locator('#blossom')).toBeEnabled();
 await expect(page.locator('#execute')).toHaveText('FIRE NORMALLY');
 await page.locator('#blossom').click();
 for(let rotation=1;rotation<=6;rotation++){
  await expect(page.locator('#phase')).toHaveText('BLOSSOM-TARGETING',{timeout:30000});
  await expect(page.locator('#localTargetPanel')).toBeVisible();
  await expect(page.locator('#execute')).toHaveText('FIRE THIS ROTATION');
  const options=page.locator('select.localTargetSelect');
  if(await options.count()){
   await options.first().selectOption('none');
  }
  await page.locator('#execute').click();
 }
 await expect(page.locator('#turn')).toHaveText('02',{timeout:30000});
 const after=await page.evaluate(()=>window.__battleTest.state());
 const gunstar=after.ships.find(s=>s.id==='GS-01');
 expect(gunstar.power).toBe(0);
 expect(gunstar.missiles).toBe(4); // Optional missiles default to HOLD.
 const blossoming=after.history.filter(line=>line.includes('DEATH BLOSSOM ROTATION'));
 expect(blossoming).toHaveLength(6);
 await expect(page.locator('#status')).toContainText('MANDATORY DEATH BLOSSOM RECHARGE');
 await expect(page.locator('#laser')).toBeDisabled();
 await expect(page.locator('#particle')).toBeDisabled();
 await expect(page.locator('#missile')).toBeDisabled();
 const position={q:gunstar.q,r:gunstar.r};
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await page.locator('#execute').click();
 await expect(page.locator('#turn')).toHaveText('03',{timeout:30000});
 const recovered=await page.evaluate(()=>window.__battleTest.state());
 const afterRecharge=recovered.ships.find(s=>s.id==='GS-01');
 expect([afterRecharge.q,afterRecharge.r]).toEqual([position.q,position.r]);
 expect(afterRecharge.power).toBe(5);
 expect(recovered.history.some(line=>line.includes('GS-01 RECHARGED +5 POWER'))).toBe(true);
 expect(errors).toEqual([]);
});

test('Gunstar may decline Death Blossom after Swarm fire and finish normal firing',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/game.html?scenario=swarm&mode=ai&battle_test=1');
 await page.evaluate(()=>{
  const game=window.__battleTest;
  game.setup('swarm',{mode:'ai',asteroids:'none'});
  game.damage('GS-01',{power:8});
  for(let i=1;i<=14;i++)game.damage('SW-'+String(i).padStart(2,'0'),{laserLoss:1});
 });
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('BLOSSOM-DECISION',{timeout:30000});
 await page.locator('#execute').click();
 await expect(page.locator('#turn')).toHaveText('02',{timeout:30000});
 const final=await page.evaluate(()=>window.__battleTest.state());
 expect(final.history.some(line=>line.includes('GUNSTAR ELECTS NORMAL FIRE'))).toBe(true);
 expect(final.history.filter(line=>line.includes('DEATH BLOSSOM ROTATION'))).toHaveLength(0);
 expect(errors).toEqual([]);
});

for(const size of [1,2])test('release gate: real '+size+'v'+size+' completes from lobby to winner and survives result reload',async({browser})=>{
 test.setTimeout(240000);
 const pilots=[];
 try{
  for(let i=0;i<size*2;i++)pilots.push(await openPilot(browser));
  const host=pilots[0].page;
  await host.locator('#create').click();
  await expect(host.locator('#roomPanel')).toBeVisible();
  const room=(await host.locator('#roomCode').textContent()).trim();
  expect(room).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  for(let i=1;i<pilots.length;i++){
   const page=pilots[i].page;
   await page.locator('#codeInput').fill(room);
   await page.locator('#join').click();
   await expect(page.locator('#roomPanel')).toBeVisible();
  }
  // The room creator owns configuration even if assigned to Ko-Dan.
  const factions=await Promise.all(pilots.map(async({page})=>(await page.locator('#side').textContent()).includes('STAR LEAGUE')?'host':'guest'));
  expect(factions.filter(x=>x==='host')).toHaveLength(size);
  expect(factions.filter(x=>x==='guest')).toHaveLength(size);
  // Use a clear starfield so off-map victory is deterministic and requires no test-only state mutation.
  await host.locator('#lobbyAsteroids').uncheck();
  for(const {page} of pilots)await page.locator('#ready').click();
  await expect(host.locator('#launch')).toBeEnabled({timeout:20000});
  for(const {page} of pilots){
   await page.goto('/online-battle.html?emulator=1#room='+room);
   await expect(page.locator('#turn')).toHaveText('1',{timeout:30000});
   await expect(page.locator('#asteroidSync')).toContainText('CLEAR SPACE');
  }
  for(let round=1;round<=4;round++){
   for(let i=0;i<pilots.length;i++){
    const page=pilots[i].page;
    await expect(page.locator('#submit')).toHaveText('COMMIT MOVEMENT',{timeout:30000});
    await expect(page.locator('#turn')).toHaveText(String(round));
    for(const kind of ['laser','particle','missile'])await page.locator('#'+kind).uncheck();
    // Deck Fighters move west toward and eventually off the left edge; Gunstar ships hold.
    await page.locator('#plan').fill(factions[i]==='host'?'':round===4?'FF':'FFFFF');
    await page.locator('#submit').click();
    await expect(page.locator('#status')).not.toContainText('ORDER REJECTED');
   }
   if(round<4){
    for(const {page} of pilots){
     await expect(page.locator('#targetingPanel')).toBeVisible({timeout:30000});
     await expect(page.locator('#submit')).toHaveText('LOCK WEAPON TARGETS');
    }
    for(const {page} of pilots)await page.locator('#submit').click();
    for(const {page} of pilots)await expect(page.locator('#turn')).toHaveText(String(round+1),{timeout:30000});
   }else{
    for(let i=0;i<pilots.length;i++){
     const page=pilots[i].page;
     await expect(page.locator('#battleResult')).toBeVisible({timeout:30000});
     await expect(page.locator('#resultTitle')).toContainText(factions[i]==='host'?'VICTORY · STAR LEAGUE':'DEFEAT · STAR LEAGUE');
     await expect(page.locator('#targetingPanel')).toBeHidden();
     await expect(page.locator('#submit')).toBeDisabled();
    }
   }
  }
  // Result state must survive reload on both sides, without reopening movement orders.
  for(let i of [0,pilots.length-1]){
   const page=pilots[i].page;
   await page.reload();
   await expect(page.locator('#battleResult')).toBeVisible({timeout:30000});
   await expect(page.locator('#resultTitle')).toContainText(i<size?'VICTORY · STAR LEAGUE':'DEFEAT · STAR LEAGUE');
  }
  for(const pilot of pilots)expect(pilot.errors).toEqual([]);
 }finally{await Promise.all(pilots.map(p=>p.context.close()))}
});
