---
name: release-builder
description: 派发 deployer Subagent 执行打包、构建与部署冒烟验证，破除过度可信，核验真实端点与时间戳。
---

# Release Builder (Antigravity 专版)

[任务]
    按既定发布规范执行最终构建打包、产物一致性校验、部署冒烟与健康核验。
    核心理念：**发布过程零盲信，构建成功不等于系统可用，必须查验真实运行端点与时间戳证据**。

[第一性原则：防范发布过度可信]
    1. **坚决避免过度可信 (Avoid Over-Trusting)**：
       - **构建成功 ≠ 系统存活**：CI 编译通过、Docker build exit 0 只是必要条件，绝不代表服务能够正确启动并处理业务。
       - **独立核验现场证据**：
         - 查验运行中的真实容器/进程启动时间戳（确保跑的是最新构建，而非旧实例假象）；
         - 检查部署镜像 Tag 与 Git Commit Hash 是否完全一致；
         - 执行 HTTP 健康检查探针（如 `GET /healthz` 或心跳命令），核查 HTTP 200 状态码与响应体。
    2. **产物隔离与安全底线**：
       - 发布包中严禁混入 `.env` 本地开发密钥、私有临时文件与未提交的试验代码；
       - 执行产物哈希一致性对比（如 `FRAMEWORK-MANIFEST.json` SHA256 审计）。
    3. **回滚方案必须在手 (Rollback Ready)**：
       - 发布前确认回滚指令或上一版本备份镜像可用；
       - 若冒烟探测失败，立即执行回滚并报警，严禁在线上长期排查。

[文件结构]
    release-builder/
    ├── SKILL.md
    └── references/
        └── artifact-and-recovery.md        # 产物校验、环境隔离与自愈回滚

[工作流程]
    1. **发布前门禁审查**：
       - 确认工作区无未跟踪未提交的脏代码；
       - 确认前序测试与审查全量 PASS，无挂账的 Blocker 缺陷。
    2. **一键构建打包**：
       - 派发 `deployer` 执行生产构建命令（如 `npm run build`）；
       - 核验产物目录与文件哈希。
    3. **启动与部署**：
       - 在指定环境拉起服务或更新镜像。
    4. **冒烟探针核验 (Smoke Verification)**：
       - 查询目标进程 PID 与启动时间；
       - 发送冒烟探针请求，捕获真实成功回执。
    5. **交接发布回执**：

```text
Status: [PASS | FAIL | BLOCKED]
Artifact: [发布产物名称、版本号与 Commit Hash]
HealthCheck: [健康端点探测命令与返回结果]
Timestamp: [进程/容器实际运行时间戳证据]
RollbackPlan: [验证过的回滚操作指引]
Evidence: [冒烟探测原始响应输出]
```
