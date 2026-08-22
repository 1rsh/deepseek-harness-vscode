import { describe, expect, it } from 'vitest'
import { isWebviewMessage } from '../src/protocol.js'

describe('webview protocol', () => {
  it('accepts known actions', () => {
    expect(isWebviewMessage({ type: 'ready' })).toBe(true)
    expect(isWebviewMessage({ type: 'send', text: 'hello' })).toBe(true)
    expect(isWebviewMessage({ type: 'openExternal', url: 'https://example.test' })).toBe(true)
    expect(isWebviewMessage({ type: 'refreshInsights' })).toBe(true)
    expect(isWebviewMessage({ type: 'goalAction', action: 'pause', id: 'g', revision: 1 })).toBe(true)
    expect(isWebviewMessage({ type: 'viewSubagent', parentSessionId: 'p', childSessionId: 'c', mode: 'one-shot' })).toBe(true)
    expect(isWebviewMessage({ type: 'editSetting', ns: 'llm', revision: 2 })).toBe(true)
  })

  it('rejects malformed and unknown actions', () => {
    expect(isWebviewMessage(null)).toBe(false)
    expect(isWebviewMessage({ type: 'shell' })).toBe(false)
    expect(isWebviewMessage({})).toBe(false)
  })
})
