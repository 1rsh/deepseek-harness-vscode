import { describe, expect, it } from 'vitest'
import { visibleWorkspaceSessions } from '../src/sessionFilters.js'
import type { SessionSummary } from '../src/protocol.js'

const cwd = '/workspace/project'
const session = (sessionId: string, fields: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId,
  cwd,
  running: false,
  ...fields,
})

describe('visibleWorkspaceSessions', () => {
  it('filters archives, subagents, and other workspaces', () => {
    const sessions = [
      session('kept'),
      session('archived'),
      session('child', { origin: 'subagent' }),
      session('elsewhere', { cwd: '/workspace/elsewhere' }),
    ]
    expect(visibleWorkspaceSessions(sessions, ['archived'], cwd).map(item => item.sessionId)).toEqual(['kept'])
  })

  it('keeps only one reusable blank session', () => {
    const sessions = [session('blank-newest', { blank: true }), session('blank-old', { blank: true }), session('history', { blank: false })]
    expect(visibleWorkspaceSessions(sessions, [], cwd).map(item => item.sessionId)).toEqual(['blank-newest', 'history'])
  })
})
