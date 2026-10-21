const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert/strict'), { spawn } = require('child_process');
process.chdir(process.env.NAS_TEST_WORKSPACE || path.resolve(__dirname, '../..'));
const root = path.resolve('state/backup-test-' + Date.now()), base = 'http://127.0.0.1:18617';
fs.mkdirSync(root, { recursive: true });
const config = JSON.parse(fs.readFileSync('platform/.local/upstream/sftpgo.json'));
Object.assign(config.common.defender, { enabled: false });
Object.assign(config.httpd, { token_validation: 3, cookie_lifetime: 43200, templates_path: path.resolve('app/templates'), static_files_path: path.resolve('app/static'), signing_passphrase: 'isolated-backup-test-signing-key', signing_passphrase_file: '' });
Object.assign(config.data_provider, { driver: 'bolt', name: root + '/test.db', users_base_dir: root + '/users', backups_path: root + '/backups' });
config.httpd.bindings = [{ ...config.httpd.bindings[0], address: '127.0.0.1', port: 18617, client_ip_proxy_header: 'X-Real-IP', proxy_allowed: ['127.0.0.1/32'] }];
Object.assign(config, { sftpd: { ...config.sftpd, bindings: [] }, ftpd: { ...config.ftpd, bindings: [] }, webdavd: { ...config.webdavd, bindings: [] } });
config.telemetry.bind_port = 0;
config.smtp = { host: '', port: 0, from: '', user: '', password: '', auth_type: 0, encryption: 0, domain: '', templates_path: config.httpd.templates_path };
fs.writeFileSync(root + '/sftpgo.json', JSON.stringify(config));
const adminPassword = 'Backup-Admin-7x!r';
fs.writeFileSync(root + '/bootstrap.json', JSON.stringify({ version: 16, admins: [{ username: 'backup-admin', password: adminPassword, status: 1, permissions: ['*'] }] }));
let backend;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mergeCookie(old, values) { const jar = new Map(old.split('; ').filter(Boolean).map(c => c.split('='))); for (const v of values) { const part = v.split(';')[0], i = part.indexOf('='); jar.set(part.slice(0, i), part.slice(i + 1)); } return [...jar].map(([k, v]) => k + '=' + v).join('; '); }
async function login(route, username, password) {
  let r = await fetch(base + route + '/login'); const html = await r.text(), cookie = mergeCookie('', r.headers.getSetCookie()), csrf = html.match(/name="_form_token" value="([^"]+)"/)[1];
  r = await fetch(base + route + '/login', { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password, _form_token: csrf }) });
  assert.equal(r.status, 302); return mergeCookie('', r.headers.getSetCookie());
}
function crc32(buffer) { return zlib.crc32(buffer) >>> 0; }
function zipOf(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name), body = Buffer.from(data), crc = crc32(body);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, body); centrals.push(central, nameBuffer); offset += 30 + nameBuffer.length + body.length;
  }
  const centralBuffer = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}
(async () => {
  try {
    const log = fs.openSync(root + '/process.log', 'a');
    backend = spawn(path.resolve(process.env.NAS_TEST_BINARY || 'state/sftpgo-backup-feature.exe'), ['serve', '--config-dir', root, '--log-file-path', root + '/service.log', '--loaddata-from', root + '/bootstrap.json'], { windowsHide: true, stdio: ['ignore', log, log] });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await sleep(200); }
    const cookie = await login('/web/admin', 'backup-admin', adminPassword);
    const page = await fetch(base + '/web/admin/nas-backup', { headers: { Cookie: cookie } });
    assert.equal(page.status, 200); const html = await page.text(); const csrf = html.match(/data-csrf="([^"]+)"/)[1];
    assert.ok(html.includes('id="backup-start"') && html.includes('air-backup.js'));
    assert.ok(html.includes('/web/admin/nas-backup'), 'sidebar entry');
    assert.equal((await fetch(base + '/web/admin/nas-backup', { redirect: 'manual' })).status, 302, 'anonymous page redirects to login');
    assert.ok([302, 401, 403].includes((await fetch(base + '/web/admin/nas-backup/state', { redirect: 'manual' })).status), 'anonymous state blocked');
    const h = { Cookie: cookie, 'X-CSRF-TOKEN': csrf };
    const api = (p, o = {}) => fetch(base + '/web/admin/nas-backup' + p, { ...o, headers: { ...h, ...(o.headers || {}) } });
    const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await fetch(base + '/web/admin/nas-backup/create', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403, 'CSRF required');

    const token = (await (await fetch(base + '/api/v2/token', { headers: { Authorization: 'Basic ' + Buffer.from('backup-admin:' + adminPassword).toString('base64') } })).json()).access_token;
    const rest = (p, method = 'GET', body) => fetch(base + '/api/v2' + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    for (const name of ['alice', 'bob', 'carol']) assert.equal((await rest('/users', 'POST', { username: name, password: 'User-Pass-123!', status: 1, home_dir: path.join(root, 'users', name), permissions: { '/': ['*'] }, description: 'user ' + name })).status, 201);
    const home = n => path.join(root, 'users', n);
    fs.mkdirSync(home('bob'), { recursive: true }); fs.mkdirSync(path.join(home('alice'), 'sub/deep'), { recursive: true }); fs.mkdirSync(path.join(home('alice'), 'empty'), { recursive: true });
    fs.writeFileSync(path.join(home('alice'), 'a.txt'), 'alice original'); fs.writeFileSync(path.join(home('alice'), 'sub/b.txt'), 'bee'); fs.writeFileSync(path.join(home('alice'), 'sub/deep/中文 文件.txt'), '深层'); fs.writeFileSync(path.join(home('bob'), 'c.txt'), 'bob file');

    let state = await (await api('/state')).json();
    assert.deepEqual(state.users.map(u => u.username), ['alice', 'bob', 'carol']);
    async function finish() { for (let i = 0; i < 200; i++) { const job = await (await api('/job')).json(); if (job.state !== 'running') return job; await sleep(100); } throw Error('job timeout'); }

    // Validation.
    assert.equal((await post('/create', { settings: false, users: [], userFiles: [] })).status, 202); let job = await finish(); assert.equal(job.state, 'error'); assert.ok(job.error.key.includes('请至少选择'));
    assert.equal((await post('/create', { settings: false, users: ['ghost'], userFiles: [] })).status, 202); job = await finish(); assert.equal(job.state, 'error');
    assert.equal((await post('/delete', { name: '../x.zip' })).status, 400);
    assert.equal((await api('/download?name=..%2Ftest.db')).status, 404);

    // Backup: settings, alice + bob info, alice files only.
    assert.equal((await post('/create', { settings: true, users: ['alice', 'bob'], userFiles: ['alice'] })).status, 202);
    job = await finish(); assert.equal(job.state, 'done', JSON.stringify(job)); assert.equal(job.warnings.length, 0);
    const name = job.result; assert.match(name, /^air-cloud-\d{8}-\d{6}\.zip$/);
    assert.equal(job.filesTotal, 3); assert.ok(job.summary.some(m => m.key.startsWith('用户文件 {name}') && m.values.name === 'alice' && m.values.count === 3));
    state = await (await api('/state')).json(); const item = state.backups.find(b => b.name === name); assert.ok(item.valid);
    assert.equal(item.manifest.settings, true); assert.deepEqual(item.manifest.users.map(u => [u.username, u.info, u.files]), [['alice', true, true], ['bob', true, false]]);
    const download = await api('/download?name=' + name); assert.equal(download.status, 200); const archive = Buffer.from(await download.arrayBuffer()); assert.equal(archive.subarray(0, 2).toString(), 'PK');
    assert.ok(!archive.includes(Buffer.from('bob file')), 'unselected user files are not stored'); assert.ok(archive.includes(Buffer.from('alice original')));

    // Change the system, then restore selectively.
    fs.writeFileSync(path.join(home('alice'), 'a.txt'), 'alice CHANGED'); fs.rmSync(path.join(home('alice'), 'sub'), { recursive: true });
    assert.equal((await rest('/users/bob', 'DELETE')).status, 200); fs.rmSync(home('bob'), { recursive: true });
    assert.equal((await rest('/users/alice')).status, 200);
    assert.equal((await post('/restore', { name, settings: false, users: ['alice', 'bob'], userFiles: ['alice'], infoMode: 'skip', fileMode: 'skip' })).status, 202);
    job = await finish(); assert.equal(job.state, 'done', JSON.stringify(job));
    assert.equal((await rest('/users/bob')).status, 200, 'deleted user returns');
    assert.equal(fs.readFileSync(path.join(home('alice'), 'a.txt'), 'utf8'), 'alice CHANGED', 'skip mode keeps existing files');
    assert.equal(fs.readFileSync(path.join(home('alice'), 'sub/b.txt'), 'utf8'), 'bee'); assert.equal(fs.readFileSync(path.join(home('alice'), 'sub/deep/中文 文件.txt'), 'utf8'), '深层'); assert.ok(fs.statSync(path.join(home('alice'), 'empty')).isDirectory());
    assert.ok(!fs.existsSync(path.join(home('bob'), 'c.txt')), 'bob files were not selected');
    assert.equal((await post('/restore', { name, settings: true, users: [], userFiles: ['alice'], infoMode: 'overwrite', fileMode: 'overwrite' })).status, 202);
    job = await finish(); assert.equal(job.state, 'done', JSON.stringify(job)); assert.equal(fs.readFileSync(path.join(home('alice'), 'a.txt'), 'utf8'), 'alice original', 'overwrite mode restores files');
    assert.equal((await post('/restore', { name, settings: false, users: ['carol'], userFiles: [], infoMode: 'skip', fileMode: 'skip' })).status, 202); job = await finish(); assert.equal(job.state, 'error', 'carol is not in the backup');
    assert.equal((await post('/restore', { name: '../test.zip', settings: true })).status, 400);

    // A hostile archive must never write outside the home directory.
    const manifest = { format: 'air-cloud-backup', version: 1, createdAt: Date.now(), createdBy: 'x', settings: false, users: [{ username: 'alice', index: 'u0001', info: false, files: true, fileCount: 3, fileBytes: 3 }] };
    const hostile = zipOf([{ name: 'manifest.json', data: JSON.stringify(manifest) }, { name: 'files/u0001/ok.txt', data: 'ok' }, { name: 'files/u0001/../escape.txt', data: 'bad' }, { name: 'files/u0001/..\\escape2.txt', data: 'bad' }, { name: 'files/u0001//abs.txt', data: 'bad' }, { name: 'files/u0001/C:/evil.txt', data: 'bad' }]);
    let r = await fetch(base + '/web/admin/nas-backup/upload?name=hostile.zip', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-TOKEN': csrf }, body: hostile }); assert.equal(r.status, 200);
    assert.equal((await fetch(base + '/web/admin/nas-backup/upload?name=junk.zip', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-TOKEN': csrf }, body: 'not a zip' })).status, 400, 'invalid archives rejected');
    assert.ok(!fs.readdirSync(root + '/backups/air-cloud').some(f => f.includes('junk') || f.endsWith('.part')));
    assert.equal((await post('/restore', { name: 'hostile.zip', settings: false, users: [], userFiles: ['alice'], infoMode: 'skip', fileMode: 'overwrite' })).status, 202);
    job = await finish(); assert.equal(job.state, 'done', JSON.stringify(job)); assert.ok(job.warnings.length >= 3, 'unsafe entries reported');
    assert.equal(fs.readFileSync(path.join(home('alice'), 'ok.txt'), 'utf8'), 'ok');
    for (const escaped of [path.join(home('alice'), '..', 'escape.txt'), path.join(home('alice'), 'escape.txt'), path.join(home('alice'), 'escape2.txt'), path.join(root, 'escape.txt'), path.join(home('alice'), 'abs.txt')]) assert.ok(!fs.existsSync(escaped), 'no write at ' + escaped);
    assert.equal((await post('/delete', { name: 'hostile.zip' })).status, 200);
    assert.equal((await post('/delete', { name })).status, 200);
    console.log('PASS: admin-only access, CSRF, selective backup, selective restore, skip/overwrite modes, hostile archive protection');
  } finally { if (backend && backend.exitCode === null && backend.signalCode === null) await new Promise(resolve => { backend.once('exit', resolve); backend.kill(); }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
