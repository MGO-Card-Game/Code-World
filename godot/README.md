# 骰境登峰 Godot 客户端

Godot 4.7 客户端通过 WebSocket 加入现有房间。对局由 TypeScript 房间服运行，Godot 接收当前座位可见的状态，负责棋盘、输入和事件演出。

## 当前能玩到哪里

- 房主可以创建 2–4 人房间，玩家凭房间码加入。等待页显示在线状态，断线后客户端会用原玩家身份尝试回到座位。
- 玩家可以查看三阶段棋盘、守关门与 Boss 支路、玩家状态和自己的手牌。轮到自己时可以投骰、结束回合、打出八种干扰卷轴并选择目标。相遇时可以选择对手，以及交易、招呼或战斗意向。
- 行动台按服务器事件的顺序播放旁白。棋子、生命、金币和新获得的手牌在相应事件播到时更新。重复广播会按事件 ID 去重，玩家可以跳过演出。

进入战斗后，行动台目前只显示阶段提示。攻防骰、战斗生命和末击结算的显示逻辑已有测试，战斗面板和选牌按钮仍待接入。交易报价、缴械弃牌、领取奖励、商店等阶段也需要补上操作入口。本地热座目前可在 Web 版使用。

## 启动与双人联调

**单人调试**也使用下方的房间服。启动服务和一个 Godot 窗口，在大厅点「单人调试 · 一人操作两席」即可开局。窗口会切到当前需要操作的席位，包括相遇意向、交易双方、战斗攻守方和缴械弃牌者。顶部显示当前操作者，只展示该席的手牌。

在仓库根目录安装 Node 依赖并启动房间服。

```powershell
npm.cmd ci
npm.cmd run dev:server
```

用 Godot 4.7 打开本目录的 `project.godot` 并运行主场景，默认连接 `ws://127.0.0.1:8787`。如果 Godot 可执行文件已加入 PATH，可以从仓库根目录在两个终端分别运行以下两条命令。两个 profile 各自保存玩家身份，适合在同一台机器上测试建房、加入和重连。

```powershell
godot --path godot -- --profile=p1
godot --path godot -- --profile=p2
```

服务器地址按 `--server=<地址>`、环境变量 `DICEBOUND_SERVER_URL`、项目设置 `network/dicebound/server_url` 的顺序取值。`--profile=<名称>` 也可通过环境变量 `DICEBOUND_PROFILE` 设置。要与 Web 版联调，可另开终端运行 `npm.cmd run dev`，在浏览器选择「联机对战」并输入同一房间码。通过 HTTPS 页面运行 Web 导出时，服务器地址使用 `wss://`。

## 内容同步与测试

卷轴、装备、敌人、赐福和规则术语的展示数据来自 TypeScript 内容表。修改内容定义后，从仓库根目录重新生成目录，并将生成的 JSON 与源定义一同提交。Vitest 会逐字节核对两者。[内容导出脚本](../scripts/export-godot-catalog.ts)

```powershell
npm.cmd run export:godot-catalog
npm.cmd test
```

Godot 的无界面测试覆盖主场景、座位操作、事件去重、跳过演出和战斗显示逻辑。首次检出时先导入项目，再运行测试。测试自行提供房间状态，可独立于房间服运行。

```powershell
godot --headless --path godot --import
godot --headless --path godot --script res://tests/run_tests.gd
```

下一步是接入战斗选牌、攻防骰展示和战利品确认，让玩家能从普通怪战斗走到下一回合。里程碑及完整迁移的评估方案见[迁移路线](../docs/godot-migration.md)。
