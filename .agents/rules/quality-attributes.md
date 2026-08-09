# Five-Dimensional Quality Attributes Rule (5-D DFX Rule)

## 1. 韧性 (Resilience)
- 任何长运行后台服务必须接入 `supervisor.js` 守护，包含指数退避拉起、健康检查探针与重启风暴熔断机制。
- 服务在遭遇异常、高并发或故障时必须 fail-visible（显式报错），绝不静默吞掉异常。
- 系统需具备主动风险扫描能力（`risk scan`），在高并发冲击下自动实施限流与降级。

## 2. 网络与信息安全 (Security)
- 硬编码秘密、AK/SK、Token 校验硬拦截；提交代码前自动扫描 Secrets。
- 权限与输入校验：所有 API 接口实施严格输入验证与最小权限原则（PoLP）。
- 防范未授权访问、窃听、破坏与篡改；对凭证日志使用 Hash 签名防篡改。

## 3. 功能安全 (Safety)
- 确保系统失效或遇到未定义故障时进入 **Fail-Safe**（安全失败）状态。
- 防止自动化工具/脚本对生产物理环境或基础设备造成直接破坏。破坏性指令强制 Secondary Sign-off。

## 4. 隐私性 (Privacy)
- 严格遵循 GDPR 与 Privacy-by-Design 规范。
- 用户与企业数据收集、传输、存储必须脱敏或加密。
- 提供 `state prune` 自动化销毁策略，定期擦除日志及会话痕迹。

## 5. 可靠性 (Reliability)
- 代码库中的重构与新特性必须通过 `verification-matrix.json` 中定义的自动化测试。
- 保持精确锁定的 Dependency Lockfile（ lockfile 版本锁纪律）。
- 所有修 bug 操作必须遵循 **Red-Locks-The-Bug** 固化测试协议。
