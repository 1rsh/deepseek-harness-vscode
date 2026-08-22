import { randomUUID } from 'node:crypto'
import type { ConfigurationOverview, ModelDirectory, SessionEvent, SessionSummary } from './protocol.js'
interface RpcResult<T> { ok: true; value: T }; interface RpcFailure { ok: false; error: { code: string; message: string } }; interface Envelope<T> { result: RpcResult<T> | RpcFailure }
export interface WebFrameEnvelope { rpcId: string; payload: Record<string, unknown> & { type: string } }
export class WebHostClient {
  constructor(private readonly baseUrl = 'http://127.0.0.1:3080') {}
  async call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> { const response = await fetch(new URL(`/api/${method}`, this.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }), signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(`DSH Web API ${method} failed: HTTP ${response.status}`); const envelope = await response.json() as Envelope<T>; if (!envelope.result.ok) throw new Error(`${envelope.result.error.code}: ${envelope.result.error.message}`); return envelope.result.value }
  async respond(rpcId: string, value: unknown): Promise<void> { const response = await fetch(new URL('/api/respond', this.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-response', rpcId, result: { ok: true, value } }) }); if (!response.ok) throw new Error(`DSH Web API response failed: HTTP ${response.status}`); const receipt = await response.json() as { accepted?: boolean; reason?: string }; if (receipt.accepted !== true) throw new Error(`DSH Web rejected response: ${receipt.reason ?? 'unknown reason'}`) }
  openEvents(kind: 'mux' | 'host', onFrame: (frame: WebFrameEnvelope) => void, onClose: () => void): WebSocket { const url = new URL(`/api/events.${kind}`, this.baseUrl); url.protocol = 'ws:'; const socket = new WebSocket(url); socket.addEventListener('message', event => { if (typeof event.data !== 'string') return; try { onFrame(JSON.parse(event.data) as WebFrameEnvelope) } catch {} }); socket.addEventListener('close', onClose); socket.addEventListener('error', onClose); return socket }
  async describe(): Promise<{ provider: string; model: string }> { return await this.call('host.describe') }
  async openSettingsDocument(): Promise<void> { await this.call('settings.openDocument') }
  async mutateSetting(ns: string, revision: number, op: { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }): Promise<void> { await this.call('settings.mutate', { ns, ops: [op], expectedRevision: revision }) }
  async configurationOverview(): Promise<ConfigurationOverview> {
    const [settings, providers, presets] = await Promise.all([
      this.call<{ writable: boolean; hasDocument: boolean; namespaces: Array<ConfigurationOverview['namespaces'][number] & { value?: unknown }> }>('settings.describe'),
      this.call<{ providers: ConfigurationOverview['providers'] }>('llm.providers'),
      this.call<{ presets: ConfigurationOverview['presets'] }>('agentPreset.list'),
    ])
    return { writable: settings.writable, hasDocument: settings.hasDocument, namespaces: settings.namespaces.map(({ ns, applies, revision, secrets, value }) => ({ ns, applies, revision, secrets, ...(typeof value === 'object' && value !== null && !Array.isArray(value) ? { keys: Object.keys(value as Record<string, unknown>).sort() } : {}) })), providers: providers.providers, presets: presets.presets }
  }
  async listSessions(): Promise<SessionSummary[]> { return (await this.call<{ items: SessionSummary[] }>('session.list')).items }
  async listArchivedSessionIds(): Promise<string[]> { return (await this.call<{ archivedSessionIds: string[] }>('workspace.list')).archivedSessionIds }
  async createSession(cwd: string, sessionId: string): Promise<string> { return (await this.call<{ sessionId: string }>('session.create', { cwd, sessionId })).sessionId }
  async searchSessions(query: string): Promise<{ items: Array<{ sessionId: string; snippet: string }>; hasMore: boolean }> { return await this.call('session.search', { query }) }
  async listSkills(sessionId: string): Promise<import('./protocol.js').SkillSummary[]> { return (await this.call<{ skills: import('./protocol.js').SkillSummary[] }>('skill.list', { sessionId })).skills }
  async listSubagents(parentSessionId: string): Promise<{ entries: import('./protocol.js').SubagentSummary[]; parentAvailable: boolean }> { return await this.call('subagent.list', { parentSessionId }) }
  async subagentHistory(parentSessionId: string, childSessionId: string, mode: 'one-shot' | 'continuable'): Promise<SessionEvent[]> {
    const all: SessionEvent[] = []
    let beforeSeq: number | undefined
    for (;;) {
      const result = await this.call<{ events: Array<SessionEvent | { event: SessionEvent; view?: unknown }>; hasMore: boolean }>('subagent.history', { parentSessionId, childSessionId, mode, maxMessages: 200, ...(beforeSeq === undefined ? {} : { beforeSeq }) })
      const page = result.events.map(entry => {
        if (typeof entry !== 'object' || entry === null || !('event' in entry)) return entry as SessionEvent
        const wrapped = entry as { event: SessionEvent; view?: unknown }
        return wrapped.view === undefined ? wrapped.event : { ...wrapped.event, view: wrapped.view }
      })
      all.unshift(...page)
      if (!result.hasMore || page.length === 0) break
      const oldest = page.reduce((min, event) => Math.min(min, event.seq), Number.POSITIVE_INFINITY)
      if (!Number.isFinite(oldest) || oldest <= 0 || oldest === beforeSeq) break
      beforeSeq = oldest
    }
    return all
  }
  async promptSubagent(parentSessionId: string, childSessionId: string, text: string): Promise<void> { await this.call('subagent.prompt', { parentSessionId, childSessionId, mode: 'continuable', content: [{ type: 'text', text }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }
  async interruptSubagent(parentSessionId: string, childSessionId: string): Promise<void> { await this.call('subagent.interrupt', { parentSessionId, childSessionId, mode: 'continuable' }) }
  async goalAction(sessionId: string, action: 'pause' | 'resume' | 'complete' | 'clear', ref: { id: string; revision: number }): Promise<void> { await this.call(`goal.${action}`, { sessionId, ref }) }
  async history(sessionId: string): Promise<SessionEvent[]> {
    const all: SessionEvent[] = []
    let beforeSeq: number | undefined
    for (;;) {
      const result = await this.call<{ events: Array<SessionEvent | { event: SessionEvent }>; hasMore: boolean }>('session.history', { sessionId, maxMessages: 200, ...(beforeSeq === undefined ? {} : { beforeSeq }) })
      const page = result.events.map(entry => {
        if (typeof entry !== 'object' || entry === null || !('event' in entry)) return entry as SessionEvent
        const wrapped = entry as { event: SessionEvent; view?: unknown }
        return wrapped.view === undefined ? wrapped.event : { ...wrapped.event, view: wrapped.view }
      })
      all.unshift(...page)
      if (!result.hasMore || page.length === 0) break
      const oldest = page.reduce((min, event) => Math.min(min, event.seq), Number.POSITIVE_INFINITY)
      if (!Number.isFinite(oldest) || oldest <= 0 || oldest === beforeSeq) break
      beforeSeq = oldest
    }
    return all
  }
  async prompt(sessionId: string, text: string, mode: 'queue' | 'steer', images: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string; name?: string }> = []): Promise<void> { await this.call('session.prompt', { sessionId, mode, content: [{ type: 'text', text }, ...images.map(image => ({ type: 'image', ...image }))], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }
  async cancel(sessionId: string): Promise<void> { await this.call('session.cancel', { sessionId }) }
  async updateQueue(sessionId: string, itemId: string, action: { kind: string; content?: Array<{ type: 'text'; text: string }> }): Promise<void> { await this.call('session.updateQueue', { sessionId, itemId, action }) }
  async selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<void> { await this.call('session.selectModel', { sessionId, provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }) }
  async renameSession(sessionId: string, title: string): Promise<string> { return (await this.call<{ title: string }>('session.rename', { sessionId, title })).title }
  async forkSession(sessionId: string): Promise<string> { return (await this.call<{ sessionId: string }>('session.fork', { sessionId })).sessionId }
  async archiveSession(sessionId: string): Promise<void> { await this.call('workspace.archiveSession', { sessionId }) }
  async executeCommand(sessionId: string, line: string): Promise<void> { await this.call('commands/execute', { args: { agentId: sessionId, line, images: [] } }) }
  async listCommands(sessionId: string): Promise<Array<{ name: string; description?: string }>> { const value = await this.call<unknown>('commands/list', { args: { agentId: sessionId } }); if (Array.isArray(value)) return value as Array<{ name: string; description?: string }>; if (typeof value === 'object' && value !== null && 'value' in value && Array.isArray((value as { value: unknown }).value)) return (value as { value: Array<{ name: string; description?: string }> }).value; return [] }
  async modelCatalog(sessionId?: string): Promise<ModelDirectory> { if (sessionId !== undefined) return await this.call<ModelDirectory>('session.models', { sessionId }); const host = await this.describe(); const catalog = await this.call<Pick<ModelDirectory, 'groups' | 'failures'>>('llm.models'); return { current: host, groups: catalog.groups, ...(catalog.failures === undefined ? {} : { failures: catalog.failures }) } }
}
