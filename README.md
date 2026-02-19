<p align = "center">
  <img src="./assets/eclia-day.png#gh-dark-mode-only" width="300">
  <img src="./assets/eclia-night.png#gh-light-mode-only" width="300">
</p>

<div align = "center">
I <em>remember</em> u.
</div>

### Install

```bash
npm install pnpm
pnpm install
#Install CodeX cli if you want to login with your OpenAI account to use CodeX
#OAuth is handled by CodeX itself under repo/.codex.
npm i -g @openai/codex
```

### Launch

```bash
#Launch ECLIA
pnpm dev:all
#More launch options are available in package.json.
```

## Informations you might want to know

- Session data and its artifacts (Large output or files produced by model) are saved under repo/.eclia. Slashcommand /clear basically remove all of them while keeping the session structure.
- Minimax is suggested for terminal tasks since it's impressive terminal performance.
- Most of your preferences and important informations like token or api key was stored at repo/eclia.config.local.toml. Do not send this to anyone.