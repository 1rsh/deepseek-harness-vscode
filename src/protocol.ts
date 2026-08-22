export type JsonObject = Record<string, unknown>

export interface SessionEvent {
  type: string
  seq: number
  time?: number
  data: JsonObject
  [key: string]: unknown
}

export interface SessionSummary {
  sessionId: string
  cwd?: string
  updatedAt?: number
  running: boolean
  eventCount?: number
  origin?: 'subagent'
  parentSessionId?: string
  blank?: boolean
  agentPreset?: string
  projections?: { values?: { title?: string; permissions?: { currentValue?: string; options?: Array<{ value: string; name: string; description?: string }> }; goal?: GoalProjection | null; todos?: TodoItem[] | null; sessionStats?: { turns: number; steps: number; llmMs: number; toolMs: number; ttftMs: number; ttftSteps: number; decodeMs: number; decodeTokens: number }; tokenUsage?: { uncachedInputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number }; contextPressure?: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number }; contextBreakdown?: { systemTokens: number; toolsTokens: number; messageTokens: number } } }
}

export interface ApprovalRequest {
  requestId: string
  sessionId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
}

export interface QuestionOption { label: string; description?: string }
export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}
export interface QuestionRequest { requestId: string; sessionId: string; questions: QuestionItem[] }

export type RuntimeNotification =
  | { method: 'session.event'; params: { sessionId: string; event: SessionEvent } }
  | { method: 'session.status'; params: { sessionId: string; status: 'idle' | 'running' } }
  | { method: 'session.error'; params: { sessionId: string; message: string } }
  | { method: 'approval.requested'; params: ApprovalRequest }
  | { method: 'approval.resolved'; params: { requestId: string; sessionId: string; approvalId: string; outcome: string } }
  | { method: 'question.requested'; params: QuestionRequest }
  | { method: 'question.resolved'; params: { requestId: string; sessionId: string; outcome: string } }
  | { method: string; params: JsonObject }

export interface ContextReference {
  kind: 'selection' | 'file'
  uri: string
  path: string
  language: string
  startLine?: number
  endLine?: number
  text: string
}

export interface DraftAttachment { id: string; name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; size: number }
export interface CommandSummary { name: string; description?: string }
export interface ModelEffort { id: string; name: string; description?: string }
export interface ModelEntry { id: string; name: string; description?: string; reasoning?: { efforts: ModelEffort[]; defaultEffort?: string } }
export interface ModelDirectory { current: { provider: string; model: string; reasoningEffort?: string }; routable?: boolean; groups: Array<{ id: string; name: string; models: ModelEntry[] }>; failures?: Array<{ provider?: string; message?: string; code?: string }> }
export interface ContextUsage { pressureTokens: number; projectedTokens: number; contextWindow: number; breakdown?: { systemTokens: number; toolsTokens: number; messageTokens: number } }
export interface QueueItem { id: string; placement: 'queued' | 'steering' | 'context'; message?: { role?: string; content?: Array<{ type: string; text?: string; [key: string]: unknown }> }; preview?: string; text?: string | null }
export interface SessionJob { id: string; kind: string; label: string; status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'; detail?: string; startedAt: number; finishedAt?: number }
export interface SkillSummary { name: string; description: string; whenToUse?: string; modelInvocable: boolean }
export interface SubagentSummary { kind: 'child' | 'diagnostic'; id: string; parentSessionId?: string; mode?: 'one-shot' | 'continuable'; activity?: 'running' | 'inactive'; hasChildren?: boolean; label?: string; reason?: string; depth?: number; parentAvailable?: boolean }
export interface GoalProjection { goal: { id: string; revision: number; objective: string; phase: 'active' | 'paused' | 'blocked' | 'complete'; maxGoalRounds: number; blockedReason?: { code: string; message: string } }; roundsStarted: number; createdAt: number; updatedAt: number }
export interface TodoItem { content: string; status: 'pending' | 'in_progress' | 'completed' }
export interface ConfigurationOverview { writable: boolean; hasDocument: boolean; namespaces: Array<{ ns: string; applies: 'live' | 'restart'; revision: number; secrets: Array<{ path: string[]; set: boolean }>; keys?: string[] }>; providers: Array<{ provider: string; displayName: string; active: boolean; declared?: boolean }>; presets: Array<{ id: string; trust: 'system' | 'user'; isDefault: boolean; name?: string; description?: string; broken?: string }>; presetAuthorable?: boolean; presetHasDocument?: boolean; canSelectPreset?: boolean }
export interface SubagentHistory { parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable'; label?: string; activity?: 'running' | 'inactive'; parentAvailable?: boolean; events: SessionEvent[] }
export interface SessionInsights { goal?: GoalProjection | null; todos?: TodoItem[] | null; jobs: SessionJob[]; skills: SkillSummary[]; subagents: SubagentSummary[]; archived: Array<{ sessionId: string; title: string; updatedAt?: number }>; configuration?: ConfigurationOverview }

export type HostToWebview =
  | { type: 'bootstrap'; workspace?: string; sessions: SessionSummary[]; activeSessionId?: string; events: SessionEvent[]; running: boolean; contexts: ContextReference[]; attachments?: DraftAttachment[]; models?: ModelDirectory; permission?: string; permissionOptions?: Array<{ value: string; name: string; description?: string }>; stats?: string; commands?: CommandSummary[]; contextUsage?: ContextUsage; queue?: QueueItem[]; insights?: SessionInsights; submitOnEnter?: boolean; runtimeState?: 'starting' | 'ready' | 'failed'; error?: string }
  | { type: 'sessionSelected'; sessionId: string; events: SessionEvent[]; running: boolean; commands?: CommandSummary[]; contextUsage?: ContextUsage; queue?: QueueItem[] }
  | { type: 'sessionEvent'; sessionId: string; event: SessionEvent }
  | { type: 'sessionStatus'; sessionId: string; status: 'idle' | 'running' }
  | { type: 'projection'; sessionId: string; key: string; value: unknown; stats?: string; contextUsage?: ContextUsage }
  | { type: 'queue'; sessionId: string; items: QueueItem[] }
  | { type: 'insights'; sessionId?: string; insights: SessionInsights }
  | { type: 'sessions'; sessions: SessionSummary[]; activeSessionId?: string }
  | { type: 'sessionSearchResults'; query: string; items: Array<{ sessionId: string; snippet: string }> }
  | { type: 'fileResults'; query: string; items: Array<{ path: string; detail?: string }> }
  | { type: 'contexts'; contexts: ContextReference[] }
  | { type: 'attachments'; attachments: DraftAttachment[] }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'approvalResolved'; requestId: string }
  | { type: 'question'; request: QuestionRequest }
  | { type: 'questionResolved'; requestId: string }
  | { type: 'subagentHistory'; history: SubagentHistory }
  | { type: 'error'; message: string }
  | { type: 'actionComplete'; action: 'rename' | 'fork' | 'archive'; sessionId: string }
  | { type: 'runtimeState'; state: 'starting' | 'ready' | 'stopped' | 'failed'; message?: string }

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'newSession' }
  | { type: 'selectSession'; sessionId: string }
  | { type: 'send'; text: string; mode?: 'queue' | 'steer' }
  | { type: 'cancel' }
  | { type: 'removeContext'; uri: string; startLine?: number }
  | { type: 'approval'; requestId: string; approvalId: string; outcome: 'allowed-once' | 'rejected' }
  | { type: 'question'; requestId: string; answers: { id: string; selected: string[]; custom?: string }[] }
  | { type: 'openFile'; path: string; line?: number }
  | { type: 'openExternal'; url: string }
  | { type: 'restartRuntime' }
  | { type: 'openSettings' }
  | { type: 'openLogs' }
  | { type: 'addActiveFile' }
  | { type: 'searchFiles'; query: string }
  | { type: 'addFile'; path: string }
  | { type: 'pickAttachments' }
  | { type: 'removeAttachment'; id: string }
  | { type: 'selectModel'; provider: string; model: string; reasoningEffort?: string }
  | { type: 'selectPermission'; permission: string }
  | { type: 'runCommand'; line: string }
  | { type: 'refreshInsights' }
  | { type: 'invokeSkill'; name: string }
  | { type: 'viewSubagent'; parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable'; label?: string; activity?: 'running' | 'inactive'; parentAvailable?: boolean }
  | { type: 'promptSubagent'; parentSessionId: string; childSessionId: string; mode: 'continuable' }
  | { type: 'interruptSubagent'; parentSessionId: string; childSessionId: string; mode: 'continuable' }
  | { type: 'editSetting'; ns: string; revision: number }
  | { type: 'presetAction'; action: 'view' | 'copy' | 'open' | 'remove' | 'select'; agentPreset: string }
  | { type: 'goalAction'; action: 'pause' | 'resume' | 'complete' | 'clear'; id: string; revision: number }
  | { type: 'renameSession'; sessionId: string; title: string; newTitle?: string }
  | { type: 'forkSession'; sessionId: string }
  | { type: 'archiveSession'; sessionId: string }
  | { type: 'searchSessions'; query: string }
  | { type: 'updateQueue'; itemId: string; action: { kind: 'remove' | 'steer' } | { kind: 'edit'; text: string } }
  | { type: 'uiAck'; stage: string; detail?: string }
  | { type: 'clientError'; message: string }

export function isWebviewMessage(value: unknown): value is WebviewToHost {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && [
    'ready', 'newSession', 'selectSession', 'send', 'cancel', 'removeContext',
    'approval', 'question', 'openFile', 'openExternal', 'restartRuntime', 'openSettings', 'openLogs', 'addActiveFile', 'searchFiles', 'addFile', 'pickAttachments', 'removeAttachment', 'selectModel', 'selectPermission', 'runCommand', 'refreshInsights', 'invokeSkill', 'viewSubagent', 'promptSubagent', 'interruptSubagent', 'editSetting', 'presetAction', 'goalAction', 'renameSession', 'forkSession', 'archiveSession', 'searchSessions', 'updateQueue', 'uiAck', 'clientError',
  ].includes(type)
}
