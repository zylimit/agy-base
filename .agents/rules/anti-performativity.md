# Anti-Performativity & Evidence Gate Protocol

## 1. 验证先于完成 (Verification Before Completion)
- 严禁任何 "应该可以了"、"大概没问题"、"看起来不错" 等主观假设。
- 门控逻辑：`IDENTIFY 验证命令 -> RUN 执行 -> READ 输出 -> VERIFY 断言 -> THEN claim`。
- 没有终端/工具返回的真实 PASS 证据，禁止声称任务完成。

## 2. 红转绿缺陷锁定 (Red-Locks-The-Bug)
- 遇到 bug 时，禁止直接修改业务代码。
- 正确流程：
  1. `tester` 编写针对该 bug 的测试用例（必定失败/呈现红态）。
  2. 主 Agent 验证测试红态。
  3. `implementer` 修复业务代码。
  4. 主 Agent 验证测试转绿。
  5. 缺陷测试固化为回归测试套件的一部分。
