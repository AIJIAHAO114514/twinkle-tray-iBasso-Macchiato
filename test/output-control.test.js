const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Module = require('module')

const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const babel = require('@babel/core')

const componentPath = path.join(__dirname, '..', 'src', 'components', 'MacchiatoOutputControl.jsx')

function loadComponent() {
  const source = fs.readFileSync(componentPath, 'utf8')
  const { code } = babel.transformSync(source, {
    filename: componentPath,
    presets: [[require('@babel/preset-react'), { runtime: 'classic' }]]
  })

  const loaded = new Module(componentPath, module)
  loaded.filename = componentPath
  loaded.paths = Module._nodeModulePaths(path.dirname(componentPath))
  loaded._compile(code, componentPath)
  return loaded.exports.default
}

const MacchiatoOutputControl = loadComponent()
const labels = {
  title: '音频输出',
  set: '切换到 耳机 (Macchiato)',
  failed: '切换失败，重试',
  menu: '选择音频输出'
}

function render(output) {
  return renderToStaticMarkup(React.createElement(MacchiatoOutputControl, {
    output,
    labels,
    onSelect: () => Promise.resolve({ ok: true }),
    onOpenMenu: () => Promise.resolve(true)
  }))
}

test('a switchable target renders the switch action and a separate menu button', () => {
  const html = render({ id: 'realtek', available: true, isDefault: false, displayName: '扬声器 (Realtek)' })

  assert.match(html, /class="macchiato-output-action"/)
  assert.match(html, /切换到 耳机 \(Macchiato\)/)
  assert.match(html, /title="扬声器 \(Realtek\)"/)

  // The two controls are decoupled: the switch action never opens the menu.
  assert.match(html, /class="macchiato-output-menu"/)
  const actionIndex = html.indexOf('macchiato-output-action')
  const menuIndex = html.indexOf('macchiato-output-menu')
  assert.notStrictEqual(actionIndex, -1)
  assert.notStrictEqual(menuIndex, -1)
  assert.notStrictEqual(actionIndex, menuIndex)
  assert.doesNotMatch(html.slice(actionIndex, menuIndex), /aria-haspopup/)
})

test('the menu button is a standalone menu trigger, not the switch target', () => {
  const html = render({ id: 'realtek', available: true, isDefault: false, displayName: '扬声器 (Realtek)' })

  const menuButton = html.slice(html.indexOf('macchiato-output-menu'))
  assert.match(menuButton, /aria-haspopup="menu"/)
  assert.match(menuButton, /aria-label="选择音频输出"/)
  assert.doesNotMatch(menuButton, /切换到/)
})

test('no switch target renders only the menu button', () => {
  const html = render({ id: '', available: false, isDefault: false, displayName: '' })

  assert.doesNotMatch(html, /class="macchiato-output-action"/)
  assert.doesNotMatch(html, /切换到/)
  assert.match(html, /class="macchiato-output-menu"/)
  assert.match(html, /aria-label="选择音频输出"/)
})

test('an offline target hides the switch action but keeps the menu', () => {
  const html = render({ id: 'gone', available: false, isDefault: false, displayName: 'USB DAC' })

  assert.doesNotMatch(html, /class="macchiato-output-action"/)
  assert.match(html, /class="macchiato-output-menu"/)
})

test('a switch in progress never flashes the button', () => {
  // No pending state exists: the button renders identically before, during
  // and after a switch, so there is no "switching" re-render to flicker.
  const source = fs.readFileSync(componentPath, 'utf8')

  // No "switching" status string or pending visual state remains.
  assert.doesNotMatch(source, /"switching"/)
  assert.doesNotMatch(source, /labels\.switching/)
  assert.doesNotMatch(source, /setPending|useState\(false\)[^\n]*pending/)
  assert.match(source, /pendingRef/)

  // The rendered button carries only the steady states.
  const html = render({ id: 'realtek', available: true, isDefault: false, displayName: '扬声器 (Realtek)' })
  assert.match(html, /data-state="set"/)
  assert.doesNotMatch(html, /data-state="switching"/)
  assert.doesNotMatch(html, /disabled/)
})
