import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as readline from 'node:readline'
import type { RuntimeNotification } from './protocol.js'

interface JsonRpcResponse { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string; data?: unknown } }
interface JsonRpcNotification { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> }
interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer?: NodeJS.Timeout }

export interface RuntimeLaunch {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

export class JsonRpcClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined
  private nextId = 1
  private pending = new Map<number, Pending>()
  private closing = false

  constructor(private readonly log: (line: string) => void) { super() }

  get running(): boolean { return this.child !== undefined && !this.child.killed }

  start(launch: RuntimeLaunch): void {
    if (this.child !== undefined) return
    this.closing = false
    this.log(`Starting: ${launch.command} ${launch.args.map(value => JSON.stringify(value)).join(' ')}`)
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => this.log(String(chunk).trimEnd()))
    child.on('error', error => this.failAll(new Error(`Runtime failed to start: ${error.message}`)))
    child.on('exit', (code, signal) => {
      const expected = this.closing
      this.child = undefined
      const message = `Runtime exited (code=${String(code)}, signal=${String(signal)})`
      this.log(message)
      this.failAll(new Error(message))
      this.emit(expected ? 'closed' : 'crash', message)
    })
    const lines = readline.createInterface({ input: child.stdout })
    lines.on('line', line => this.receive(line))
  }

  async request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 0): Promise<T> {
    const child = this.child
    if (child === undefined) throw new Error('DeepSeek Harness runtime is not running')
    const id = this.nextId++
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return await new Promise<T>((resolve, reject) => {
      const pending: Pending = { resolve: value => resolve(value as T), reject }
      if (timeoutMs > 0) pending.timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, pending)
      child.stdin.write(`${frame}\n`, error => {
        if (error === null || error === undefined) return
        this.pending.delete(id)
        if (pending.timer !== undefined) clearTimeout(pending.timer)
        reject(error)
      })
    })
  }

  async close(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.closing = true
    try { await this.request('shutdown', {}, 1_000) } catch { /* process ladder below */ }
    child.stdin.end()
    await Promise.race([
      new Promise<void>(resolve => child.once('exit', () => resolve())),
      new Promise<void>(resolve => setTimeout(resolve, 1_500)),
    ])
    if (this.child === child) child.kill('SIGTERM')
    await Promise.race([
      new Promise<void>(resolve => child.once('exit', () => resolve())),
      new Promise<void>(resolve => setTimeout(resolve, 1_000)),
    ])
    if (this.child === child) child.kill('SIGKILL')
  }

  private receive(line: string): void {
    let value: JsonRpcResponse | JsonRpcNotification
    try { value = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification } catch {
      this.log(`Non-JSON stdout: ${line}`)
      return
    }
    if ('id' in value) {
      const pending = this.pending.get(value.id)
      if (pending === undefined) return
      this.pending.delete(value.id)
      if (pending.timer !== undefined) clearTimeout(pending.timer)
      if (value.error !== undefined) pending.reject(new Error(`${value.error.message} (${value.error.code})`))
      else pending.resolve(value.result)
      return
    }
    if ('method' in value) this.emit('notification', { method: value.method, params: value.params ?? {} } satisfies RuntimeNotification)
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer !== undefined) clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
