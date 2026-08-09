---
name: release-builder
description: 派发 deployer Subagent 执行打包、构建与部署冒烟验证。
---

# Release Builder Skill

## 1. 冒烟与发布三件套
1. **核查产物时间戳与 Tag**。
2. **核查健康检查端点 (`/healthz`)**。
3. **新功能 Live 冒烟验证**。
