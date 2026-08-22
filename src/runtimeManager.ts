import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import type { ModelDirectory, RuntimeNotification, SessionEvent, SessionSummary } from './protocol.js'
import { WebHostClient, type WebFrameEnvelope } from './webHostClient.js'
import { visibleWorkspaceSessions } from './sessionFilters.js'
import type { HarnessServer } from './harnessServer.js'
export interface RuntimeLocation { cwd: string; name: string; uri?: vscode.Uri }
interface State { state: 'starting' | 'ready' | 'failed'; message?: string }
export class RuntimeManager {
  readonly notifications = new vscode.EventEmitter<RuntimeNotification>(); readonly stateEmitter = new vscode.EventEmitter<State>(); readonly onNotification = this.notifications.event; readonly onState = this.stateEmitter.event
  private readonly url: string; private readonly web: WebHostClient; private started = false; private sockets: WebSocket[] = []; private streamGeneration = 0; private reconnectTimer: NodeJS.Timeout | undefined; private readonly projectionSeq = new Map<string, number>(); private readonly eventTailSeq = new Map<string, number>(); private readonly approvalRequestIds = new Map<string, string>()
  constructor(readonly location: RuntimeLocation, private readonly output: vscode.OutputChannel, private readonly harnessServer: HarnessServer) { this.url = vscode.workspace.getConfiguration('deepseekHarness').get('web.url', 'http://127.0.0.1:3080'); this.web = new WebHostClient(this.url) }
  async ensureStarted(): Promise<void> { if (this.started) return; this.stateEmitter.fire({ state: 'starting' }); try { await this.harnessServer.ensureRunning(this.url); const host = await this.web.describe(); this.started = true; this.output.appendLine(`[${this.location.name}] Connected to DSH Web (${host.provider}/${host.model})`); this.stateEmitter.fire({ state: 'ready' }); this.openStreams() } catch (error) { const message = `Cannot connect to the configured DSH Web endpoint: ${error instanceof Error ? error.message : String(error)}`; this.stateEmitter.fire({ state: 'failed', message }); throw new Error(message) } }
  async listSessions(): Promise<SessionSummary[]> {
    await this.ensureStarted()
    const [sessions, archivedIds] = await Promise.all([this.web.listSessions(), this.web.listArchivedSessionIds()])
    return visibleWorkspaceSessions(sessions, archivedIds, this.location.cwd)
  }
  async createSession(sessionId = randomUUID()): Promise<string> {
    await this.ensureStarted()
    const reusable = (await this.listSessions()).find(session => session.blank === true)
    return reusable?.sessionId ?? await this.web.createSession(this.location.cwd, sessionId)
  }
  async listArchivedSessions(): Promise<SessionSummary[]> {
    await this.ensureStarted()
    const [sessions, archivedIds] = await Promise.all([this.web.listSessions(), this.web.listArchivedSessionIds()])
    const archived = new Set(archivedIds)
    return sessions.filter(session => archived.has(session.sessionId) && session.origin !== 'subagent' && (session.cwd === undefined || path.resolve(session.cwd) === this.location.cwd))
  }
  async searchSessions(query: string): Promise<Array<{ sessionId: string; snippet: string }>> { await this.ensureStarted(); const allowed = new Set((await this.listSessions()).map(item => item.sessionId)); return (await this.web.searchSessions(query)).items.filter(item => allowed.has(item.sessionId)) }
  async configurationOverview(): Promise<import('./protocol.js').ConfigurationOverview> { await this.ensureStarted(); return await this.web.configurationOverview() }
  async openSettingsDocument(): Promise<void> { await this.ensureStarted(); await this.web.openSettingsDocument() }
  async modelCatalog(sessionId?: string): Promise<ModelDirectory> { await this.ensureStarted(); return await this.web.modelCatalog(sessionId) }
  currentPermission(): string { return vscode.workspace.getConfiguration('deepseekHarness').get('permission', 'workspace-write') }
  async history(sessionId: string): Promise<SessionEvent[]> { await this.ensureStarted(); const events = await this.web.history(sessionId); this.eventTailSeq.set(sessionId, events.reduce((tail, event) => Math.max(tail, event.seq), -1)); return events }
  async prompt(sessionId: string, text: string, mode: 'queue' | 'steer' = 'queue', images: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string; name?: string }> = []): Promise<void> { await this.ensureStarted(); if (text.startsWith('/') && images.length === 0) await this.runCommand(text, sessionId); else await this.web.prompt(sessionId, text, mode, images) }
  async cancel(sessionId: string): Promise<void> { await this.web.cancel(sessionId) }
  async updateQueue(sessionId: string | undefined, itemId: string, action: { kind: 'remove' | 'steer' } | { kind: 'edit'; text: string }): Promise<void> { if (sessionId === undefined) return; await this.web.updateQueue(sessionId, itemId, action.kind === 'edit' ? { kind: 'edit', content: [{ type: 'text', text: action.text }] } : action) }
  async renameSession(sessionId: string, title: string): Promise<string> { return await this.web.renameSession(sessionId, title) }
  async forkSession(sessionId: string): Promise<string> { return await this.web.forkSession(sessionId) }
  async archiveSession(sessionId: string): Promise<void> { await this.web.archiveSession(sessionId) }
  async answerApproval(sessionId: string, requestId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> { await this.web.respond(requestId, { sessionId, approvalId, outcome }) }
  async answerQuestion(sessionId: string, requestId: string, answers: { id: string; selected: string[]; custom?: string }[]): Promise<void> { await this.web.respond(requestId, { sessionId, answer: { answers } }) }
  async selectModel(provider: string, model: string, reasoningEffort: string | undefined, sessionId?: string): Promise<void> { if (sessionId === undefined) throw new Error('Create or select a session before choosing a model'); await this.web.selectModel(sessionId, provider, model, reasoningEffort) }
  async listSkills(sessionId?: string): Promise<import('./protocol.js').SkillSummary[]> { if (sessionId === undefined) return []; await this.ensureStarted(); return await this.web.listSkills(sessionId) }
  async listSubagents(sessionId?: string): Promise<import('./protocol.js').SubagentSummary[]> {
    if (sessionId === undefined) return []
    await this.ensureStarted()
    const output: import('./protocol.js').SubagentSummary[] = []
    const visit = async (parentSessionId: string, depth: number): Promise<void> => {
      if (depth > 4 || output.length >= 100) return
      const catalog = await this.web.listSubagents(parentSessionId)
      for (const entry of catalog.entries) {
        output.push({ ...entry, parentSessionId, parentAvailable: catalog.parentAvailable, depth })
        if (entry.kind === 'child' && entry.hasChildren === true) await visit(entry.id, depth + 1)
      }
    }
    await visit(sessionId, 0)
    return output
  }
  async subagentHistory(parentSessionId: string, childSessionId: string, mode: 'one-shot' | 'continuable'): Promise<SessionEvent[]> { await this.ensureStarted(); return await this.web.subagentHistory(parentSessionId, childSessionId, mode) }
  async promptSubagent(parentSessionId: string, childSessionId: string, text: string): Promise<void> { await this.ensureStarted(); await this.web.promptSubagent(parentSessionId, childSessionId, text) }
  async interruptSubagent(parentSessionId: string, childSessionId: string): Promise<void> { await this.ensureStarted(); await this.web.interruptSubagent(parentSessionId, childSessionId) }
  async mutateSetting(ns: string, revision: number, op: { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }): Promise<void> { await this.ensureStarted(); await this.web.mutateSetting(ns, revision, op) }
  async goalAction(sessionId: string | undefined, action: 'pause' | 'resume' | 'complete' | 'clear', ref: { id: string; revision: number }): Promise<void> { if (sessionId === undefined) throw new Error('Select a session before changing its goal'); await this.web.goalAction(sessionId, action, ref) }
  async listCommands(sessionId?: string): Promise<Array<{ name: string; description?: string }>> { if (sessionId === undefined) return []; await this.ensureStarted(); return await this.web.listCommands(sessionId) }
  async runCommand(line: string, sessionId?: string): Promise<void> { if (sessionId === undefined) throw new Error('Create or select a session before running a command'); await this.web.executeCommand(sessionId, line) }
  async selectPermission(permission: string, sessionId?: string): Promise<void> { await this.runCommand(`/permission ${permission}`, sessionId) }
  async restart(): Promise<void> { this.closeStreams(); this.started = false; await this.harnessServer.restartOwned(); await this.ensureStarted() }
  async dispose(): Promise<void> { this.closeStreams(); this.notifications.dispose(); this.stateEmitter.dispose() }
  private openStreams(): void {
    this.closeStreams()
    const generation = ++this.streamGeneration
    this.sockets = [
      this.web.openEvents('mux', frame => { if (generation === this.streamGeneration) this.handleFrame(frame) }, () => this.handleStreamClose(generation)),
      this.web.openEvents('host', frame => { if (generation === this.streamGeneration) this.handleFrame(frame) }, () => this.handleStreamClose(generation)),
    ]
  }
  private closeStreams(): void { this.streamGeneration++; if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; const sockets = this.sockets; this.sockets = []; for (const socket of sockets) if (socket.readyState < WebSocket.CLOSING) socket.close() }
  private handleStreamClose(generation: number): void { if (!this.started || generation !== this.streamGeneration || this.sockets.length === 0 || this.reconnectTimer !== undefined) return; this.output.appendLine('DSH Web event stream disconnected; reconnecting'); this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; if (this.started && generation === this.streamGeneration) this.openStreams() }, 750) }
  private handleFrame({ rpcId, payload }: WebFrameEnvelope): void {
    const type = payload.type; const sessionId = String(payload.sessionId ?? '')
    if (type === 'session/subscribed') {
      const lastSeq = typeof payload.lastSeq === 'number' ? payload.lastSeq : -1
      this.eventTailSeq.set(sessionId, lastSeq)
      for (const [key, seq] of this.projectionSeq) if (key.startsWith(`${sessionId}:`) && seq > lastSeq) this.projectionSeq.delete(key)
      this.notifications.fire({ method: 'session.resync', params: { sessionId, lastSeq } })
    }
    else if (type === 'session/event') {
      const event = payload.event as SessionEvent
      const tail = this.eventTailSeq.get(sessionId)
      if (tail !== undefined && event.seq <= tail) return
      if (tail !== undefined && event.seq > tail + 1) { this.output.appendLine(`[${sessionId}] Event gap ${tail} -> ${event.seq}; reloading history`); this.notifications.fire({ method: 'session.resync', params: { sessionId, lastSeq: event.seq } }); return }
      this.eventTailSeq.set(sessionId, event.seq)
      this.notifications.fire({ method: 'session.event', params: { sessionId, event, ...(payload.view === undefined ? {} : { view: payload.view }) } })
    }
    else if (type === 'session/projection') {
      const key = `${sessionId}:${String(payload.key)}`
      const seq = typeof payload.seq === 'number' ? payload.seq : -1
      if (seq <= (this.projectionSeq.get(key) ?? -1)) return
      this.projectionSeq.set(key, seq)
      this.notifications.fire({ method: 'session.projection', params: { sessionId, key: payload.key, value: payload.value, seq } })
    }
    else if (type === 'session/queue') this.notifications.fire({ method: 'session.queue', params: { sessionId, items: payload.items } })
    else if (type === 'session/jobs') this.notifications.fire({ method: 'session.jobs', params: { sessionId, jobs: payload.jobs } })
    else if (type === 'host/session-added' || type === 'host/session-removed' || type === 'host/archived-sessions-changed' || type === 'host/workspace-changed') this.notifications.fire({ method: 'sessions.changed', params: payload })
    else if (type === 'host/session-status') this.notifications.fire({ method: 'session.status', params: { sessionId, status: payload.running === true ? 'running' : 'idle' } })
    else if (type === 'host/agent-error') this.notifications.fire({ method: 'session.error', params: { sessionId, message: String(payload.message ?? 'Agent error') } })
    else if (type === 'approval/requested') { const approvalId = String(payload.approvalId); this.approvalRequestIds.set(approvalId, rpcId); this.notifications.fire({ method: 'approval.requested', params: { requestId: rpcId, approvalId, toolName: String(payload.toolName), ...(payload.reason === undefined ? {} : { reason: String(payload.reason) }) } }) }
    else if (type === 'approval/resolved') { const approvalId = String(payload.approvalId); const requestId = this.approvalRequestIds.get(approvalId) ?? rpcId; this.approvalRequestIds.delete(approvalId); this.notifications.fire({ method: 'approval.resolved', params: { requestId } }) }
    else if (type === 'question/requested') this.notifications.fire({ method: 'question.requested', params: { requestId: rpcId, questions: payload.questions as never } })
    else if (type === 'question/resolved') this.notifications.fire({ method: 'question.resolved', params: { requestId: String(payload.questionRpcId ?? rpcId) } })
  }
}
export function currentLocation(): RuntimeLocation {
  const editorUri = vscode.window.activeTextEditor?.document.uri
  const activeFolder = editorUri === undefined ? undefined : vscode.workspace.getWorkspaceFolder(editorUri)
  const folder = activeFolder ?? vscode.workspace.workspaceFolders?.[0]
  return folder === undefined ? { cwd: os.homedir(), name: '~' } : { cwd: path.resolve(folder.uri.fsPath), name: folder.name, uri: folder.uri }
}
