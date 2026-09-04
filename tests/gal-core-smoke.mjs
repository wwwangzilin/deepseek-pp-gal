/**
 * GAL 叠加层核心逻辑冒烟测试
 * 从 entrypoints/gal-view.content.ts 提取纯函数逻辑验证。
 * 运行：node tests/gal-core-smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const src = readFileSync(join(root, 'entrypoints', 'gal-view.content.ts'), 'utf8')

let passed = 0
let failed = 0
function assert(cond, name, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail ? ' :: ' + detail : '')) }
}

// 抽取打字机/分页纯函数（用 vm 包裹最小环境执行文件主体前先截取函数段）
// 更稳的方式：正则提取关键函数源码后 eval。
function extractFn(name) {
  const m = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g')
  const start = m.exec(src)
  if (!start) return null
  // 括号配对截取
  let depth = 0
  let i = src.indexOf('{', start.index)
  const fnStart = start.index
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  return src.slice(fnStart, i)
}
function extractArrowFn(name) {
  const m = new RegExp('(?:const|let|var) ' + name + ' = \\\\([\\\\s\\\\S]*?\\\\) => \\\\{', 'g')
  return null
}

console.log('== 打字机 reducer ==')
{
  const code = extractFn('createTypeState') + '\n' + extractFn('setTarget') + '\n' + extractFn('skip') + '\n' + extractFn('advance') + '\nreturn {createTypeState,setTarget,skip,advance}'
  const mod = new Function(code)()
  const s0 = mod.createTypeState()
  assert(s0.done === true && s0.target === '', '初始状态')

  const s1 = mod.setTarget(s0, '你好喵')
  assert(s1.target === '你好喵' && s1.done === false, '设置目标')
  const s2 = mod.advance(s1, 1000, 24)
  assert(s2.shown.length > 0 && s2.shown.length <= s2.target.length, '逐字推进')
  assert(s2.target.startsWith(s2.shown), 'shown 是 target 前缀')
  const s3 = mod.skip(s1)
  assert(s3.shown === '你好喵' && s3.done === true, '跳过追平')
}

console.log('== 分页 ==')
{
  const code = extractFn('splitPages')
  const mod = new Function('const MAX_PAGES=24\nconst BREAK_PUNCT=/[。！？!?；;…\\n]/\n' + code + '\nreturn {splitPages}')()
  const pages = mod.splitPages('这是一句比较长的台词内容，用来测试分页。第二句话。', (p) => p.length <= 8)
  assert(pages.length > 1, '长文本分页', 'pages=' + pages.length)
  const joined = pages.join('')
  assert(joined.includes('这是一句比较长') && joined.includes('第二句话'), '分页拼接还原文本')
  assert(pages.every((p) => p.length <= 10), '每页不超容量')
}

console.log('== markdown 剥离 ==')
{
  const m = src.match(/function stripMarkdown[\s\S]*?\n}/)
  assert(m !== null, 'stripMarkdown 函数存在')
  if (m) {
    const mod = new Function(m[0] + '\nreturn {stripMarkdown}')()
    const out = mod.stripMarkdown('**加粗** 和 `代码` 还有 [链接](http://x) 和\n```js\ncode\n```\n结尾')
    assert(!out.includes('**') && !out.includes('```'), '剥除 markdown 标记')
    assert(out.includes('加粗') && out.includes('链接') && out.includes('code'), '保留正文')
  }
}

console.log('== 角色卡与 prompt ==')
{
  const m1 = src.match(/function defaultCharacter[\s\S]*?\n}/)
  const m2 = src.match(/function buildCharacterSystemPrompt[\s\S]*?\n}/)
  assert(m1 !== null && m2 !== null, '角色函数存在')
  if (m1 && m2) {
    const mkid = "function makeId(p){return p+'-'+Math.random().toString(36).slice(2,8)+Date.now().toString(36)}"
    const stub = "const ASSET_AVATAR='chrome-extension://test/gal/char.png'"
    const mod = new Function(mkid + '\n' + stub + '\n' + m1[0] + '\n' + m2[0] + '\nreturn {defaultCharacter,buildCharacterSystemPrompt}')()
    const c = mod.defaultCharacter()
    assert(c.avatar === 'chrome-extension://test/gal/char.png', '默认角色带内置立绘')
    assert(c.name === 'DeepSeek娘' && c.id, '默认角色创建')
    const p = mod.buildCharacterSystemPrompt(c)
    assert(p.includes('你是「DeepSeek娘」'), 'prompt 含角色名')
    assert(p.includes('【角色设定】') && p.includes(c.description.slice(0, 5)), 'prompt 含设定')
  }
}

console.log('== 雪璃预设 ==')
{
  const m = src.match(/function presetSnowCrystal[\s\S]*?\n}/)
  assert(m !== null, '雪璃预设函数存在')
  if (m) {
    const mkid = "function makeId(p){return p+'-'+Math.random().toString(36).slice(2,8)+Date.now().toString(36)}"
    const stub = "const ASSET_AVATAR='chrome-extension://test/gal/char.png'"
    const mod = new Function(mkid + '\n' + stub + '\n' + m[0] + '\nreturn {presetSnowCrystal}')()
    const c = mod.presetSnowCrystal()
    assert(c.name === '雪璃' && c.avatar === 'chrome-extension://test/gal/char.png', '雪璃预设带内置立绘')
    assert(c.systemPrompt.includes('喵'), '雪璃预设含猫娘系统指令')
  }
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
