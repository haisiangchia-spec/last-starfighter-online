const {test,expect}=require('@playwright/test');
const url='/index.html?emulator=1';
async function openPilot(browser){
 const context=await browser.newContext();const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await expect(page.locator('#authStatus')).toContainText('CONNECTED',{timeout:30000});
 return {context,page,errors};
}
test('local AI duel, clear-space Swarm, asteroid Swarm and hot-seat render without exceptions',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [scenario,mode,asteroids,count,facing] of [
  ['duel','ai','none',2,3],['swarm','ai','none',15,0],['swarm','ai','field',15,3],['duel','hotseat','none',2,3]
 ]){
  await page.goto('/game.html?scenario='+scenario+'&mode='+mode);
  await page.locator('#asteroids').selectOption(asteroids);
  await page.locator('#new').click();
  const data=await page.evaluate(()=>({scenario,mode,asteroids,ships:ships.map(s=>({id:s.id,q:s.q,r:s.r,d:s.d})),canvas:document.querySelector('canvas').getBoundingClientRect().width}));
  expect(data.ships).toHaveLength(count);expect(data.ships[0].id).toBe('GS-01');
  expect(data.ships[1].d).toBe(facing);expect(data.canvas).toBeGreaterThan(100);
  if(scenario==='swarm'){
   expect(data.ships.slice(1,8).map(s=>s.r)).toEqual([3,4,5,6,7,8,9]);
   expect(data.ships.slice(8).map(s=>s.r)).toEqual([3,4,5,6,7,8,9]);
  }
 }
 expect(errors).toEqual([]);
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
   await p.locator('#joinFaction').selectOption(i<size?'host':'guest');
   await p.locator('#codeInput').fill(code);await p.locator('#join').click();
   await expect(p.locator('#roomPanel')).toBeVisible();
  }
  await host.locator('#lobbyAsteroids').check();
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
  for(let i=0;i<pilots.length;i++){
   await pilots[i].page.locator('#submit').click();
   await expect(pilots[i].page.locator('#status')).not.toContainText('ORDER REJECTED',{timeout:15000});
  }
  for(const {page} of pilots){
   await expect(page.locator('#hostOrder')).toContainText('SEALED',{timeout:20000});
   await expect(page.locator('#guestOrder')).toContainText('SEALED',{timeout:20000});
  }
  await pilots[0].page.locator('#resolve').click();
  for(const {page} of pilots)await expect(page.locator('#turn')).toHaveText('2',{timeout:30000});
  for(const {errors} of pilots)expect(errors).toEqual([]);
 }finally{await Promise.all(pilots.map(p=>p.context.close()))}
});
