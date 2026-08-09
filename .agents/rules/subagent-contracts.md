# Subagent Dispatch Contracts & Roles

## 1. 扁平编排原则
- 主 Agent 是唯一的调度协调者。
- 被派发的 Subagent 均为 **fresh 实例**，不继承 Session 冗余历史。
- Subagent 绝对不得再次启动子 Subagent。

## 2. 四大执行角色
1. `implementer`: 仅负责按 Spec/Plan 进行代码编写与编译自检。
2. `code-reviewer`: 仅负责静态闸、架构合规性与质量审查。
3. `tester`: 仅负责独立编写/跑测试。测试者必须独立于实现者！
4. `deployer`: 仅负责构建打包与部署验证。

## 3. 信封规范
Subagent 返回格式必须包含：`Status`, `Changed`, `Verified`, `Not verified`, `Evidence`。主 Agent 必须核查 Evidence 真实性后再做下一步决策。
