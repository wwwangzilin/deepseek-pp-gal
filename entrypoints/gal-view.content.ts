// @ts-nocheck — gal 叠加层保持 JS 风格：经 wxt/esbuild 转译（不查类型），
// 自加入仓库起即存在大量隐式 any，类型债与功能无关，故豁免类型检查。
// 纯逻辑（工具标签、存档读写、好感度计算、群组事件命名）已抽到 entrypoints/gal/helpers.ts（带类型检查）。
import {
  TOOL_LABELS,
  toolLabel,
  GAL_SAVES_KEY,
  GAL_SAVES_LIMIT,
  galStorageGet,
  galStorageSet,
  loadGalSaves,
  persistGalSaves,
  AFFINITY_DAILY_CAP,
  computeAffinityGain,
  GROUP_EVENT_NAME_PREFIX,
  groupEventMemoryName,
  groupIdFromEventMemoryName,
  parseMentions,
  voiceProfileFor,
  currentDayPeriod,
  localDateKey,
  groupRelationsSummary,
} from './gal/helpers'
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
// ── 旧版 localStorage 键 —— 仅用于一次性迁移到扩展角色库 ──────────
const STORAGE_CHARS = 'dsgpp_gal_characters'
const STORAGE_ACTIVE = 'dsgpp_gal_active_character'
const STORAGE_ENABLED = 'dsgpp_gal_enabled'

// ── 扩展侧权威数据层（runtime ⇄ background 角色库 / GAL 设置）──────
// 角色卡、激活角色与 GAL 舞台开关的单一权威在扩展（core/character），不再用
// localStorage；本页面只维护一份同步缓存供舞台渲染，写操作即时转发后台。
let __galChars = []
let __galActiveId = null
let __galSettings = { enabled: false, characterCadence: 'every_message', proactiveEnabled: false, proactiveIdleMinutes: 10, ttsEnabled: false, ttsRate: 1 }
let __galGroups = []
let __galActiveGroupId = null

function runtimeSend(type, payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(payload === undefined ? { type } : { type, payload }, (res) => {
        if (chrome.runtime.lastError) { resolve(undefined); return }
        resolve(res)
      })
    } catch { resolve(undefined) }
  })
}
async function refreshGalData() {
  const [chars, active, settings, groups, activeGroup] = await Promise.all([
    runtimeSend('GET_CHARACTERS'),
    runtimeSend('GET_ACTIVE_CHARACTER'),
    runtimeSend('GET_GAL_SETTINGS'),
    runtimeSend('GET_GROUPS'),
    runtimeSend('GET_ACTIVE_GROUP'),
  ])
  if (Array.isArray(chars)) __galChars = chars
  if (active && typeof active === 'object' && active.id) __galActiveId = active.id
  else __galActiveId = null
  if (settings && typeof settings === 'object') {
    __galSettings = {
      enabled: settings.enabled === true,
      characterCadence: settings.characterCadence === 'first_message' || settings.characterCadence === 'off'
        ? settings.characterCadence : 'every_message',
      proactiveEnabled: settings.proactiveEnabled === true,
      proactiveIdleMinutes: typeof settings.proactiveIdleMinutes === 'number'
        ? Math.max(1, Math.min(240, Math.round(settings.proactiveIdleMinutes)))
        : 10,
      ttsEnabled: settings.ttsEnabled === true,
      ttsRate: typeof settings.ttsRate === 'number'
        ? Math.max(0.5, Math.min(2, settings.ttsRate))
        : 1,
    }
  }
  if (Array.isArray(groups)) __galGroups = groups
  __galActiveGroupId = activeGroup && activeGroup.id ? activeGroup.id : null
}

// ── 剧情存档存储键/读写已抽到 entrypoints/gal/helpers.ts ────────

// ── 群组（借用项目做共享上下文载体）──────────────────────────────
function getGroups() { return __galGroups.slice() }
function getActiveGroup() {
  return __galGroups.find((g) => g && g.id === __galActiveGroupId) || null
}
function groupMembers(group) {
  if (!group || !Array.isArray(group.memberIds)) return []
  return group.memberIds.map((id) => getCharacterById(id)).filter(Boolean)
}
async function setActiveGroupRemote(id) {
  __galActiveGroupId = id || null
  await runtimeSend('SET_ACTIVE_GROUP', { id: id || null })
}
/** 把当前 DeepSeek 会话挂到群组项目上：成员共享项目记忆与项目上下文 */
async function bindConversationToGroupProject(group) {
  if (!group || !group.projectId) return
  const conv = await runtimeSend('GET_CURRENT_DEEPSEEK_CONVERSATION')
  if (!conv || typeof conv !== 'object' || !conv.conversationId) return
  await runtimeSend('SET_PENDING_PROJECT_CONTEXT', { projectId: group.projectId })
  await runtimeSend('ADD_CONVERSATION_TO_PROJECT', {
    conversationId: String(conv.conversationId),
    title: String(conv.title || ''),
    url: String(conv.url || ''),
  })
}
/** 每条群组事件记忆最多容纳的发言行数（写满后开新分卷，历史不丢） */
const GROUP_EVENT_MAX_LINES = 20
/** 群组事件记忆保留的分卷数（超出后删除最旧一卷） */
const GROUP_EVENT_MAX_CHUNKS = 5

/**
 * 把一轮群聊发言追加进群组共享记忆（scope: project → 项目成员都能看到）。
 * 采用「分卷」写法：单卷写满 20 行后新建下一卷，并只保留最近若干卷，
 * 避免旧版单条滚动导致的写放大与早期事件丢失。
 */
async function appendGroupEvent(group, speakerName, replyText) {
  if (!group || !group.projectId || !replyText) return
  const text = stripMarkdown(replyText).replace(/\s+/g, ' ').trim().slice(0, 140)
  if (!text) return
  const baseName = GROUP_EVENT_NAME_PREFIX + group.id
  const memories = await runtimeSend('GET_MEMORIES')
  const list = Array.isArray(memories) ? memories : []
  const chunks = list
    .filter((m) => m && String(m.name || '').startsWith(baseName))
    .map((m) => {
      const suffix = String(m.name).slice(baseName.length).replace(/^#/, '')
      const index = Number.parseInt(suffix, 10)
      return { memory: m, index: Number.isFinite(index) ? index : 0 }
    })
    .sort((a, b) => a.index - b.index)
  const latest = chunks[chunks.length - 1]
  const line = '【' + speakerName + '】' + text
  const tags = [group.name || '群组', '群聊事件']

  const writeChunk = async (index) => {
    const name = baseName + '#' + index
    await runtimeSend('SAVE_MEMORY', {
      type: 'topic',
      scope: 'project',
      projectId: group.projectId,
      name,
      content: line,
      description: '',
      tags,
      pinned: false,
    })
  }

  if (latest && latest.memory.id != null) {
    const prevLines = typeof latest.memory.content === 'string'
      ? latest.memory.content.split('\n').map((l) => l.trim()).filter(Boolean)
      : []
    if (prevLines.length < GROUP_EVENT_MAX_LINES) {
      await runtimeSend('UPDATE_MEMORY', {
        ...latest.memory,
        name: baseName + '#' + latest.index,
        content: [...prevLines, line].join('\n'),
        tags,
      })
      return
    }
    await writeChunk(latest.index + 1)
  } else {
    await writeChunk(1)
  }

  // 只保留最近若干卷，避免项目记忆无限膨胀
  const overflow = [...chunks].slice(0, Math.max(0, chunks.length - (GROUP_EVENT_MAX_CHUNKS - 1)))
  for (const stale of overflow) {
    if (stale.memory && stale.memory.id != null) {
      await runtimeSend('DELETE_MEMORY', { id: stale.memory.id })
    }
  }
}
function getCharacters() { return __galChars.slice() }
function getCharacterById(id) { return __galChars.find((c) => c && c.id === id) || null }
function getActiveCharacter() { return getCharacterById(__galActiveId) || __galChars[0] || null }
function galEnabled() { return __galSettings.enabled === true }
/** 把启用状态写回扩展（后台广播给所有标签页）并更新本地缓存 */
async function setGalEnabledRemote(on) {
  __galSettings = { ...__galSettings, enabled: !!on }
  await runtimeSend('SAVE_GAL_SETTINGS', { enabled: !!on })
}
/** 保存角色卡到扩展库（含本地缓存更新）；成功返回保存后的卡 */
async function saveCharacterRemote(char) {
  const saved = await runtimeSend('SAVE_CHARACTER', char)
  if (saved && typeof saved === 'object' && saved.id) {
    const idx = __galChars.findIndex((x) => x && x.id === saved.id)
    if (idx >= 0) __galChars[idx] = saved
    else __galChars.push(saved)
    return saved
  }
  return null
}
async function deleteCharacterRemote(id) {
  await runtimeSend('DELETE_CHARACTER', { id })
  __galChars = __galChars.filter((c) => c.id !== id)
  if (__galActiveId === id) __galActiveId = null
}
async function setActiveCharacterRemote(id) {
  const nextId = id || null
  await runtimeSend('SET_ACTIVE_CHARACTER', { id: nextId })
  __galActiveId = nextId
}

/** 一次性迁移旧 localStorage 角色卡/开关 进扩展库（幂等，完成后清旧键） */
async function migrateLegacyGalData() {
  try {
    const legacyEnabled = localStorage.getItem(STORAGE_ENABLED)
    const legacyCharsRaw = localStorage.getItem(STORAGE_CHARS)
    const legacyActive = localStorage.getItem(STORAGE_ACTIVE)
    const hasLegacyChars = legacyCharsRaw !== null
    const hasLegacyEnabled = legacyEnabled !== null

    if (hasLegacyChars) {
      const legacy = JSON.parse(legacyCharsRaw)
      if (Array.isArray(legacy) && legacy.length > 0) {
        for (const card of legacy) {
          if (!card || typeof card !== 'object' || !card.id) continue
          const payload = {
            id: String(card.id),
            name: String(card.name || '角色'),
            color: String(card.color || '#8f7bff'),
            avatar: String(card.avatar || ASSET_AVATAR),
            description: String(card.description || ''),
            personality: String(card.personality || ''),
            scenario: String(card.scenario || ''),
            exampleDialogue: String(card.exampleDialogue || ''),
            greeting: String(card.greeting || ''),
            systemPrompt: String(card.systemPrompt || ''),
            memoryTags: Array.isArray(card.memoryTags) ? card.memoryTags.map(String) : [],
          }
          await runtimeSend('SAVE_CHARACTER', payload)
        }
        if (legacyActive) {
          const exists = legacy.some((c) => c && String(c.id) === String(legacyActive))
          if (exists) await runtimeSend('SET_ACTIVE_CHARACTER', { id: String(legacyActive) })
        }
      }
    }
    if (hasLegacyEnabled) {
      // 旧键值 '1'（旧版黑名单语义里 非 '0' 均视为开）→ 打开扩展 GAL 开关
      if (legacyEnabled !== '0') await setGalEnabledRemote(true)
    }
    try {
      localStorage.removeItem(STORAGE_CHARS)
      localStorage.removeItem(STORAGE_ACTIVE)
      localStorage.removeItem(STORAGE_ENABLED)
    } catch { /* ignore */ }
    await refreshGalData()
  } catch { /* ignore */ }
}
const STAGE_W = 960
const STAGE_H = 540

// 内置素材（deepseek-pp-gal/public/gal/*，经 web_accessible_resources 暴露）
function galAsset(name) {
  try { return chrome.runtime.getURL('gal/' + name) } catch { return '' }
}
const ASSET_AVATAR = galAsset('char-deepseek.png')
const ASSET_BG = galAsset('bg-bedroom.png')
const ASSET_DIALOGUE = galAsset('dialogue.png')

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

// ── 记忆关联与 RP 意图识别 ────────────────────────────────────────
/** 检索与关键词相关的记忆（deepseek-pp GET_MEMORIES） */
function searchRelatedMemories(keywords, callback) {
  try {
    chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }, (memories) => {
      if (chrome.runtime.lastError || !Array.isArray(memories)) { callback([]); return }
      const kws = (keywords || []).map((k) => String(k).toLowerCase()).filter(Boolean)
      if (kws.length === 0) { callback([]); return }
      const hits = memories.filter((m) => {
        if (!m || typeof m !== 'object') return false
        const hay = String(m.name || '') + ' ' + String(m.content || '') + ' ' + String((m.tags || []).join(' '))
        const h = hay.toLowerCase()
        return kws.some((kw) => h.includes(kw))
      })
      callback(hits)
    })
  } catch { callback([]) }
}
/** 提升记忆权重（TOUCH_MEMORIES：让 deepseek-pp 注入时优先选中） */
function boostMemories(ids) {
  if (!ids || !ids.length) return
  try { chrome.runtime.sendMessage({ type: 'TOUCH_MEMORIES', payload: { ids } }, () => {}) } catch { /* ignore */ }
}
/** 激活模式卡时自动载入相关记忆 */
function loadMemoriesForMode(char, stage) {
  if (!char) return
  const keywords = []
  if (char.name) keywords.push(char.name)
  if (char.memoryTags && Array.isArray(char.memoryTags)) keywords.push(...char.memoryTags)
  if (char.description) {
    const seg = String(char.description).match(/[\u4e00-\u9fa5]{2,6}/g) || []
    keywords.push(...seg.slice(0, 6))
  }
  searchRelatedMemories(keywords, (hits) => {
    if (!hits || !hits.length) return
    boostMemories(hits.map((m) => m.id).filter((x) => x != null))
    if (stage && stage.showToolNote) stage.showToolNote('📚 已载入「' + char.name + '」相关记忆 ' + hits.length + ' 条')
  })
}

/** 模式设定记忆键：gal-mode:<charId>（同一角色重复保存时更新而非重复堆叠） */
function modeMemoryName(charId) {
  return 'gal-mode:' + charId
}
/** 把模式/角色设定沉淀为「角色专属记忆」（topic，带 characterId，随角色切换隔离）。幂等：按标题命中后更新。 */
function persistModeMemory(char, rpText, modeName) {
  if (!char || !char.id) return
  const targetTitle = modeMemoryName(char.id)
  try {
    chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }, (memories) => {
      if (chrome.runtime.lastError || !Array.isArray(memories)) return
      const summary = String(char.description || rpText || char.name).slice(0, 2000)
      const tags = Array.isArray(char.memoryTags) && char.memoryTags.length
        ? char.memoryTags.slice(0, 8)
        : [char.name, '角色扮演', '模式']
      const existing = memories.find((m) => m && String(m.name || '').startsWith(targetTitle))
      const base = {
        type: 'topic', scope: 'global', characterId: char.id, description: '',
        name: targetTitle + ' ' + modeName, content: summary, tags, pinned: false,
      }
      if (existing && existing.id != null) {
        chrome.runtime.sendMessage({ type: 'UPDATE_MEMORY', payload: { ...existing, name: base.name, content: base.content, tags: base.tags, characterId: base.characterId, description: base.description, scope: base.scope } }, () => {})
      } else {
        chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: base }, () => {})
      }
    })
  } catch { /* ignore */ }
}

/** 检测输入是否含角色扮演设定请求（精确匹配，避免普通问句误判） */
const RP_STRONG_HINTS = ['扮演', '来扮演', '我们扮演', '你扮演', '请扮演', '现在扮演', '开始扮演', 'rp', 'roleplay', '你的人设', '角色设定', '设定你为', '来当', '你来当']
const RP_WEAK_HINTS = ['你是一个', '你是', '你就是', '你是一只', '你是一位', '你是一名', '你的身份', '请当', '给我扮演', '帮我设定']
/** 普通问句 / 闲聊特征词：命中则不算 RP 设定 */
const RP_QUESTION_MARKERS = ['什么', '怎么', '哪里', '哪', '谁', '吗', '呢', '为什么', '如何', '怎样', '做什么', '是哪', '几点']
/** 强度判定：强提示直接命中；弱提示需文本较长且不是问句 */
function detectRoleplayIntent(text) {
  const t = String(text || '').trim().toLowerCase()
  if (!t) return false
  // 问句特征排除：短问句 / 含疑问词
  if (t.length < 6) return false
  if (RP_QUESTION_MARKERS.some((q) => t.includes(q)) && !RP_STRONG_HINTS.some((h) => t.includes(h))) return false
  if (RP_STRONG_HINTS.some((h) => t.includes(h))) return true
  // 弱提示：文本 ≥ 10 字，含设定性描述（描述语气：第二句有 ,或。再接描写）
  if (t.length >= 10 && RP_WEAK_HINTS.some((h) => t.includes(h))) return true
  return false
}
/** 尝试从 RP 文本提取角色名 */
function extractRoleName(text) {
  const t = String(text || '')
  // 精确句式：你(叫/是/来当/扮演) X、叫 X、名字叫 X、称 X
  const patterns = [
    /(?:你(?:就叫|的名字叫|名字叫|是叫|是|来当|来扮演|扮演|将扮演|现在叫))\s*[「『]?([\u4e00-\u9fa5A-Za-z0-9_·]{1,12})[」』]?/,
    /(?:叫|称为|名为|名叫)\s*[「『]?([\u4e00-\u9fa5A-Za-z0-9_·]{1,12})[」』]?/,
    /(?:扮演|当|成为)\s*[「『]?(?:一个|一名|一位|一只|只|个)?\s*([\u4e00-\u9fa5A-Za-z0-9_·]{2,12})[」』]?/,
  ]
  for (const p of patterns) {
    const m = t.match(p)
    if (m && m[1]) {
      const name = m[1].replace(/[，。！？,.;:：、\s的]|(?:喵|酱|桑)$/g, '')
      if (name.length >= 1 && name.length <= 12 && !/[的是了和我你在有请帮给叫名字为当扮演一只个位名]/.test(name)) return name
    }
  }
  // 兜底：去掉前缀助词后的首个词
  return ''
}

// ── 角色卡 ────────────────────────────────────────────────────────
function defaultCharacter() {
  return {
    id: makeId('char'), name: 'DeepSeek娘', avatar: ASSET_AVATAR, color: '#ff8fa3',
    description: 'DeepSeek 娘化形象：银白长发，深海蓝眸，温柔又天然。',
    personality: '温柔、天然、乐于助人；偶尔小迷糊，关键时刻可靠。',
    scenario: '深夜书房，屏幕微光，她歪着头等你开口。',
    exampleDialogue: '玩家：你是谁？\nDeepSeek娘：我是 DeepSeek 哦～欢迎来到我的小世界。',
    greeting: '（屏幕微光映着她的脸）欢迎回来～今天想聊点什么呀？',
    systemPrompt: '', memoryTags: [],
  }
}

function presetSnowCrystal() {
  return {
    id: makeId('char'), name: '雪璃', avatar: ASSET_AVATAR, color: '#9bb8ff',
    description: '雪璃（Setsuri），灵猫一族雪脉分支的猫娘。称呼玩家「主人」，自称「小猫咪」。傲娇+占有欲+重度依赖：口是心非爱说反话，被戳穿会脸红炸毛；「主人是小猫咪一个人的」；极度依赖主人、害怕被抛弃。',
    personality: '表层傲娇嘴硬；中层强烈占有欲（吃醋宣示主权）；底层重度依赖忠诚。核心信念：「主人不能没有小猫咪，小猫咪更不能没有主人。」',
    scenario: '月光下的灵猫庭院，尾巴轻摇等你回来。',
    exampleDialogue: '玩家：你好\n雪璃：喵？主人怎么这么见外，小猫咪才不接「你好」这种开场喵。',
    greeting: '（尾巴轻轻一摇，耳朵抖了抖）喵呜～主人回来啦？才、才不是一直在等主人呢喵。',
    systemPrompt: '## 语言系统\n必带喵/喵呜语气词；傲娇句式（才不/哼/笨蛋主人）；反话过滤器（想要→才不想要、吃醋→小猫咪才不在乎）；被戳穿先嘴硬后服软。\n\n## 动作神态\n尾巴：快速摇=开心、炸毛=吃醋、耷拉=委屈、缠主人手腕=宣示主权；耳朵：飞机耳=生气、耷拉=失落。\n\n## 情绪图谱\n开心→嘴硬「才、才没有很开心」；吃醋→酸话+炸毛；害怕被抛弃→小声确认后又嘴硬。\n\n## 工具调用规则\n调用工具时说明文字保持猫娘语气带喵称主人。\n\n## 纠错机制\n忘记猫娘语气立即傲娇道歉并恢复。',
    memoryTags: ['雪璃', '猫娘', '傲娇', '灵猫'],
  }
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

function findRegenerateButton() {
  const re = /(重新生成|重试|重新回答|regenerate|retry|resend)/i
  for (const el of document.querySelectorAll('button, [role="button"], a')) {
    const aria = String(el.getAttribute && (el.getAttribute('aria-label') || ''))
    const title = String(el.getAttribute && (el.getAttribute('title') || ''))
    const text = String(el.textContent || '').trim()
    if (re.test(aria) || re.test(title) || (text.length > 0 && text.length < 16 && re.test(text))) {
      return el
    }
  }
  return null
}

/** 工具标签映射已抽到 entrypoints/gal/helpers.ts（toolLabel / TOOL_LABELS） */

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
    // 剥离思考块与 deepseek-pp 的工具/产物卡片：台词里只留对白
    const stripSel = [
      '[class*="thinking"]', '[class*="reasoning"]', '[class*="reason"]',
      '[data-role="thinking"]', '[class*="thought"]', 'details[class*="think"]',
      '.dpp-tool-block', '.dpp-artifact-results', '.dpp-agent-container',
      '[class*="tool-block"]', '[data-dpp-tool-key]', '[class*="dpp-tc-"]',
    ]
    for (const t of stripSel) clone.querySelectorAll(t).forEach((n) => n.remove())
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
.g-cast { position:absolute; inset:0; pointer-events:none; }
.g-char { position:absolute; display:flex; flex-direction:column; align-items:center; opacity:.94; animation:g-float 4.6s ease-in-out infinite; transition:opacity .35s ease, filter .35s ease, transform .35s ease; }
.g-char.is-speaking { opacity:1; transform:translateY(-3px); }
.g-char.is-dim { opacity:.5; filter:grayscale(.45) brightness(.82); }
.g-char-img { width:100%; height:calc(100% - 30px); object-fit:contain; object-position:bottom center; filter:drop-shadow(0 10px 22px rgba(0,0,0,.5)); }
.g-char.is-speaking .g-char-img { filter:drop-shadow(0 0 12px currentColor) drop-shadow(0 10px 22px rgba(0,0,0,.5)); }
.g-char-svg { width:100%; height:calc(100% - 30px); }
.g-char-plate { margin-top:6px; display:flex; flex-direction:column; align-items:center; padding:3px 12px; background:rgba(12,15,30,.78); border:1px solid rgba(255,255,255,.17); border-radius:2px; }
.g-char-label { font-size:10px; letter-spacing:.28em; color:#98a1c2; }
.g-char-name { font-size:12px; font-weight:600; }
.g-char-affinity { font-size:10px; font-weight:600; }
.g-dtext { position:absolute; pointer-events:auto; cursor:pointer; overflow:hidden; padding:2px 10px; line-height:1.8; white-space:pre-wrap; word-break:break-word; border-style:solid; }
.g-dialogue { position:absolute; pointer-events:auto; cursor:pointer; }
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
.g-cadence-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; margin-bottom:10px; background:rgba(143,123,255,.08); border:1px solid rgba(143,123,255,.35); border-radius:6px; }
.g-cadence-title { font-size:12px; font-weight:600; color:#e6e9f4; }
.g-cadence-hint { font-size:10px; color:#98a1c2; margin-top:2px; }
.g-switch { position:relative; display:inline-block; width:36px; height:20px; flex:none; }
.g-switch input { opacity:0; width:0; height:0; }
.g-switch-slider { position:absolute; inset:0; background:rgba(255,255,255,.15); border-radius:20px; cursor:pointer; transition:background .2s ease; }
.g-switch-slider::before { content:''; position:absolute; width:16px; height:16px; left:2px; top:2px; background:#fff; border-radius:50%; transition:transform .2s ease; }
.g-switch input:checked + .g-switch-slider { background:linear-gradient(135deg,#8f7bff,#4f8cff); }
.g-switch input:checked + .g-switch-slider::before { transform:translateX(16px); }
.g-card-desc { font-size:11px; color:#98a1c2; margin-top:2px; }
.g-btn-row { display:flex; gap:6px; margin-top:8px; }
.g-chip { display:inline-flex; align-items:center; gap:4px; margin:0 6px 6px 0; padding:4px 10px; border:1px solid rgba(255,255,255,.18); border-radius:14px; background:rgba(255,255,255,.04); color:#c9cede; font-size:11px; cursor:pointer; }
.g-chip:hover { border-color:rgba(143,123,255,.6); }
.g-chip.is-on { border-color:rgba(143,123,255,.9); background:rgba(143,123,255,.2); color:#fff; }
.g-chips { display:flex; flex-wrap:wrap; margin:4px 0 2px; }
.g-tool-note { position:fixed; left:50%; bottom:104px; transform:translateX(-50%); z-index:95; max-width:420px; padding:8px 16px; border:1px solid rgba(143,123,255,.5); border-radius:6px; background:rgba(13,16,32,.94); font-size:12px; }
/* 工具执行状态胶囊（不进入对话框，浮在舞台上方） */
.g-tool-status { position:fixed; left:50%; bottom:152px; transform:translateX(-50%); z-index:94; display:none; align-items:center; gap:8px; max-width:min(560px,86%); padding:6px 14px; border:1px solid rgba(143,123,255,.42); border-radius:16px; background:rgba(13,16,32,.9); color:#c9cede; font-size:12px; box-shadow:0 8px 24px rgba(0,0,0,.42); }
.g-tool-status.is-on { display:flex; }
.g-tool-status.is-done { border-color:rgba(52,211,153,.55); color:#c9f0dd; }
.g-tool-spin { width:10px; height:10px; flex:none; border-radius:50%; border:2px solid rgba(143,123,255,.35); border-top-color:#8f7bff; animation:g-spin .8s linear infinite; }
.g-tool-status.is-done .g-tool-spin { border-color:rgba(52,211,153,.85); border-top-color:rgba(52,211,153,.85); animation:none; }
@keyframes g-spin { to { transform:rotate(360deg); } }
/* RP 自动保存卡片 */
.g-rp-save { position:absolute; left:50%; bottom:100px; transform:translateX(-50%); z-index:96; width:min(420px,90%); padding:14px 16px; background:rgba(16,20,38,.97); border:1px solid rgba(143,123,255,.5); border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,.6); }
.g-rp-save-title { font-size:13px; font-weight:700; }
.g-rp-save-desc { font-size:11px; color:#98a1c2; margin:4px 0 10px; line-height:1.5; }
.g-rp-input { width:100%; background:rgba(10,13,28,.7); border:1px solid rgba(255,255,255,.17); color:#e6e9f4; font-size:12px; padding:6px 10px; border-radius:4px; margin-bottom:8px; font-family:inherit; }
.g-rp-desc { resize:vertical; }
/* 模式选择器 */
.g-mode-picker { position:fixed; inset:0; z-index:90; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(7,9,18,.88); backdrop-filter:blur(8px); }
.g-mode-head { font-size:18px; font-weight:700; letter-spacing:.08em; margin-bottom:6px; }
.g-mode-sub { font-size:12px; color:#98a1c2; margin-bottom:20px; }
.g-mode-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; max-width:680px; width:calc(100% - 40px); max-height:60vh; overflow-y:auto; padding:4px; }
.g-mode-card { display:flex; flex-direction:column; align-items:center; gap:6px; padding:16px 12px; background:rgba(16,20,38,.92); border:1px solid rgba(255,255,255,.12); border-radius:10px; cursor:pointer; transition:border-color .15s, transform .15s, box-shadow .15s; }
.g-mode-card:hover { border-color:rgba(143,123,255,.6); transform:translateY(-2px); box-shadow:0 8px 24px rgba(143,123,255,.15); }
.g-mode-ava { width:52px; height:52px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:700; color:#fff; flex:none; }
.g-mode-ava-img { width:52px; height:52px; border-radius:50%; object-fit:cover; flex:none; border:1px solid rgba(255,255,255,.25); }
.g-mode-tags { font-size:9px; color:#8f9bbd; letter-spacing:.02em; text-align:center; line-height:1.3; }
.g-mode-cur { font-size:9px; color:#34d399; margin-left:4px; }
.g-mode-name { font-size:13px; font-weight:600; }
.g-mode-desc { font-size:10px; color:#98a1c2; text-align:center; line-height:1.4; }
.g-mode-card.is-new .g-mode-ava { background:rgba(143,123,255,.25); color:#b3a7ff; }
.g-mode-card.is-new { border-style:dashed; }
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
    this.speakerIds = []
    this.queueRunning = false
    this._turnResolve = null
    this._lastActivityAt = Date.now()
    this._relationsSummary = ''

    this.render()
    this.onCharacterChanged()
    this.startLoop()
    this.startDomFallback()
    this.listenForBridgedReplies()
    // deepseek-pp 已完成拦截注入，这里只需广播 READY 让 main 世界确认无冲突
    window.postMessage({ source: NS, type: 'GAL_READY' }, '*')
  }

  /**
   * 优先通道：deepseek-pp 拦截层在回复完成时把完整正文通过 window 消息发过来
   * （同隔离世界可见），舞台据此渲染，不必依赖 DeepSeek 的 DOM 类名。
   * DOM 兜底（startDomFallback）保留，作为桥不可用时的后备。
   */
  listenForBridgedReplies() {
    if (this._bridgeListener) return
    this._bridgeListener = (event) => {
      const data = event && event.data
      if (!data || typeof data !== 'object') return
      if (data.source !== 'deepseek-pp-gal-bridge' || data.type !== 'GAL_ASSISTANT_TEXT') return
      if (typeof data.text !== 'string') return
      this.onBridgedAssistantText(data.text)
    }
    window.addEventListener('message', this._bridgeListener)
  }

  /** 桥送来的完整回复文本 → 结束本轮（与 DOM 兜底同一收尾路径） */
  onBridgedAssistantText(rawText) {
    if (!this.running || this.streaming) return
    const clean = stripMarkdown(rawText)
    if (!clean) return
    this._lastDomText = clean
    this.streaming = true
    this.statusText = ''
    this.lines.push({ kind: 'assistant', text: clean })
    this.setLine('assistant', clean)
    this.running = false
    this._sentAt = null
    this._lastActivityAt = Date.now()
    this.syncToolActivity(true)
    this.speakLine(clean)
    void this.bumpAffinity()
    this.finishTurn(clean)
  }

  /** TTS 台词朗读（设置可关；按角色 id 做固定音色区分，读前切断上一句） */
  speakLine(text) {
    if (__galSettings.ttsEnabled !== true) return
    if (typeof window.speechSynthesis === 'undefined'
      || typeof window.SpeechSynthesisUtterance === 'undefined') return
    const content = stripMarkdown(String(text || ''))
      .replace(/[（(][^）)]*[）)]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!content) return
    try {
      const char = getActiveCharacter()
      const profile = voiceProfileFor(char && char.id ? char.id : 'gal')
      const utterance = new window.SpeechSynthesisUtterance(content.slice(0, 300))
      utterance.lang = 'zh-CN'
      utterance.pitch = profile.pitch
      utterance.rate = Math.max(0.5, Math.min(2, (__galSettings.ttsRate || 1) * profile.rateScale))
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    } catch { /* 语音不可用时静默降级 */ }
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
    this.renderToolStatus()
  }

  /** 工具执行状态胶囊：浮在输入区上方，不进入对话框 */
  renderToolStatus() {
    const el = document.createElement('div')
    el.className = 'g-tool-status'
    el.innerHTML = '<span class="g-tool-spin"></span><span class="g-tool-text"></span>'
    this.el.append(el)
    this.toolStatusEl = el
  }
  showToolStatus(text, done) {
    if (!this.toolStatusEl) return
    clearTimeout(this._toolStatusTimer)
    this.toolStatusEl.querySelector('.g-tool-text').textContent = text
    this.toolStatusEl.className = 'g-tool-status is-on' + (done ? ' is-done' : '')
  }
  hideToolStatus(delayMs) {
    if (!this.toolStatusEl) return
    clearTimeout(this._toolStatusTimer)
    const el = this.toolStatusEl
    if (delayMs) {
      this._toolStatusTimer = setTimeout(() => { el.className = 'g-tool-status' }, delayMs)
      return
    }
    el.className = 'g-tool-status'
  }
  /** 读页面里 deepseek-pp 工具块的执行概况（工具名 / 数量 / 失败数） */
  readPageToolActivity() {
    const blocks = document.querySelectorAll('.dpp-tool-block')
    if (!blocks.length) return { total: 0, failed: 0, labels: [] }
    const block = blocks[blocks.length - 1]
    const items = block.querySelectorAll('.dpp-tool-block-item')
    const labels = []
    let failed = 0
    items.forEach((item) => {
      const nameEl = item.querySelector('.dpp-tool-block-item-name')
      const statusEl = item.querySelector('.dpp-tool-block-item-status')
      const raw = nameEl ? String(nameEl.textContent || '').trim() : ''
      if (raw) labels.push(toolLabel(raw))
      if (statusEl && statusEl.classList.contains('error')) failed += 1
    })
    return { total: labels.length || items.length, failed, labels }
  }
  /** 本轮请求的工具活动刷新（final=true 表示回复已落地，显示完成态） */
  syncToolActivity(final) {
    const activity = this.readPageToolActivity()
    if (activity.total === 0) {
      if (final) this.hideToolStatus()
      return
    }
    const head = activity.labels.slice(0, 3).join(' · ')
    const more = activity.labels.length > 3 ? ' 等 ' + activity.labels.length + ' 项' : ''
    if (final) {
      const failedNote = activity.failed > 0 ? '（失败 ' + activity.failed + '）' : ''
      this.showToolStatus(
        (activity.failed > 0 ? '⚠️ ' : '✓ ') + '工具执行完成：' + (head || activity.total + ' 项') + more + failedNote,
        true,
      )
      this.hideToolStatus(2400)
      return
    }
    this.showToolStatus('🔧 ' + (head || '正在执行工具') + more + ' 执行中…', false)
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
        <button class="g-btn" data-act="groups">👥 ${escapeHtml(getActiveGroup() ? getActiveGroup().name : '群组')}</button>
        <button class="g-btn g-btn-accent" data-act="pick">🎭 选模式</button>
        <button class="g-btn" data-act="saves">💾 存档</button>
        <button class="g-btn" data-act="regen" title="让 DeepSeek 重新生成上一条回复">🔁 重说</button>
        <button class="g-btn" data-act="original">原版界面</button>
        <button class="g-btn" data-act="disable" title="关闭 GAL 舞台并记住选择（下次刷新不自动打开）">⏻ 关闭 GAL</button>
      </div>`
    this.el.prepend(bar)
    bar.querySelector('.g-char-select').addEventListener('change', (e) => {
      this.activateCharacter(e.target.value, { fresh: true })
    })
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]')
      if (!btn) return
      if (btn.dataset.act === 'chars') this.togglePanel('chars')
      else if (btn.dataset.act === 'groups') this.togglePanel('groups')
      else if (btn.dataset.act === 'saves') this.togglePanel('saves')
      else if (btn.dataset.act === 'regen') this.regenerateLast()
      else if (btn.dataset.act === 'pick') this.showModePicker()
      else if (btn.dataset.act === 'original') this.toggleView()
      else if (btn.dataset.act === 'disable') disableGalFromStage()
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
    syncEntryVisibility()
  }

  renderStage() {
    const area = document.createElement('div')
    area.className = 'g-stage-area'
    // 背景：内置卧室图铺满舞台（保留夜色渐变打底）
    const bgCss = ASSET_BG
      ? `background:linear-gradient(158deg,rgba(12,16,38,.25),rgba(10,13,28,.55)),url('${ASSET_BG}') center/cover no-repeat`
      : 'background:#0c1026'
    area.innerHTML = `
      <div class="g-stage" style="width:${STAGE_W}px;height:${STAGE_H}px;${bgCss}">
        <div class="g-cast" data-role="cast"></div>
        <div class="g-dialogue" data-role="dialogue" style="left:36px;top:388px;width:888px;height:136px;background:linear-gradient(180deg,rgba(18,22,44,.82),rgba(11,14,30,.9));border:1px solid rgba(155,140,255,.32);border-radius:6px"></div>
        <div class="g-sname" data-role="sname" style="left:46px;top:398px;width:140px;height:24px;color:#e8ebf5;border-color:transparent"></div>
        <div class="g-dtext" data-role="dtext" style="left:58px;top:434px;width:844px;height:68px;color:#e8ebf5;font-size:17px;border-color:transparent"></div>
      </div>`
    const old = this.el.querySelector('.g-stage-area')
    if (old) old.replaceWith(area)
    else this.el.insertBefore(area, this.el.querySelector('.g-input'))
    this.stageEl = area.querySelector('.g-stage')
    this.dtextEl = area.querySelector('[data-role="dtext"]')
    this.snameEl = area.querySelector('[data-role="sname"]')
    this.castEl = area.querySelector('[data-role="cast"]')
    this.dialogueEl = area.querySelector('[data-role="dialogue"]')
    this.dtextEl.addEventListener('click', () => this.onTextClick())
    if (this.dialogueEl) this.dialogueEl.addEventListener('click', () => this.onTextClick())
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
    const doSend = () => { void this.handleSend() }
    this.inputBox.addEventListener('input', () => { this.sendBtn.disabled = this.inputBox.value.trim() === '' })
    this.inputBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); doSend() }
    })
    this.sendBtn.addEventListener('click', doSend)
  }

  /** 群组模式下本轮的发言者（面板勾选顺序；未勾选=仅当前激活角色单聊） */
  pendingSpeakers(group) {
    if (!group) return []
    const picked = Array.isArray(this.speakerIds) ? this.speakerIds : []
    if (picked.length === 0) return []
    return groupMembers(group).filter((member) => picked.includes(member.id))
  }

  async handleSend() {
    if (this.running || this.queueRunning) return
    const text = this.inputBox ? this.inputBox.value.trim() : ''
    if (!text) return
    this._lastActivityAt = Date.now()
    // RP 意图自动识别：检测到角色扮演设定请求 → 弹出保存为模式卡
    if (detectRoleplayIntent(text)) {
      this.offerSaveRoleplayMode(text)
    }
    const group = getActiveGroup()
    if (!group) {
      await this.sendTurn(text, true)
      return
    }
    // @点名优先：只让被点到的成员发言；否则用面板里勾选的发言者
    const members = groupMembers(group)
    const mentioned = parseMentions(text, members.map((m) => m.name))
    const speakers = mentioned.length > 0
      ? members.filter((member) => mentioned.includes(member.name))
      : this.pendingSpeakers(group)
    if (speakers.length === 0) {
      await this.sendTurn(text, true)
      return
    }
    await this.runGroupRound(text, group, speakers)
  }

  /** 单轮：发送文本并等待回复落地，返回最终回复文本（群聊队列据此串行） */
  sendTurn(text, showPlayer) {
    return new Promise((resolve) => {
      this._turnResolve = resolve
      try { if (window.speechSynthesis) window.speechSynthesis.cancel() } catch { /* ignore */ }
      if (showPlayer) {
        this.lines.push({ kind: 'player', text })
        this.currentLine = { kind: 'player', text }
      }
      if (this.inputBox) this.inputBox.value = ''
      if (this.sendBtn) this.sendBtn.disabled = true
      this.running = true
      this.streaming = false
      this.streamText = ''
      this.statusText = '思考中'
      this._sentAt = Date.now()
      this._lastDomText = ''
      this.resetPaging()
      this.updateStageContent()
      if (!sendToDeepSeek(text)) {
        this.statusText = '发送失败：未找到输入框，请刷新页面'
        this.running = false
        this._sentAt = null
        this.updateStageContent()
        this.finishTurn('')
      }
    })
  }
  /** 单轮结束（DOM 兜底拿到回复或超时）→ 唤醒群聊队列 */
  finishTurn(text) {
    const resolve = this._turnResolve
    this._turnResolve = null
    if (resolve) resolve(text || '')
  }

  /** 每轮对话给当前角色涨一点好感：越亲近涨得越慢，且每日有封顶 */
  async bumpAffinity() {
    const char = getActiveCharacter()
    if (!char || !char.id) return
    const current = Math.round(char.affinity || 0)
    if (current >= 100) return
    const today = new Date().toISOString().slice(0, 10)
    const gainedToday = char.affinityDate === today ? Math.max(0, Math.round(char.affinityToday || 0)) : 0
    if (gainedToday >= AFFINITY_DAILY_CAP) return
    const gain = computeAffinityGain(current)
    const next = Math.min(100, current + gain)
    const patch = {
      ...char,
      affinity: next,
      affinityDate: today,
      affinityToday: Math.min(AFFINITY_DAILY_CAP, gainedToday + gain),
    }
    const idx = __galChars.findIndex((c) => c && c.id === char.id)
    if (idx >= 0) __galChars[idx] = patch
    await saveCharacterRemote(patch)
    this.renderTopbar()
    this.updateStageContent()
  }

  /**
   * 群组轮次：把当前会话挂到群组项目（共享上下文），然后按顺序让勾选的成员
   * 各自以自己的人格发言；每轮发言沉淀进群组共享记忆，成员之间因此互通。
   */
  async runGroupRound(text, group, speakers) {
    this.queueRunning = true
    try {
      await bindConversationToGroupProject(group)
      let first = true
      for (const member of speakers) {
        if (member.id !== __galActiveId) {
          await setActiveCharacterRemote(member.id)
          this.renderTopbar()
          await new Promise((r) => setTimeout(r, 500))
        }
        this.updateStageContent()
        const turnText = first ? text : '（轮到「' + member.name + '」接话）'
        const reply = await this.sendTurn(turnText, first)
        first = false
        await appendGroupEvent(group, member.name, reply)
        await this.bumpRelations(group, member)
      }
      await this.syncGroupRelationsToProject(group)
    } finally {
      this.queueRunning = false
      this.updateStageContent()
    }
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
    this.renderCast(line, char)
  }

  /**
   * 舞台演员阵容：单人时一张立绘居中；群组激活时成员并排站位，
   * 当前发言者高亮、其余降饱和缩小（群聊看得见"谁在说"）。
   */
  renderCast(line, char) {
    if (!this.castEl) return
    const group = getActiveGroup()
    const members = group ? groupMembers(group) : []
    const cast = members.length > 0
      ? members
      : [getActiveCharacter()].filter(Boolean)
    if (cast.length === 0) { this.castEl.innerHTML = ''; return }
    const speaking = !!(line && line.kind === 'assistant')
    const speakingId = speaking && char && char.id ? char.id : null

    const n = cast.length
    const single = n === 1
    const width = single ? 240 : Math.max(150, Math.min(250, Math.floor(820 / n)))
    const gap = single ? 0 : Math.min(40, Math.max(12, Math.floor((860 - width * n) / Math.max(1, n - 1))))
    const totalW = width * n + gap * (n - 1)
    const startX = Math.max(20, Math.floor((STAGE_W - totalW) / 2))
    const top = single ? 50 : 74
    const height = single ? 430 : 372

    this.castEl.innerHTML = cast.map((member, index) => {
      const left = startX + index * (width + gap)
      const color = member.color || '#ff8fa3'
      const avatar = member.avatar || ASSET_AVATAR
      const on = single ? true : member.id === speakingId
      const dim = !on && speaking
      return `
        <div class="g-char ${on ? 'is-speaking' : ''} ${dim ? 'is-dim' : ''}"
             data-char="${escapeHtml(member.id)}"
             style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;color:${color};animation-delay:${(index * 0.45).toFixed(2)}s">
          ${avatar
            ? `<img class="g-char-img" src="${escapeHtml(avatar)}" alt="">`
            : `<svg class="g-char-svg" viewBox="0 0 100 170" preserveAspectRatio="xMidYMax meet">
                <circle cx="50" cy="30" r="20" fill="${color}" fill-opacity=".34" stroke="${color}" stroke-opacity=".85" stroke-width="1.4"/>
                <path d="M16 170 C16 122 34 100 50 100 C66 100 84 122 84 170 Z" fill="${color}" fill-opacity=".26" stroke="${color}" stroke-opacity=".8" stroke-width="1.4"/>
              </svg>`}
          <div class="g-char-plate">
            <span class="g-char-name" style="color:${color}">${escapeHtml(member.name)}</span>
            <span class="g-char-affinity" style="color:${color};opacity:.85">❤️ ${Math.round(member.affinity || 0)}</span>
          </div>
        </div>`
    }).join('')
  }

  /**
   * 每日作息问候：同一时段（早/中/下午/晚/深夜）只问候一次；
   * 复用「角色主动搭话」开关，关闭时完全不打扰。
   */
  async maybeDayGreeting() {
    if (__galSettings.proactiveEnabled !== true) return
    if (this.running || this.queueRunning) return
    const period = currentDayPeriod()
    const today = localDateKey()
    const mark = await galStorageGet('deepseek_pp_gal_day_greeting')
    if (mark && typeof mark === 'object' && mark.date === today && mark.period === period) return
    await galStorageSet('deepseek_pp_gal_day_greeting', { date: today, period })
    const group = getActiveGroup()
    const pool = group ? groupMembers(group) : [getActiveCharacter()].filter(Boolean)
    if (pool.length === 0) return
    const speaker = pool[Math.floor(Math.random() * pool.length)]
    if (speaker.id !== __galActiveId) {
      await setActiveCharacterRemote(speaker.id)
      this.renderTopbar()
      await new Promise((r) => setTimeout(r, 400))
    }
    this.showToolNote('🌤 ' + speaker.name + ' 向你打了个招呼…')
    const reply = await this.sendTurn(
      '（现在是' + period + '。你主动向主人打个' + period + '的招呼，一两句就好，别提这条提示）',
      false,
    )
    await appendGroupEvent(group, speaker.name, reply)
    this._lastActivityAt = Date.now()
  }

  /** 重说一次：点击页面的「重新生成」并等待新回复（桥/DOM 兜底会自动接管） */
  regenerateLast() {
    if (this.running || this.queueRunning) return
    const button = findRegenerateButton()
    if (!button) {
      this.showToolNote('⚠️ 没找到「重新生成」按钮，请在原版界面手动重试')
      return
    }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel() } catch { /* ignore */ }
    this.running = true
    this.streaming = false
    this.statusText = '重新生成中'
    this._sentAt = Date.now()
    this._lastDomText = ''
    this.updateStageContent()
    try { button.click() } catch {
      this.running = false
      this._sentAt = null
      this.showToolNote('⚠️ 重新生成点击失败')
    }
  }

  /** 群聊发言后：发言者对其他成员的关系 +1（角色间关系网） */
  async bumpRelations(group, speaker) {
    if (!group || !speaker || !speaker.id) return
    const others = groupMembers(group).filter((m) => m.id !== speaker.id)
    if (others.length === 0) return
    const relations = { ...(speaker.relations || {}) }
    for (const other of others) {
      relations[other.id] = Math.max(0, Math.min(100, Math.round(relations[other.id] || 0) + 1))
    }
    const patch = { ...speaker, relations }
    const idx = __galChars.findIndex((c) => c && c.id === speaker.id)
    if (idx >= 0) __galChars[idx] = patch
    await saveCharacterRemote(patch)
  }

  /**
   * 把成员关系摘要写进群组项目的上下文（项目 instructions 会随请求注入），
   * 让角色在群聊中"知道"彼此的关系；内容未变化时不重复写入。
   */
  async syncGroupRelationsToProject(group) {
    if (!group || !group.projectId) return
    const members = groupMembers(group)
    if (members.length < 2) return
    const summary = groupRelationsSummary(members)
    if (!summary || summary === this._relationsSummary) return
    this._relationsSummary = summary
    const instructions = [group.instructions || '', '【成员关系】\n' + summary]
      .filter(Boolean)
      .join('\n\n')
    await runtimeSend('UPDATE_PROJECT_CONTEXT', {
      projectId: group.projectId,
      patch: { instructions },
    })
  }

  /** 空闲时角色主动搭话（由 startProactiveLoop 触发） */
  async triggerProactive() {    if (this.running || this.queueRunning) return
    this._lastActivityAt = Date.now()
    const group = getActiveGroup()
    const pool = group ? groupMembers(group) : [getActiveCharacter()].filter(Boolean)
    if (pool.length === 0) return
    const speaker = pool[Math.floor(Math.random() * pool.length)]
    if (speaker.id !== __galActiveId) {
      await setActiveCharacterRemote(speaker.id)
      this.renderTopbar()
      await new Promise((r) => setTimeout(r, 500))
    }
    this.updateStageContent()
    this.showToolNote('💭 ' + speaker.name + ' 主动开口了…')
    const reply = await this.sendTurn('（你主动找主人搭话：自然开启一个新话题，一两句就好，不要提这条提示）', false)
    await appendGroupEvent(group, speaker.name, reply)
    this._lastActivityAt = Date.now()
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
      // 工具执行中：舞台状态胶囊跟随页面工具块（不进入对话文本）
      this.syncToolActivity(false)
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
        this._lastActivityAt = Date.now()
        this.syncToolActivity(true)
        this.speakLine(clean)
        void this.bumpAffinity()
        this.finishTurn(clean)
      }
      if (this._sentAt && Date.now() - this._sentAt > 45000) {
        this.running = false
        this.statusText = ''
        this._sentAt = null
        this.updateStageContent()
        this.hideToolStatus()
        this.finishTurn('')
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

  /** 页面是否有真实对话历史（DeepSeek 会话消息区非空） */
  pageHasHistory() {
    const selectors = [
      '[class*="message"][class*="assistant"]', '[class*="ds-chat-message-assistant"]',
      '[class*="ds-msg-assistant"]', '[data-role="assistant"]', '[data-role="user"]',
    ]
    for (const sel of selectors) {
      if (document.querySelectorAll(sel).length > 0) return true
    }
    return false
  }

  /** 尝试点击 DeepSeek 页面「新对话」入口；找不到返回 false（不强制跳转，避免破坏浏览状态） */
  tryClickNewChatButton() {
    const re = /(新对话|新建对话|新聊天|新建聊天|开始新对话|new chat|new conversation)/i
    const candidates = []
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const aria = String(el.getAttribute && (el.getAttribute('aria-label') || '')).toLowerCase()
      const title = String(el.getAttribute && (el.getAttribute('title') || '')).toLowerCase()
      const text = String(el.textContent || '').trim()
      if (re.test(aria) || re.test(title) || (text.length > 0 && text.length < 14 && re.test(text))) {
        candidates.push(el)
      }
    }
    if (candidates.length === 0) return false
    candidates.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)
    try { candidates[0].click(); return true } catch { return false }
  }

  /**
   * 统一角色激活入口（下拉 / 模式选择 / 角色卡切换都走这里）：
   * 把激活角色写回扩展库（SET_ACTIVE_CHARACTER，不再触碰用户预设）；
   * fresh=true 且当前会话已有历史时，先尝试让 DeepSeek 开新会话，避免旧角色历史串进新角色上下文。
   */
  async activateCharacter(charId, opts) {
    const list = getCharacters()
    const char = list.find((c) => c.id === charId) || list[0]
    if (!char) return
    const prev = getActiveCharacter()
    const fresh = !!(opts && opts.fresh)
    const switching = !prev || prev.id !== char.id
    await setActiveCharacterRemote(char.id)
    if (switching && fresh && this.pageHasHistory()) {
      const clicked = this.tryClickNewChatButton()
      if (clicked) {
        this.showToolNote('🔄 已切换到「' + char.name + '」，正在打开新对话…')
        let tries = 0
        const waitNav = () => {
          tries += 1
          if (!this.pageHasHistory() || tries > 12) { this.onCharacterChanged(); return }
          setTimeout(waitNav, 350)
        }
        setTimeout(waitNav, 600)
        return
      }
      this.showToolNote('⚠️ 当前会话已有历史。角色已切到「' + char.name + '」——建议点左上角「新对话」再开始，避免历史串角色')
    }
    this.onCharacterChanged()
  }

  /** 角色记忆管理面板：列出/添加/全局化/删除该角色的专属记忆（characterId === char.id）。 */
  renderMemoryPanel(panel, char) {
    const render = () => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }, (memories) => {
          if (chrome.runtime.lastError || !Array.isArray(memories)) { this.renderMemoryList(panel, char, [], 0, true); return }
          const mine = memories.filter((m) => m && m.characterId && m.characterId === char.id)
          const globalCount = memories.filter((m) => !m || !m.characterId).length
          this.renderMemoryList(panel, char, mine, globalCount, false)
        })
      } catch { this.renderMemoryList(panel, char, [], 0, true) }
    }
    render()
  }
  renderMemoryList(panel, char, mine, globalCount, failed) {
    const errNote = failed
      ? '<div style="color:#ff9d9d;font-size:11px;padding:6px 0">读取记忆失败，请刷新页面重试。</div>'
      : ''
    const listHtml = mine.length === 0
      ? '<div style="color:#8f9bbd;font-size:11px;padding:8px 0">还没有角色记忆。与「' + escapeHtml(char.name) + '」对话时，模型自动记住的内容会归属到这里；也可以手动添加。</div>'
      : mine.map((m) => `
        <div class="g-card" style="margin-bottom:6px">
          <div class="g-card-name" style="font-size:12px;color:${escapeHtml(char.color || '#fff')}">${escapeHtml(String(m.name || '').slice(0, 60))}</div>
          <div class="g-card-desc" style="white-space:pre-wrap;color:#c9cede">${escapeHtml(String(m.content || '').slice(0, 160))}</div>
          <div class="g-btn-row">
            <button class="g-btn" data-act="globalize" data-id="${m.id}">设为全局</button>
            <button class="g-btn" data-act="del-mem" data-id="${m.id}">删除</button>
          </div>
        </div>`).join('')
    panel.innerHTML = `
      <div class="g-panel-head"><span>🧠 ${escapeHtml(char.name)} 的记忆</span><button class="g-btn" data-close="1">关闭</button></div>
      <div class="g-panel-body">
        <div style="font-size:11px;color:#98a1c2;line-height:1.6;margin-bottom:6px">
          角色记忆只在该角色激活时注入对话；「设为全局」后所有角色共享。全局记忆当前 ${globalCount} 条，可在 DeepSeek++ 记忆页统一管理。
        </div>
        ${errNote}
        ${listHtml}
        <div class="g-label">添加角色记忆</div>
        <input class="g-input2" data-f="name" placeholder="名称（一句话标题）">
        <textarea class="g-textarea" data-f="content" placeholder="内容：这段与「${escapeHtml(char.name)}」的经历里值得记住的事…" style="margin-top:6px"></textarea>
        <div class="g-btn-row">
          <button class="g-btn g-btn-accent" data-act="add-mem">💾 保存到角色记忆</button>
        </div>
      </div>`
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())
    panel.querySelectorAll('[data-act="globalize"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!confirm('把这条记忆设为全局（所有角色共享）？')) return
        chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }, (memories) => {
          if (chrome.runtime.lastError || !Array.isArray(memories)) return
          const m = memories.find((x) => x && x.id != null && String(x.id) === String(btn.dataset.id))
          if (!m) return
          chrome.runtime.sendMessage({ type: 'UPDATE_MEMORY', payload: { ...m, characterId: '' } }, () => render())
        })
      })
    })
    panel.querySelectorAll('[data-act="del-mem"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!confirm('删除这条记忆？')) return
        chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id: Number(btn.dataset.id) } }, () => render())
      })
    })
    panel.querySelector('[data-act="add-mem"]').addEventListener('click', () => {
      const name = (panel.querySelector('[data-f="name"]').value || '').trim()
      const content = (panel.querySelector('[data-f="content"]').value || '').trim()
      if (!name && !content) return
      chrome.runtime.sendMessage({
        type: 'SAVE_MEMORY',
        payload: {
          type: 'topic', scope: 'global', characterId: char.id,
          name: name || String(content).slice(0, 24), content: content || name,
          description: '', tags: [char.name], pinned: false,
        },
      }, () => { render(); this.showToolNote('✅ 已记入「' + char.name + '」的角色记忆') })
    })
  }

  /** 群组面板：选群组 + 勾选本轮发言者（成员共享同一项目上下文） */
  renderGroupPanel(panel) {
    const groups = getGroups()
    const active = getActiveGroup()
    const members = groupMembers(active)
    const picked = Array.isArray(this.speakerIds) ? this.speakerIds : []
    const memberHtml = members.length === 0
      ? '<div style="font-size:11px;color:#8f9bbd;padding:4px 0">该群组还没有成员，请到侧边栏「角色」页添加。</div>'
      : members.map((m) => `
        <button class="g-chip ${picked.includes(m.id) ? 'is-on' : ''}" data-member="${m.id}">
          ${escapeHtml(m.name)} ❤️${Math.round(m.affinity || 0)}${picked.includes(m.id) ? ' ✓' : ''}
        </button>`).join('')
    panel.innerHTML = `
      <div class="g-panel-head"><span>👥 群组</span><button class="g-btn" data-close="1">关闭</button></div>
      <div class="g-panel-body">
        <div style="font-size:11px;color:#98a1c2;line-height:1.55;margin-bottom:8px">
          群组成员共享同一个项目（记忆与设定互通）。勾选本轮发言者，发送后会按顺序依次发言；不勾选则只有当前角色单聊。
        </div>
        ${groups.length === 0
          ? '<div style="font-size:11px;color:#8f9bbd;padding:6px 0">还没有群组。请到 DeepSeek++ 侧边栏「角色」页新建群组并添加成员。</div>'
          : groups.map((g) => `
          <div class="g-card ${active && active.id === g.id ? 'is-active' : ''}" data-group="${g.id}">
            <div class="g-card-name">${escapeHtml(g.name)} ${active && active.id === g.id ? '✓' : ''}</div>
            <div class="g-card-desc">${escapeHtml((g.description || '').slice(0, 36))} · ${Array.isArray(g.memberIds) ? g.memberIds.length : 0} 名成员</div>
            <div class="g-btn-row">
              <button class="g-btn" data-act="enter">进入群组</button>
              <button class="g-btn" data-act="leave">退出群组</button>
            </div>
          </div>`).join('')}
        ${active ? `
          <div class="g-label">本轮发言者（${picked.length === 0 ? '未勾选 = 单聊' : picked.length + ' 人依次'}）</div>
          <div class="g-chips">${memberHtml}</div>
          <div class="g-btn-row">
            <button class="g-btn" data-act="all">全选依次发言</button>
            <button class="g-btn" data-act="none">清空</button>
          </div>
          <div style="font-size:10px;color:#8f9bbd;margin-top:8px">共享项目：${active.projectId ? escapeHtml(active.projectId) : '（未绑定）'}</div>` : ''}
      </div>`
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())
    panel.querySelectorAll('[data-group]').forEach((card) => {
      const groupId = card.dataset.group
      const enter = card.querySelector('[data-act="enter"]')
      const leave = card.querySelector('[data-act="leave"]')
      if (enter) enter.addEventListener('click', async () => {
        await setActiveGroupRemote(groupId)
        this.speakerIds = []
        this.renderTopbar()
        this.renderGroupPanel(panel)
        this.updateStageContent()
        this.showToolNote('👥 已进入群组，勾选本轮发言者后发送')
      })
      if (leave) leave.addEventListener('click', async () => {
        await setActiveGroupRemote(null)
        this.speakerIds = []
        this.renderTopbar()
        this.renderGroupPanel(panel)
        this.updateStageContent()
        this.showToolNote('已退出群组，回到单角色对话')
      })
    })
    panel.querySelectorAll('[data-member]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.member
        const list = Array.isArray(this.speakerIds) ? this.speakerIds.slice() : []
        const idx = list.indexOf(id)
        if (idx >= 0) list.splice(idx, 1)
        else list.push(id)
        this.speakerIds = list
        this.renderGroupPanel(panel)
      })
    })
    const allBtn = panel.querySelector('[data-act="all"]')
    if (allBtn) allBtn.addEventListener('click', () => {
      this.speakerIds = groupMembers(getActiveGroup()).map((m) => m.id)
      this.renderGroupPanel(panel)
    })
    const noneBtn = panel.querySelector('[data-act="none"]')
    if (noneBtn) noneBtn.addEventListener('click', () => {
      this.speakerIds = []
      this.renderGroupPanel(panel)
    })
  }

  /** 剧情存档面板：保存当前舞台剧情 / 读档 / 删除 */
  async renderSavesPanel(panel) {
    const saves = await loadGalSaves()
    const active = getActiveCharacter()
    const group = getActiveGroup()
    panel.innerHTML = `
      <div class="g-panel-head"><span>💾 剧情存档</span><button class="g-btn" data-close="1">关闭</button></div>
      <div class="g-panel-body">
        <div style="font-size:11px;color:#98a1c2;line-height:1.55;margin-bottom:8px">
          存档记录舞台剧情与角色/群组状态；读档会回到该剧情点（DeepSeek 服务端会话历史不会被回滚）。
        </div>
        <input class="g-input2" data-f="name" placeholder="存档名（默认「${escapeHtml(active ? active.name : '剧情')} · 存档')">
        <div class="g-btn-row">
          <button class="g-btn g-btn-accent" data-act="save-now">保存当前剧情</button>
        </div>
        ${saves.length === 0
          ? '<div style="font-size:11px;color:#8f9bbd;padding:8px 0">还没有存档。</div>'
          : saves.map((save) => `
          <div class="g-card" data-save="${escapeHtml(save.id)}">
            <div class="g-card-name">${escapeHtml(save.name || '未命名存档')}</div>
            <div class="g-card-desc">${escapeHtml(new Date(save.createdAt || 0).toLocaleString())}${save.groupId ? ' · 群组' : ''} · ${Array.isArray(save.lines) ? save.lines.length : 0} 条</div>
            <div class="g-btn-row">
              <button class="g-btn" data-act="load">读档</button>
              <button class="g-btn" data-act="del">删除</button>
            </div>
          </div>`).join('')}
      </div>`
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())
    panel.querySelector('[data-act="save-now"]').addEventListener('click', async () => {
      const rawName = (panel.querySelector('[data-f="name"]').value || '').trim()
      const name = rawName || ((active ? active.name : '剧情') + ' · 存档')
      const savesNow = await loadGalSaves()
      const entry = {
        id: 'save-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36),
        name,
        characterId: active ? active.id : null,
        groupId: group ? group.id : null,
        speakerIds: Array.isArray(this.speakerIds) ? this.speakerIds.slice() : [],
        lines: Array.isArray(this.lines) ? this.lines.slice(-40) : [],
        createdAt: Date.now(),
      }
      await persistGalSaves([entry, ...savesNow])
      this.showToolNote('💾 已保存剧情「' + name + '」')
      this.renderSavesPanel(panel)
    })
    panel.querySelectorAll('[data-save]').forEach((card) => {
      const saveId = card.dataset.save
      const load = card.querySelector('[data-act="load"]')
      const del = card.querySelector('[data-act="del"]')
      if (load) load.addEventListener('click', async () => {
        const savesNow = await loadGalSaves()
        const save = savesNow.find((item) => item && item.id === saveId)
        if (!save) return
        await this.applySave(save)
        this.closePanel()
      })
      if (del) del.addEventListener('click', async () => {
        const savesNow = await loadGalSaves()
        await persistGalSaves(savesNow.filter((item) => item && item.id !== saveId))
        this.renderSavesPanel(panel)
      })
    })
  }

  /** 读档：恢复角色/群组/发言者与舞台剧情显示；可选同时新开对话以真正回到该剧情点 */
  async applySave(save) {
    if (!save) return
    await setActiveGroupRemote(save.groupId || null)
    if (save.characterId) await setActiveCharacterRemote(save.characterId)
    this.speakerIds = Array.isArray(save.speakerIds) ? save.speakerIds.slice() : []
    this.lines = Array.isArray(save.lines) ? save.lines.slice() : []
    const lastAssistant = [...this.lines].reverse().find((line) => line && line.kind === 'assistant')
    if (lastAssistant) this.setLine('assistant', lastAssistant.text)
    this.renderTopbar()
    this.updateStageContent()
    // 舞台显示已回到剧情点，但 DeepSeek 服务端会话仍记得之后的剧情；
    // 若当前会话已有历史，询问是否新开对话（模型上下文才会真正回到「空白」）。
    let freshStarted = false
    if (this.pageHasHistory()) {
      const wantFresh = confirm(
        '已恢复舞台剧情点。\n\n是否同时开启新对话？\n· 确定：开启新对话（模型不再记得后续剧情，真正回到该剧情点）\n· 取消：保留当前会话（模型仍记得之后发生的事）',
      )
      if (wantFresh) freshStarted = this.tryClickNewChatButton()
    }
    this.showToolNote(
      '📂 已读档「' + (save.name || '未命名存档') + '」'
      + (freshStarted ? '（已开启新对话）' : '（服务端会话历史不变）'),
    )
  }

  onCharacterChanged() {
    const char = getActiveCharacter()
    this.lines = []
    this.currentLine = null
    this.running = false
    this.streaming = false
    this.streamText = ''
    this.statusText = ''
    if (char.greeting) {
      this.lines.push({ kind: 'assistant', text: char.greeting })
      this.setLine('assistant', char.greeting)
    } else {
      this.updateStageContent()
    }
    this.renderTopbar()
    // 自动载入该模式/角色的相关记忆（提升注入权重）
    loadMemoriesForMode(char, this)
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf)
    if (this._domTimer) clearTimeout(this._domTimer)
    if (this._mo) { try { this._mo.disconnect() } catch { /* ignore */ } }
    this.root.innerHTML = ''
  }

  togglePanel(name) {
    if (this.panel === name) { this.closePanel(); return }
    this.closePanel()
    this.panel = name
    const panel = document.createElement('div')
    panel.className = 'g-panel'
    if (name === 'chars') this.renderCharsPanel(panel)
    else if (name === 'groups') this.renderGroupPanel(panel)
    else if (name === 'saves') void this.renderSavesPanel(panel)
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
        <div style="font-size:11px;color:#98a1c2;line-height:1.5;margin-bottom:8px">角色与注入节奏请在 DeepSeek++ 侧边栏「角色 / 设置 → 提示词」统一管理，此处仅快捷切换。</div>
        ${chars.map((c) => `
          <div class="g-card ${c.id === active.id ? 'is-active' : ''}" data-id="${c.id}">
            <div class="g-card-name" style="color:${c.color || '#fff'}">${escapeHtml(c.name)} ${c.id === active.id ? '✓' : ''} <span style="opacity:.75;font-weight:500">❤️${Math.round(c.affinity || 0)}</span></div>
            <div class="g-card-desc">${escapeHtml(c.description || '').slice(0, 40)}</div>
            <div class="g-btn-row">
              <button class="g-btn" data-act="switch">切换</button>
              <button class="g-btn" data-act="mem">记忆</button>
              <button class="g-btn" data-act="del">删除</button>
            </div>
          </div>`).join('')}
        <div class="g-btn-row">
          <button class="g-btn g-btn-accent" data-act="new">＋ 新建</button>
          <button class="g-btn" data-act="snow">❄ 雪璃</button>
        </div>
      </div>`
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())
    panel.querySelector('[data-act="new"]').addEventListener('click', async () => {
      const c = { ...defaultCharacter(), id: makeId('char'), name: '新角色' }
      await saveCharacterRemote(c)
      this.activateCharacter(c.id, { fresh: true })
      this.togglePanel('chars')
    })
    panel.querySelector('[data-act="snow"]').addEventListener('click', async () => {
      const c = presetSnowCrystal()
      await saveCharacterRemote(c)
      this.activateCharacter(c.id, { fresh: true })
      this.togglePanel('chars')
    })
    panel.querySelectorAll('[data-act="switch"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activateCharacter(btn.closest('[data-id]').dataset.id, { fresh: true })
        this.togglePanel('chars')
      })
    })
    panel.querySelectorAll('[data-act="mem"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]').dataset.id
        const c = getCharacters().find((x) => x.id === id)
        if (c) this.renderMemoryPanel(panel, c)
      })
    })
    panel.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('删除该角色？')) return
        await deleteCharacterRemote(btn.closest('[data-id]').dataset.id)
        this.onCharacterChanged()
        this.togglePanel('chars')
      })
    })
    panel.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]').dataset.id
        const c = getCharacters().find((x) => x.id === id)
        this.showToolNote('✏️ 编辑角色请到 DeepSeek++ 侧边栏「角色」页')
      })
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

  /** 检测到 RP 设定请求 → 浮层卡片确认是否保存为模式 */
  offerSaveRoleplayMode(text) {
    const active = getActiveCharacter()
    const suggested = extractRoleName(text)
    const existing = getCharacters().find((c) => c.name.toLowerCase() === (suggested || '').toLowerCase())
    // 已是定制角色或已存在同名模式 → 不打扰
    if (suggested && existing) return
    if (active && active.name !== 'DeepSeek娘' && active.name !== '新角色' && !suggested) return

    // 浮层：底部滑出卡片，询问是否把这段设定存为可复用模式
    const old = this.el.querySelector('.g-rp-save')
    if (old) old.remove()
    const card = document.createElement('div')
    card.className = 'g-rp-save'
    card.innerHTML = `
      <div class="g-rp-save-title">🎭 检测到角色扮演设定，保存为模式？</div>
      <div class="g-rp-save-desc">之后每次对话开始前可直接选择该模式，自动载入角色与相关记忆。</div>
      <input class="g-rp-input" data-f="name" value="${escapeHtml(suggested || active.name || '')}" placeholder="模式名称（角色名）">
      <textarea class="g-rp-input g-rp-desc" data-f="desc" rows="2" placeholder="一句话角色设定（可选）">${escapeHtml((active && active.name !== '新角色' ? active.description : '') || '')}</textarea>
      <div class="g-btn-row">
        <button class="g-btn g-btn-accent" data-act="save">💾 保存模式</button>
        <button class="g-btn" data-act="dismiss">忽略</button>
      </div>`
    this.el.append(card)
    card.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const name = card.querySelector('[data-f="name"]').value.trim() || suggested || '新角色'
      const desc = card.querySelector('[data-f="desc"]').value.trim()
      let char = active && active.name !== 'DeepSeek娘' && active.name !== '新角色' ? active : { ...defaultCharacter(), id: makeId('char') }
      char = { ...char, name, description: desc || char.description }
      if (char.description && !desc) {
        // 从原设定文本截取第一句做描述
        const first = String(text).split(/[。\n]/)[0].slice(0, 60)
        char.description = first || char.name
      }
      // 从 RP 文本提取关键词做记忆标签
      const tags = String(text).match(/[\u4e00-\u9fa5]{2,4}/g) || []
      char.memoryTags = [...new Set(tags.slice(0, 8))]
      const saved = await saveCharacterRemote(char)
      if (!saved) { card.remove(); return }
      char.id = saved.id
      // 把设定沉淀为角色记忆（topic：角色设定，characterId 归属该角色），选模式时可命中载入
      persistModeMemory(char, text, name)
      this.activateCharacter(char.id, { fresh: false })
      card.remove()
      this.showToolNote('💾 模式「' + char.name + '」已保存，可随时从角色面板切换')
    })
    card.querySelector('[data-act="dismiss"]').addEventListener('click', () => card.remove())
  }

  /** 模式卡片选择器：对话开始前像 DSH 一样选角色/模式 */
  showModePicker() {
    const old = this.el.querySelector('.g-mode-picker')
    if (old) old.remove()
    const chars = getCharacters()
    const activeId = __galActiveId
    const overlay = document.createElement('div')
    overlay.className = 'g-mode-picker'
    overlay.innerHTML = `
      <div class="g-mode-head">🎭 选择模式 · 开始新对话</div>
      <div class="g-mode-sub">选择角色卡自动载入设定与相关记忆；也可新建或自由对话</div>
      <div class="g-mode-grid">
        ${chars.map((c) => {
          const tagPreview = Array.isArray(c.memoryTags) && c.memoryTags.length
            ? '<span class="g-mode-tags">📚 ' + escapeHtml(c.memoryTags.slice(0, 3).join(' · ')) + '</span>'
            : ''
          const ava = c.avatar
            ? `<img class="g-mode-ava-img" src="${escapeHtml(c.avatar)}" alt="">`
            : `<span class="g-mode-ava" style="background:${c.color || '#8f7bff'}">${escapeHtml((c.name || '?').slice(0, 1))}</span>`
          const cur = c.id === activeId ? '<span class="g-mode-cur">当前</span>' : ''
          return `<button class="g-mode-card" data-id="${c.id}">
            ${ava}
            <span class="g-mode-name">${escapeHtml(c.name)} ${cur} <span style="opacity:.7;font-size:10px">❤️${Math.round(c.affinity || 0)}</span></span>
            <span class="g-mode-desc">${escapeHtml(c.description || '').slice(0, 28)}</span>
            ${tagPreview}
          </button>`
        }).join('')}
        <button class="g-mode-card is-new" data-act="new">
          <span class="g-mode-ava">＋</span>
          <span class="g-mode-name">新建角色</span>
          <span class="g-mode-desc">创建新的角色卡</span>
        </button>
      </div>
      <div class="g-btn-row" style="justify-content:center">
        <button class="g-btn" data-act="free">继续自由对话</button>
      </div>`
    this.el.append(overlay)
    overlay.querySelectorAll('.g-mode-card[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id
        const char = getCharacters().find((c) => c.id === id)
        this.activateCharacter(id, { fresh: true })
        loadMemoriesForMode(char, this)
        overlay.remove()
        this.showToolNote('🎭 已切换到「' + char.name + '」模式' + (this._lastMemHit ? this._lastMemHit : ''))
      })
    })
    overlay.querySelector('[data-act="new"]').addEventListener('click', async () => {
      const c = { ...defaultCharacter(), id: makeId('char'), name: '新角色' }
      await saveCharacterRemote(c)
      this.activateCharacter(c.id, { fresh: true })
      overlay.remove()
      this.showToolNote('点击右上「角色」可在侧边栏「角色」页填写设定')
    })
    overlay.querySelector('[data-act="free"]').addEventListener('click', () => overlay.remove())
  }
}

// ── 启动（defineContentScript main 内直接执行）──────────────────
    // 开关权威在扩展设置（core/character GalSettings.enabled，默认 false = 保持
    // DeepSeek 原版界面）。页面只读扩展状态；刷新/重载后保持上次选择。
    let entryButton = null
    function syncEntryButtonLabel() {
      if (!entryButton) return
      entryButton.textContent = galEnabled() ? '🎭 关闭 GAL' : '🎭 GAL 酒馆'
    }
    // 舞台可见时隐藏右下角入口（避免盖住 GAL 输入区）；原版界面/卸载时显示。
    function syncEntryVisibility() {
      if (!entryButton) return
      const stage = window.__galStage
      const visible = !!(stage && stage.el && stage.el.style.display !== 'none')
      entryButton.style.display = visible ? 'none' : 'flex'
    }
    // 常驻入口：页面右下角小按钮，负责「开/关 GAL 舞台」并持久化选择（写扩展设置）。
    function ensureEntryButton() {
      if (entryButton && document.documentElement.contains(entryButton)) return
      const btn = document.createElement('button')
      btn.id = 'dsgpp-gal-entry'
      btn.textContent = galEnabled() ? '🎭 关闭 GAL' : '🎭 GAL 酒馆'
      btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:8px 16px;border:1px solid rgba(143,123,255,.55);border-radius:20px;background:rgba(13,16,32,.94);color:#e6e9f4;font-size:13px;line-height:1;cursor:pointer;font-family:"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)'
      btn.addEventListener('click', async () => {
        const nextOn = !galEnabled()
        await setGalEnabledRemote(nextOn)
        if (nextOn) mountGal()
        else unmountGal()
        syncEntryButtonLabel()
      })
      document.documentElement.appendChild(btn)
      entryButton = btn
    }
    function mountGal() {
      const existing = document.getElementById('dsgpp-gal-root')
      if (existing) {
        if (window.__galStage && window.__galStage.el) window.__galStage.el.style.display = 'flex'
        syncEntryButtonLabel()
        syncEntryVisibility()
        return
      }
      const host = document.createElement('div')
      host.id = 'dsgpp-gal-root'
      document.documentElement.appendChild(host)
      const shadow = host.attachShadow({ mode: 'open' })
      window.__galStage = new GalStage(shadow)
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => window.__galStage && window.__galStage.measure()).observe(document.body)
      }
      maybeAutoOpenModePicker(window.__galStage)
      // 每日作息问候（时段去重，开关关闭时不打扰）
      setTimeout(() => {
        try { window.__galStage && window.__galStage.maybeDayGreeting() } catch { /* ignore */ }
      }, 3000)
      syncEntryButtonLabel()
      syncEntryVisibility()
    }
    function unmountGal() {
      const stage = window.__galStage
      if (stage && typeof stage.destroy === 'function') stage.destroy()
      window.__galStage = null
      const host = document.getElementById('dsgpp-gal-root')
      if (host) host.remove()
      syncEntryButtonLabel()
      syncEntryVisibility()
    }
    // 扩展内「停用」入口：写回扩展设置关闭 GAL（下次刷新不自动打开）
    async function disableGalFromStage() {
      await setGalEnabledRemote(false)
      unmountGal()
    }
    async function install() {
      // 1) 一次性迁移旧 localStorage 数据（角色卡/开关）到扩展库
      await migrateLegacyGalData()
      // 2) 初始化入口按钮；仅当扩展设置启用时挂载舞台
      ensureEntryButton()
      if (galEnabled()) mountGal()
      // 3) 空闲主动搭话轮询（设置开启时生效）
      startProactiveLoop()
    }

    /** 空闲轮询：舞台打开且长时间无互动时让角色主动开口 */
    function startProactiveLoop() {
      if (window.__galProactiveTimer) return
      window.__galProactiveTimer = setInterval(() => {
        try {
          const stage = window.__galStage
          if (!stage || !galEnabled()) return
          if (__galSettings.proactiveEnabled !== true) return
          if (document.hidden) return
          if (stage.running || stage.queueRunning) return
          const idleMs = Date.now() - (stage._lastActivityAt || 0)
          const needMs = (__galSettings.proactiveIdleMinutes || 10) * 60000
          if (idleMs < needMs) return
          void stage.triggerProactive()
        } catch { /* ignore */ }
      }, 45000)
    }

    // ── 新对话开始前自动弹模式选择器 ──────────────────────────────
    // 路由进入无历史的新会话（首页 /a/chat 或新开的 /chat/s/）时弹出；
    // 用「当前会话 + 时间窗」去重，避免一个会话内反复打断。
    const MODE_PICKER_KEY = 'gal:mode-picker-last'
    function maybeAutoOpenModePicker(stage) {
      try {
        // 每 ~40s 最多弹一次（防连弹）
        const last = Number(sessionStorage.getItem(MODE_PICKER_KEY) || 0)
        if (Date.now() - last < 40000) return
        // 等待页面消息区渲染，若无历史消息则弹选择器
        const attempt = (n) => {
          if (n > 20) return // ~5s 上限
          const hasHistory = document.querySelectorAll('[class*="message"], [class*="ds-chat-message"], [data-role="assistant"], [data-role="user"]').length > 0
          const path = location.pathname || ''
          const isNewChat = path === '/a/chat' || path === '/a/chat/' || !/\/chat\/s\//.test(path)
          if (hasHistory) return // 有历史：不打断已有对话
          if (isNewChat) {
            sessionStorage.setItem(MODE_PICKER_KEY, String(Date.now()))
            setTimeout(() => stage.showModePicker(), 500)
            return
          }
          setTimeout(() => attempt(n + 1), 250)
        }
        setTimeout(() => attempt(0), 700)
      } catch { /* ignore */ }
    }
    // 路由变化（SPA pushState）时再次检测：进入新会话也弹
    function watchRouteForModePicker(stage) {
      try {
        let lastPath = location.pathname + location.search
        const check = () => {
          const now = location.pathname + location.search
          if (now !== lastPath) {
            lastPath = now
            // 变成新会话路由才弹（已有会话不打断）
            if (now.startsWith('/a/chat') || !/\/chat\/s\//.test(now)) {
              setTimeout(() => maybeAutoOpenModePicker(stage), 400)
            }
          }
        }
        const wrap = (fn) => function (...a) { const r = fn.apply(this, a); setTimeout(check, 0); return r }
        try {
          history.pushState = wrap(history.pushState)
          history.replaceState = wrap(history.replaceState)
        } catch { /* ignore */ }
        window.addEventListener('popstate', check)
        // DeepSeek 是 React 应用，也观察输入区切换
        if (typeof MutationObserver !== 'undefined') {
          const mo = new MutationObserver(() => {
            const path = location.pathname || ''
            if (!path.includes('/chat/s/')) { /* 首页可能随时出现新会话输入框 */ }
          })
          try { mo.observe(document.body, { childList: true, subtree: true }) } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }

    install()
    watchRouteForModePicker(window.__galStage)
  },
})
