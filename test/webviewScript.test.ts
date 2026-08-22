import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function renderedWebviewScript(): string {
  const source = readFileSync(`${process.cwd()}/src/chatView.ts`, 'utf8')
  const marker = 'const script = `'
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const raw = source.slice(start + marker.length).replace(/`\s*$/, '')
    .replace('${JSON.stringify(dshIcons)}', '{}')
  return Function(`return \`${raw}\``)() as string
}

describe('webview script', () => {
  it('remains valid JavaScript after template-literal rendering', () => {
    expect(() => Function(renderedWebviewScript())).not.toThrow()
  })

  it('keeps discovery, draft, queue, and rich-content behaviors wired', () => {
    const rendered = renderedWebviewScript()
    expect(rendered).toContain("reference=raw.match(/@([^\\s@]*)$/)")
    expect(rendered).toContain('fileQuery=null')
    expect(rendered).toContain('function beginRename')
    expect(rendered).toContain('function renderInsights')
    expect(rendered).toContain('vscode.getState?.()')
    expect(rendered).toContain('vscode.setState({draft:')
    expect(rendered).toContain('setRuntimeState(m.runtimeState,m.error)')
    expect(rendered).toContain('function setRuntimeState')
    expect(rendered).toContain("text.split(/\\x60{3}/)")
    expect(rendered).toContain("post({type:'openExternal',url:match[7]})")
    expect(rendered).toContain('function renderInline')
    expect(rendered).toContain('function renderBlock')
    expect(rendered).toContain('textContent(item.message?.content)')
    expect(rendered).toContain("'steering current turn'")
    expect(rendered).toContain('function renderSubagentHistory')
    expect(rendered).toContain("post({type:'editSetting'")
    expect(rendered).toContain("post({type:'promptSubagent'")
    expect(rendered).toContain("post({type:'interruptSubagent'")
  })
})
