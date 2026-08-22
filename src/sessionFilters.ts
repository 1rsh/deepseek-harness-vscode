import * as path from 'node:path'
import type { SessionSummary } from './protocol.js'

export function visibleWorkspaceSessions(
  sessions: SessionSummary[],
  archivedIds: Iterable<string>,
  cwd: string,
): SessionSummary[] {
  const archived = new Set(archivedIds)
  let keptBlank = false
  return sessions.filter(session => {
    if (archived.has(session.sessionId)) return false
    if (session.origin === 'subagent') return false
    if (session.cwd !== undefined && path.resolve(session.cwd) !== cwd) return false
    if (session.blank !== true) return true
    if (keptBlank) return false
    keptBlank = true
    return true
  })
}
