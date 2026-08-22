import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebHostClient } from '../src/webHostClient.js'

afterEach(() => vi.unstubAllGlobals())

describe('WebHostClient interaction responses', () => {
  it('wraps answers in a successful client-response result', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => new Response(JSON.stringify({ accepted: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new WebHostClient().respond('rpc-1', { sessionId: 'session-1', outcome: 'rejected' })
    const init = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toEqual({
      type: 'client-response',
      rpcId: 'rpc-1',
      result: { ok: true, value: { sessionId: 'session-1', outcome: 'rejected' } },
    })
  })

  it('rejects a non-accepted response receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accepted: false, reason: 'bad-response' }), { status: 200 })))
    await expect(new WebHostClient().respond('rpc-2', {})).rejects.toThrow('bad-response')
  })

  it('uses exact revision-fenced settings and child-agent RPC shapes', async () => {
    const requests: Array<{ method: string; payload: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string; payload: Record<string, unknown> }
      requests.push(request)
      const value = request.method === 'subagent.list' ? { entries: [], parentAvailable: true }
        : request.method === 'subagent.history' ? { events: [], hasMore: false }
          : request.method === 'subagent.prompt' ? { messageId: 'm1' }
            : request.method === 'subagent.interrupt' ? { accepted: true }
              : { ns: 'models', revision: 4 }
      return new Response(JSON.stringify({ result: { ok: true, value } }), { status: 200 })
    }))
    const client = new WebHostClient()
    await client.mutateSetting('models', 3, { op: 'set', path: ['temperature'], value: 0.2 })
    await client.listSubagents('parent')
    await client.subagentHistory('parent', 'child', 'continuable')
    await client.promptSubagent('parent', 'child', 'continue')
    await client.interruptSubagent('parent', 'child')
    expect(requests[0]).toMatchObject({ method: 'settings.mutate', payload: { ns: 'models', expectedRevision: 3, ops: [{ op: 'set', path: ['temperature'], value: 0.2 }] } })
    expect(requests[1]).toMatchObject({ method: 'subagent.list', payload: { parentSessionId: 'parent' } })
    expect(requests[2]).toMatchObject({ method: 'subagent.history', payload: { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable', maxMessages: 200 } })
    expect(requests[3]).toMatchObject({ method: 'subagent.prompt', payload: { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable', content: [{ type: 'text', text: 'continue' }] } })
    expect(requests[4]).toMatchObject({ method: 'subagent.interrupt', payload: { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable' } })
  })
})
