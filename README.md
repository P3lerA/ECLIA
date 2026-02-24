<p align = "center">
  <img src="./assets/eclia-day.png#gh-dark-mode-only" width="300">
  <img src="./assets/eclia-night.png#gh-light-mode-only" width="300">
</p>

<div align = "center">
I <em>remember</em> u.
</div>

### Install and Launch

```bash
#install pnpm and ECLIA
npm install pnpm
pnpm install
#Install CodeX cli if you want to login with your OpenAI account to use CodeX
#OAuth is handled by CodeX itself under repo/.codex.
npm i -g @openai/codex

#Launch ECLIA
pnpm dev:all
```

## Security

ECLIA requires elevated permissions for certain privacy and security functions. Please be aware that:

- The installation of ANY skills and plugins should be treated as arbitrary code execution.
- Personal informations and tokens are stored under /.eclia and *.local.toml.