# Dev Setup

- Switch to project root: Ex: `cd /Desktop/projects/useai-v3`
- Terminal1: `pnpm dev`(Compiles all packages and also does watches for files changes), This also runs dashboard in dev mode
- Terminal2: `cd packages/daemon && pnpm start`(Runs the daemon server, and also watches for files changes happened in terminal 1 and restarts the server, Note this exclude dashboard updates.)
- Terminal 3: `node packages/cli/dist/bin.js setup --yes`(Installs useai in all detected AI tools)

# If you wish to remove useai from all tools

`node packages/cli/dist/bin.js setup --remove`
