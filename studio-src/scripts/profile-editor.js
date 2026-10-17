#!/usr/bin/env node
const fs = require('fs')
const http = require('http')
const path = require('path')

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH || 'playwright'
const { chromium } = require(PLAYWRIGHT)

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  if (i === -1) return def
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const OUT = opt('--out', null)
const TOP = Number(opt('--top', 14))
const QUERY = opt('--query', '')
const HEADED = argv.includes('--headed')
const rest = argv.filter(a => !a.startsWith('--'))
const FILE = rest[0]
const ALL = ['load', 'dom', 'idle', 'switch', 'tabs', 'scroll', 'drag', 'run']
const WANT = rest.length > 1 ? rest.slice(1) : ALL
if (!FILE) {
  console.error('usage: profile-editor.js <file.sb3> [scenario...] [--out dir] [--top N] [--headed]')
  process.exit(1)
}

const BUILD = path.join(__dirname, '../build')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.map': 'application/json' }

const serve = () => new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (url === '/__project') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      return fs.createReadStream(FILE).pipe(res)
    }
    const file = path.join(BUILD, path.normalize(url))
    if (!file.startsWith(BUILD) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  server.listen(0, '127.0.0.1', () => resolve(server))
})

const summarize = profile => {
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const self = new Map()
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (profile.timeDeltas[i] || 0)))
  const fns = new Map()
  let total = 0
  let idle = 0
  for (const [id, us] of self) {
    const f = byId.get(id).callFrame
    total += us
    if (f.functionName === '(idle)') {
      idle += us
      continue
    }
    const where = f.url ? `${f.url.split('/').pop()}:${f.lineNumber + 1}` : ''
    const key = `${f.functionName || '(anonymous)'} ${where}`
    fns.set(key, (fns.get(key) || 0) + us)
  }
  return {
    busyMs: (total - idle) / 1000,
    totalMs: total / 1000,
    top: [...fns].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([fn, us]) => ({ ms: (us / 1000).toFixed(1), fn }))
  }
}

const callers = profile => {
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id)
  const LIB = /^(|\(program\)|\(garbage collector\)|\(idle\))$/
  const out = new Map()
  profile.samples.forEach((id, i) => {
    const us = profile.timeDeltas[i] || 0
    const seen = new Set()
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const f = byId.get(cur).callFrame
      if (LIB.test(f.functionName) || !f.url) continue
      const key = `${f.functionName} ${f.url.split('/').pop()}:${f.lineNumber + 1}`
      if (seen.has(key)) continue
      seen.add(key)
      out.set(key, (out.get(key) || 0) + us)
    }
  })
  return [...out].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([fn, us]) => ({ ms: (us / 1000).toFixed(1), fn }))
}

const pct = (arr, p) => arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0

const main = async () => {
  const server = await serve()
  const base = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  await cdp.send('Performance.enable')
  const errors = []
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]))

  await page.addInitScript(() => {
    window.__perf = { frames: [], long: [] }
    let last = performance.now()
    const tick = now => {
      window.__perf.frames.push(now - last)
      last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    try {
      new PerformanceObserver(l => l.getEntries().forEach(e => window.__perf.long.push(e.duration)))
        .observe({ entryTypes: ['longtask'] })
    } catch (e) {  }
  })

  const metrics = async () => {
    const { metrics: m } = await cdp.send('Performance.getMetrics')
    const o = {}
    for (const x of m) o[x.name] = x.value
    return o
  }

  const measure = async (name, fn) => {
    await page.evaluate(() => { window.__perf.frames.length = 0; window.__perf.long.length = 0 })
    const before = await metrics()
    await cdp.send('Profiler.start')
    const t0 = Date.now()
    const extra = await fn()
    const wall = Date.now() - t0
    const { profile } = await cdp.send('Profiler.stop')
    const after = await metrics()
    const perf = await page.evaluate(() => ({ frames: window.__perf.frames.slice(), long: window.__perf.long.slice() }))
    const s = summarize(profile)
    const d = k => ((after[k] - before[k]) * 1000).toFixed(0)
    console.log(`\n=== ${name} ===`)
    console.log(`  wall ${wall}ms  main-thread busy ${s.busyMs.toFixed(0)}ms (${(100 * s.busyMs / s.totalMs).toFixed(0)}%)` +
      `  script ${d('ScriptDuration')}ms  style ${d('RecalcStyleDuration')}ms  layout ${d('LayoutDuration')}ms` +
      `  (recalcs ${after.RecalcStyleCount - before.RecalcStyleCount}, layouts ${after.LayoutCount - before.LayoutCount})`)
    console.log(`  frames ${perf.frames.length}  p50 ${pct(perf.frames, 0.5).toFixed(0)}ms  p95 ${pct(perf.frames, 0.95).toFixed(0)}ms` +
      `  worst ${Math.max(0, ...perf.frames).toFixed(0)}ms  long tasks ${perf.long.length}` +
      ` (${perf.long.reduce((a, b) => a + b, 0).toFixed(0)}ms)` +
      `  dom nodes ${after.Nodes}  heap ${(after.JSHeapUsedSize / 1048576).toFixed(0)}MB  listeners ${after.JSEventListeners}`)
    if (extra) console.log('  ' + extra)
    console.log('  self time:')
    for (const r of s.top) console.log(`    ${r.ms.padStart(8)}ms  ${r.fn}`)
    console.log('  inclusive (who asked for it):')
    for (const r of callers(profile)) console.log(`    ${r.ms.padStart(8)}ms  ${r.fn}`)
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true })
      fs.writeFileSync(path.join(OUT, `${name.replace(/\W+/g, '-')}.cpuprofile`), JSON.stringify(profile))
    }
  }

  const settle = (ms = 400) => page.evaluate(wait => new Promise(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))
  }), ms)
  const want = s => WANT.includes(s)

  await page.goto(`${base}/editor.html${QUERY ? `?${QUERY}` : ''}`)
  await page.waitForFunction(() => window.vm && window.vm.runtime && window.vm.editingTarget, null, { timeout: 120000 })
  await settle(1500)

  const load = () => page.evaluate(async () => {
    const buf = await (await fetch('/__project')).arrayBuffer()
    const t = performance.now()
    await window.vm.loadProject(buf)
    return `vm.loadProject ${(performance.now() - t).toFixed(0)}ms, ${window.vm.runtime.targets.length} targets`
  })
  if (want('load')) {
    await measure('load', async () => {
      const r = await load()
      await settle(1500)
      return r
    })
  } else {
    await load()
    await settle(1500)
  }

  const domReport = async label => {
    const rows = await page.evaluate(() => {
      const count = el => el ? el.getElementsByTagName('*').length : 0
      const q = s => document.querySelector(s)
      const ws = (window.Blockly && window.Blockly.getMainWorkspace()) || null
      const out = {
        'document': count(document.documentElement),
        'palette (flyout)': count(q('.blocklyFlyout')),
        'workspace blocks': count(q('.blocklySvg .blocklyBlockCanvas')),
        'toolbox categories': count(q('.blocklyToolboxDiv')),
        'stage + sprite pane': count(q('[class*=stage-and-target-wrapper]')),
        'menu bar': count(q('[class*=menu-bar_menu-bar]')),
        'flyout blocks': ws && ws.getFlyout() ? ws.getFlyout().getWorkspace().getAllBlocks().length : 0,
        'workspace block objects': ws ? ws.getAllBlocks().length : 0,
        'workspace variables': ws ? ws.getAllVariables().length : 0
      }
      const kids = [...document.body.children].map(c => [`body > ${c.tagName.toLowerCase()}${c.id ? '#' + c.id : ''}` +
        `${typeof c.className === 'string' && c.className ? '.' + c.className.split(' ')[0] : ''}`, count(c)])
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
      return Object.entries(out).concat(kids)
    })
    console.log(`\n=== dom: ${label} ===`)
    for (const [k, v] of rows) console.log(`  ${String(v).padStart(8)}  ${k}`)
  }
  if (want('dom')) await domReport('after load')

  if (want('idle')) {
    await measure('idle 6s (Code tab, project stopped)', () => page.waitForTimeout(6000))
  }

  if (want('switch')) {
    const ids = await page.evaluate(() => window.vm.runtime.targets.filter(t => t.isOriginal)
      .sort((a, b) => Object.keys(b.blocks._blocks).length - Object.keys(a.blocks._blocks).length)
      .slice(0, 6).map(t => ({ id: t.id, name: t.getName(), blocks: Object.keys(t.blocks._blocks).length })))
    const one = async (label, list) => {
      const times = []
      await measure(label, async () => {
        for (const t of list) {
          times.push(await page.evaluate(id => new Promise(resolve => {
            const t0 = performance.now()
            window.vm.setEditingTarget(id)
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)))
          }), t.id))
          await settle(300)
        }
        return list.map((t, i) => `${t.name}(${t.blocks}b) ${times[i].toFixed(0)}ms`).join('  ')
      })
    }
    await one('sprite switch, first visit', ids)
    await one('sprite switch, revisit', ids)
  }

  if (want('dom') && want('switch')) await domReport('after sprite switches')

  if (want('tabs')) {
    const tabs = []
    for (const t of await page.$$('[class*=gui_tab-list] [role=tab]')) if (await t.isVisible()) tabs.push(t)
    const names = await Promise.all(tabs.map(t => t.innerText()))
    await measure('tab round trip', async () => {
      const out = []
      for (const i of [...tabs.keys()].slice(1).concat(0)) {
        const t0 = Date.now()
        await tabs[i].click()
        await settle(0)
        out.push(`${names[i].trim() || i} ${Date.now() - t0}ms`)
        await settle(500)
      }
      return out.join('  ')
    })
  }

  const wsBox = async () => {
    const el = await page.$('.injectionDiv .blocklySvg')
    return el ? el.boundingBox() : null
  }

  if (want('scroll')) {
    const box = await wsBox()
    if (box) {
      await measure('workspace scroll (60 wheel events)', async () => {
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5)
        for (let i = 0; i < 60; i++) {
          await page.mouse.wheel(0, i < 30 ? 60 : -60)
          await page.waitForTimeout(16)
        }
        await settle(200)
      })
    } else console.log('\n(scroll skipped: no workspace)')
  }

  if (want('drag')) {
    const pt = await page.evaluate(() => {
      const ws = window.Blockly && window.Blockly.getMainWorkspace()
      if (!ws) return null
      const m = ws.getMetrics()
      const tops = ws.getTopBlocks(false).map(b => ({ b, n: b.getDescendants(false).length }))
        .sort((a, b) => b.n - a.n)
      for (const { b, n } of tops) {
        const r = b.getSvgRoot().getBoundingClientRect()
        const wsr = ws.getParentSvg().getBoundingClientRect()
        if (r.left > wsr.left + m.flyoutWidth + 20 && r.top > wsr.top && r.left < wsr.right - 200 && r.top < wsr.bottom - 100) {
          return { x: r.left + 12, y: r.top + 12, n }
        }
      }
      return null
    })
    if (pt) {
      await measure(`drag a ${pt.n}-block script (60 moves)`, async () => {
        await page.mouse.move(pt.x, pt.y)
        await page.mouse.down()
        for (let i = 1; i <= 60; i++) {
          await page.mouse.move(pt.x + i * 4, pt.y + Math.sin(i / 6) * 40)
          await page.waitForTimeout(16)
        }
        await page.mouse.move(pt.x, pt.y)
        await page.mouse.up()
        await settle(300)
      })
    } else console.log('\n(drag skipped: no script on screen)')
  }

  if (want('run')) {
    await measure('running 6s (green flag)', async () => {
      await page.evaluate(() => window.vm.greenFlag())
      await page.waitForTimeout(6000)
      const r = await page.evaluate(() => `threads ${window.vm.runtime.threads.length}, clones ${window.vm.runtime._cloneCounter}, ` +
        `targets ${window.vm.runtime.targets.length}`)
      await page.evaluate(() => window.vm.stopAll())
      return r
    })
    await settle(500)
    await measure('idle 4s after stop', () => page.waitForTimeout(4000))
  }

  if (errors.length) {
    console.log('\npage errors:')
    for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e)
  }
  await browser.close()
  server.close()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
