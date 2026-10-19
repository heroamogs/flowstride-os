import http from 'node:http';
import { registerGame } from 'flowstride/dist/game/bridge.js';
const html = `<!doctype html><html><head><title>Flowstride native game fixture</title></head><body>
<canvas id="game" width="300" height="200" style="touch-action:none"></canvas>
<script>
const canvas=document.querySelector('canvas'),context=canvas.getContext('2d');
const state={score:0};
function draw(){context.fillStyle=state.score?'blue':'red';context.fillRect(0,0,canvas.width,canvas.height);}
canvas.onpointerdown=()=>{state.score++;draw();};draw();
const register=${registerGame.toString()};register({readState:()=>state,testMode:true,fixtures:{reset:()=>{state.score=0;draw();}}});
</script></body></html>`;
http.createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end(html);}).listen(5189,'127.0.0.1');
