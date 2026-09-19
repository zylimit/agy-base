---
name: test-scaffold
description: test-builder 在确需搭建测试基建或核对示例断言时使用的参考。
---

# 测试基建最小 scaffold 参考

> 优先沿用仓库现有 runner、目录和命令；下列技术栈、路径、接口和业务规则都是示例，不要求目标项目照搬。只有确需搭建基建时才先验证一个 smoke；它仅证明 runner 可运行。依赖只在用户明确授权后安装，不自动新增覆盖率门禁或 CI；已有要求与测试范围、证据强度继续消费 resolved Assurance controls。

用例规划和维护先按 [风险分级、比例与老化](../references/risk-and-lifecycle.md)。在已有套件/计划中继承 owner、风险/契约、层次、适用范围；异常条目才补最近复核与下次条件。P0/P1/P2 与耗时分别判断，不因示例短就标 P0，也不为模板完整新增测试。比例看项目/可独立交付组件总存量，不能用本模板凑行数；无行为变化的小修订复用现有检查。

---

## 后端 · pytest（Python / FastAPI）

**依赖**（加进 `api/requirements.txt` 或 dev 依赖；异步测试才需 pytest-asyncio）：
```
pytest
pytest-asyncio    # 仅当要测 async 函数/路由时
```

**目录约定**：`api/tests/`，文件名 `test_*.py`。

**最小可用配置**（`api/pytest.ini` 或 pyproject 段，按需）：
```ini
[pytest]
testpaths = tests
asyncio_mode = auto    # 用了 pytest-asyncio 才加
```

**样例用例**（`api/tests/test_smoke.py`，验证基建可跑）：
```python
def test_scaffold_alive():
    assert 1 + 1 == 2
```

**往返契约示例**：假设项目已经确认，站点由下面四个字段构成，导出再导入应逐字段保留、无额外站点，且不修改调用方输入；顺序不属于此示例契约。示意 API 的 `res.sites` 为字典列表，实际使用时按真实模型调整，不能凭模板定义业务规则。

```python
from copy import deepcopy
import pytest
from exporters.kmz import build_kml, pack_kmz
from parsers.kmz import parse_kmz

@pytest.mark.parametrize("site_rows", [
    [
        {"id": "site-a", "name": "北站", "longitude": 103.8, "latitude": 1.3},
        {"id": "site-b", "name": "南站", "longitude": 110.4, "latitude": -6.2},
    ],
    [{"id": "site-c", "name": "西站", "longitude": -73.9, "latitude": 40.7}],
    [],
])
def test_export_import_preserves_site_fields(site_rows):
    expected = deepcopy(site_rows)
    kml = build_kml(site_rows, [], [])
    res = parse_kmz(pack_kmz(kml))
    assert sorted(res.sites, key=lambda row: row["id"]) == sorted(
        expected, key=lambda row: row["id"]
    )
    assert res.lessors == []
    assert site_rows == expected
```

两个不同站点能识别“数量正确但重复同一行”、字段丢失、名称/坐标串位；另一组与空输入能识别固定返回首组 fixture。独立保留 `expected` 还能识别输入被修改。这里没有声明全部实体类型、格式互操作性或装饰几何过滤均已覆盖：若实际验收包括这些规则，应使用独立确认的格式 fixture、非空相关实体及真正含装饰的输入。仅有往返断言可能让两端互逆的错误抵消，不能据此宣称格式兼容。

要证明格式互操作性时，按 [独立预期方法](../references/independent-oracles-and-evidence.md) 另选契约中适用的单向固定期望：直接检查导出内容的规定字段，使用独立外部 fixture 检查导入结果。先核对来源和生产前提，不能用 `build_kml` 的输出来充当独立的导入 fixture，也不能要求契约没有规定的排序或数值格式。

**需要真库时**（尽量避免）：用最小 fixture 起测试库 + 事务回滚，**绝不连生产/基线库**。

**跑**：`cd api && python -m pytest -q`

---

## 前端 · vitest（TypeScript / React + Vite）

**依赖**（`web` devDependencies）：
```
vitest
@testing-library/react   # 仅当要测组件渲染时；纯函数不需要
jsdom                    # 组件/DOM 测试才需
```

**package.json scripts**：
```json
{ "scripts": { "test": "vitest run", "test:watch": "vitest" } }
```

**最小配置**（`web/vitest.config.ts`，纯函数测试可省 environment）：
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node" },   // 测组件改 "jsdom"
});
```

**数值契约示例**（`web/src/utils.test.ts`）：假设项目已确认此函数的输入纬度以度计，200 米在赤道返回 200、南北纬 60 度返回 400，零半径返回零。期望值取自这些事先明确的例子，不在测试里复写实现公式。

```ts
import { describe, it, expect } from "vitest";
import { metersToProjRadius } from "./utils";

describe("metersToProjRadius 示例契约", () => {
  it.each([
    [200, 0, 200],
    [200, 60, 400],
    [200, -60, 400],
    [0, 60, 0],
  ])("半径 %s、纬度 %s 应得到 %s", (meters, latitude, expected) => {
    expect(metersToProjRadius(meters, latitude)).toBeCloseTo(expected, 5);
  });
});
```

非零纬度断言会识别“原样返回米数”；南北纬度与已知数值还能区分符号处理和角度单位错误。此例没有规定极区、非法输入或误差容限的完整业务契约；这些要求应回到实际来源确认，不能从示例外推。

**跑**：`cd web && npm run test`

---

## 取舍提醒

- 用能识别目标错误的最小层次验证；交互和恢复问题可先跑组件/E2E，顺序由本次任务的失效点决定。
- 每个断言注明其规则来源和实际覆盖；能跑通 smoke 不证明产品行为正确，测试通过也不证明业务含义已经由人确认。
- 新增与执行范围按 test-builder 的“测试预算”和“流程”消费 controls；以上示例不是新增 mandatory 测试清单，也不是已执行的测试证据。
- 回传沿 test-builder 的载体说明：普通 tester Markdown 使用角色契约的 PASS/FAIL 等状态；`--output-schema` 的 JSON 使用 exec-envelope 的 DONE 等状态，并在现有字段说明检查结论。Evidence 按适用范围带本次对象、工作目录/必要参数、fixture 来源、实际执行与退出、报告位置及覆盖限制；不增加 runtime JSON 字段，两者均不代替 fresh receipt。
- 脚本摘要、浏览器报告或角色输出的采样/判定语义不清楚时，读取上述方法的“读懂报告是怎样得出结论的”；空样本或无事件不能补写成通过。
