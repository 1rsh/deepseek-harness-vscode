import * as vscode from 'vscode'
import { ChatViewProvider } from './chatView.js'
import { HarnessServer } from './harnessServer.js'

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DeepSeek Harness', { log: true })
  const harnessServer = new HarnessServer(output, context.globalStorageUri.fsPath)
  const webUrl = vscode.workspace.getConfiguration('deepseekHarness').get<string>('web.url', 'http://127.0.0.1:3080')
  harnessServer.ensureRunning(webUrl).catch(error => output.appendLine(`[harness] startup auto-start failed: ${error instanceof Error ? error.message : String(error)}`))
  const provider = new ChatViewProvider(context.extensionUri, context, output, harnessServer)
  context.subscriptions.push(
    output,
    harnessServer,
    provider,
    vscode.window.registerWebviewViewProvider('deepseekHarness.chat', provider),
    vscode.commands.registerCommand('deepseekHarness.newSession', () => provider.newSession()),
    vscode.commands.registerCommand('deepseekHarness.focusChat', () => provider.focus()),
    vscode.commands.registerCommand('deepseekHarness.addSelection', async () => {
      try { await provider.addSelection(); provider.focus() } catch (error) { void vscode.window.showErrorMessage(String(error)) }
    }),
    vscode.commands.registerCommand('deepseekHarness.addActiveFile', async () => {
      try { await provider.addActiveFile(); provider.focus() } catch (error) { void vscode.window.showErrorMessage(String(error)) }
    }),
    vscode.commands.registerCommand('deepseekHarness.cancelTurn', () => provider.cancel()),
    vscode.commands.registerCommand('deepseekHarness.restartRuntime', () => provider.restart()),
    vscode.commands.registerCommand('deepseekHarness.openLogs', () => output.show()),
    vscode.window.onDidChangeActiveTextEditor(() => { void provider.rebindWorkspace() }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void provider.rebindWorkspace() }),
  )
}

export function deactivate(): void {}
