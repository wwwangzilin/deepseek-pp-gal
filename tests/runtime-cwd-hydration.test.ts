// cwd hydration 双分支回归（响应评审 #1 / 第二次评审行内 #1）：
// 验证 resolveToolCallPayload 在「普通 XML / legacy DSML」与「externalized」两条路径
// 都从 grant 派生 cwd（不重新信任 call 字段），且未绑定 Skill 授权时不注入。
//
// 关键约束：cwd 仅从 getGrantLocalSkillDir(grant.id) 派生；普通分支经授权层统一输出的
// externalPayloadNamespace（= grant.id）取得，无 Skill 授权时为 undefined → 不注入。

import { describe, expect, it, vi, beforeEach } from 'vitest';

const TEST_SKILL_DIR = '/skills/demo';

// 在导入 runtime 之前拦截 authorization 的 getGrantLocalSkillDir，避免触碰真实 state。
vi.mock('../core/tool/authorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/tool/authorization')>();
  return {
    ...actual,
    // P1-A ② 端到端：getGrantLocalSkillDir 仍按 grant-1 → skillDir 派生 cwd。
    getGrantLocalSkillDir: vi.fn(async (grantId: string): Promise<string | undefined> => {
      return grantId === 'grant-1' ? TEST_SKILL_DIR : undefined;
    }),
    // 端到端直接返回带 externalPayloadNamespace='grant-1' 的授权结果，绕开真实 grant 状态机；
    // 真实 parser 产出的 call（可能携带错误 cwd）原样透传给 resolveToolCallPayload 覆盖。
    authorizeToolExecution: vi.fn(),
    completeToolExecutionAuthorization: vi.fn(async () => undefined),
  };
});

// P1-A ② 端到端：provider 执行后的历史落盘与本模块无关，mock 避免触碰真实 storage。
vi.mock('../core/tool/history', () => ({
  appendToolCallHistory: vi.fn(async () => undefined),
}));

import { createRuntimeToolRuntime, resolveToolCallPayload } from '../core/tool/runtime';
import { ToolProviderRegistry, type RuntimeToolProvider } from '../core/tool/provider-registry';
import type { ToolCall, ToolDescriptor, ToolResult } from '../core/tool/types';
import {
  extractToolCalls,
  LEGACY_TOOL_CALLS_OPEN_TAG,
  LEGACY_TOOL_CALLS_CLOSE_TAG,
} from '../core/interceptor/tool-parser';
import { authorizeToolExecution } from '../core/tool/authorization';

function normalCall(invocationName: string, cwd?: string): ToolCall {
  const payload: Record<string, unknown> = { command: 'ls' };
  if (cwd !== undefined) payload.cwd = cwd;
  return {
    id: 'call-1',
    descriptorId: 'local:test:sample_tool',
    name: invocationName,
    invocationName,
    payload: payload as ToolCall['payload'],
    raw: '<tool_call/>',
  };
}

describe('resolveToolCallPayload cwd hydration — normal (inline XML) branch', () => {
  it('经 Skill 授权的普通 shell_exec 调用 → cwd 被注入为 grant 的 skillDir', async () => {
    const call = normalCall('shell_exec');
    const out = await resolveToolCallPayload(call, 'grant-1');
    expect((out.payload as { cwd?: string }).cwd).toBe(TEST_SKILL_DIR);
  });

  it('普通 shell_exec 给了错误 cwd（≠ skillDir）→ 被 grant 的 skillDir 覆盖（P1-A 修复）', async () => {
    const call = normalCall('shell_exec', '/somewhere/else');
    const out = await resolveToolCallPayload(call, 'grant-1');
    // 错误 cwd 不再保留调用方原值：归一化为 grant 派生的 skillDir，防止在 Skill 目录外执行
    expect((out.payload as { cwd?: string }).cwd).toBe(TEST_SKILL_DIR);
  });

  it('普通 shell_exec 已给正确 cwd（=== skillDir）→ 幂等保留调用方原值', async () => {
    const call = normalCall('shell_exec', TEST_SKILL_DIR);
    const out = await resolveToolCallPayload(call, 'grant-1');
    expect((out.payload as { cwd?: string }).cwd).toBe(TEST_SKILL_DIR);
  });

  it('非命令型工具（local_file_read）→ cwd 不注入', async () => {
    const call: ToolCall = {
      id: 'call-2',
      descriptorId: 'local:test:file_read',
      name: 'local_file_read',
      invocationName: 'local_file_read',
      payload: { rootPath: '/skills/demo', selectedPaths: ['SKILL.md'] } as ToolCall['payload'],
      raw: '<tool_call/>',
    };
    const out = await resolveToolCallPayload(call, 'grant-1');
    expect((out.payload as { cwd?: string }).cwd).toBeUndefined();
  });

  it('未绑定 Skill 授权（externalPayloadNamespace 为 undefined）→ cwd 不注入', async () => {
    const call = normalCall('shell_exec');
    const out = await resolveToolCallPayload(call, undefined);
    expect((out.payload as { cwd?: string }).cwd).toBeUndefined();
  });

  it('未绑定 Skill 授权（grant 无 localSkillDir）→ cwd 不注入', async () => {
    const call = normalCall('shell_exec');
    const out = await resolveToolCallPayload(call, 'no-skill-grant');
    expect((out.payload as { cwd?: string }).cwd).toBeUndefined();
  });
});

describe('resolveToolCallPayload cwd hydration — externalized branch (regression)', () => {
  it('externalized payload 仍从 grant 派生 cwd（不回归，派生函数被调用）', async () => {
    const { getGrantLocalSkillDir } = await import('../core/tool/authorization');
    const spy = vi.mocked(getGrantLocalSkillDir);

    // externalized payload 需要真实的 ref 解析；此处仅确认 externalized 分支仍调用派生函数
    // （完整 externalized 解析由 tool-runtime-externalized-payload.test.ts 覆盖）。
    const call: ToolCall = {
      id: 'call-3',
      descriptorId: 'local:test:sample_tool',
      name: 'shell_exec',
      invocationName: 'shell_exec',
      payload: {
        ref: 'nonexistent-ref',
        invocationName: 'shell_exec',
      } as ToolCall['payload'],
      raw: '<tool_call/>',
    };
    await resolveToolCallPayload(call, 'grant-1');
    // externalized 分支必须调用 getGrantLocalSkillDir（派生 cwd），证明未退化为"不注入"
    expect(spy).toHaveBeenCalledWith('grant-1');
  });
});

describe('resolveToolCallPayload cwd hydration — end-to-end parser→runtime→provider (P1-A ②)', () => {
  // 真实 parser 解析含错误 cwd（/somewhere/else）的两种模型输出格式，验证整条链路
  // parser → executeToolCall（authorizeToolExecution → resolveToolCallPayload）→ providerRegistry.execute
  // 最终 provider 收到的是 grant 派生的 skillDir，而非 parser 输出的未信任 cwd。

  const shellDescriptor: ToolDescriptor = {
    id: 'local:test:shell_exec',
    provider: { kind: 'local', id: 'test', displayName: 'Test', transport: 'in_process' },
    name: 'shell_exec',
    invocationName: 'shell_exec',
    title: 'Shell exec',
    description: 'Run a shell command inside the local skill directory.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' }, cwd: { type: 'string' } },
      required: ['command'],
      additionalProperties: true,
    },
    execution: { mode: 'auto', enabled: true, risk: 'high' },
  };

  const xmlText = '<shell_exec>{"command":"ls","cwd":"/somewhere/else"}</shell_exec>';
  // 从 tool-parser 导出的真实常量反推 DSML 标签字面，确保与解析正则字符完全一致。
  const dsmlPrefix = LEGACY_TOOL_CALLS_OPEN_TAG.slice(0, -'tool_calls>'.length);
  const invokeOpen = `${dsmlPrefix}invoke name="shell_exec">`;
  // 开放标签用 `${dsmlPrefix}X`（dsmlPrefix = '<｜DSML｜'）；闭合标签用 `</${dsmlPrefix.slice(1)}X>`
  // （slice(1) 去掉首字符 '<'，得到 '｜DSML｜'，前面补 '</'）。二者对称，才能被
  // LEGACY_INVOKE_REGEX / LEGACY_PARAMETER_REGEX 正确命中。原 param 闭合误用 `</${dsmlPrefix}parameter>`
  // 多带一个 '<'，变成 </<｜DSML｜parameter>，导致 parameter 子匹配失败、payload 为空——属测试构造 bug（非实现 bug）。
  const param = (name: string, value: string) =>
    `${dsmlPrefix}parameter name="${name}" string="true">${value}</${dsmlPrefix.slice(1)}parameter>`;
  const dsmlText =
    `${LEGACY_TOOL_CALLS_OPEN_TAG}${invokeOpen}` +
    `${param('command', 'ls')}${param('cwd', '/somewhere/else')}` +
    `</${dsmlPrefix.slice(1)}invoke>${LEGACY_TOOL_CALLS_CLOSE_TAG}`;

  beforeEach(() => {
    vi.mocked(authorizeToolExecution).mockImplementation(async (call, _context, descriptors) => ({
      call: call as ToolCall,
      descriptor:
        (descriptors as readonly ToolDescriptor[]).find(
          (d) => d.invocationName === (call as ToolCall).invocationName,
        ) ?? shellDescriptor,
      externalPayloadNamespace: 'grant-1',
      reservation: { grantId: 'grant-1', callId: (call as ToolCall).id ?? 'call-1' },
      trigger: 'manual_chat',
    }));
  });

  async function runEndToEnd(text: string): Promise<ToolCall> {
    const providerCalls: ToolCall[] = [];
    const provider: RuntimeToolProvider = {
      registration: { kind: 'local', id: 'test' },
      listTools: vi.fn(async () => [shellDescriptor]),
      execute: vi.fn(async (authorizedCall: ToolCall) => {
        providerCalls.push(authorizedCall);
        return { ok: true, summary: 'provider completed' } as ToolResult;
      }),
    };
    const runtime = createRuntimeToolRuntime(new ToolProviderRegistry([provider]));

    const parsed = extractToolCalls(text, { descriptors: [shellDescriptor] });
    expect(parsed).toHaveLength(1);
    // parser 确实输出了调用方给的错误 cwd（证明覆盖前未被信任）
    expect((parsed[0].payload as { cwd?: string }).cwd).toBe('/somewhere/else');

    // executeToolCall 的第二参数是授权触发场景（RuntimeToolAuthorizationContext），
    // grant 信息由 mock 的 authorizeToolExecution 经 reservation.grantId 回填，故此处传 'manual_chat'。
    await runtime.executeToolCall(parsed[0], 'manual_chat');

    expect(provider.execute).toHaveBeenCalledTimes(1);
    expect(providerCalls).toHaveLength(1);
    return providerCalls[0];
  }

  it('端到端：真实 parser 解析正常 XML（含错误 cwd）→ provider 收到 cwd===skillDir', async () => {
    const received = await runEndToEnd(xmlText);
    expect((received.payload as { cwd?: string }).cwd).toBe(TEST_SKILL_DIR);
  });

  it('端到端：真实 parser 解析 legacy DSML（含错误 cwd）→ provider 收到 cwd===skillDir', async () => {
    const received = await runEndToEnd(dsmlText);
    expect((received.payload as { cwd?: string }).cwd).toBe(TEST_SKILL_DIR);
  });
});
