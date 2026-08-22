# Contributing

Issues and pull requests are welcome.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run package
```

Press **F5** in VS Code (using the included `.vscode/launch.json`) to run the extension in a development host, or install the generated `.vsix` directly.

## Before opening a PR

- `npm run typecheck`, `npm test`, and `npm run build` should all pass.
- Keep changes focused; unrelated formatting/refactors make review harder.
- Update `CHANGELOG.md` for user-visible changes.
