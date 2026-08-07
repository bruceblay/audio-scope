/** Bundle and render the production effects graph in a real headless Chrome. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
const chrome = candidates.find((candidate) => existsSync(candidate))
if (!chrome) {
  console.error('No Chrome/Chromium found. Set CHROME_PATH to run the Web Audio render.')
  process.exit(1)
}

const directory = mkdtempSync(join(tmpdir(), 'audio-scope-fx-'))
let browser = null
try {
  const script = join(directory, 'test.js')
  const html = join(directory, 'test.html')
  buildSync({
    entryPoints: [process.env.FX_BROWSER_ENTRY ?? 'test/fx.browser.test.ts'],
    bundle: true,
    format: 'iife',
    outfile: script,
  })
  writeFileSync(html, '<!doctype html><body>WAIT</body><script src="test.js"></script>')
  const pageUrl = `${pathToFileURL(html).href}?mode=${encodeURIComponent(process.env.FX_BROWSER_MODE ?? '')}`
  browser = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${join(directory, 'chrome-profile')}`,
    pageUrl,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  const debuggerUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome did not open its debugger')), 5000)
    browser.stderr.on('data', (chunk) => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/)
      if (!match) return
      clearTimeout(timeout)
      resolve(match[1])
    })
    browser.once('error', reject)
    browser.once('exit', (code) => reject(new Error(`Chrome exited before the test (code ${code})`)))
  })

  const { port } = new URL(debuggerUrl)
  let page
  for (let i = 0; i < 50 && !page; i++) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
    page = targets.find((target) => target.type === 'page' && target.url.startsWith('file:'))
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!page) throw new Error('Chrome did not expose the audio test page')

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let messageId = 0
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const id = ++messageId
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      socket.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result.result.value)
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })

  let result = 'FAIL browser render timed out'
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const text = await evaluate('document.body.textContent')
    if (text && !text.startsWith('WAIT') && !text.startsWith('RUN')) {
      result = text
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  socket.close()
  console.log(result)
  if (!result.startsWith('PASS')) process.exitCode = 1
} finally {
  browser?.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 100))
  rmSync(directory, { recursive: true, force: true })
}
