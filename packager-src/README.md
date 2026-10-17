# Dimod Packager

Lives at dimod.org/packager. Turns a Dimod project (a `.warp` file) into a single HTML file, a zip, or a
program for Windows, macOS or Linux, to put anywhere. It runs entirely in the visitor's browser.

Cloud projects can't be packaged: their server code and database run on Dimod's game server. The page refuses
a project with a top-level `dimodServer` field or `event_dimod_*` Client blocks (`src/dimod/cloud-check.js`).

## What it is

A fork of the PenguinMod Packager (Apache-2.0), itself a fork of the TurboWarp Packager (MPL-2.0, by
Thomas Weber / GarboMuffin). LICENSE is the fork's own. The credits line in every packaged project comes from
`src/packager/brand.js`.

What Dimod changed:

- `src/dimod/runtime.js` installs Dimod's runtime into the packaged project's VM: Dimod's own blocks
  (map, wrap, round, distance, seconds since 2000...), complex sprites and the VM patches they need. It is the
  *studio's* code (`studio-src/src/lib/dimod-player-runtime.js`), imported at build time, so a packaged project
  runs exactly what the editor's player runs. The multiplayer parts (Client blocks, the Server tab, cloud
  variables) are left out on purpose; `world.server` in complex code is quietly offline, as it is anywhere but Dimod.
- `src/dimod/cloud-check.js` and `src/p4/SelectProject.svelte`: `.warp` (and `.sb3`) files only, no loading by
  project id or URL, and the cloud refusal.
- `src/packager/brand.js`, `src/p4/P4.svelte`, `src/p4/template.ejs`: Dimod's name, colours and links.
- `package.json` pins scratch-vm, scratch-render, scratch-audio, scratch-storage and scratch-svg-renderer to the
  same commits as `studio-src`, so a packaged project's VM is the editor's VM. When the studio's move, move these.
- `webpack.config.js` builds the studio's modules with the packager's own scratch-vm (one VM in the bundle).

## Building and deploying

```
npm install --legacy-peer-deps
NODE_ENV=production NODE_OPTIONS=--openssl-legacy-provider npm run build   # output: dist/
```

`../deploy.sh packager` does the build and copies `dist/` into `../frontend/public/packager`, which the
frontend build ships and `frontend/serve.cjs` serves at `/packager/`. It also rebuilds when the studio's
VM-only modules change.

Packaged projects made by a development build are far bigger and shouldn't be distributed.
