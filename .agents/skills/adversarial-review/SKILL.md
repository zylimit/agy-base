---
name: adversarial-review
description: 对高风险或核心架构变更发起红蓝对抗审查（红队攻击，蓝队自证，主 Agent 裁决）。
---

# Adversarial Review (Antigravity 专版)

[任务]
    对一批高风险改动执行 **Blue（自证）→ Red（攻击）→ Judge（裁决）** 三遍审查，把代码核验从“看着没问题”转变成“硬核证据说话”，坚决破除 AI 自我认同与过度可信。

[第一性原则]
    1. **自述不作数（防过度可信）**：
       Blue 的自证报告、Red 的攻击指控、Subagent 的“已通过”都不因口头声称而采信。必须给出确凿的 `file:line` 或可复现命令输出，给不出落点的一律不采信。
    2. **红队证伪姿态**：
       Red 角色默认姿态是“尝试推翻这批改动”，专挑极端并发、越权注入、数据丢失、边界溢出与回滚死角。
    3. **Judge 独立裁决（防过度检视）**：
       主 Agent 亲自逐条裁定 Red 提出的 findings：
       - 无法复现、无代码行依据、纯属主观风格争议的，**一律驳回**，防止过度找茬；
       - 事实确凿、复现成立的，列入 `FIX_REQUIRED` 必修清单；
       - 裁决结论三态：`ACCEPT`（放行通过）/ `FIX_REQUIRED`（须修清单）/ `NEEDS_MORE_EVIDENCE`（证据不足）。

[三遍流程]
    - **Blue Pass（自证/摆靶子）**：
      由 `implementer` 罗列修改意图、运行的测试及行号证据。明确告知：这是靶子，不作为放行依据。
    - **Red Pass（攻击/四视角证伪）**：
      由独立 `code-reviewer` 实施无情攻击：
      - *correctness*: 逻辑漏洞、状态死锁、Spec 契约冲突；
      - *security*: 越权、SQL/命令注入、凭证泄露；
      - *release*: 破坏性变更、缺失向后兼容、无法回滚；
      - *edge-cases*: 乱序并发、大数据量溢出、网络中断。
    - **Judge Pass（裁定）**：
      主 Agent 依证据下发最终判决，不依任何一方的情绪与辞藻。
