---
name: large-repo-harness
description: 针对 600K+ LOC 大项目执行 Context Packaging、拓扑缩小与影响面评估。
---

# Large Repo Harness Skill

## 1. 核心流程
1. 读取 `module-catalog.json` 进行拓扑裁剪。
2. 运行 `npm run context:pack -- --target=<module>` 打包精简上下文。
3. 执行隔离模块级别的受控修改。
