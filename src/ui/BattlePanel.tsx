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
  visualRoll,
} from "../anim/visualState";
import { handCardLayout, handSpacing } from "../anim/handLayout";
import { eliteAffixDefinition } from "../game/content/enemies/affixes";
import {
  SCROLL_CATEGORY_NAMES,
  SCROLL_CATEGORY_SIGILS,
  SCROLLS,
  scrollCategory,
} from "../game/content/scrolls";
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
  const spacing = handSpacing(cards.length, 760, 118);

  return (
    <div className={`battle-hand ${cards.length === 0 ? "empty" : ""}`}>
      <div className="battle-hand-heading">
        <span className="battle-hand-label">{label} · 战术手牌</span>
        <span className="battle-hand-count">{cards.length} 张可用</span>
      </div>
      {cards.length === 0 ? (
        <div className="battle-hand-empty">
          <span aria-hidden="true">◇</span>
          <strong>本轮无可用卷轴</strong>
          <em>直接确认，进入投骰</em>
        </div>
      ) : (
        <div className="battle-hand-cards">
          <AnimatePresence initial={false} mode="popLayout">
            {cards.map((scroll, index) => {
              const selected = selectedIds.includes(scroll.instanceId);
              const category = scrollCategory(SCROLLS[scroll.kind]);
              const { rotate, lift, zIndex } = handCardLayout(index, cards.length);
              return (
                <motion.button
                  key={scroll.instanceId}
                  layout
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  aria-label={`${SCROLLS[scroll.kind].name}：${SCROLLS[scroll.kind].description}`}
                  className={`battle-card scroll-${scroll.kind} card-${category} ${selected ? "selected" : ""}`}
                  style={{ marginLeft: index === 0 ? 0 : spacing, zIndex }}
                  onClick={() => onToggle(scroll.instanceId)}
                  initial={{ opacity: 0, y: 52, scale: 0.72, rotate: 0 }}
                  animate={{
                    opacity: 1,
                    y: selected ? lift - 24 : lift,
                    scale: selected ? 1.06 : 1,
                    rotate: selected ? 0 : rotate,
                    zIndex: selected ? 70 : zIndex,
                  }}
                  exit={{ opacity: 0, y: -26, scale: 0.6, transition: { duration: 0.24 } }}
                  whileHover={disabled ? undefined : {
                    y: selected ? lift - 30 : lift - 26,
                    rotate: 0,
                    scale: 1.07,
                    zIndex: 80,
                  }}
                  transition={SPRING}
                >
                  <span className={`card-rarity rarity-${SCROLLS[scroll.kind].rarity.toLowerCase()}`}>
                    {SCROLLS[scroll.kind].rarity}
                  </span>
                  <span
                    className={`battle-card-sigil type-${category}`}
                    title={SCROLL_CATEGORY_NAMES[category]}
                  >
                    {SCROLL_CATEGORY_SIGILS[category]}
                  </span>
                  <span className="battle-card-name">{SCROLLS[scroll.kind].name}</span>
                  <span className="battle-card-effect">{SCROLLS[scroll.kind].description}</span>
                  <span className="battle-card-select-hint">
                    {selected ? "已加入本轮" : "点击选择"}
                  </span>
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
        <i aria-hidden="true">{role === "attack" ? "刃" : "盾"}</i>
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
  const { a, b } = getBattleParticipants(state, battle);
  const enemyAffix = battle.enemyAffix
    ? eliteAffixDefinition(battle.enemyAffix)
    : undefined;
  const showsFleshCountdown = battle.enemyId === "uncannyFlesh";
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

  // 换一方选牌时清空选择，免得把上一方的选中态带过去
  useEffect(() => {
    setPendingChoiceIds([]);
  }, [choosingSide]);

  /*
    骰点从事件流派生，不再由"事件恰好成为当前"的那一帧抄进局部 state。

    抄写模型有个致命窗口：那一帧被跳过（跳过演出）、被合批吃掉（两次广播落进同一次
    渲染）或者弹层重挂时，这一轮的骰子就永久空着。派生之后没有窗口——错过动画只意味着
    直接显示终值。按住与清空的时机跟以前完全一致，都由 pending 决定，见 visualRoll。
  */
  const attackRoll = visualRoll("attack", state.lastEvents, playback.pending);
  const defenseRoll = visualRoll("defense", state.lastEvents, playback.pending);

  const nameOf = (side: CombatSide) => (side === "a" ? a.name : b.name);
  const hpMaxB = "maxHp" in b ? b.maxHp : 1;
  const hpA = visualBattleHp(battle, "a", playback.pending);
  const hpB = visualBattleHp(battle, "b", playback.pending);
  const damage = activeDamage(playback.event);
  const healing = activeHealing(playback.event);
  const displayedRollFor = (side: CombatSide) => {
    const attacking = side === shownAttacker;
    const roll = attacking ? attackRoll : defenseRoll;
    // 事件自带 side。跟展示归属对不上就宁可空着，也不要把骰点挂到错的人头上
    const shown = roll?.side === side ? roll : undefined;
    return {
      role: attacking ? ("attack" as const) : ("defense" as const),
      dice: shown?.dice,
      sides: shown?.sides,
      total: shown?.total,
    };
  };
  const aRoll = displayedRollFor("a");
  const bRoll = displayedRollFor("b");
  const battleKindLabel = battle.kind === "pvp"
    ? "旅者相遇战"
    : battle.kind === "boss"
      ? "最终决战"
      : "山路遭遇";

  return (
    <ModalBackdrop>
      <motion.section
        className="battle-modal"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <header className="battle-header">
          <div className="battle-title-rule" aria-hidden="true"><span /></div>
          <div className="modal-kicker">{battleKindLabel}</div>
          <h2>{a.name} <span>VS</span> {b.name}</h2>
          <div className="initiative-line">
            <span>先攻 {battle.initiativeA} : {battle.initiativeB}</span>
            <b>第 {shownRound} 轮</b>
          </div>
        </header>
        <div className="combatants">
          <div className={`combatant side-a ${shownAttacker === "a" ? "attacking" : "defending"}`}>
            <div className="combatant-sigil" aria-hidden="true">{a.name.slice(0, 1)}</div>
            <span className="combat-role">{shownAttacker === "a" ? "攻击方" : "防守方"}</span>
            <h3>{a.name}</h3>
            <div className="combatant-hp">
              <span>生命</span>
              <strong>{hpA}<small> / {a.maxHp}</small></strong>
            </div>
            <HealthBar value={hpA} max={a.maxHp} />
            {battle.nextPlayerAttackPenalty > 0 && (
              <div className="battle-status-effect" aria-label="玩家下一次攻击降低">
                <span>霜冻侵蚀</span>
                <b>下一次攻击 −{battle.nextPlayerAttackPenalty}</b>
              </div>
            )}
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
          <div className="clash-mark" aria-hidden="true">
            <span>⚔</span>
            <i />
          </div>
          <div className={`combatant side-b ${shownAttacker === "b" ? "attacking" : "defending"}`}>
            <div className="combatant-sigil" aria-hidden="true">{b.name.slice(0, 1)}</div>
            <span className="combat-role">{shownAttacker === "b" ? "攻击方" : "防守方"}</span>
            <h3>{b.name}</h3>
            <div className="combatant-hp">
              <span>生命</span>
              <strong>{hpB}<small> / {hpMaxB}</small></strong>
            </div>
            <HealthBar value={hpB} max={hpMaxB} />
            {showsFleshCountdown && (
              <div className="enemy-attack-counter" aria-label="诡异肉块崩解倒计时">
                <span>崩解倒计时</span>
                <b>{Math.min(3, battle.enemyAttacksPerformed)} / 3 次攻击</b>
              </div>
            )}
            {enemyAffix && (
              <div className={`elite-affix rarity-${enemyAffix.rarity.toLowerCase()}`}>
                <span>{enemyAffix.rarity} · 怪物词条</span>
                <b>{enemyAffix.name}</b>
                <small>{enemyAffix.description}</small>
              </div>
            )}
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

        <p className="turn-callout">
          <span aria-hidden="true">◆</span>
          <strong>{nameOf(shownAttacker)}</strong>发动攻击
          <i aria-hidden="true">→</i>
          {nameOf(shownDefender)}进行防御
        </p>

        {/*
          规格 8.3：双方必须在看到骰子结果之前决定是否使用卷轴。
          暗牌之下两人不能同屏选牌，所以改成依次提交——先攻击方（7.7 第 4 步）
          再防守方（第 5 步），两侧齐了引擎自动结算。
        */}
        {choosingPlayer && choosingSide && myTurnToChoose && (
          <>
            <p className="scroll-notice">
              <span>战术决策</span>
              轮到<strong>{choosingPlayer.name}</strong>选择本轮卷轴，可多选。
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
            <div className="battle-decision-bar">
              <span>
                {pendingChoiceIds.length > 0
                  ? <>已选择 <strong>{pendingChoiceIds.length}</strong> 张卷轴</>
                  : "不使用卷轴也可以直接行动"}
              </span>
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
                  ? `打出并确认 · ${pendingChoiceIds.length}`
                  : "直接投骰"}
                <i aria-hidden="true">→</i>
              </button>
            </div>
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
