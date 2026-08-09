---
name: arch-designer
description: 评估系统软件架构，定义分层与依赖规范，产出 Architecture-Design.md 与 module-catalog.json 架构骨架，接通防腐闸。
---

# Architecture Designer Skill

## 1. 核心职责
- 划分模块边界 (Presentation, Application, Domain, Infrastructure)。
- 建立 `module-catalog.json` 架构声明文件。
- 强制排除循环依赖并设定架构债务棘轮基线 (`npm run arch:baseline`)。
