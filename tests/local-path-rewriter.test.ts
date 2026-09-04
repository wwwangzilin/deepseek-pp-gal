// T5 D1 路径改写器单测。
// 覆盖：joinUnderRoot 双基/越界、isAbsolutePath、absolutizeSkillReferences 的
// 「双基探测绝对化」「URL/锚点/绝对路径/家目录占位不改写」「文件不存在保留原样」「代码块（fenced/inline）内引用跳过改写」。
//
// 声明自洽（评审 #3 路线 A）：本改写器仅作用于「注入 Agent 上下文的索引指令文本」（见 local-path-rewriter.ts
// 文件头），不覆盖本地 Skill 真实 SKILL.md 正文及其 references 文件内容。真实正文相对引用依赖 Agent 遵循
// D4 软提示的「double-base rule」自行解析。本文件末尾的 describe 显式锚定这一声明边界。
//
// 设计来源：local-skill-import-design.md §2.5。算法（双基探测）：
//   1) 先 join(thisFileDir, rel)，fileExists 存在 → 用；
//   2) 否则 join(skillDir, rel)，fileExists 存在 → 用；
//   3) 都不存在 → 保留原样（不误伤 URL / 绝对路径 / 占位 / `..` 越界）。

import { describe, expect, it } from 'vitest';
import {
  absolutizeSkillReferences,
  isAbsolutePath,
  joinUnderRoot,
} from '../core/skill/local-path-rewriter';

describe('joinUnderRoot', () => {
  it('在根下拼接相对路径', () => {
    expect(joinUnderRoot('/skills/demo', 'references/guide.md')).toBe('/skills/demo/references/guide.md');
  });

  it('向上一级（..）解析', () => {
    expect(joinUnderRoot('/skills/demo', '../sibling.md')).toBe('/skills/sibling.md');
  });

  it('越界（逃出 root）→ null', () => {
    expect(joinUnderRoot('/skills/demo', '../../../escape.md')).toBeNull();
  });

  it('保留点号（.）', () => {
    expect(joinUnderRoot('/skills/demo', './guide.md')).toBe('/skills/demo/guide.md');
  });
});

describe('isAbsolutePath', () => {
  it('Windows 盘符视为绝对路径', () => {
    expect(isAbsolutePath('C:\\skills\\demo')).toBe(true);
    expect(isAbsolutePath('D:/skills/demo')).toBe(true);
  });

  it('类 Unix 绝对路径', () => {
    expect(isAbsolutePath('/skills/demo')).toBe(true);
  });

  it('相对路径 / 家目录占位不是绝对路径', () => {
    expect(isAbsolutePath('references/guide.md')).toBe(false);
    expect(isAbsolutePath('~/notes.md')).toBe(false);
  });
});

describe('absolutizeSkillReferences', () => {
  const skillDir = '/skills/demo';
  const thisFileDir = '/skills/demo/sub';

  it('双基探测：thisFileDir 命中优先', () => {
    const text = '见 [指南](references/guide.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: (abs) => abs === '/skills/demo/sub/references/guide.md',
    });
    expect(out).toBe('见 [指南](/skills/demo/sub/references/guide.md)');
  });

  it('双基探测：thisFileDir 缺失则回退 skillDir', () => {
    const text = '见 [指南](references/guide.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: (abs) => abs === '/skills/demo/references/guide.md',
    });
    expect(out).toBe('见 [指南](/skills/demo/references/guide.md)');
  });

  it('两基都不存在 → 保留原样', () => {
    const text = '见 [指南](references/guide.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => false,
    });
    expect(out).toBe(text);
  });

  it('URL 不改写', () => {
    const text = '见 [文档](https://example.com/guide.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('锚点不改写', () => {
    const text = '见 [章节](#section)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('已是绝对路径不改写', () => {
    const text = '见 [文档](/already/absolute.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('家目录占位（~）不改写', () => {
    const text = '见 [笔记](~/notes.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('相对路径会逃出 skillDir 根 → 不改写（防逃逸）', () => {
    const text = '见 [越界](../../etc/secrets.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: () => true,
    });
    expect(out).toBe(text);
  });

  it('一次改写多个引用', () => {
    const text = '见 [甲](a.md) 与 [乙](b.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir: skillDir,
      fileExists: (abs) => abs === '/skills/demo/a.md' || abs === '/skills/demo/b.md',
    });
    expect(out).toBe('见 [甲](/skills/demo/a.md) 与 [乙](/skills/demo/b.md)');
  });

  it('跳过 fenced 代码块内的伪链接（不改写）', () => {
    const text = [
      '见 [真实链接](references/guide.md)',
      '',
      '```',
      '示例：[example](references/guide.md)',
      '```',
    ].join('\n');
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: (abs) => abs === '/skills/demo/references/guide.md',
    });
    // 非代码区的真实链接被改写，代码块内的示例链接保留相对路径。
    expect(out).toContain('[真实链接](/skills/demo/references/guide.md)');
    expect(out).toContain('[example](references/guide.md)');
    // 代码块结构保持完整。
    expect(out).toContain('```');
  });

  it('跳过 inline code 内的伪链接（不改写）', () => {
    const text = '说明：`[example](references/guide.md)` 是示例，而 [真实链接](references/guide.md) 会改写。';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir,
      fileExists: (abs) => abs === '/skills/demo/references/guide.md',
    });
    expect(out).toContain('`[example](references/guide.md)`');
    expect(out).toContain('[真实链接](/skills/demo/references/guide.md)');
  });
});

describe('声明自洽边界（评审 #3 路线 A）：仅作用于注入索引指令文本', () => {
  const skillDir = '/skills/demo';

  it('索引指令层（文件在已知清单）→ 正常绝对化（设计覆盖边界）', () => {
    // 模拟 composeLocalSkillPrompt 注入的索引指令文本：thisFileDir=skillDir，fileExists 命中清单
    const text = '见 [指南](references/guide.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir: skillDir,
      fileExists: (abs) => abs === '/skills/demo/references/guide.md',
    });
    expect(out).toBe('见 [指南](/skills/demo/references/guide.md)');
  });

  it('真实正文层（文件不在 augment 清单 → fileExists=false）→ 原样保留，不在本层强制', () => {
    // 模拟真实 SKILL.md 正文经 local_file_read 读入后的情形：本改写器不在读盘注入边界调用，
    // 若强行传入（fileExists 返回 false 表示不在已登记清单），相对引用保持原样，
    // 由 Agent 遵循 D4「double-base rule」自行解析——体现"声明自洽：不覆盖真实正文"。
    const text = '详见 [附录](./appendix/notes.md) 与 [示例](examples/demo.md)';
    const out = absolutizeSkillReferences(text, {
      skillDir,
      thisFileDir: `${skillDir}/refs`,
      fileExists: () => false,
    });
    expect(out).toBe(text);
  });

  it('GAP-1 固化：索引指令改写与真实正文隔离——调用点仅传入 index card', () => {
    // 契约（request-augmentation.ts:268 composeLocalSkillPrompt）：absolutizeSkillReferences 唯一调用点只接收
    // skill.instructions（导入时生成的索引卡），绝不接收 local_file_read 读回的真实正文。
    // 即便真实正文含可解析的相对引用，只要未被注入清单登记（fileExists=false），本层不强制改写，
    // 由 Agent 遵循 D4「double-base rule」自行解析。此测试锁定该隔离边界，防止回归为"覆盖真实正文"。
    const indexCard = '见 [指南](references/guide.md)'; // 索引卡：在清单内 → 改写
    const realBody = '正文见 [附录](./appendix/notes.md)'; // 真实正文：不在清单 → 保留
    const rewrittenIndex = absolutizeSkillReferences(indexCard, {
      skillDir,
      thisFileDir: skillDir,
      fileExists: (abs) => abs === '/skills/demo/references/guide.md',
    });
    const untouchedBody = absolutizeSkillReferences(realBody, {
      skillDir,
      thisFileDir: `${skillDir}/refs`,
      fileExists: () => false, // 真实正文不在注入清单
    });
    expect(rewrittenIndex).toBe('见 [指南](/skills/demo/references/guide.md)');
    expect(untouchedBody).toBe(realBody);
  });
});
