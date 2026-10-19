const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');
const {WebAdapter}=require('../../dist/adapters/web/playwright');const {GameSDK}=require('../../dist/game/sdk');const {registerThreeGame}=require('../../dist/game/three-bridge');
const {registerGame}=require('../../dist/game/bridge');
const threeRoot=process.env.FLOWSTRIDE_THREE_BUILD;
const html=`<html><body><canvas id="game" width="300" height="200" style="touch-action:none"></canvas><script>
const canvas=document.querySelector('canvas'),context=canvas.getContext('2d');const state=JSON.parse(localStorage.getItem('game') || '{"score":0,"key":0}');
function paint(){context.fillStyle=state.score?'blue':'red';context.fillRect(0,0,300,200);}paint();
canvas.onpointerdown=()=>{state.score++;localStorage.setItem('game',JSON.stringify(state));paint();};window.onkeydown=()=>{state.key++;localStorage.setItem('game',JSON.stringify(state));};
const register=${registerGame.toString()};register({readState:()=>state,testMode:true,fixtures:{reset:()=>{state.score=0;localStorage.setItem('game',JSON.stringify(state));paint();}}});
</script></body></html>`;
async function fixture(handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};}
for(const device of ['desktop','phone','landscape'])test(`native game input, visual/state assertions and cleanup on ${device}`,async()=>{
 const server=await fixture((_req,res)=>res.end(html));const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-game-'));const config={headless:true,ci:true,timeout:3000,device,recordVideo:false,artifactsDir:directory};const web=new WebAdapter(config);
 try{await web.initialise();const page=web.getPage();await page.goto(server.url);const game=new GameSDK(()=>page,config);
  await game.snapshot({name:'before',canvas:'#game'});await game.expectVisual({name:'before',canvas:'#game'});await game.tap({canvas:'#game',x:.5,y:.5});await game.expectState({path:'score',equals:1});
  const ratio=await game.expectVisual({name:'before',canvas:'#game',minChange:.9});assert(ratio>.9);
  await game.key({key:'ArrowRight',duration:10});await game.expectState({path:'key',equals:1});
  await game.snapshotState({name:'saved',path:'score'});await page.reload();await game.expectPreserved({name:'saved'});
  await game.fixture({name:'reset'});await game.expectState({path:'score',equals:0});
  await game.drag({canvas:'#game',from:{x:.2,y:.3},to:{x:.7,y:.6},duration:20});
  await assert.rejects(game.tap({canvas:'#game',x:2,y:.5}),/outside/);
  const file=await game.checkpoint({name:'canvas',canvas:'#game'});assert(fs.statSync(file).size>0);
  await page.evaluate(()=>window.__FLOWSTRIDE_GAME__.testMode=false);await assert.rejects(game.fixture({name:'reset'}),/unavailable/);
 }finally{await web.shutdown();await server.close();}
});
test('Three.js bridge selects live objects, detects occlusion, and protects fixtures',{skip:!threeRoot},async()=>{
 const source=registerThreeGame.toString();
 const server=await fixture((req,res)=>{
  if(['/three.module.js','/three.core.js'].includes(req.url)){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(threeRoot,req.url.slice(1))));return;}
  res.end(`<html><body><script type="module">import * as THREE from '/three.module.js';
const renderer=new THREE.WebGLRenderer();renderer.setSize(300,200);document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1.5,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
const target=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:'red'}));scene.add(target);
const cover=new THREE.Mesh(new THREE.BoxGeometry(2,2,.2),new THREE.MeshBasicMaterial({color:'blue'}));cover.position.z=2;cover.visible=false;scene.add(cover);
const state={selected:0};renderer.domElement.onpointerdown=()=>state.selected++;
const register=${source};const bridge=register({scene,camera,canvas:renderer.domElement,Vector3:THREE.Vector3,Raycaster:THREE.Raycaster,objects:{billboard:target},readState:()=>state,testMode:false,fixtures:{cheat:()=>{state.selected=999;}}});
window.showCover=()=>{cover.visible=true;renderer.render(scene,camera);};renderer.render(scene,camera);window.ready=true;
</script></body></html>`);
 });
 const config={ci:true,headless:true,timeout:5000,device:'desktop',recordVideo:false};const web=new WebAdapter(config);
 try{await web.initialise();const page=web.getPage();await page.goto(server.url);await page.waitForFunction(()=>window.ready);const game=new GameSDK(()=>page,config);
  await game.select({id:'billboard'});await game.expectState({path:'selected',equals:1});
  await assert.rejects(game.fixture({name:'cheat'}),/unavailable/);
  await page.evaluate(()=>window.showCover());await assert.rejects(game.select({id:'billboard'}),/occluded/);
  await assert.rejects(game.select({id:'missing'}),/not found/);
 }finally{await web.shutdown();await server.close();}
});

// Reproduce the old five-second chooser race with a real browser chooser.
test('real file chooser remains safe when the click takes longer than five seconds',async()=>{
 const directory=fs.mkdtempSync(path.join(process.cwd(),'.flowstride-real-upload-'));const file=path.join(directory,'upload.txt');fs.writeFileSync(file,'native upload');
 const web=new WebAdapter({ci:true,headless:true,timeout:8000,recordVideo:false});
 try{await web.initialise();const page=web.getPage();await page.setContent('<button id="choose" onclick="document.querySelector(\'input\').click()">Choose</button><input type="file" style="display:none">');
  const locator=page.locator('#choose'),click=locator.click.bind(locator);locator.click=async options=>{await new Promise(resolve=>setTimeout(resolve,5500));await click(options);};
  web.getLocator=async()=>locator;web.checkAmbiguity=async value=>value;
  await web.upload('#choose',file);assert.equal(await page.locator('input').evaluate(input=>input.files[0].name),'upload.txt');
 }finally{await web.shutdown();}
});
