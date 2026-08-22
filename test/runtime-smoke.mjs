import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'

const harness = process.argv[2]
const config = process.argv[3]
if (!harness || !config) throw new Error('usage: runtime-smoke.mjs <harness> <config>')
const sessionRoot = `/tmp/dsh-vscode-smoke-${randomUUID()}`
const child = spawn(process.execPath, ['--import', 'tsx/esm', `${harness}/packages/examples/jsonrpc-demo/src/bin.ts`, config], {
  cwd: harness, env: { ...process.env, DSH_CWD: process.cwd(), DSH_SESSION_ROOT: sessionRoot, DEEPSEEK_BASE_URL: 'http://127.0.0.1:18080/v1', DEEPSEEK_API_KEY: 'mock-key' }, stdio: ['pipe', 'pipe', 'pipe'],
})
child.on('error', error => { throw error })
child.on('exit', code => { for (const pendingRequest of pending.values()) pendingRequest.reject(new Error(`runtime exited ${code}; stderr=${stderr}`)); pending.clear() })
let nextId = 1
const pending = new Map()
const notifications = []
let stderr = ''
child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk })
createInterface({ input: child.stdout }).on('line', line => {
  const frame = JSON.parse(line)
  if (frame.id !== undefined) { const p = pending.get(frame.id); pending.delete(frame.id); frame.error ? p.reject(new Error(frame.error.message)) : p.resolve(frame.result) }
  else notifications.push(frame)
})
function request(method, params = {}) { const id = nextId++; child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`); return new Promise((resolve,reject)=>pending.set(id,{resolve,reject})) }
function waitFor(predicate, timeout = 15000) { return new Promise((resolve,reject)=>{ const started=Date.now(); const tick=()=>{ const found=notifications.find(predicate); if(found)resolve(found); else if(Date.now()-started>timeout)reject(new Error(`notification timeout; stderr=${stderr}`)); else setTimeout(tick,20)};tick()}) }
try {
  const initialized = await request('initialize', { cwd: process.cwd(), provider: 'deepseek-official', model: 'smoke-model', maxTokens: 1024 })
  if (!initialized.capabilities?.includes('history')) throw new Error('missing interactive capabilities')
  const sessionId = randomUUID()
  await request('session/create', { sessionId, cwd: process.cwd() })
  await request('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text: 'Reply with the smoke result.' }] })
  await waitFor(frame => frame.method === 'session.status' && frame.params.sessionId === sessionId && frame.params.status === 'idle')
  const history = await request('session/history', { sessionId })
  const text = JSON.stringify(history.events)
  if (!text.includes('VS Code extension smoke passed')) throw new Error(`assistant result missing: ${text}`)
  const listed = await request('session/list')
  if (!listed.sessions.some(session => session.sessionId === sessionId)) throw new Error('session not listed')
  await request('session/cancel', { sessionId })
  console.log(JSON.stringify({ ok: true, sessionId, events: history.events.length, notifications: notifications.length }))
  await request('shutdown')
} finally {
  child.stdin.end()
  setTimeout(() => child.kill('SIGKILL'), 2000).unref()
}
