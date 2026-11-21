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
  current: '当前默认输出',
  unavailable: '未检测到音频输出',
  switching: '正在切换...',
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

test('current output renders one menu picker instead of a disabled action', () => {
  const html = render({ id: 'dac', available: true, isDefault: true, displayName: '耳机 (Macchiato)' })

  assert.match(html, /macchiato-output-picker/)
  assert.match(html, /当前默认输出/)
  assert.doesNotMatch(html, /class="macchiato-output-action"/)
  assert.match(html, /aria-haspopup="menu"/)
})

test('no quick-switch target still renders a neutral output picker', () => {
  const html = render({ id: '', available: false, isDefault: false, displayName: '' })

  assert.match(html, /macchiato-output-picker/)
  assert.match(html, /选择音频输出/)
  assert.doesNotMatch(html, /未检测到音频输出/)
  assert.doesNotMatch(html, /class="macchiato-output-action"/)
})

test('an available non-current target renders the switch action and menu button', () => {
  const html = render({ id: 'realtek', available: true, isDefault: false, displayName: '扬声器 (Realtek)' })

  assert.match(html, /class="macchiato-output-action"/)
  assert.match(html, /切换到 耳机 \(Macchiato\)/)
  assert.match(html, /class="macchiato-output-menu"/)
  assert.doesNotMatch(html, /macchiato-output-picker/)
})

test('an offline saved target renders the unavailable picker', () => {
  const html = render({ id: 'gone', available: false, isDefault: false, displayName: 'USB DAC' })

  assert.match(html, /macchiato-output-picker/)
  assert.match(html, /未检测到音频输出/)
  assert.match(html, /title="USB DAC"/)
  assert.doesNotMatch(html, /class="macchiato-output-action"/)
})
