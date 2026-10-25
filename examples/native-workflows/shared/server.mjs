import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (body, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Flowstride workflow examples</title></head><body>${body}<script>${script}</script></body></html>`;

/** Local demonstration application. It sends no email and performs no speech recognition. */
export async function startExampleApp({ port = 4107 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Example port must be between 0 and 65535.');
  const users = new Map();
  let lastAudioPeak = 0;
  let profileName = 'Ada Obi';
  const server = http.createServer(async (request, response) => {
    const host = request.headers.host;
    const boundPort = server.address().port;
    const allowed = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
    if (!allowed.includes(host) || (request.headers.origin && request.headers.origin !== `http://${host}`)) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    const url = new URL(request.url, `http://${host}`);
    const json = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    const html = source => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(source); };
    let raw = '', size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 65536) { json(413, { error: 'Demo request exceeds 64 KiB' }); return; }
      raw += chunk;
    }
    let data = {};
    if (raw) { try { data = JSON.parse(raw); } catch { json(400, { error: 'Invalid JSON' }); return; } }
    if (url.pathname === '/api/users' && request.method === 'POST') {
      if (!['email', 'password', 'name'].every(key => typeof data[key] === 'string' && data[key].trim())) return json(400, { error: 'Email, password and name are required' });
      const user = { id: randomUUID(), email: data.email, password: data.password, name: data.name, loginCount: 0 };
      users.set(user.id, user);
      return json(201, { id: user.id, email: user.email, name: user.name, loginCount: user.loginCount });
    }
    if (url.pathname.startsWith('/api/users/') && request.method === 'GET') {
      const user = users.get(url.pathname.split('/').pop());
      return user ? json(200, { id: user.id, email: user.email, name: user.name, loginCount: user.loginCount }) : json(404, { error: 'Unknown demo user' });
    }
    if (url.pathname === '/api/session' && request.method === 'POST') {
      const user = [...users.values()].find(value => value.email === data.email && value.password === data.password);
      if (!user) return json(401, { error: 'Invalid demo credentials' });
      user.loginCount += 1;
      response.setHeader('Set-Cookie', `example-user=${user.id}; Path=/; HttpOnly; SameSite=Lax`);
      return json(200, { id: user.id });
    }
    if (url.pathname === '/api/echo' && request.method === 'POST') return json(200, data);
    if (url.pathname === '/api/audio-observed' && request.method === 'POST') { lastAudioPeak = Number(data.peak) || 0; return json(200, { received: lastAudioPeak > 0.001 }); }
    if (url.pathname === '/api/audio-observed' && request.method === 'GET') return json(200, { peak: lastAudioPeak });
    if (url.pathname === '/api/profile' && request.method === 'POST') {
      if (typeof data.name !== 'string' || !data.name.trim()) return json(400, { error: 'A display name is required' });
      profileName = data.name.trim(); return json(200, { name: profileName });
    }
    if (url.pathname === '/login') return html(page('<h1>Demo sign in</h1><input placeholder="Email" type="email"><input placeholder="Password" type="password"><button>Sign in</button><p id="error"></p>', `document.querySelector('button').onclick=async()=>{const r=await fetch('/api/session',{method:'POST',body:JSON.stringify({email:document.querySelector('input[type=email]').value,password:document.querySelector('input[type=password]').value})});if(r.ok){localStorage.setItem('account-mode','signed-in');sessionStorage.setItem('account-session','active');location.href='/dashboard';}else document.querySelector('#error').textContent='Invalid credentials';};`));
    if (url.pathname === '/dashboard') {
      const id = request.headers.cookie?.match(/example-user=([^;]+)/)?.[1], user = users.get(id);
      return html(page(`<h1>${user ? 'Welcome, ' + escapeHtml(user.name) : 'Not authenticated'}</h1><div id="storage"></div>`, `document.querySelector('#storage').dataset.mode=localStorage.getItem('account-mode')||'missing';document.querySelector('#storage').dataset.session=sessionStorage.getItem('account-session')||'missing';`));
    }
    if (url.pathname === '/frames') return html(page('<h1>Embedded profile</h1><iframe id="profile-frame" title="Embedded profile" src="/frame"></iframe>'));
    if (url.pathname === '/frame') return html(page('<button id="frame-only">Frame action</button><p id="frame-result">Waiting</p>', `document.querySelector('button').onclick=()=>document.querySelector('#frame-result').textContent='Clicked in frame';`));
    if (url.pathname === '/orders') return html(page('<h1>Orders</h1><input placeholder="Search orders"><table id="orders"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Action</th></tr></thead><tbody><tr><td>FS-101</td><td>Ada Obi</td><td>Pending</td><td><button>View</button></td></tr><tr><td>FS-102</td><td>Bayo Ade</td><td>Approved</td><td><button>View</button></td></tr></tbody></table><p id="details">Select an order</p>', `const rows=[...document.querySelectorAll('tbody tr')];document.querySelector('input').oninput=e=>rows.forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(e.target.value.toLowerCase()));rows.forEach(r=>r.onclick=()=>document.querySelector('#details').textContent='Order '+r.cells[0].textContent);`));
    if (url.pathname === '/reuse') return html(page('<h1>Reuse extracted data</h1><input placeholder="Selected value"><button>Apply value</button><p id="reused"></p>', `document.querySelector('button').onclick=()=>document.querySelector('#reused').textContent='Selected '+document.querySelector('input').value;`));
    if (url.pathname === '/profile') return html(page(`<h1>Profile review</h1><label>Display name<input id="name" value="${escapeHtml(profileName)}"></label><button>Save profile</button><p id="profile-result"></p>`, `document.querySelector('button').onclick=async()=>{const r=await fetch('/api/profile',{method:'POST',body:JSON.stringify({name:document.querySelector('input').value})});const data=await r.json();document.querySelector('#profile-result').textContent=r.ok?'Saved as '+data.name:data.error;};`));
    if (url.pathname === '/audio') return html(page('<h1>Microphone demo — simulated transcription</h1><button id="start">Start recording</button><button id="stop" disabled>Stop recording</button><p id="recording"></p><p id="transcript"></p>', `let stream,context,timer,peak=0;document.querySelector('#start').onclick=async()=>{stream=await navigator.mediaDevices.getUserMedia({audio:true});context=new AudioContext();await context.resume();const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();source.connect(analyser);const samples=new Float32Array(analyser.fftSize);timer=setInterval(()=>{analyser.getFloatTimeDomainData(samples);for(const sample of samples)peak=Math.max(peak,Math.abs(sample));},10);document.querySelector('#recording').textContent='Recording active';document.querySelector('#stop').disabled=false;};document.querySelector('#stop').onclick=async()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());await context.close();await fetch('/api/audio-observed',{method:'POST',body:JSON.stringify({peak})});document.querySelector('#recording').textContent='Recording stopped';setTimeout(()=>document.querySelector('#transcript').textContent=peak>0.001?'Fixture transcript: audio received.':'Microphone input was silent',150);};`));
    if (url.pathname === '/') return html(page('<h1>Flowstride workflow examples</h1><ul><li><a href="/login">Demo login</a></li><li><a href="/frames">Iframe</a></li><li><a href="/orders">Orders table</a></li><li><a href="/reuse">Variable reuse</a></li><li><a href="/audio">Microphone demo</a></li><li><a href="/profile">Manual profile review</a></li></ul>'));
    return json(404, { error: 'Unknown example route' });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.FLOWSTRIDE_EXAMPLE_PORT === undefined ? 4107 : Number(process.env.FLOWSTRIDE_EXAMPLE_PORT);
  const app = await startExampleApp({ port });
  console.log(`Flowstride example application: ${app.url}`);
  console.log('Local demo only. No real email delivery or speech recognition.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
}
