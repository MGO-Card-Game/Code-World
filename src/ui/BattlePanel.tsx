import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  activeDamage,
  activeHealing,
  battleWithDamage,
  isBattleEnding,
  visualAttacker,
  visualBattleHp,
  visualBattleRound,
} from "../anim/visualState";
import { SCROLLS, scrollCategory } from "../game/content/scrolls";
import { getBattleParticipants, getSidePlayer } from "../game/engine";
import type {
  BattleState,
  CombatSide,
  GameStateView,
  PlayerId,
  PlayerView,
  ScrollTiming,
} from "../game/types";
import {
  HealthBar,
  ModalBackdrop,
  playableFromView,
  SPRING,
  type Dispatch,
  type Playback,
} from "./shared";

function choiceOf(battle: BattleState, side: CombatSide) {
  return side === "a" ? battle.choiceA : battle.choiceB;
}

/**
 * 当前轮到哪一侧选卷轴：攻击方先（GameRule 7.7 第 4 步），再防守方（第 5 步）。
 * 两侧都提交后返回 null，引擎会自动结算本回合。
 */
function pendingChoiceSide(battle: BattleState): CombatSide | null {
  const attacker = battle.attacker;
  const defender: CombatSide = attacker === "a" ? "b" : "a";
  if (choiceOf(battle, attacker).status === "pending") return attacker;
  if (choiceOf(battle, defender).status === "pending") return defender;
  return null;
}

/**
 * 战斗中的可用卷轴（规格 25.5「可使用卷轴」）。
 *
 * 按 timing 过滤而不是按 kind，加新卷轴时这里不用改（GameRule 8.9）。
 * 多选：8.5 不限张数，点一下选中、再点一下取消。
 */
function BattleHand({ player, timing, label, selectedIds, onToggle, disabled }: {
  player: PlayerView;
  timing: ScrollTiming;
  label: string;
  selectedIds: readonly string[];
  onToggle: (instanceId: string) => void;
  disabled: boolean;
}) {
  const cards = playableFromView(player, timing);

  return (
    <div className="battle-hand">
      <span className="battle-hand-label">{label}</span>
      {cards.length === 0 ? (
        <em className="battle-hand-empty">无可用卷轴</em>
      ) : (
        <div className="battle-hand-cards">
          <AnimatePresence initial={false} mode="popLayout">
            {cards.map((scroll) => {
              const selected = selectedIds.includes(scroll.instanceId);
              const category = scrollCategory(SCROLLS[scroll.kind]);
              return (
                <motion.button
                  key={scroll.instanceId}
                  layout
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  className={`battle-card scroll-${scroll.kind} card-${category} ${selected ? "selected" : ""}`}
                  onClick={() => onToggle(scroll.instanceId)}
                  initial={{ opacity: 0, y: 18, scale: 0.8 }}
                  animate={{ opacity: 1, y: selected ? -9 : 0, scale: selected ? 1.05 : 1 }}
                  exit={{ opacity: 0, y: -26, scale: 0.6, transition: { duration: 0.24 } }}
                  whileHover={disabled ? undefined : { y: selected ? -13 : -6 }}
                  transition={SPRING}
                >
                  <span className={`card-rarity rarity-${SCROLLS[scroll.kind].rarity.toLowerCase()}`}>
                    {SCROLLS[scroll.kind].rarity}
                  </span>
                  <span className="battle-card-name">{SCROLLS[scroll.kind].name}</span>
                  <span className="battle-card-effect">{SCROLLS[scroll.kind].description}</span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function CombatSlot({ ownerName, role, dice, sides = 6, total }: {
  ownerName: string;
  /** 攻防两侧沿用力量／护盾卷轴的配色，两个合计并排时一眼能分清谁是谁 */
  role: "attack" | "defense";
  dice?: number[];
  sides?: number;
  total?: number;
}) {
  const roleLabel = role === "attack" ? "攻击" : "防御";
  return (
    <div className={`combat-slot ${role}`}>
      <span className="combat-slot-label">
        <strong>{ownerName}</strong>
        <em>{roleLabel} · D{sides}</em>
      </span>
      <AnimatePresence mode="wait">
        {dice === undefined ? (
          <motion.span className="combat-die idle" key="idle">—</motion.span>
        ) : (
          <motion.div
            className="combat-rolls"
            key={`${ownerName}-${role}-${dice.join("-")}-${total}`}
            initial={{ scale: 0.2, rotate: -160, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 18 }}
          >
            {dice.map((die, index) => (
              <span className="combat-die" key={`${index}-${die}`}>{die}</span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {/* 合计才是决定这一轮伤害的数字，比骰面本身更该被看见 */}
      <div className="combat-slot-total">
        <span className="combat-total-label">合计</span>
        <motion.strong
          className={`combat-total-value${total === undefined ? " idle" : ""}`}
          key={total ?? "idle"}
          initial={total === undefined ? false : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 460, damping: 15 }}
        >
          {total ?? "—"}
        </motion.strong>
      </div>
    </div>
  );
}

/**
 * 战斗弹层要活到 battleEnded 播完为止，胜负揭晓那一轮的演出才有地方播。
 * 判定与补血都在 visualState 里，这里只负责记住最后一份 battle 快照。
 */
export function useLingeringBattle(
  state: GameStateView,
  playback: Playback,
): BattleState | null {
  const remembered = useRef<BattleState | null>(null);
  if (state.phase.kind === "battle") {
    remembered.current = state.phase.battle;
    return state.phase.battle;
  }
  if (!remembered.current) return null;
  if (!isBattleEnding(playback.event, playback.pending)) return null;
  return battleWithDamage(remembered.current, state.lastEvents);
}

export function BattlePanel({ state, battle, live, dispatch, playback, viewerSeat }: {
  state: GameStateView;
  battle: BattleState;
  /** 引擎里战斗是否还在进行。false 表示只是在补播最后一轮的演出 */
  live: boolean;
  dispatch: Dispatch;
  playback: Playback;
  viewerSeat: PlayerId;
}) {
  const [pendingChoiceIds, setPendingChoiceIds] = useState<string[]>([]);
  const togglePendingChoice = useCallback((instanceId: string) => {
    setPendingChoiceIds((current) => (
      current.includes(instanceId)
        ? current.filter((id) => id !== instanceId)
        : [...current, instanceId]
    ));
  }, []);
  const [rolls, setRolls] = useState<{
    attackDice?: number[]; attackSides?: number; attackTotal?: number;
    defenseDice?: number[]; defenseSides?: number; defenseTotal?: number;
  }>({});
  const { a, b } = getBattleParticipants(state, battle);
  const attackerSide = battle.attacker;

  /*
    引擎结算是原子的：本轮的骰点、伤害动画还没播，battle.attacker 就已经翻给下一轮了。
    直接拿它渲染，玩家会看到自己打出的 D20 挂在"正在攻击"的对手名下。
    因此展示用的攻防归属和轮次都按住到 battleRoundAdvanced 播到为止（见 visualState）。
  */
  const shownAttacker = visualAttacker(battle, playback.pending);
  const shownDefender: CombatSide = shownAttacker === "a" ? "b" : "a";
  const shownRound = visualBattleRound(battle, playback.pending);

  // 依次轮到谁选牌：攻击方先（7.7 第 4 步），再防守方（第 5 步）。
  // 选牌判定必须用引擎的真实 attacker，否则提交的时机会跟引擎校验对不上；
  // 但下一轮的选牌提示要等交接动画播完再露面，免得跟按住的攻防归属自相矛盾。
  const handedOver = live && shownRound === battle.round;
  const choosingSide = handedOver ? pendingChoiceSide(battle) : null;
  const choosingPlayer = choosingSide ? getSidePlayer(state, battle, choosingSide) : undefined;
  const choosingTiming: ScrollTiming =
    choosingSide === attackerSide ? "beforeAttackRoll" : "beforeDefenseRoll";
  const otherSideSubmitted =
    choosingSide !== null &&
    choiceOf(battle, choosingSide === "a" ? "b" : "a").status !== "pending";
  // 该选牌的人是不是"我"。不是的话只显示等待，绝不能把对方的手牌铺出来
  const myTurnToChoose = choosingPlayer?.id === viewerSeat;

  useEffect(() => {
    setPendingChoiceIds([]);
  }, [battle.round]);

  // 骰面跟着展示轮次走：上一轮的骰点留到交接动画播到时才清，
  // 否则本轮骰点会被下一轮的引擎状态提前抹掉，或者反过来挂到新攻击方名下
  useEffect(() => {
    setRolls({});
  }, [shownRound]);

  // 换一方选牌时清空选择，免得把上一方的选中态带过去
  useEffect(() => {
    setPendingChoiceIds([]);
  }, [choosingSide]);

  // 攻防骰事件播到时才亮出骰面，让数字跟动画同步出现
  const playing = playback.event;
  useEffect(() => {
    if (playing?.type === "attackRolled") {
      setRolls((current) => ({
        ...current,
        attackDice: playing.dice,
        attackSides: playing.sides,
        attackTotal: playing.total,
      }));
    }
    if (playing?.type === "defenseRolled") {
      setRolls((current) => ({
        ...current,
        defenseDice: playing.dice,
        defenseSides: playing.sides,
        defenseTotal: playing.total,
      }));
    }
  }, [playing]);

  const nameOf = (side: CombatSide) => (side === "a" ? a.name : b.name);
  const hpMaxB = "maxHp" in b ? b.maxHp : 1;
  const hpA = visualBattleHp(battle, "a", playback.pending);
  const hpB = visualBattleHp(battle, "b", playback.pending);
  const damage = activeDamage(playback.event);
  const healing = activeHealing(playback.event);
  const displayedRollFor = (side: CombatSide) => {
    const attacking = side === shownAttacker;
    return attacking
      ? {
          role: "attack" as const,
          dice: rolls.attackDice,
          sides: rolls.attackSides,
          total: rolls.attackTotal,
        }
      : {
          role: "defense" as const,
          dice: rolls.defenseDice,
          sides: rolls.defenseSides,
          total: rolls.defenseTotal,
        };
  };
  const aRoll = displayedRollFor("a");
  const bRoll = displayedRollFor("b");

  return (
    <ModalBackdrop>
      <motion.section
        className="battle-modal"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="modal-kicker">{battle.kind === "pvp" ? "旅者相遇战" : battle.kind === "boss" ? "最终决战" : "山路遭遇"}</div>
        <h2>{a.name} <span>VS</span> {b.name}</h2>
        <div className="initiative-line">先攻投骰 {battle.initiativeA} : {battle.initiativeB} · 第 {shownRound} 轮</div>
        <div className="combatants">
          <div className={shownAttacker === "a" ? "attacking" : ""}>
            <span className="combat-role">{shownAttacker === "a" ? "正在攻击" : "防守"}</span>
            <h3>{a.name}</h3>
            <strong>{hpA}/{a.maxHp}</strong>
            <HealthBar value={hpA} max={a.maxHp} />
            <AnimatePresence>
              {damage?.targetSide === "a" && damage.amount > 0 && (
                <motion.span
                  className="damage-float"
                  key={damage.id}
                  initial={{ opacity: 0, y: 6, scale: 0.5 }}
                  animate={{ opacity: 1, y: -40, scale: 1.3 }}
                  exit={{ opacity: 0, y: -62 }}
                  transition={{ duration: 0.5 }}
                >
                  −{damage.amount}
                </motion.span>
              )}
              {healing?.targetSide === "a" && healing.amount > 0 && (
                <motion.span
                  className="healing-float"
                  key={healing.id}
                  initial={{ opacity: 0, y: 6, scale: 0.5 }}
                  animate={{ opacity: 1, y: -40, scale: 1.3 }}
                  exit={{ opacity: 0, y: -62 }}
                  transition={{ duration: 0.5 }}
                >
                  +{healing.amount}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="clash-mark">⚔</div>
          <div className={shownAttacker === "b" ? "attacking" : ""}>
            <span className="combat-role">{shownAttacker === "b" ? "正在攻击" : "防守"}</span>
            <h3>{b.name}</h3>
            <strong>{hpB}/{hpMaxB}</strong>
            <HealthBar value={hpB} max={hpMaxB} />
            <AnimatePresence>
              {damage?.targetSide === "b" && damage.amount > 0 && (
                <motion.span
                  className="damage-float"
                  key={damage.id}
                  initial={{ opacity: 0, y: 6, scale: 0.5 }}
                  animate={{ opacity: 1, y: -40, scale: 1.3 }}
                  exit={{ opacity: 0, y: -62 }}
                  transition={{ duration: 0.5 }}
                >
                  −{damage.amount}
                </motion.span>
              )}
              {healing?.targetSide === "b" && healing.amount > 0 && (
                <motion.span
                  className="healing-float"
                  key={healing.id}
                  initial={{ opacity: 0, y: 6, scale: 0.5 }}
                  animate={{ opacity: 1, y: -40, scale: 1.3 }}
                  exit={{ opacity: 0, y: -62 }}
                  transition={{ duration: 0.5 }}
                >
                  +{healing.amount}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="combat-dice">
          <CombatSlot ownerName={a.name} {...aRoll} />
          <span className="combat-dice-divider" aria-hidden="true">↔</span>
          <CombatSlot ownerName={b.name} {...bRoll} />
        </div>

        <p className="turn-callout"><strong>{nameOf(shownAttacker)}</strong>发动攻击，{nameOf(shownDefender)}进行防御。</p>

        {/*
          规格 8.3：双方必须在看到骰子结果之前决定是否使用卷轴。
          暗牌之下两人不能同屏选牌，所以改成依次提交——先攻击方（7.7 第 4 步）
          再防守方（第 5 步），两侧齐了引擎自动结算。
        */}
        {choosingPlayer && choosingSide && myTurnToChoose && (
          <>
            <p className="scroll-notice">
              轮到<strong>{choosingPlayer.name}</strong>决定使用哪些卷轴，张数不限。
              {otherSideSubmitted && <span className="submitted-hint">对方已提交</span>}
            </p>
            <BattleHand
              player={choosingPlayer}
              timing={choosingTiming}
              label={choosingSide === attackerSide ? "攻击方" : "防守方"}
              selectedIds={pendingChoiceIds}
              onToggle={togglePendingChoice}
              disabled={playback.playing}
            />
            <button
              className="primary-button battle-button"
              disabled={playback.playing}
              onClick={() => dispatch({
                type: "submitScrollChoice",
                side: choosingSide,
                instanceIds: pendingChoiceIds,
              })}
            >
              {pendingChoiceIds.length > 0
                ? `使用 ${pendingChoiceIds.length} 张并确认`
                : "不使用，确认"}
            </button>
          </>
        )}
        {choosingPlayer && !myTurnToChoose && (
          <p className="waiting-notice">
            等待<strong>{choosingPlayer.name}</strong>决定是否使用卷轴……
          </p>
        )}
        <div className="battle-log">
          {battle.log.map((entry, index) => <p key={`${battle.round}-${index}`}>{entry}</p>)}
        </div>
      </motion.section>
    </ModalBackdrop>
  );
}
