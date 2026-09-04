// 本地 Skill cwd「初始 cwd 提示」（评审 #4 路线 A）单测：
//   1) enforceLocalSkillCwd 纯函数：仅对 shell_exec / shell_session_begin 在「初始 cwd」层面归一化 cwd=skillDir。
//   2) parseExternalizedToolPayload 落点：当传入 skillDir 时，命令型工具的「初始 cwd」被归一化。
//   3) 声明自洽：本层仅设定初始 cwd，不持久绑定会话（持久会话 cwd 复用由 shell 会话注册表既有语义负责）。
//   4) A3 修复：shell_session_exec 不在归一化集合（其 cwd 由会话注册表保持，contracts.ts:80-84），不注入 cwd。

import { describe, expect, it } from 'vitest';
import { enforceLocalSkillCwd, isCwdEnforcedInvocation } from '../core/tool/local-skill-cwd';
import { parseExternalizedToolPayload } from '../core/tool/externalized-payload';

describe('enforceLocalSkillCwd', () => {
  it('shell_exec 未给 cwd → 强制为 skillDir', () => {
    const out = enforceLocalSkillCwd({ command: 'ls' }, 'shell_exec', '/skills/demo');
    expect(out.cwd).toBe('/skills/demo');
  });

  it('shell_exec 已给错误 cwd（≠ skillDir）→ 被 grant 的 skillDir 覆盖（Review #2 #7 P1 修复）', () => {
    const payload = { command: 'ls', cwd: '/somewhere/else' };
    const out = enforceLocalSkillCwd(payload, 'shell_exec', '/skills/demo');
    expect(out).not.toBe(payload);
    expect(out.cwd).toBe('/skills/demo');
  });

  it('shell_exec cwd 已等于 skillDir → 原样返回（不复制）', () => {
    const payload = { command: 'ls', cwd: '/skills/demo' };
    const out = enforceLocalSkillCwd(payload, 'shell_exec', '/skills/demo');
    expect(out).toBe(payload);
  });

  it('skillDir 为空 → 不改 payload', () => {
    const payload = { command: 'ls' };
    expect(enforceLocalSkillCwd(payload, 'shell_exec', '')).toBe(payload);
    expect(enforceLocalSkillCwd(payload, 'shell_exec', undefined)).toBe(payload);
  });

  it('local_file_read（无 cwd 语义）→ 不强制', () => {
    const payload = { rootPath: '/skills/demo', selectedPaths: ['SKILL.md'] };
    const out = enforceLocalSkillCwd(payload, 'local_file_read', '/skills/demo');
    expect(out.cwd).toBeUndefined();
    expect(out.rootPath).toBe('/skills/demo');
  });

  it('isCwdEnforcedInvocation 仅覆盖初始命令型工具（A3 修复：shell_session_exec 不归一化）', () => {
    expect(isCwdEnforcedInvocation('shell_exec')).toBe(true);
    expect(isCwdEnforcedInvocation('shell_session_begin')).toBe(true);
    // A3 修复：shell_session_exec 复用会话既有 cwd（contracts.ts:80-84 明确不接收 cwd 字段），
    // 不再归入归一化集合，避免违反对外契约。
    expect(isCwdEnforcedInvocation('shell_session_exec')).toBe(false);
    expect(isCwdEnforcedInvocation('local_file_read')).toBe(false);
    expect(isCwdEnforcedInvocation('local_skill_preview')).toBe(false);
  });
});

describe('parseExternalizedToolPayload cwd 强制落点', () => {
  it('shell_exec 解析时携带 skillDir → cwd 被强制', () => {
    const { payload, parseError } = parseExternalizedToolPayload(
      '{"command":"ls"}',
      'shell_exec',
      '/skills/demo',
    );
    expect(parseError).toBeUndefined();
    expect(payload?.cwd).toBe('/skills/demo');
  });

  it('不传 skillDir → cwd 不被强制（保持 Agent 原意或缺失）', () => {
    const { payload } = parseExternalizedToolPayload('{"command":"ls"}', 'shell_exec');
    expect(payload?.cwd).toBeUndefined();
  });

  it('local_file_read 不强制 cwd', () => {
    const { payload } = parseExternalizedToolPayload(
      '{"rootPath":"/skills/demo"}',
      'local_file_read',
      '/skills/demo',
    );
    expect(payload?.cwd).toBeUndefined();
  });

  it('shell_exec 解析时携带错误 cwd（≠ skillDir）→ 被覆盖为 skillDir（Review #2 #7 P1 修复，parser→runtime 路径）', () => {
    const { payload, parseError } = parseExternalizedToolPayload(
      '{"command":"ls","cwd":"/somewhere/else"}',
      'shell_exec',
      '/skills/demo',
    );
    expect(parseError).toBeUndefined();
    expect(payload?.cwd).toBe('/skills/demo');
  });
});

describe('声明自洽（评审 #4 路线 A）：仅初始 cwd 提示，不持久绑定会话', () => {
  it('enforceLocalSkillCwd 对「错误 cwd（≠ skillDir）」归一化为 grant 的 skillDir（Review #2 #7 P1 修复）', () => {
    const original = { command: 'ls', cwd: '/somewhere/else' };
    const out = enforceLocalSkillCwd(original, 'shell_exec', '/skills/demo');
    expect(out).not.toBe(original);
    expect(out.cwd).toBe('/skills/demo');
    expect(original.cwd).toBe('/somewhere/else');
  });

  it('enforceLocalSkillCwd 对「缺失 cwd」注入 skillDir，且不修改原对象', () => {
    const original: { command: string; cwd?: string } = { command: 'ls' };
    const out = enforceLocalSkillCwd(original, 'shell_exec', '/skills/demo');
    expect(out.cwd).toBe('/skills/demo');
    expect(original.cwd).toBeUndefined();
  });

  it('shell_session_exec（会话续发命令）不归一化 cwd（A3 修复，contracts.ts:80-84）', () => {
    const payload = { command: 'ls', sessionId: 's1', cwd: '/somewhere/else' };
    // A3 修复：shell_session_exec 不在 CWD_ENFORCED_INVOCATIONS，其 cwd 由会话注册表保持，
    // 调用方传入的 cwd 原样保留（不强制为 skillDir），避免违反对外契约。
    expect(isCwdEnforcedInvocation('shell_session_exec')).toBe(false);
    const out = enforceLocalSkillCwd(payload, 'shell_session_exec', '/skills/demo');
    expect(out).toBe(payload);
    expect(out.cwd).toBe('/somewhere/else');
  });
});

describe('模块 E：A3 对立面回归（C1-C3，shell_session_exec 不注入 cwd）', () => {
  it('C1：isCwdEnforcedInvocation 不含 shell_session_exec', () => {
    expect(isCwdEnforcedInvocation('shell_session_exec')).toBe(false);
  });

  it('C2：初始命令型调用 shell_exec / shell_session_begin 仍归一化 cwd', () => {
    expect(isCwdEnforcedInvocation('shell_exec')).toBe(true);
    expect(isCwdEnforcedInvocation('shell_session_begin')).toBe(true);
  });

  it('C3：shell_session_exec 的 cwd 原样保留（不强制为 skillDir，contracts.ts:80-84）', () => {
    const payload = { command: 'ls', sessionId: 's1', cwd: '/somewhere/else' };
    const out = enforceLocalSkillCwd(payload, 'shell_session_exec', '/skills/demo');
    expect(out).toBe(payload);
    expect(out.cwd).toBe('/somewhere/else');
  });

  it('C3 补：错误 cwd 仍被 shell_exec 归一化（防回归 R3）', () => {
    const payload = { command: 'ls', cwd: '/somewhere/else' };
    const out = enforceLocalSkillCwd(payload, 'shell_exec', '/skills/demo');
    expect(out.cwd).toBe('/skills/demo');
  });
});
