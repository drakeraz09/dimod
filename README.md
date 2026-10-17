# Dimod

THIS IS DIMOD!!!!! I only recently learned the license is gpl3.0, but i dont wanna open source EVERYTHING so its just gonna be the studio and all of its subsets. Youre not gonna get any git history here. Sorry!

Dimod is a fork of [PenguinMod](https://github.com/PenguinMod) (which is a fork of [TurboWarp](https://github.com/TurboWarp), which is a fork of [Scratch](https://github.com/scratchfoundation)). Huge thanks to everyone who made those.

## whats in here

- `studio-src` - the editor, forked from [PenguinMod's GUI](https://github.com/PenguinMod/penguinmod.github.io)
- `paint-src` - the costume editor, forked from [PenguinMod-Paint](https://github.com/PenguinMod/PenguinMod-Paint)
- `packager-src` - the packager, forked from [PenguinMod-Packager](https://github.com/PenguinMod/PenguinMod-Packager)
- `apply-node-patches.py` - patches a few things inside node_modules (scratch-render, scratch-vm, scratch-svg-renderer). npm install wipes them so run it again after every install

The website and backend arent in here.

## building

you need node (22 works) and python 3. keep the folders next to each other, they reach into each other.

```
cd paint-src && npm install && cd ..
cd studio-src && npm install && cd ..
cd packager-src && npm install && cd ..
python3 apply-node-patches.py
cd studio-src && npm run build
```

`npm start` in studio-src runs a dev server on port 3000. the packager builds with `npm run build` in packager-src.

saving, accounts, collab and all that talk to the dimod backend (`/api`), so on your own build those wont work.

## license

studio-src and paint-src are GPL-3.0, packager-src is Apache-2.0. each folder has its own LICENSE file. Scratch, TurboWarp and PenguinMod belong to the people who made them.
