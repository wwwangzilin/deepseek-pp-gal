// T4 本地 Skill 激活打分单测。
// 覆盖：selectImplicitSkill 五例（适用场景命中 / 不适用场景命中 / 无相关 / 双弱争激活被双闸拦截 / 名称+描述高分）、
// 以及 scoreLocalSkill / scenarioAdjustment 的精确分量。
//
// 关键语义（来自 local-skill-scoring-spec.md §3 / §3.4 / §3.5）：
//   - normalizeSearchText = NFKC + 小写 + trim；tokenize 按 \p{L}\p{N}_- 切分（中文整句成单 token）。
//   - 整串命中：name +800 / desc +400 / cat +200；逐词命中：name +100 / desc +40 / cat +60。
//   - scenarioAdjustment：适用场景命中（覆盖率≥0.6）→ 动态加成（round(cov*100)，封顶+100），不适用场景命中 -1000。
//   - P1-B 泛词闸门：查询仅由 ≤2 个常见二字词构成 → 不激活。
//   - P1-B 修法3：仅当查询整串规范化后长度 ≥ 3 才给描述整串 +400（2 字查询不再吃 +400）。
//   - 阈值双闸：最高分 >= 100 且 最高分 >= 次高分 + 50，否则返回 null。

import { describe, expect, it } from 'vitest';
import {
  type LocalSkillIndex,
  extractScenarioBlock,
  scenarioAdjustment,
  scoreLocalSkill,
  selectImplicitSkill,
} from '../core/skill/local-skill-scorer';

function index(name: string, description: string, skillDir = '/skills/x'): LocalSkillIndex {
  return { name, description, skillDir };
}

describe('scenarioAdjustment', () => {
  it('适用场景命中（覆盖率≥0.6）→ 动态加成（F0-A，封顶+100）', () => {
    // 查询 2-gram「周报」100% 命中适用场景文本 → coverage=1.0 → round(100)=100（非固定 +300）。
    expect(scenarioAdjustment('适用场景：生成周报、日报、总结', '周报', ['周报'])).toBe(100);
  });

  it('适用场景部分命中（覆盖率<0.6）→ 不给加成', () => {
    // 查询 2-gram 仅 1/3 命中适用场景文本 → coverage≈0.33 < 0.6 → 返回 0（避免弱粒度误加成）。
    expect(scenarioAdjustment('适用场景：生成周报、月报、季报', '周报 年报', ['周报', '年报'])).toBe(0);
  });

  it('不适用 / 禁用场景命中 → -1000', () => {
    expect(scenarioAdjustment('通用写作助手。禁用场景：写周报', '周报', ['周报'])).toBe(-1000);
    expect(scenarioAdjustment('不适用场景：写周报', '周报', ['周报'])).toBe(-1000);
  });

  it('无场景标注 → 0', () => {
    expect(scenarioAdjustment('普通描述，与周报无关', '周报', ['周报'])).toBe(0);
  });
});

describe('scoreLocalSkill', () => {
  it('名称逐词 + 描述整串命中累加', () => {
    // 名称 weekly-report 含逐词 weekly/report 各 +100；描述整串命中 weekly report +400、逐词各 +40。
    const score = scoreLocalSkill(
      index('weekly-report', 'Generate weekly report and summary'),
      'weekly report',
      ['weekly', 'report'],
    );
    expect(score).toBe(100 + 100 + 400 + 40 + 40);
  });

  it('不适用场景把正分拉成负分（低于阈值）', () => {
    const score = scoreLocalSkill(
      index('writer', '通用写作助手。禁用场景：写周报'),
      '周报',
      ['周报'],
    );
    // P1-B 修法3：查询整串长度=2 < 3 → 不吃描述整串 +400，仅逐词 +40；不适用场景 -1000 → -960。
    expect(score).toBe(40 - 1000);
  });
});

describe('selectImplicitSkill', () => {
  it('空候选 → null', () => {
    expect(selectImplicitSkill('周报', [])).toBeNull();
  });

  it('例1：适用场景命中 → 激活', () => {
    const skills = [index('report', '适用场景：生成周报、日报、总结')];
    expect(selectImplicitSkill('周报', skills)?.name).toBe('report');
  });

  it('例2：不适用场景命中 → 不激活', () => {
    const skills = [index('writer', '通用写作助手。禁用场景：写周报')];
    expect(selectImplicitSkill('周报', skills)).toBeNull();
  });

  it('例3：无相关 Skill → null', () => {
    const skills = [
      index('weather', '查询天气与气象预警'),
      index('news', '新闻摘要与聚合'),
    ];
    expect(selectImplicitSkill('周报', skills)).toBeNull();
  });

  it('例4：双弱候选未过阈值（ACTIVATION_THRESHOLD）→ null', () => {
    // 两个 Skill 仅在描述含「周报」整串；但 queryNorm 长度=2 < 3 不吃 +400，仅逐词 +40 → 各得 40，
    // 未过 ACTIVATION_THRESHOLD(100)，双闸（阈值 + 领先差）拦截，避免「两弱争激活」。
    const skills = [
      index('a', '处理周报'),
      index('b', '整理周报'),
    ];
    const picked = selectImplicitSkill('周报', skills);
    expect(picked).toBeNull();
  });

  it('例5：名称逐词 + 描述整串高分 → 激活', () => {
    const skills = [index('weekly-report', 'Generate weekly report and summary')];
    expect(selectImplicitSkill('weekly report', skills)?.name).toBe('weekly-report');
  });

  it('多候选时只返回显著领先且过阈值的那一个', () => {
    const skills = [
      index('report', '适用场景：生成周报、日报、总结'), // 140（整串不吃+400 + 适用场景覆盖率加成 +100）
      index('digest', '整理会议纪要'), // 0（与「周报」无关）
    ];
    expect(selectImplicitSkill('周报', skills)?.name).toBe('report');
  });
});

describe('P1-B 泛词闸门（常见二字词弱共享不激活）', () => {
  it('单常见二字词查询 → null（不误激活）', () => {
    const skills = [index('finance-report', '适用场景：生成财务报表')];
    expect(selectImplicitSkill('财务', skills)).toBeNull();
  });

  it('两个常见二字词查询 → null', () => {
    const skills = [index('finance-news', '适用场景：财务新闻摘要')];
    expect(selectImplicitSkill('财务 新闻', skills)).toBeNull();
  });

  it('特定场景词（非泛词）仍正常激活', () => {
    const skills = [index('weekly-report', '适用场景：生成周报')];
    expect(selectImplicitSkill('周报', skills)?.name).toBe('weekly-report');
  });

  it('泛词 + 特定场景词混合（>2 词）→ 正常评分', () => {
    // 超过 2 个词 → 不触发泛词闸门，进入正常打分并激活。
    const skills = [index('weekly-report', '适用场景：生成财务报表与周报')];
    expect(selectImplicitSkill('财务 报表 周报', skills)?.name).toBe('weekly-report');
  });
});

describe('P1-B 修法3（2 字查询不吃描述整串 +400）', () => {
  it('2 字查询仅凭常见 2-gram 命中描述 → 仅逐词 +40，无整串 +400', () => {
    const score = scoreLocalSkill(index('writer', '写周报的工具'), '周报', ['周报']);
    expect(score).toBe(40);
  });

  it('3 字及以上查询命中描述整串 → 照常 +400', () => {
    const score = scoreLocalSkill(
      index('writer', '生成季度周报汇总'),
      '季度周报',
      ['季度', '周报'],
    );
    // 描述整串「季度周报」命中 +400；逐词 季度+40 周报+40；无场景块 → +400+80=480。
    expect(score).toBe(400 + 40 + 40);
  });
});

describe('P1-C 场景块提取负向防御（防「适用场景」被「不适用场景」子串误匹配）', () => {
  it('仅「不适用场景」heading → 适用场景返回空', () => {
    const desc = '## 不适用场景\n- 写周报';
    expect(extractScenarioBlock(desc, '适用场景', '适用场景|适用|使用场景')).toBe('');
  });

  it('负向块在前、正向块在后 → 适用场景抓到正向块', () => {
    const desc = '## 不适用场景\n- 写周报\n## 适用场景\n- 生成月报';
    expect(extractScenarioBlock(desc, '适用场景', '适用场景|适用|使用场景').trim()).toBe('生成月报');
  });

  it('正向块在前、负向块在后 → 适用场景抓到正向块', () => {
    const desc = '## 适用场景\n- 生成月报\n## 不适用场景\n- 写周报';
    expect(extractScenarioBlock(desc, '适用场景', '适用场景|适用|使用场景').trim()).toBe('生成月报');
  });

  it('inline「不适用场景：」不污染适用场景提取（均行首）', () => {
    const desc = '通用写作助手\n不适用场景：写周报\n适用场景：生成月报';
    expect(extractScenarioBlock(desc, '适用场景', '适用场景|适用|使用场景')).toBe('生成月报');
  });
});

describe('模块 E：A4 精确名称不被泛词杀（E1-E3）', () => {
  it('E1：Skill 名称精确命中泛词查询 → 激活（如分析作为名称）', () => {
    const skills = [index('分析', '通用分析助手')];
    expect(selectImplicitSkill('分析', skills)?.name).toBe('分析');
  });

  it('E2：名称含泛词（财务）→ 名称精确命中 +800 激活', () => {
    const skills = [index('财务报表生成', '适用场景：生成财务报表')];
    expect(selectImplicitSkill('财务', skills)?.name).toBe('财务报表生成');
  });

  it('E3：名称含泛词（报告）→ 名称精确命中 +800 激活', () => {
    const skills = [index('数据分析报告', '适用场景：生成分析报告')];
    expect(selectImplicitSkill('报告', skills)?.name).toBe('数据分析报告');
  });
});

describe('模块 E：A2 负向 -1000 恢复且正向不误抓（E4-E6）', () => {
  it('E4：heading 风格不适用场景能被正确提取负向块', () => {
    const desc = '## 不适用场景\n- 写周报';
    expect(extractScenarioBlock(desc, '不适用场景', '不适用场景|不适用|禁用场景')).toBe('写周报');
  });

  it('E5：heading 不适用场景命中 → 不激活（负向 -1000 恢复）', () => {
    const skills = [index('writer', '## 不适用场景\n- 写周报')];
    expect(selectImplicitSkill('周报', skills)).toBeNull();
  });

  it('E6：heading 适用场景正向块仍正确激活（删 (?!不) 后不误抓）', () => {
    const skills = [index('report', '## 适用场景\n- 生成周报')];
    expect(selectImplicitSkill('周报', skills)?.name).toBe('report');
  });
});

describe('模块 E：E7 精确名称 vs 强负向收尾钉死', () => {
  it('E7：名称精确命中但场景明确不适用 → 不激活（+800-1000=-200<阈值）', () => {
    const skills = [index('分析', '## 不适用场景\n- 分析类任务')];
    expect(selectImplicitSkill('分析', skills)).toBeNull();
  });

  it('E7 补：名称精确命中且场景适用 → 激活', () => {
    const skills = [index('分析', '## 适用场景\n- 数据分析')];
    expect(selectImplicitSkill('分析', skills)?.name).toBe('分析');
  });
});

describe('模块 E：E8 R4 泛词误激活防护不回归', () => {
  it('E8：泛词查询（非精确名称）仍不误激活财务报表类 Skill', () => {
    const skills = [index('finance-helper', '适用场景：生成财务报表')];
    expect(selectImplicitSkill('财务', skills)).toBeNull();
  });

  it('E8 补：泛词查询 + 名称精确命中（如财务在名称中）→ 仍激活', () => {
    const skills = [index('财务报表', '适用场景：生成财务报表')];
    expect(selectImplicitSkill('财务', skills)?.name).toBe('财务报表');
  });
});
