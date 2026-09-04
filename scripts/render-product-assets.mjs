#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tempDir = path.join(root, '.tmp-product-assets');

await fs.rm(tempDir, { recursive: true, force: true });
await fs.mkdir(tempDir, { recursive: true });

// README header is curated from the original logo artwork; do not regenerate it
// from synthetic UI panels when refreshing product screenshots.
const outputs = [
  ['docs/chrome-web-store/assets/small-promo.png', promoSvg()],
  ['docs/chrome-web-store/assets/screenshot-inline-tools-1280x800.png', storeScreenshotSvg()],
  ['assets/screenshot-inline-tools.png', inlineToolsSvg()],
  ['assets/screenshot-sidepanel-memory.png', sidepanelSvg({
    activeTab: '资料',
    activeSubTab: '记忆',
    title: '记忆',
    meta: '共 4 条记忆',
    description: '长期影响 DeepSeek++ 回复的用户偏好、反馈、话题背景和参考资料。',
    filters: ['全部', '用户', '反馈', '话题', '参考'],
    cards: [
      ['用户', '文档风格偏好', '公开 README 只写用户可感知的功能价值，不暴露内部 API、协议和实现细节。', ['README', '公开文案'], true],
      ['反馈', '修复严重问题时少问多做', '当 bug 被定性为严重 blocker 时，先沿根因完整追踪、修复、验证，再汇报结果。', ['协作', '质量'], true],
      ['话题', 'DeepSeek++ 产品主线', '运行在 DeepSeek 网页侧边栏里的工作台，集中管理记忆、项目、Skill、MCP 和自动化。', ['产品', '发布'], false],
      ['参考', 'Chrome Web Store 发布检查', '商店图、权限说明、隐私政策、zip 资产和更新说明必须同步检查。', ['store', 'release'], false],
    ],
  })],
  ['assets/screenshot-sidepanel-saved.png', sidepanelSvg({
    activeTab: '资料',
    activeSubTab: '保存',
    title: '保存',
    meta: '共 3 条保存项',
    description: '收藏常用提示词、参考链接和对话片段，下一次聊天可直接插入。',
    filters: ['片段', '书签', 'Markdown', 'JSON'],
    cards: [
      ['片段', '发布说明骨架', '这次版本的主线是：把 DeepSeek 网页从单次聊天扩展成带记忆、项目、工具和自动化的工作台。', ['release', 'README'], false],
      ['书签', 'Chrome Web Store 提交流程', 'docs/chrome-web-store/submission.md', ['store', 'checklist'], false],
      ['片段', '宏观日报提示词', '先列事实源和最新日期，再判断风险灯号增强、维持、缓解或失效，最后输出纪律影响。', ['prompt', 'macro'], false],
    ],
  })],
  ['assets/screenshot-sidepanel-projects.png', sidepanelSvg({
    activeTab: '项目',
    title: '项目',
    meta: '2 个项目 · 2 个会话',
    description: '把会话、项目指令和项目内记忆绑定在一起，让 DeepSeek++ 在同一任务线上持续理解上下文。',
    filters: ['投资研究', 'DeepSeek++ 发布'],
    cards: [
      ['项目', '投资研究', '长期跟踪组合、交易纪律和宏观假设。先确认事实来源，再把结论收束到仓位、风险和下一步动作。', ['1 个会话', '1 条项目记忆'], true],
      ['会话', '黄仁勋五层金字塔结构', '已绑定到「投资研究」，下一次新对话可继续复用项目指令。', ['2 小时前'], false],
      ['项目', 'DeepSeek++ 发布', 'README、商店文案、发布验证与用户反馈。公开文案只讲用户可感知能力。', ['release', 'docs'], false],
    ],
  })],
  ['assets/screenshot-sidepanel-skill.png', sidepanelSvg({
    activeTab: '能力',
    activeSubTab: '技能',
    title: '技能',
    meta: '16 个 Skill · 15 个启用',
    description: '为固定工作流保存可复用的指令模板，也可以从 GitHub 导入团队共享 Skill。',
    filters: ['内置', '官方', '自定义', 'GitHub'],
    cards: [
      ['内置', 'memory-manager', '提炼稳定偏好、项目背景和长期参考资料，自动写入记忆。', ['启用', '内置'], true],
      ['官方', 'officecli', '创建、分析和修改 Office 文档，适合报告、表格和演示材料。', ['文档', '工具'], false],
      ['自定义', 'release-copy', '先提炼 release thesis，再按用户可感知能力组织发布文案。', ['README', 'store'], false],
      ['GitHub', 'store-listing', '核对商店截图、短描述、权限说明、隐私政策和更新说明。', ['Chrome Web Store'], false],
    ],
  })],
  ['assets/screenshot-sidepanel-mcp.png', sidepanelSvg({
    activeTab: '能力',
    activeSubTab: 'MCP',
    title: 'MCP',
    meta: '2 个服务 · 5 个工具',
    description: '连接本地 Shell Host、HTTP/SSE 或 Native MCP 服务，把外部工具纳入 DeepSeek 对话。',
    filters: ['全部', '已启用', 'Shell Host', 'HTTP'],
    cards: [
      ['Native', 'DeepSeek++ Shell Host', 'ready · 3 个工具 · 42 ms。Shell、Python 与状态检查已可用。', ['auto', '本地'], true],
      ['HTTP', 'Market Data MCP', 'ready · 2 个工具 · 118 ms。仅允许 quote_snapshot 和 macro_calendar。', ['confirm', 'allowlist'], false],
      ['历史', 'python_exec', 'Python completed in 0.8s · rows=128, anomalies=3, saved=report.csv', ['9 分钟前'], false],
    ],
  })],
  ['assets/screenshot-sidepanel-tools.png', sidepanelSvg({
    activeTab: '能力',
    activeSubTab: '工具',
    title: '工具',
    meta: 'Web + Python + 运行历史',
    description: '管理内置 Web 工具、Python 执行能力和最近工具调用记录。',
    filters: ['Web Search', 'Web Fetch', 'Python', '诊断'],
    cards: [
      ['内置', 'web_search', '在聊天中搜索网页并返回可引用摘要。', ['已启用'], true],
      ['内置', 'web_fetch', '读取指定网页内容，适合补充事实源和上下文。', ['已启用'], false],
      ['MCP', 'Python 执行', 'Shell Host 已发现 python_exec，可在对话中运行短 Python 片段。', ['ready', 'local'], false],
      ['历史', 'web_search', '搜索完成 · 已把 5 条结果整理为聊天摘要。', ['24 分钟前'], false],
    ],
  })],
  ['assets/screenshot-sidepanel-browser.png', sidepanelSvg({
    activeTab: '能力',
    activeSubTab: '浏览器',
    title: '浏览器控制',
    meta: '已启用 · 目标标签 12',
    description: '把当前浏览器标签页暴露给模型，让它读取页面结构、点击、输入和执行快照动作。',
    filters: ['目标', '快照', '动作', '安全'],
    cards: [
      ['状态', '控制已启用', '目标标签：DeepSeek - 探索未至之境。每次动作后附带页面快照。', ['enabled', 'tab 12'], true],
      ['快照', '节点与文本预算', '最多 400 个节点，文本上限 24,000 bytes，便于在上下文内保持可读。', ['snapshot'], false],
      ['动作', '可用浏览器工具', 'navigate、click、fill、key、wait_for、snapshot 等动作可按需暴露。', ['browser tools'], false],
    ],
  })],
  ['assets/screenshot-sidepanel-automation.png', sidepanelSvg({
    activeTab: '能力',
    activeSubTab: '自动化',
    title: '自动化',
    meta: '2 个任务 · 1 个启用',
    description: '把固定提示词安排为手动或定时任务，自动打开 DeepSeek 会话并保留运行历史。',
    filters: ['全部', '启用', '暂停', '定时'],
    cards: [
      ['定时', '盘前市场简报', '工作日 08:30 运行。读取美股、美元、长债与宏观事件，输出风险灯号和纪律影响。', ['active', 'Asia/Shanghai'], true],
      ['运行', '最近一次运行成功', '风险灯号维持中性偏谨慎。会话已回写到 DeepSeek 历史。', ['3 小时前'], false],
      ['手动', '每周项目复盘', '总结本周项目上下文、关键结论和下周需要跟进的问题。', ['paused'], false],
    ],
  })],
  ['assets/screenshot-sidepanel-settings.png', sidepanelSvg({
    activeTab: '设置',
    title: '设置',
    meta: 'v0.7.4',
    description: '配置同步、语言、专家模式、背景、小鲸鱼宠物、官方 API 聊天和提示词注入策略。',
    filters: ['同步', '语言', '外观', '模型'],
    cards: [
      ['模式', '专家模式', '启用后 DeepSeek++ 默认使用更强的上下文和工具配置。', ['enabled'], true],
      ['同步', 'WebDAV 同步', '可把记忆、Skill、项目、保存项和预设同步到自己的 WebDAV 目录。', ['DeepSeekPP'], false],
      ['外观', '小鲸鱼宠物', '可调整位置、尺寸、透明度和动画，让增强功能有清晰状态反馈。', ['pet', 'theme'], false],
    ],
  })],
  ['assets/screenshot-skill-popup.png', skillPopupSvg()],
];

for (const [relativePath, svg] of outputs) {
  await renderPng(relativePath, svg);
}

await fs.copyFile(
  path.join(root, 'docs/chrome-web-store/assets/screenshot-inline-tools-1280x800.png'),
  path.join(root, 'assets/screenshot-inline-tools.png'),
);

await fs.rm(tempDir, { recursive: true, force: true });
console.log(`Rendered ${outputs.length} product assets.`);

async function renderPng(relativePath, svg) {
  const svgPath = path.join(tempDir, relativePath.replace(/[\\/]/g, '__').replace(/\.png$/, '.svg'));
  const outPath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(svgPath, svg, 'utf8');
  await execFileAsync('sips', ['-s', 'format', 'png', svgPath, '--out', outPath]);
}

function promoSvg() {
  return svg(440, 280, `
    ${defs()}
    <rect width="440" height="280" fill="url(#bgPromo)"/>
    <circle cx="374" cy="54" r="72" fill="#dce9ff"/>
    <g transform="translate(34 32)">
      ${brandMark(0, 0, 38)}
      <text x="50" y="27" class="brand">DeepSeek++</text>
      <text x="0" y="92" class="promoTitle">让 DeepSeek</text>
      <text x="0" y="134" class="promoTitle">记住上下文</text>
      <text x="0" y="176" class="promoTitle">并连接真实工具</text>
      <text x="0" y="218" class="bodyStrong">记忆 · 项目 · Skill · MCP · 自动化</text>
    </g>
  `);
}

function storeScreenshotSvg() {
  return svg(1280, 800, `
    ${defs()}
    <rect width="1280" height="800" fill="#f5f8ff"/>
    <path d="M0 0H1280V800H0Z" fill="url(#bgStore)"/>
    <g transform="translate(72 72)">
      ${brandMark(0, 0, 46)}
      <text x="60" y="33" class="brandLarge">DeepSeek++</text>
      <text x="0" y="130" class="storeTitle">把 DeepSeek 变成</text>
      <text x="0" y="188" class="storeTitle">会记忆、会用工具</text>
      <text x="0" y="246" class="storeTitle">的工作台</text>
      <text x="0" y="306" class="storeBody">侧边栏统一管理长期记忆、项目上下文、Skill、MCP 工具和自动化任务。</text>
      <text x="0" y="342" class="storeBody">聊天时直接调取，结果留在同一条 DeepSeek 会话里。</text>
      ${chip(0, 392, '长期记忆', 18)}
      ${chip(122, 392, '项目上下文', 18)}
      ${chip(274, 392, 'MCP 工具', 18)}
      ${chip(410, 392, '自动化', 18)}
    </g>
    <g transform="translate(640 44)">
      ${miniSidepanel(0, 0, '记忆', ['文档风格偏好', '修复严重问题时少问多做', 'DeepSeek++ 产品主线', 'Chrome Web Store 发布检查'], '#4f6fff', 430, 710)}
      ${miniSidepanel(300, 58, 'MCP', ['DeepSeek++ Shell Host', 'Market Data MCP', 'python_exec'], '#16a34a', 330, 520)}
      ${miniSidepanel(250, 430, '自动化', ['盘前市场简报', '最近一次运行成功', '每周项目复盘'], '#7c3aed', 360, 300)}
    </g>
  `);
}

function inlineToolsSvg() {
  return storeScreenshotSvg();
}

function skillPopupSvg() {
  return svg(1440, 900, `
    ${defs()}
    <rect width="1440" height="900" fill="#f7f9ff"/>
    <g transform="translate(76 72)">
      <text x="0" y="0" class="pageKicker">DeepSeek 对话输入框</text>
      <rect x="0" y="36" width="980" height="178" rx="24" fill="#ffffff" stroke="#dce4f5"/>
      <text x="34" y="96" class="inputGhost">/release</text>
      <rect x="34" y="132" width="124" height="36" rx="18" fill="#edf4ff" stroke="#bfd2ff"/>
      <text x="62" y="156" class="blueSmall">深度思考</text>
      <rect x="176" y="132" width="126" height="36" rx="18" fill="#edf4ff" stroke="#bfd2ff"/>
      <text x="204" y="156" class="blueSmall">智能搜索</text>
      <circle cx="922" cy="148" r="28" fill="#84a2ff"/>
      <text x="913" y="158" class="sendIcon">↑</text>
    </g>
    <g transform="translate(156 286)">
      <rect width="880" height="468" rx="24" fill="#ffffff" stroke="#dce4f5" filter="url(#shadow)"/>
      <text x="30" y="52" class="popupTitle">Skill 自动补全</text>
      <text x="30" y="84" class="popupHint">输入 / 后选择常用工作流，DeepSeek++ 会把模板和上下文注入当前对话。</text>
      ${popupRow(30, 122, 'release-copy', '把版本变化改写成面向用户的发布文案', ['README', 'store'], true)}
      ${popupRow(30, 218, 'store-listing', '检查 Chrome Web Store 上架材料是否完整', ['Chrome Web Store'], false)}
      ${popupRow(30, 314, 'memory-manager', '提炼稳定偏好、项目背景和长期参考资料', ['内置', '记忆'], false)}
    </g>
    <g transform="translate(1110 106)">
      ${miniSidepanel(0, 0, '技能', ['memory-manager', 'officecli', 'release-copy', 'store-listing'], '#4f6fff', 280, 640)}
    </g>
  `);
}

function sidepanelSvg({
  activeTab,
  activeSubTab,
  title,
  meta,
  description,
  filters,
  cards,
}) {
  const subTabs = activeTab === '资料'
    ? ['记忆', '保存']
    : activeTab === '能力'
      ? ['技能', 'MCP', '工具', '浏览器', '预设', '自动化']
      : [];
  return svg(760, 1600, `
    ${defs()}
    <rect width="760" height="1600" fill="#f7f9ff"/>
    <rect width="760" height="92" fill="#ffffff"/>
    ${brandMark(32, 23, 44)}
    <text x="92" y="58" class="sideBrand">DeepSeek++</text>
    <line x1="0" y1="92" x2="760" y2="92" stroke="#e3e8f3"/>
    ${topNav(activeTab)}
    ${subTabs.length ? subNav(subTabs, activeSubTab ?? subTabs[0]) : ''}
    <g transform="translate(40 ${subTabs.length ? 262 : 220})">
      <text x="0" y="0" class="pageTitle">${esc(title)}</text>
      <text x="0" y="38" class="pageMeta">${esc(meta)}</text>
      ${wrapText(description, 0, 82, 36, 28, 'pageDesc')}
      ${filterRow(0, 152, filters)}
      ${cards.map((card, index) => cardSvg(0, 216 + index * 220, ...card)).join('')}
    </g>
  `);
}

function topNav(active) {
  const tabs = ['资料', '项目', '能力', '设置'];
  return `<g transform="translate(0 92)">
    <rect width="760" height="78" fill="#ffffff"/>
    ${tabs.map((tab, index) => {
      const x = 72 + index * 166;
      const isActive = tab === active;
      return `
        <text x="${x}" y="49" class="${isActive ? 'navActive' : 'nav'}">${tab}</text>
        ${isActive ? `<rect x="${x - 18}" y="70" width="76" height="4" rx="2" fill="#4f6fff"/>` : ''}
      `;
    }).join('')}
    <line x1="0" y1="78" x2="760" y2="78" stroke="#e3e8f3"/>
  </g>`;
}

function subNav(tabs, active) {
  return `<g transform="translate(0 170)">
    <rect width="760" height="50" fill="#f1f5ff"/>
    ${tabs.map((tab, index) => {
      const x = 40 + index * (tabs.length > 3 ? 104 : 130);
      const isActive = tab === active;
      return `
        <text x="${x}" y="32" class="${isActive ? 'subActive' : 'sub'}">${tab}</text>
        ${isActive ? `<rect x="${x - 6}" y="46" width="${Math.max(42, tab.length * 24)}" height="4" rx="2" fill="#4f6fff"/>` : ''}
      `;
    }).join('')}
  </g>`;
}

function filterRow(x, y, labels) {
  let cursor = x;
  return `<g transform="translate(${x} ${y})">
    ${labels.map((label, index) => {
      const width = Math.max(76, label.length * 28 + 30);
      const markup = `<rect x="${cursor}" y="0" width="${width}" height="46" rx="23" fill="${index === 0 ? '#edf4ff' : '#ffffff'}" stroke="${index === 0 ? '#bfd2ff' : '#dce4f5'}"/>
        <text x="${cursor + 18}" y="31" class="${index === 0 ? 'filterActive' : 'filter'}">${esc(label)}</text>`;
      cursor += width + 12;
      return markup;
    }).join('')}
  </g>`;
}

function cardSvg(x, y, type, title, body, tags, pinned = false) {
  const colors = typeColors(type);
  const badgeWidth = Math.max(68, type.length * 24 + 28);
  const titleX = 28 + badgeWidth + 24;
  return `<g transform="translate(${x} ${y})">
    <rect width="680" height="190" rx="22" fill="#ffffff" stroke="#dce4f5" filter="url(#softShadow)"/>
    <rect x="28" y="28" width="${badgeWidth}" height="38" rx="10" fill="${colors.bg}" stroke="${colors.border}"/>
    <text x="43" y="54" class="badge" fill="${colors.text}">${esc(type)}</text>
    <text x="${titleX}" y="55" class="cardTitle">${esc(title)}</text>
    ${pinned ? '<text x="610" y="55" class="star">★</text>' : ''}
    ${wrapText(body, 28, 96, 28, 29, 'cardBody')}
    ${tags.map((tag, index) => tagPill(28 + index * 130, 150, tag)).join('')}
  </g>`;
}

function tagPill(x, y, tag) {
  const width = Math.max(68, tag.length * 18 + 30);
  return `<rect x="${x}" y="${y}" width="${width}" height="30" rx="8" fill="#f3f6fb"/>
    <text x="${x + 15}" y="${y + 21}" class="tag">${esc(tag)}</text>`;
}

function miniSidepanel(x, y, title, items, color, width = 310, height = 300) {
  const itemY = 96;
  return `<g transform="translate(${x} ${y})">
    <rect width="${width}" height="${height}" rx="22" fill="#ffffff" stroke="#dce4f5" filter="url(#shadow)"/>
    <rect width="${width}" height="64" rx="22" fill="#ffffff"/>
    <text x="24" y="42" class="miniTitle">${esc(title)}</text>
    <rect x="24" y="72" width="${width - 48}" height="3" rx="1.5" fill="${color}"/>
    ${items.map((item, index) => `
      <rect x="24" y="${itemY + index * 72}" width="${width - 48}" height="52" rx="14" fill="${index === 0 ? '#edf4ff' : '#f7f9ff'}" stroke="${index === 0 ? '#bfd2ff' : '#e3e8f3'}"/>
      <circle cx="48" cy="${itemY + 26 + index * 72}" r="8" fill="${color}"/>
      <text x="66" y="${itemY + 34 + index * 72}" class="miniItem">${esc(item)}</text>
    `).join('')}
  </g>`;
}

function popupRow(x, y, title, body, tags, active) {
  return `<g transform="translate(${x} ${y})">
    <rect width="820" height="76" rx="16" fill="${active ? '#edf4ff' : '#f8fafc'}" stroke="${active ? '#bfd2ff' : '#e3e8f3'}"/>
    <text x="24" y="31" class="popupRowTitle">/${esc(title)}</text>
    <text x="24" y="58" class="popupRowBody">${esc(body)}</text>
    ${tags.map((tag, index) => tagPill(580 + index * 120, 22, tag)).join('')}
  </g>`;
}

function brandMark(x, y, size) {
  const radius = Math.round(size * 0.28);
  const textSize = Math.round(size * 0.38);
  return `<g transform="translate(${x} ${y})">
    <rect width="${size}" height="${size}" rx="${radius}" fill="#4f6fff"/>
    <text x="${size * 0.18}" y="${size * 0.62}" font-size="${textSize}" font-weight="850" fill="#ffffff">D++</text>
  </g>`;
}

function chip(x, y, text, fontSize = 15) {
  const width = Math.max(88, text.length * fontSize + 34);
  return `<rect x="${x}" y="${y}" width="${width}" height="38" rx="19" fill="#ffffff" stroke="#bfd2ff"/>
    <text x="${x + 17}" y="${y + 25}" class="chip">${esc(text)}</text>`;
}

function wrapText(text, x, y, maxChars, lineHeight, className) {
  const lines = [];
  let current = '';
  for (const char of text) {
    const next = current + char;
    if (next.length > maxChars) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2).map((line, index) =>
    `<text x="${x}" y="${y + index * lineHeight}" class="${className}">${esc(line)}</text>`
  ).join('');
}

function typeColors(type) {
  if (['反馈', 'HTTP', '官方', '运行'].includes(type)) return { bg: '#fff7ed', border: '#fed7aa', text: '#ea580c' };
  if (['话题', '项目', 'MCP', '定时'].includes(type)) return { bg: '#f5f3ff', border: '#ddd6fe', text: '#7c3aed' };
  if (['参考', 'Native', '内置', '状态'].includes(type)) return { bg: '#ecfdf5', border: '#bbf7d0', text: '#16a34a' };
  return { bg: '#edf4ff', border: '#bfd2ff', text: '#2563eb' };
}

function defs() {
  return `<defs>
    <linearGradient id="bgHeader" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#edf5ff"/>
    </linearGradient>
    <linearGradient id="bgPromo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#edf5ff"/>
    </linearGradient>
    <linearGradient id="bgStore" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#edf5ff"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#1f3f82" flood-opacity=".18"/>
    </filter>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#2c4778" flood-opacity=".08"/>
    </filter>
  </defs>`;
}

function svg(width, height, content) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif;letter-spacing:0}
    .brand{font-size:23px;font-weight:800;fill:#2563eb}
    .brandLarge{font-size:28px;font-weight:850;fill:#2563eb}
    .sideBrand{font-size:27px;font-weight:800;fill:#111827}
    .h1{font-size:34px;font-weight:850;fill:#111827}
    .storeTitle{font-size:46px;font-weight:850;fill:#111827}
    .promoTitle{font-size:34px;font-weight:850;fill:#111827}
    .storeBody{font-size:20px;font-weight:450;fill:#4b5563}
    .body{font-size:15px;font-weight:450;fill:#4b5563}
    .bodyStrong{font-size:16px;font-weight:700;fill:#4b5563}
    .chip{font-size:15px;font-weight:650;fill:#2456d6}
    .nav{font-size:23px;font-weight:650;fill:#6b7280}
    .navActive{font-size:23px;font-weight:760;fill:#4f6fff}
    .sub{font-size:20px;font-weight:650;fill:#6b7280}
    .subActive{font-size:20px;font-weight:760;fill:#4f6fff}
    .pageTitle{font-size:32px;font-weight:850;fill:#111827}
    .pageMeta{font-size:16px;font-weight:650;fill:#9aa3b2}
    .pageDesc{font-size:18px;font-weight:450;fill:#687386}
    .filter{font-size:18px;font-weight:600;fill:#687386}
    .filterActive{font-size:18px;font-weight:760;fill:#4f6fff}
    .badge{font-size:18px;font-weight:760}
    .cardTitle{font-size:24px;font-weight:800;fill:#111827}
    .cardBody{font-size:21px;font-weight:450;fill:#687386}
    .tag{font-size:15px;font-weight:600;fill:#98a1b2}
    .star{font-size:24px;font-weight:800;fill:#f59e0b}
    .miniTitle{font-size:22px;font-weight:800;fill:#111827}
    .miniItem{font-size:17px;font-weight:650;fill:#4b5563}
    .pageKicker{font-size:28px;font-weight:850;fill:#111827}
    .inputGhost{font-size:32px;font-weight:650;fill:#4f6fff}
    .blueSmall{font-size:16px;font-weight:700;fill:#4f6fff}
    .sendIcon{font-size:28px;font-weight:850;fill:#ffffff}
    .popupTitle{font-size:28px;font-weight:850;fill:#111827}
    .popupHint{font-size:18px;font-weight:450;fill:#687386}
    .popupRowTitle{font-size:22px;font-weight:800;fill:#4f6fff}
    .popupRowBody{font-size:16px;font-weight:450;fill:#687386}
  </style>
  ${content}
</svg>`;
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
