import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { WebHostClient } from './webHostClient.js'

const READY_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 500
const HEARTBEAT_MS = 15_000
const SETUP_TIMEOUT_MS = 600_000
const HARNESS_REPO_URL = 'https://github.com/deepseek-ai/deepseek-harness.git'

export class HarnessServer implements vscode.Disposable {
  private proc: ChildProcess | undefined
  private startPromise: Promise<void> | undefined
  private startedUrl: string | undefined
  private preparePromise: Promise<void> | undefined

  /** Where the extension clones and builds its own managed deepseek-harness checkout when the user hasn't pointed runtime.cwd at one of their own. Lives in global storage (not the extension install dir) so it survives extension updates and isn't shipped in the .vsix. */
  private readonly managedCwd: string

  constructor(private readonly output: vscode.OutputChannel, globalStoragePath: string) {
    this.managedCwd = path.join(globalStoragePath, 'deepseek-harness')
  }

  /** Fire-and-forget: runs once, as part of extension activation, so the managed (or user-configured) checkout is cloned/installed/built without waiting for a chat session to be opened. */
  triggerPrepare(): void {
    if (this.preparePromise !== undefined) return
    this.preparePromise = this.resolveLaunch().then(plan => {
      if (plan.command !== 'pnpm') return
      return this.ensurePrepared(plan.cwd)
    }).catch(error => {
      this.output.appendLine(`[harness] setup failed: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    })
  }

  /** Resolves the actual launch command: an explicit runtime.command override, else pnpm against the extension's managed clone (cloning it first if needed). */
  private async resolveLaunch(): Promise<{ command: string; args: string[]; cwd: string }> {
    const config = vscode.workspace.getConfiguration('deepseekHarness')
    const configuredCommand = config.get<string>('runtime.command', '').trim()
    const configuredArgs = config.get<string[]>('runtime.args', [])
    const configuredCwd = config.get<string>('runtime.cwd', '').trim()
    if (configuredCommand !== '') {
      const args = configuredArgs.length > 0 ? configuredArgs : (configuredCommand === 'pnpm' ? ['dsh', 'web', '--no-open'] : configuredArgs)
      return { command: configuredCommand, args, cwd: configuredCwd || this.managedCwd }
    }
    return { command: 'pnpm', args: ['dsh', 'web', '--no-open'], cwd: configuredCwd || this.managedCwd }
  }

  async ensureRunning(url: string): Promise<void> {
    if (await isReady(url)) return
    const config = vscode.workspace.getConfiguration('deepseekHarness')
    if (!config.get<boolean>('autoStart', true)) throw new Error(`No DSH Web server is reachable at ${url}. Start one, or enable deepseekHarness.autoStart to have the extension launch it.`)
    if (this.startPromise === undefined || this.startedUrl !== url) {
      this.startedUrl = url
      this.startPromise = this.spawnAndWait(url)
    }
    await this.startPromise
  }

  async restartOwned(): Promise<void> {
    const proc = this.proc
    if (proc === undefined) return
    this.proc = undefined
    this.startPromise = undefined
    proc.kill()
    await new Promise<void>(resolve => proc.once('exit', () => resolve()))
  }

  dispose(): void { this.proc?.kill() }

  private async spawnAndWait(url: string): Promise<void> {
    const { command, args, cwd } = await this.resolveLaunch()
    const parsed = new URL(url)
    const extraArgs = [
      ...(parsed.hostname === '' || parsed.hostname === '127.0.0.1' ? [] : ['--host', parsed.hostname]),
      ...(parsed.port === '' ? [] : ['--port', parsed.port]),
    ]
    const fullArgs = [...args, ...extraArgs]
    if (command === 'pnpm') { this.triggerPrepare(); if (this.preparePromise !== undefined) await this.preparePromise }
    if (command === 'npx') this.output.appendLine('[harness] first run may take a few minutes while npx downloads the DeepSeek Harness packages')
    this.output.appendLine(`[harness] starting: ${command} ${fullArgs.join(' ')}${cwd === undefined ? '' : ` (cwd: ${cwd})`}`)
    const proc = spawn(command, fullArgs, { cwd, env: process.env, shell: process.platform === 'win32' })
    this.proc = proc
    proc.stdout?.on('data', chunk => this.output.append(chunk.toString()))
    proc.stderr?.on('data', chunk => this.output.append(chunk.toString()))
    proc.on('error', error => this.output.appendLine(`[harness] failed to start: ${error.message}`))
    proc.on('exit', code => {
      this.output.appendLine(`[harness] server exited (code ${code ?? 'unknown'})`)
      if (this.proc === proc) { this.proc = undefined; this.startPromise = undefined }
    })
    const started = Date.now()
    const deadline = started + READY_TIMEOUT_MS
    let nextHeartbeat = started + HEARTBEAT_MS
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error('The DSH Web server exited before it became ready; see the DeepSeek Harness output channel for details.')
      if (await isReady(url)) return
      if (Date.now() >= nextHeartbeat) { this.output.appendLine(`[harness] still waiting for ${url} to come up (${Math.round((Date.now() - started) / 1000)}s elapsed)...`); nextHeartbeat += HEARTBEAT_MS }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new Error(`Timed out waiting for the DSH Web server at ${url} to become ready.`)
  }

  private async ensurePrepared(cwd: string): Promise<void> {
    const needsClone = !(await pathExists(path.join(cwd, '.git')))
    const needsInstall = needsClone || !(await pathExists(path.join(cwd, 'node_modules')))
    const needsBuild = needsClone || needsInstall || !(await pathExists(path.join(cwd, '.dsh-build')))
    if (!needsClone && !needsInstall && !needsBuild) return
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DeepSeek Harness: one-time setup (this may take a few minutes; only happens once)', cancellable: false },
      async progress => {
        if (needsClone) {
          progress.report({ message: 'Cloning deepseek-harness…' })
          await fs.mkdir(path.dirname(cwd), { recursive: true })
          await this.runSetupStep(path.dirname(cwd), 'git', ['clone', '--depth', '1', HARNESS_REPO_URL, path.basename(cwd)], 'cloning deepseek-harness')
        }
        if (needsInstall) {
          progress.report({ message: 'Installing dependencies (pnpm install)…' })
          await this.runSetupStep(cwd, 'pnpm', ['install'], 'installing dependencies')
        }
        if (needsBuild) {
          progress.report({ message: 'Building (pnpm run build)…' })
          await this.runSetupStep(cwd, 'pnpm', ['run', 'build'], 'building')
        }
      },
    )
  }

  private async runSetupStep(cwd: string, command: string, args: string[], label: string): Promise<void> {
    this.output.appendLine(`[harness] ${label}: ${command} ${args.join(' ')} (cwd: ${cwd})`)
    const proc = spawn(command, args, { cwd, env: process.env, shell: process.platform === 'win32' })
    proc.stdout?.on('data', chunk => this.output.append(chunk.toString()))
    proc.stderr?.on('data', chunk => this.output.append(chunk.toString()))
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { proc.kill(); reject(new Error(`Timed out while ${label} (cwd: ${cwd}).`)) }, SETUP_TIMEOUT_MS)
      proc.on('error', error => { clearTimeout(timer); reject(error) })
      proc.on('exit', code => { clearTimeout(timer); resolve(code) })
    })
    if (exitCode !== 0) throw new Error(`Failed while ${label} (exit code ${exitCode ?? 'unknown'}); see the DeepSeek Harness output channel for details.`)
  }
}

async function pathExists(target: string): Promise<boolean> {
  try { await fs.access(target); return true } catch { return false }
}

async function isReady(url: string): Promise<boolean> {
  try { await new WebHostClient(url).describe(); return true } catch { return false }
}
