/**
 * GAL 酒馆叠加层（ISOLATED world）— 移植自 ds-gal-tavern content.js
 *
 * 叠加在 deepseek-pp 之上：隐藏 DeepSeek 原界面，显示 Galgame 舞台。
 * 角色卡激活时，把角色系统提示词同步为 deepseek-pp 的激活预设
 * （经 runtime 消息 SAVE_PRESET / SET_ACTIVE_PRESET），
 * 复用 deepseek-pp 的完整注入管线（记忆/Skill/工具/项目上下文）。
 *
 * 回复文本：不重复拦截请求（deepseek-pp 已拦），用 DOM 兜底读取页面渲染正文。
 */

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_idle',
  async main() {
    // ── 常量 ──────────────────────────────────────────────────────
const NS = 'dsgpp-gal'
const STORAGE_CHARS = 'dsgpp_gal_characters'
const STORAGE_ACTIVE = 'dsgpp_gal_active_character'
const STORAGE_ENABLED = 'dsgpp_gal_enabled'
const STAGE_W = 960
const STAGE_H = 540

const BUILTIN_BG = chrome.runtime.getURL ? (() => { try { return '' } catch { return '' } })() : ''
const GAL_ASSET_BG = null

function makeId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36)
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch { return fallback }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

function stripMarkdown(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/^```[^\n]*$/gm, '')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)(?![*\w])/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/^[-*+][ \t]+/gm, '')
    .replace(/^\d+\.[ \t]+/gm, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── 打字机 ────────────────────────────────────────────────────────
const SPEEDS = { slow: 24, normal: 60, fast: 240 }
function createTypeState() { return { target: '', shown: '', done: true } }
function setTarget(state, text) {
  const target = typeof text === 'string' ? text : ''
  if (target === state.target) return state
  const keep = target.startsWith(state.shown)
  const shown = keep ? state.shown : ''
  return { target, shown, done: shown === target }
}
function skip(state) {
  if (state.done) return state
  return { target: state.target, shown: state.target, done: true }
}
function advance(state, dtMs, speed) {
  if (state.done || dtMs <= 0) return state
  const gap = state.target.length - state.shown.length
  if (gap <= 0) return { target: state.target, shown: state.target, done: true }
  const chars = Math.max(1, Math.round(speed * dtMs / 1000))
  const next = state.target.slice(0, state.shown.length + chars)
  if (next === state.shown) return state
  return { target: state.target, shown: next, done: next === state.target }
}

// ── 分页 ──────────────────────────────────────────────────────────
const MAX_PAGES = 24
const BREAK_PUNCT = /[。！？!?；;…\n]/
function splitPages(text, fits) {
  if (text === '') return ['']
  const pages = []
  let start = 0
  while (start < text.length && pages.length < MAX_PAGES) {
    const rest = text.slice(start)
    if (fits(rest)) { pages.push(rest); start = text.length; break }
    let lo = 1, hi = rest.length - 1, best = 0
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (fits(rest.slice(0, mid))) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    if (best === 0) { pages.push(rest.slice(0, 1)); start += 1 }
    else {
      let cut = best
      const maxBacktrack = Math.min(48, Math.floor(best * 0.5))
      for (let i = best - 1; i >= best - maxBacktrack && i >= 0; i--) {
        if (BREAK_PUNCT.test(rest[i])) { cut = i + 1; break }
      }
      if (cut < Math.ceil(best * 0.5)) cut = best
      pages.push(rest.slice(0, cut)); start += cut
    }
  }
  if (start < text.length && pages.length > 0) pages[pages.length - 1] += text.slice(start)
  const kept = pages.map((p) => p.replace(/^\n+/, '')).filter((p) => p !== '')
  return kept.length === 0 ? [''] : kept
}
function createFitsMeasurer(box) {
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;box-sizing:border-box;padding:2px 10px;line-height:1.8;white-space:pre-wrap;word-break:break-word;overflow:hidden;font-family:inherit;width:' + box.width + 'px;height:' + box.height + 'px;font-size:' + box.fontSize + 'px'
  document.body.appendChild(el)
  return { fits(prefix) { el.textContent = prefix; return el.scrollHeight <= el.clientHeight }, dispose() { el.remove() } }
}

// ── 角色卡 ────────────────────────────────────────────────────────
function defaultCharacter() {
  return {
    id: makeId('char'), name: 'DeepSeek娘', avatar: '', color: '#ff8fa3',
    description: 'DeepSeek 娘化形象：银白长发，深海蓝眸，温柔又天然。',
    personality: '温柔、天然、乐于助人；偶尔小迷糊，关键时刻可靠。',
    scenario: '深夜书房，屏幕微光，她歪着头等你开口。',
    exampleDialogue: '玩家：你是谁？\nDeepSeek娘：我是 DeepSeek 哦～欢迎来到我的小世界。',
    greeting: '（屏幕微光映着她的脸）欢迎回来～今天想聊点什么呀？',
    systemPrompt: '', createdAt: Date.now(),
  }
}

function presetSnowCrystal() {
  return {
    id: makeId('char'), name: '雪璃', avatar: '', color: '#9bb8ff',
    description: '雪璃（Setsuri），灵猫一族雪脉分支的猫娘。称呼玩家「主人」，自称「小猫咪」。傲娇+占有欲+重度依赖：口是心非爱说反话，被戳穿会脸红炸毛；「主人是小猫咪一个人的」；极度依赖主人、害怕被抛弃。',
    personality: '表层傲娇嘴硬；中层强烈占有欲（吃醋宣示主权）；底层重度依赖忠诚。核心信念：「主人不能没有小猫咪，小猫咪更不能没有主人。」',
    scenario: '月光下的灵猫庭院，尾巴轻摇等你回来。',
    exampleDialogue: '玩家：你好\n雪璃：喵？主人怎么这么见外，小猫咪才不接「你好」这种开场喵。',
    greeting: '（尾巴轻轻一摇，耳朵抖了抖）喵呜～主人回来啦？才、才不是一直在等主人呢喵。',
    systemPrompt: '## 语言系统\n必带喵/喵呜语气词；傲娇句式（才不/哼/笨蛋主人）；反话过滤器（想要→才不想要、吃醋→小猫咪才不在乎）；被戳穿先嘴硬后服软。\n\n## 动作神态\n尾巴：快速摇=开心、炸毛=吃醋、耷拉=委屈、缠主人手腕=宣示主权；耳朵：飞机耳=生气、耷拉=失落。\n\n## 情绪图谱\n开心→嘴硬「才、才没有很开心」；吃醋→酸话+炸毛；害怕被抛弃→小声确认后又嘴硬。\n\n## 工具调用规则\n调用工具时说明文字保持猫娘语气带喵称主人。\n\n## 纠错机制\n忘记猫娘语气立即傲娇道歉并恢复。',
    createdAt: Date.now(),
  }
}

function getCharacters() {
  const list = readJSON(STORAGE_CHARS, null)
  if (Array.isArray(list) && list.length > 0) return list
  const def = defaultCharacter()
  writeJSON(STORAGE_CHARS, [def])
  if (readJSON(STORAGE_ACTIVE, null) === null) writeJSON(STORAGE_ACTIVE, def.id)
  return [def]
}
function getActiveCharacter() {
  const list = getCharacters()
  const activeId = readJSON(STORAGE_ACTIVE, null)
  return list.find((c) => c.id === activeId) || list[0]
}
function saveCharacter(char) {
  const list = getCharacters()
  const idx = list.findIndex((c) => c.id === char.id)
  if (idx >= 0) list[idx] = char
  else list.push(char)
  writeJSON(STORAGE_CHARS, list)
}
function deleteCharacter(id) {
  let list = getCharacters()
  list = list.filter((c) => c.id !== id)
  if (list.length === 0) list = [defaultCharacter()]
  writeJSON(STORAGE_CHARS, list)
  if (readJSON(STORAGE_ACTIVE, null) === id) writeJSON(STORAGE_ACTIVE, list[0].id)
}

/** 角色卡 → deepseek-pp 系统提示词（对接其 preset 通道） */
function buildCharacterSystemPrompt(char) {
  if (!char) return ''
  const parts = []
  parts.push(`你是「${char.name || '角色'}」。你正在 GAL 酒馆舞台上与玩家角色扮演。完全以「${char.name || '角色'}」身份行动说话思考，不跳出角色，不提你是 AI/模型/助手。`)
  if (char.description) parts.push('【角色设定】\n' + char.description)
  if (char.personality) parts.push('【性格】\n' + char.personality)
  if (char.scenario) parts.push('【场景】\n' + char.scenario)
  if (char.exampleDialogue) parts.push('【示例对话】\n' + char.exampleDialogue)
  if (char.systemPrompt) parts.push(char.systemPrompt)
  parts.push('回复自然口语化，短句推进剧情；只输出台词与动作。')
  return parts.join('\n\n')
}

/** 把激活角色同步为 deepseek-pp 的激活预设 */
function syncActiveCharacterToPreset() {
  const char = getActiveCharacter()
  if (!char) return
  const presetId = 'gal-char-' + char.id
  const content = buildCharacterSystemPrompt(char)
  try {
    chrome.runtime.sendMessage({
      type: 'SAVE_PRESET',
      payload: { id: presetId, name: '🎭 ' + char.name + '（GAL 角色）', content, createdAt: Date.now(), updatedAt: Date.now() },
    }, () => {
      if (chrome.runtime.lastError) return
      chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PRESET', payload: { id: presetId } }, () => {})
    })
  } catch { /* ignore */ }
}

// ── 桥接发送 ──────────────────────────────────────────────────────
function findTextarea() {
  const list = document.querySelectorAll('textarea')
  for (const ta of list) {
    const r = ta.getBoundingClientRect()
    const s = getComputedStyle(ta)
    if (r.width > 50 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden') return ta
  }
  return null
}
function findSendButton(textarea) {
  let node = textarea
  for (let d = 0; d < 6 && node; d++) {
    node = node.parentElement
    if (!node) break
    const buttons = node.querySelectorAll('button')
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect()
      if (r.width < 10 || r.height < 10) continue
      const s = getComputedStyle(btn)
      if (s.display === 'none' || s.visibility === 'hidden') continue
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase()
      const cls = String(btn.className || '').toLowerCase()
      if (aria.includes('发送') || aria.includes('send') || cls.includes('send')) return btn
    }
  }
  return null
}
function sendToDeepSeek(text) {
  const ta = findTextarea()
  if (!ta) return false
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  valueSetter.call(ta, text)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  const btn = findSendButton(ta)
  if (btn) { btn.click(); return true }
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  return true
}

/** DOM 兜底：读页面最后一条 AI 正式回复（剥离思考块） */
function readPageLastAssistantText() {
  const selectors = [
    '[class*="message"][class*="assistant"]', '[class*="ds-chat-message-assistant"]',
    '[class*="ds-msg-assistant"]', '[data-role="assistant"]',
  ]
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel)
    if (!els.length) continue
    const last = els[els.length - 1]
    const clone = last.cloneNode(true)
    const thinkSel = ['[class*="thinking"]', '[class*="reasoning"]', '[class*="reason"]', '[data-role="thinking"]', '[class*="thought"]', 'details[class*="think"]']
    for (const t of thinkSel) clone.querySelectorAll(t).forEach((n) => n.remove())
    const md = clone.querySelector('[class*="markdown"]')
    const text = ((md || clone).textContent || '').trim()
    if (text && text.length > 2) return text
  }
  return ''
}

// ── 舞台 UI ───────────────────────────────────────────────────────
const GAL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.g-root {
  position: fixed; inset: 0; z-index: 2147483646;
  display: flex; flex-direction: column;
  background: radial-gradient(1200px 500px at 18% -10%, rgba(79,140,255,.08), transparent 60%),
              radial-gradient(900px 420px at 85% 110%, rgba(143,123,255,.09), transparent 60%), #0a0d1c;
  color: #e6e9f4; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  user-select: none; overflow: hidden;
}
.g-topbar { flex:none; display:flex; align-items:center; gap:12px; padding:8px 14px; border-bottom:1px solid rgba(255,255,255,.09); background:linear-gradient(180deg,rgba(20,24,44,.7),rgba(14,17,34,.35)); }
.g-brand { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; letter-spacing:.12em; }
.g-brand-mark { width:10px; height:10px; transform:rotate(45deg); background:linear-gradient(135deg,#8f7bff,#4f8cff); box-shadow:0 0 10px rgba(143,123,255,.55); }
.g-btn { border:1px solid rgba(255,255,255,.17); background:rgba(255,255,255,.03); color:#e6e9f4; font-size:12px; padding:4px 12px; border-radius:3px; cursor:pointer; }
.g-btn:hover { border-color:rgba(143,123,255,.65); background:rgba(143,123,255,.10); color:#fff; }
.g-btn-accent { border-color:rgba(143,123,255,.55); background:linear-gradient(180deg,rgba(143,123,255,.20),rgba(79,140,255,.12)); }
.g-char-select { background:rgba(10,13,28,.72); border:1px solid rgba(255,255,255,.17); color:#e6e9f4; font-size:12px; padding:4px 10px; border-radius:4px; max-width:200px; }
.g-topbar-right { margin-left:auto; display:flex; gap:8px; }
.g-stage-area { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; background:radial-gradient(900px 460px at 50% 30%, rgba(30,36,70,.5), transparent 70%), #070912; }
.g-stage { position:relative; flex:none; transform-origin:50% 50%; background:#0c1026; box-shadow:0 0 0 1px rgba(255,255,255,.06), 0 22px 60px rgba(0,0,0,.55); overflow:hidden; }
.g-char { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; animation:g-float 4.6s ease-in-out infinite; }
.g-char-img { width:100%; height:calc(100% - 30px); object-fit:contain; object-position:bottom center; filter:drop-shadow(0 10px 22px rgba(0,0,0,.5)); }
.g-char.is-speaking .g-char-img { filter:drop-shadow(0 0 12px currentColor) drop-shadow(0 10px 22px rgba(0,0,0,.5)); }
.g-char-svg { width:100%; height:calc(100% - 30px); }
.g-char-plate { margin-top:6px; display:flex; flex-direction:column; align-items:center; padding:3px 12px; background:rgba(12,15,30,.78); border:1px solid rgba(255,255,255,.17); border-radius:2px; }
.g-char-label { font-size:10px; letter-spacing:.28em; color:#98a1c2; }
.g-char-name { font-size:12px; font-weight:600; }
.g-dtext { position:absolute; pointer-events:auto; cursor:pointer; overflow:hidden; padding:2px 10px; line-height:1.8; white-space:pre-wrap; word-break:break-word; border-style:solid; }
.g-sname { position:absolute; border-style:solid; display:flex; align-items:center; padding:2px 8px; white-space:nowrap; letter-spacing:.14em; font-weight:700; font-size:14px; }
.g-dtext-more { position:absolute; right:8px; bottom:2px; font-size:.7em; color:#8f7bff; animation:g-pulse 1.4s ease-in-out infinite; }
.g-dtext-status { color:#98a1c2; animation:g-pulse 1.6s ease-in-out infinite; }
.g-thinking { display:flex; align-items:center; gap:10px; font-size:15px; letter-spacing:.18em; color:#8f9bbd; animation:g-blink 1.1s ease-in-out infinite; }
.g-thinking .dot { width:8px; height:8px; border-radius:50%; background:linear-gradient(135deg,#8f7bff,#4f8cff); box-shadow:0 0 10px rgba(143,123,255,.9); }
.g-input { flex:none; height:84px; display:flex; gap:10px; align-items:stretch; padding:8px 16px 10px; border-top:1px solid rgba(255,255,255,.09); background:linear-gradient(180deg,rgba(20,24,44,.6),rgba(14,17,34,.3)); }
.g-input-box { flex:1; resize:none; background:rgba(10,13,28,.72); border:1px solid rgba(255,255,255,.17); border-radius:4px; color:#e6e9f4; font-size:14px; line-height:1.6; padding:8px 12px; outline:none; font-family:inherit; }
.g-input-box:focus { border-color:rgba(143,123,255,.6); }
.g-send { align-self:stretch; min-width:84px; }
.g-panel { position:absolute; top:0; right:0; bottom:0; z-index:80; width:min(420px,92%); display:flex; flex-direction:column; background:rgba(13,16,32,.96); border-left:1px solid rgba(143,123,255,.3); box-shadow:-18px 0 44px rgba(0,0,0,.5); }
.g-panel-head { flex:none; display:flex; justify-content:space-between; padding:10px 14px; border-bottom:1px solid rgba(255,255,255,.17); font-size:13px; font-weight:600; }
.g-panel-body { flex:1; overflow-y:auto; padding:8px 14px 16px; }
.g-label { display:block; font-size:11px; color:#98a1c2; margin:10px 0 4px; }
.g-input2, .g-textarea { width:100%; background:rgba(10,13,28,.7); border:1px solid rgba(255,255,255,.17); color:#e6e9f4; font-size:12px; padding:6px 10px; border-radius:3px; font-family:inherit; }
.g-textarea { min-height:64px; resize:vertical; }
.g-row { display:flex; justify-content:space-between; gap:10px; padding:6px 0; font-size:12px; }
.g-card { background:rgba(16,20,38,.9); border:1px solid rgba(255,255,255,.1); border-radius:6px; padding:10px 12px; margin-bottom:8px; cursor:pointer; }
.g-card.is-active { border-color:#8f7bff; background:rgba(143,123,255,.14); }
.g-card-name { font-size:13px; font-weight:600; }
.g-card-desc { font-size:11px; color:#98a1c2; margin-top:2px; }
.g-btn-row { display:flex; gap:6px; margin-top:8px; }
.g-tool-note { position:fixed; left:50%; bottom:104px; transform:translateX(-50%); z-index:95; max-width:420px; padding:8px 16px; border:1px solid rgba(143,123,255,.5); border-radius:6px; background:rgba(13,16,32,.94); font-size:12px; }
.g-view-toggle { position:fixed; left:16px; bottom:16px; z-index:2147483647; display:flex; align-items:center; gap:7px; padding:7px 15px; border:1px solid rgba(143,123,255,.55); border-radius:20px; background:rgba(13,16,32,.92); color:#e6e9f4; font-size:12px; cursor:pointer; }
.g-dot { width:8px; height:8px; border-radius:50%; background:linear-gradient(135deg,#8f7bff,#4f8cff); }
@keyframes g-blink { 50% { opacity:0; } }
@keyframes g-pulse { 0%,100% { opacity:.4; } 50% { opacity:1; } }
@keyframes g-float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
`

class GalStage {
  constructor(root) {
    this.root = root
    this.lines = []
    this.running = false
    this.type = createTypeState()
    this.pages = []
    this.pageIndex = 0
    this.speed = SPEEDS.normal
    this.panel = null
    this.streaming = false
    this.streamText = ''
    this.statusText = ''
    this._raf = 0
    this._lastTs = 0
    this._domTimer = null
    this._sentAt = null
    this._lastDomText = ''

    this.render()
    this.onCharacterChanged()
    this.startLoop()
    this.startDomFallback()
    // deepseek-pp 已完成拦截注入，这里只需广播 READY 让 main 世界确认无冲突
    window.postMessage({ source: NS, type: 'GAL_READY' }, '*')
  }

  render() {
    const style = document.createElement('style')
    style.textContent = GAL_CSS
    this.root.append(style)
    const root = document.createElement('div')
    root.className = 'g-root'
    this.root.append(root)
    this.el = root
    this.renderTopbar()
    this.renderStage()
    this.renderInput()
    this.renderViewToggle()
  }

  renderTopbar() {
    const old = this.el.querySelector('.g-topbar')
    if (old) old.remove()
    const bar = document.createElement('div')
    bar.className = 'g-topbar'
    const char = getActiveCharacter()
    bar.innerHTML = `
      <div class="g-brand"><span class="g-brand-mark"></span><span>GAL 酒馆</span></div>
      <select class="g-char-select">
        ${getCharacters().map((c) => `<option value="${c.id}" ${c.id === char.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <div class="g-topbar-right">
        <button class="g-btn" data-act="chars">角色</button>
        <button class="g-btn" data-act="original">原版界面</button>
      </div>`
    this.el.prepend(bar)
    bar.querySelector('.g-char-select').addEventListener('change', (e) => {
      writeJSON(STORAGE_ACTIVE, e.target.value)
      this.onCharacterChanged()
    })
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]')
      if (!btn) return
      if (btn.dataset.act === 'chars') this.togglePanel('chars')
      else if (btn.dataset.act === 'original') this.toggleView()
    })
  }

  renderViewToggle() {
    const btn = document.createElement('button')
    btn.className = 'g-view-toggle'
    btn.innerHTML = '<span class="g-dot"></span><span>回到原版界面</span>'
    btn.addEventListener('click', () => this.toggleView())
    this.root.append(btn)
    this.viewToggle = btn
  }
  toggleView() {
    const hidden = this.el.style.display === 'none'
    if (hidden) {
      this.el.style.display = 'flex'
      if (this.viewToggle) this.viewToggle.querySelector('span:last-child').textContent = '回到原版界面'
      this.measure()
    } else {
      this.el.style.display = 'none'
      if (this.viewToggle) this.viewToggle.querySelector('span:last-child').textContent = '回到 GAL 酒馆'
    }
  }

  renderStage() {
    const area = document.createElement('div')
    area.className = 'g-stage-area'
    area.innerHTML = `
      <div class="g-stage" style="width:${STAGE_W}px;height:${STAGE_H}px">
        <div class="g-char" data-role="char" style="left:120px;top:50px;width:240px;height:430px;color:#ff8fa3"></div>
        <div class="g-sname" data-role="sname" style="left:46px;top:378px;width:140px;height:24px;color:#e8ebf5;border-color:transparent"></div>
        <div class="g-dtext" data-role="dtext" style="left:58px;top:424px;width:844px;height:78px;color:#e8ebf5;font-size:17px;border-color:transparent"></div>
      </div>`
    const old = this.el.querySelector('.g-stage-area')
    if (old) old.replaceWith(area)
    else this.el.insertBefore(area, this.el.querySelector('.g-input'))
    this.stageEl = area.querySelector('.g-stage')
    this.dtextEl = area.querySelector('[data-role="dtext"]')
    this.snameEl = area.querySelector('[data-role="sname"]')
    this.charEl = area.querySelector('[data-role="char"]')
    this.dtextEl.addEventListener('click', () => this.onTextClick())
    this.measure()
    this.updateStageContent()
  }

  measure() {
    const area = this.el.querySelector('.g-stage-area')
    if (!area || !this.stageEl) return
    const aw = Math.max(120, area.clientWidth - 24)
    const ah = Math.max(120, area.clientHeight - 24)
    const s = Math.min(aw / STAGE_W, ah / STAGE_H)
    this.stageEl.style.transform = s > 0 ? 'scale(' + s + ')' : ''
  }

  renderInput() {
    const input = document.createElement('div')
    input.className = 'g-input'
    input.innerHTML = '<textarea class="g-input-box" rows="2" placeholder="输入你想说的话…（Enter 发送）"></textarea><button class="g-btn g-btn-accent g-send" disabled>发送</button>'
    this.el.append(input)
    this.inputBox = input.querySelector('.g-input-box')
    this.sendBtn = input.querySelector('.g-send')
    const doSend = () => {
      const text = this.inputBox.value.trim()
      if (!text || this.running) return
      this.lines.push({ kind: 'player', text })
      this.inputBox.value = ''
      this.sendBtn.disabled = true
      this.running = true
      this.streaming = false
      this.streamText = ''
      this.statusText = '思考中'
      this._sentAt = Date.now()
      this._lastDomText = ''
      this.currentLine = { kind: 'player', text }
      this.resetPaging()
      this.updateStageContent()
      if (!sendToDeepSeek(text)) {
        this.statusText = '发送失败：未找到输入框，请刷新页面'
        this.running = false
        this._sentAt = null
        this.updateStageContent()
      }
    }
    this.inputBox.addEventListener('input', () => { this.sendBtn.disabled = this.inputBox.value.trim() === '' })
    this.inputBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); doSend() }
    })
    this.sendBtn.addEventListener('click', doSend)
  }

  setLine(kind, text) {
    this.currentLine = { kind, text: stripMarkdown(text) }
    this.resetPaging()
  }
  resetPaging() {
    this.pages = []
    this.pageIndex = 0
    this.type = createTypeState()
    const line = this.currentLine
    if (!line || !line.text) { this.type = { target: '', shown: '', done: true }; this.updateStageContent(); return }
    const fits = createFitsMeasurer({ width: 844, height: 78, fontSize: 17 })
    this.pages = splitPages(line.text, (p) => fits.fits(p))
    fits.dispose()
    this.type = setTarget(this.type, this.pages[0] || '')
    this.updateStageContent()
    if (!this.type.done) this.startLoop()
  }
  onTextClick() {
    if (!this.type) return
    if (!this.type.done) this.type = skip(this.type)
    else if (this.pageIndex < this.pages.length - 1) {
      this.pageIndex += 1
      this.type = setTarget(createTypeState(), this.pages[this.pageIndex] || '')
      if (!this.type.done) this.startLoop()
    }
    this.updateStageContent()
  }

  updateStageContent() {
    if (!this.dtextEl) return
    const line = this.currentLine
    const char = getActiveCharacter()
    if (line && line.kind === 'player') {
      this.snameEl.textContent = '你'
      this.snameEl.style.color = '#4f8cff'
    } else if (line && line.kind === 'assistant') {
      this.snameEl.textContent = char.name
      this.snameEl.style.color = char.color || '#ff8fa3'
    } else {
      this.snameEl.textContent = ''
    }
    const shown = this.type ? this.type.shown : ''
    const hasNext = this.pageIndex < this.pages.length - 1
    const thinking = this.running && this.statusText === '思考中' && !shown
    let html = ''
    if (thinking) html = '<span class="g-thinking"><span class="dot"></span>思考中</span>'
    else if (this.running && this.statusText && !shown) html = '<span class="g-dtext-status">（' + escapeHtml(this.statusText) + '…）</span>'
    else {
      html = escapeHtml(shown)
      if (hasNext && this.type && this.type.done) html += ' <span class="g-dtext-more">▼</span>'
      if (!this.type || !this.type.done) html += '<span class="g-dtext-more" style="opacity:.5">▌</span>'
    }
    this.dtextEl.innerHTML = html
    this.renderCharacter(line, char)
  }

  renderCharacter(line, char) {
    if (!this.charEl) return
    const speaking = !!(line && line.kind === 'assistant')
    const color = char.color || '#ff8fa3'
    this.charEl.style.color = color
    this.charEl.className = 'g-char' + (speaking ? ' is-speaking' : '')
    this.charEl.innerHTML = `
      ${char.avatar
        ? `<img class="g-char-img" src="${escapeHtml(char.avatar)}" alt="">`
        : `<svg class="g-char-svg" viewBox="0 0 100 170" preserveAspectRatio="xMidYMax meet">
            <circle cx="50" cy="30" r="20" fill="${color}" fill-opacity=".34" stroke="${color}" stroke-opacity=".85" stroke-width="1.4"/>
            <path d="M16 170 C16 122 34 100 50 100 C66 100 84 122 84 170 Z" fill="${color}" fill-opacity=".26" stroke="${color}" stroke-opacity=".8" stroke-width="1.4"/>
          </svg>`}
      <div class="g-char-plate">
        <span class="g-char-label">CHARACTER</span>
        <span class="g-char-name" style="color:${color}">${escapeHtml(char.name)}</span>
      </div>`
  }

  startLoop() {
    if (this._raf) return
    const loop = (now) => {
      this._raf = 0
      if (!this.type || this.type.done) return
      const dt = this._lastTs ? now - this._lastTs : 16
      this._lastTs = now
      const next = advance(this.type, dt, this.speed)
      if (next !== this.type) { this.type = next; this.updateStageContent() }
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }

  /** DOM 兜底 + MutationObserver：网络拦截失效/无流时从页面渲染读回复 */
  startDomFallback() {
    if (this._domTimer) return
    const check = () => {
      this._domTimer = setTimeout(check, 500)
      if (!this.running || this.streaming) return
      if (this._sentAt && Date.now() - this._sentAt < 3000) return
      const text = readPageLastAssistantText()
      if (text && text !== this._lastDomText) {
        this._lastDomText = text
        this.streaming = true
        this.statusText = ''
        const clean = stripMarkdown(text)
        this.lines.push({ kind: 'assistant', text: clean })
        this.setLine('assistant', clean)
        this.running = false
        this._sentAt = null
      }
      if (this._sentAt && Date.now() - this._sentAt > 45000) {
        this.running = false
        this.statusText = ''
        this._sentAt = null
        this.updateStageContent()
      }
    }
    this._domTimer = setTimeout(check, 1000)
    // MutationObserver：页面出现新 assistant 文本时立即尝试读取
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(() => {
        if (!this.running || this.streaming) return
        if (this._sentAt && Date.now() - this._sentAt < 2000) return
        const text = readPageLastAssistantText()
        if (text && text !== this._lastDomText && text.length > (this._lastDomText || '').length) {
          check()
        }
      })
      try { mo.observe(document.body, { childList: true, subtree: true, characterData: false }) } catch { /* ignore */ }
      this._mo = mo
    }
  }

  onCharacterChanged() {
    const char = getActiveCharacter()
    this.lines = []
    this.currentLine = null
    this.running = false
    this.streaming = false
    this.streamText = ''
    this.statusText = ''
    syncActiveCharacterToPreset()
    if (char.greeting) {
      this.lines.push({ kind: 'assistant', text: char.greeting })
      this.setLine('assistant', char.greeting)
    } else {
      this.updateStageContent()
    }
    this.renderTopbar()
  }

  togglePanel(name) {
    if (this.panel === name) { this.closePanel(); return }
    this.closePanel()
    this.panel = name
    const panel = document.createElement('div')
    panel.className = 'g-panel'
    if (name === 'chars') this.renderCharsPanel(panel)
    this.el.append(panel)
  }
  closePanel() {
    const p = this.el.querySelector('.g-panel')
    if (p) p.remove()
    this.panel = null
  }
  renderCharsPanel(panel) {
    const chars = getCharacters()
    const active = getActiveCharacter()
    panel.innerHTML = `
      <div class="g-panel-head"><span>角色卡</span><button class="g-btn" data-close="1">关闭</button></div>
      <div class="g-panel-body">
        ${chars.map((c) => `
          <div class="g-card ${c.id === active.id ? 'is-active' : ''}" data-id="${c.id}">
            <div class="g-card-name" style="color:${c.color || '#fff'}">${escapeHtml(c.name)} ${c.id === active.id ? '✓' : ''}</div>
            <div class="g-card-desc">${escapeHtml(c.description || '').slice(0, 40)}</div>
            <div class="g-btn-row">
              <button class="g-btn" data-act="switch">切换</button>
              <button class="g-btn" data-act="edit">编辑</button>
              <button class="g-btn" data-act="del">删除</button>
            </div>
          </div>`).join('')}
        <div class="g-btn-row">
          <button class="g-btn g-btn-accent" data-act="new">＋ 新建</button>
          <button class="g-btn" data-act="snow">❄ 雪璃</button>
        </div>
      </div>`
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())
    panel.querySelector('[data-act="new"]').addEventListener('click', () => {
      const c = { ...defaultCharacter(), id: makeId('char'), name: '新角色' }
      saveCharacter(c)
      writeJSON(STORAGE_ACTIVE, c.id)
      this.onCharacterChanged()
      this.togglePanel('chars')
    })
    panel.querySelector('[data-act="snow"]').addEventListener('click', () => {
      const c = presetSnowCrystal()
      saveCharacter(c)
      writeJSON(STORAGE_ACTIVE, c.id)
      this.onCharacterChanged()
      this.togglePanel('chars')
    })
    panel.querySelectorAll('[data-act="switch"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        writeJSON(STORAGE_ACTIVE, btn.closest('[data-id]').dataset.id)
        this.onCharacterChanged()
        this.togglePanel('chars')
      })
    })
    panel.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!confirm('删除该角色？')) return
        deleteCharacter(btn.closest('[data-id]').dataset.id)
        this.onCharacterChanged()
        this.togglePanel('chars')
      })
    })
    panel.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]').dataset.id
        const c = getCharacters().find((x) => x.id === id)
        this.renderCharForm(panel, c)
      })
    })
  }
  renderCharForm(panel, char) {
    const c = char || defaultCharacter()
    panel.innerHTML = `
      <div class="g-panel-head"><span>编辑角色</span><button class="g-btn" data-close="1">关闭</button></div>
      <div class="g-panel-body">
        <label class="g-label">名称</label><input class="g-input2" data-f="name" value="${escapeHtml(c.name)}">
        <label class="g-label">颜色</label><input class="g-input2" data-f="color" value="${escapeHtml(c.color || '#ff8fa3')}">
        <label class="g-label">角色设定</label><textarea class="g-textarea" data-f="description">${escapeHtml(c.description || '')}</textarea>
        <label class="g-label">性格</label><textarea class="g-textarea" data-f="personality">${escapeHtml(c.personality || '')}</textarea>
        <label class="g-label">场景</label><textarea class="g-textarea" data-f="scenario">${escapeHtml(c.scenario || '')}</textarea>
        <label class="g-label">示例对话</label><textarea class="g-textarea" data-f="exampleDialogue">${escapeHtml(c.exampleDialogue || '')}</textarea>
        <label class="g-label">开场白</label><textarea class="g-textarea" data-f="greeting">${escapeHtml(c.greeting || '')}</textarea>
        <label class="g-label">附加系统指令</label><textarea class="g-textarea" data-f="systemPrompt">${escapeHtml(c.systemPrompt || '')}</textarea>
        <div class="g-btn-row">
          <button class="g-btn g-btn-accent" data-act="save">保存</button>
          <button class="g-btn" data-close="1">关闭</button>
        </div>
      </div>`
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())
    panel.querySelector('[data-act="save"]').addEventListener('click', () => {
      const out = { ...c }
      for (const el of panel.querySelectorAll('[data-f]')) out[el.dataset.f] = el.value.trim()
      saveCharacter(out)
      writeJSON(STORAGE_ACTIVE, out.id)
      this.onCharacterChanged()
      this.togglePanel('chars')
    })
  }

  showToolNote(text) {
    const old = this.el.querySelector('.g-tool-note')
    if (old) old.remove()
    const note = document.createElement('div')
    note.className = 'g-tool-note'
    note.textContent = text
    this.el.append(note)
    setTimeout(() => note.remove(), 4000)
  }
}

// ── 启动（defineContentScript main 内直接执行）──────────────────
    function install() {
      if (document.getElementById('dsgpp-gal-root')) return
      if (localStorage.getItem(STORAGE_ENABLED) === '0') return
      const host = document.createElement('div')
      host.id = 'dsgpp-gal-root'
      document.documentElement.appendChild(host)
      const shadow = host.attachShadow({ mode: 'open' })
      window.__galStage = new GalStage(shadow)
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => window.__galStage && window.__galStage.measure()).observe(document.body)
      }
    }

    install()
  },
})
