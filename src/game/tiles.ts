import { startBattle } from "./battle";
import {
  blessingName,
  bonusTreasureEquipment,
  drawRandomBlessing,
  grantRandomBlessing,
} from "./blessings";
import { ECONOMY, grantGold } from "./economy";
import { startEncounterDecision } from "./encounters";
import { resolveRandomMapEvent } from "./mapEvents";
import { grantRandomResourceReward, rewardSecret } from "./resources";
import { grantTreasureEquipmentReward } from "./rewards";
import { rollShopStock } from "./shop";
import { addHistory, emit } from "./state";
import type { ActionResult, GameState, MapTile } from "./types";

/**
 * 踩到一格会发生什么。
 *
 * 单独成一层的理由是依赖方向：相遇、交易、奖励链路都以「回到那一格继续结算」收尾，
 * 但它们同时又是这里要调用的下游，直接互调就成环了。所以下游模块把收尾作为
 * ActionResult 交上来，由 settleTileDebt 在这里兑现；排在这一层之上的模块
 * （相遇战代价）则可以直接调用 resolveTile。
 */

export function resolveTile(state: GameState, tile: MapTile, checkEncounter = true) {
  const player = state.players[state.activePlayerId];
  const opponents = Object.values(state.players).filter(
    (candidate) =>
      candidate.id !== player.id &&
      candidate.position === player.position &&
      !state.unavailablePlayerIds.includes(candidate.id),
  );

  if (checkEncounter && !tile.safeZone && opponents.length > 0) {
    if (opponents.length === 1) {
      startEncounterDecision(state, player.id, opponents[0].id, tile.id);
    } else {
      state.phase = {
        kind: "encounterChoice",
        choice: {
          challengerId: player.id,
          opponentIds: opponents.map((opponent) => opponent.id),
          tileIndex: tile.id,
        },
      };
      addHistory(state, `${player.name}遇到多名旅者，需要选择一名对手。`);
    }
    return;
  }

  switch (tile.type) {
    case "battle":
    case "elite":
      // 精英格和普通战斗格走同一条 PvE 结算，差别只在那只怪身上贴了词缀
      startBattle(
        state,
        "pve",
        player.id,
        tile.enemyId,
        undefined,
        tile.eliteAffix,
        { stageId: tile.region, tileIndex: tile.id, retreatTo: player.checkpointTileId },
      );
      return;
    case "boss":
      startBattle(state, "boss", player.id, tile.enemyId);
      return;
    case "spring": {
      const hpBefore = player.hp;
      const healed = Math.min(5, player.maxHp - player.hp);
      player.hp += healed;
      player.checkpointTileId = tile.id;
      state.phase = { kind: "turnComplete" };
      if (healed > 0) {
        emit(state, {
          type: "playerHpChanged",
          playerId: player.id,
          from: hpBefore,
          to: player.hp,
          maxHp: player.maxHp,
          reason: "spring",
        });
      }
      addHistory(state, `${player.name}在泉水恢复了 ${healed} 点生命。`);
      return;
    }
    case "treasure": {
      const progress = player.stageProgress[tile.region];
      if (progress.openedTreasureTileIds.includes(tile.id)) {
        state.phase = { kind: "turnComplete" };
        addHistory(state, `${player.name}检查「${tile.label}」，这里已经被搜空了。`);
        return;
      }
      progress.openedTreasureTileIds.push(tile.id);
      const gold = grantGold(state, player, ECONOMY.treasureGold, "treasure");
      const bonusEquipment = bonusTreasureEquipment(player);
      const reward = grantRandomResourceReward(
        state,
        player,
        bonusEquipment > 0
          ? { kind: "grantTreasureEquipment", remaining: bonusEquipment }
          : undefined,
      );
      const line = (what: string) => `${player.name}打开宝箱，获得${what}和 ${gold} 金币。`;
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      if (!reward.pendingEquipmentChoice) {
        if (bonusEquipment > 0) grantTreasureEquipmentReward(state, player, bonusEquipment);
        else state.phase = { kind: "turnComplete" };
      }
      return;
    }
    case "blessing": {
      if (player.blessings.length > 0) {
        const offered = drawRandomBlessing(
          state,
          player.blessings.map((blessing) => blessing.kind),
        );
        if (!offered) {
          state.phase = { kind: "turnComplete" };
          addHistory(state, `${player.name}来到「${tile.label}」，但没有可更换的新赐福。`);
          return;
        }
        state.phase = {
          kind: "blessingChoice",
          choice: {
            source: "tile",
            winnerId: player.id,
            offered,
            tileIndex: tile.id,
            tileLabel: tile.label,
          },
        };
        addHistory(
          state,
          `${player.name}在「${tile.label}」发现${blessingName(offered)}，需要决定是否更换当前赐福。`,
        );
        return;
      }
      const blessing = grantRandomBlessing(state, player);
      state.phase = { kind: "turnComplete" };
      addHistory(
        state,
        blessing
          ? `${player.name}在「${tile.label}」获得永久赐福：${blessingName(blessing)}。`
          : `${player.name}来到「${tile.label}」，但赐福内容尚未配置。`,
      );
      return;
    }
    case "event": {
      resolveRandomMapEvent(state, player, tile.region);
      return;
    }
    case "shop":
      state.phase = { kind: "shop", shop: rollShopStock(state, player) };
      addHistory(state, `${player.name}走进「${tile.label}」，货架已经摆好。`);
      return;
    case "start":
    case "gate":
      state.phase = { kind: "turnComplete" };
      addHistory(state, `${player.name}来到「${tile.label}」。`);
  }
}

/** 兑现下游模块交回来的那一次格子结算；动作是否合法由调用方自己判断。 */
export function settleTileDebt(state: GameState, result: ActionResult) {
  if (result === true || result === false) return;
  resolveTile(state, state.map.tiles[result.resolveTile], false);
}
