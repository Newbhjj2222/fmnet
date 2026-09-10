import Player from "./Player";
import Ball from "./Ball";
import Vector2 from "./Vector2";
import {
  BALL_STATE, DEFAULT_TACTICS, EVENT_TYPES, INJURY, MATCH,
  MATCH_STATUS, PLAYER_STATE, PITCH,
} from "./constants";
import { getFormationPosition, normalizeFormation } from "./Formation";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min = 0, max = 1) => min + Math.random() * (max - min);
const chance = (p) => Math.random() < p;
const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

export default class MatchEngine {
  constructor({ match, homeClub, awayClub, homePlayers, awayPlayers }) {
    this.match = match;
    this.homeClub = homeClub;
    this.awayClub = awayClub;

    this.running = false;
    this.paused = false;
    this.finished = false;
    this.userControlled = "home";

    this.simulationTime = clamp(Number(match?.minute) || 0, 0, 90);
    this.homeScore = Number(match?.homeScore) || 0;
    this.awayScore = Number(match?.awayScore) || 0;
    this.status = normalizeStatus(match?.status);

    this.accumulator = 0;
    this.decisionTimer = 0;
    this.aiTimer = 0;
    this.aiTacticsTimer = 0;
    this.subsTimer = 0;
    this.eventCounter = 0;
    this.lastEvent = null;
    this.halfTimeEmitted = this.simulationTime >= 45;

    this.ball = new Ball();
    this.players = [];
    this.homeXI = []; this.awayXI = [];
    this.homeBench = []; this.awayBench = [];
    this.substitutions = { home: 0, away: 0 };
    this.injuries = { home: 0, away: 0 };

    this.homeFormation = normalizeFormation(match?.homeFormation || "4-4-2");
    this.awayFormation = normalizeFormation(match?.awayFormation || "4-4-2");

    this.homeTactics = normalizeTactics(match?.homeTactics);
    this.awayTactics = normalizeTactics(match?.awayTactics);

    this.homeStats = createStats(match?.homeStats);
    this.awayStats = createStats(match?.awayStats);
    this.events = Array.isArray(match?.events) ? [...match.events] : [];

    this.buildTeams(homePlayers, awayPlayers);
    this.placeBallForKickoff();

    if (this.status === MATCH_STATUS.FINISHED) this.finished = true;
  }

  /* ====================== SETUP ====================== */
  buildTeams(rawHome, rawAway) {
    const homeXI = this.selectStartingXI(rawHome, "home", this.homeFormation, this.match?.homeLineupIds);
    const awayXI = this.selectStartingXI(rawAway, "away", this.awayFormation, this.match?.awayLineupIds);

    this.homeXI = this.createPlayers(homeXI, "home", this.homeFormation);
    this.awayXI = this.createPlayers(awayXI, "away", this.awayFormation);

    const homeIds = new Set(this.homeXI.map(p => p.id));
    const awayIds = new Set(this.awayXI.map(p => p.id));

    this.homeBench = this.createBench(rawHome, homeIds, "home");
    this.awayBench = this.createBench(rawAway, awayIds, "away");

    this.players = [...this.homeXI, ...this.awayXI];
  }

  createPlayers(source, side, formation) {
    return source.slice(0, 11).map((data, index) => {
      const pos = getFormationPosition(formation, index, side);
      return new Player({
        ...data, teamSide: side,
        teamId: side === "home" ? this.homeClub?.id : this.awayClub?.id,
      }, pos);
    });
  }

  createBench(source, selectedIds, side) {
    if (!Array.isArray(source)) return [];
    return source
      .filter(p => !selectedIds.has(String(p.id ?? p.playerId)))
      .slice(0, 9)
      .map(p => ({ ...p, teamSide: side }));
  }

  selectStartingXI(source, side, formation, savedIds) {
    if (!Array.isArray(source)) return [];
    const clean = source.filter(Boolean);

    if (Array.isArray(savedIds) && savedIds.length === 11) {
      const map = new Map();
      clean.forEach(p => map.set(String(p.id ?? p.playerId), p));
      const saved = savedIds.map(id => map.get(String(id))).filter(Boolean);
      if (saved.length === 11) return saved;
    }
    return chooseBestXI(clean, formation);
  }

  placeBallForKickoff(side = "home") {
    this.ball = new Ball();
    this.ball.position.set(PITCH.width / 2, PITCH.height / 2);
    const team = side === "home" ? this.homeXI : this.awayXI;
    const striker = team.find(p => p.position === "ST") || team[9];
    if (striker) striker.setTarget(PITCH.width / 2, PITCH.height / 2);
  }

  /* ====================== CONTROL ====================== */
  start() {
    if (this.finished) return;
    this.running = true;
    this.paused = false;
    this.status = MATCH_STATUS.LIVE;
    this.addEvent({ type: EVENT_TYPES.KICKOFF, team: "neutral", detail: "Match started." });
  }

  pause() { this.paused = true; }
  resume() {
    if (this.finished) return;
    this.paused = false;
    this.running = true;
    this.status = MATCH_STATUS.LIVE;
  }
  stop() {
    if (this.finished) return;
    this.running = false;
    this.finished = true;
    this.status = MATCH_STATUS.FINISHED;
    this.addEvent({ type: EVENT_TYPES.FULL_TIME, team: "neutral", detail: "Full time." });
  }

  setUserControlled(side) { this.userControlled = side; }
  isUserControlled(team) { return this.userControlled === team; }

  setTactics(team, tactics) {
    const current = this.getTactics(team);
    Object.assign(current, tactics);
  }

  /* ====================== MAIN LOOP ====================== */
  update(realDelta) {
    if (!this.running || this.paused || this.finished) return;
    const dt = Math.min(Number(realDelta) || 0, 0.1);
    this.accumulator += dt;
    const fixed = 1 / MATCH.FPS;
    while (this.accumulator >= fixed) {
      this.fixedUpdate(fixed);
      this.accumulator -= fixed;
    }
  }

  fixedUpdate(dt) {
    const minPerSec = MATCH.SIMULATION_MINUTES / MATCH.REAL_DURATION_SECONDS;
    this.simulationTime += dt * minPerSec;

    if (this.simulationTime >= 45 && !this.halfTimeEmitted) {
      this.halfTimeEmitted = true;
      this.addEvent({ type: EVENT_TYPES.HALF_TIME, team: "neutral", detail: "Half time." });
    }

    if (this.simulationTime >= 90) {
      this.simulationTime = 90;
      this.stop();
      return;
    }

    this.aiTimer += dt;
    this.decisionTimer += dt;
    this.aiTacticsTimer += dt;
    this.subsTimer += dt;

    this.updateBall(dt);
    this.updatePlayers(dt);
    this.resolvePossession();
    this.resolveTackles();
    this.checkBallOut();
    this.checkGoal();
    this.updateStamina(dt);

    if (this.aiTimer >= MATCH.AI_UPDATE_INTERVAL) {
      this.aiTimer = 0;
      this.updateAI();
    }
    if (this.decisionTimer >= MATCH.DECISION_INTERVAL) {
      this.decisionTimer = 0;
      this.makeDecisions();
    }
    if (this.aiTacticsTimer >= MATCH.AI_TACTICS_INTERVAL) {
      this.aiTacticsTimer = 0;
      this.adaptAITactics();
    }
    if (this.subsTimer >= 1) {
      this.subsTimer = 0;
      this.runAutomaticSubstitutions();
    }

    this.updatePossessionStats();
  }

  /* ====================== AI ====================== */
  adaptAITactics() {
    const aiSide = this.userControlled === "home" ? "away" : "home";
    const aiScore = aiSide === "home" ? this.homeScore : this.awayScore;
    const oppScore = aiSide === "home" ? this.awayScore : this.homeScore;
    const diff = aiScore - oppScore;
    const minute = this.getMinute();
    const t = this.getTactics(aiSide);

    if (diff < 0 && minute > 55) {
      t.mentality = "attacking";
      t.tempo = "fast";
      t.pressing = "high";
      t.defensiveLine = "high";
    } else if (diff > 1 && minute > 65) {
      t.mentality = "defensive";
      t.tempo = "slow";
      t.pressing = "low";
      t.defensiveLine = "deep";
    } else {
      t.mentality = "balanced";
      t.tempo = "normal";
      t.pressing = "medium";
      t.defensiveLine = "normal";
    }
  }

  updateAI() {
    const ball = this.ball.position;
    const owner = this.findPlayer(this.ball.ownerId);

    this.players.forEach(player => {
      if (player.redCard || player.isInjured()) return;
      if (player.position === "GK") { this.updateGoalkeeper(player); return; }
      if (owner && owner.teamSide !== player.teamSide) { this.defensiveMovement(player, owner); return; }
      if (owner && owner.teamSide === player.teamSide) { this.attackingMovement(player, owner); return; }
      this.freeBallMovement(player, ball);
    });
  }

  defensiveMovement(player, attacker) {
    const dToBall = player.distanceToPoint(this.ball.position.x, this.ball.position.y);
    const t = this.getTactics(player.teamSide);
    const pressDist = t.pressing === "high" ? 280 : t.pressing === "low" ? 130 : 200;

    if (dToBall < pressDist) {
      const nearest = this.getNearestDefender(player.teamSide);
      if (nearest?.id === player.id) {
        player.state = PLAYER_STATE.CHASING;
        const dir = attacker.teamSide === "home" ? 1 : -1;
        player.setTarget(attacker.x - dir * 8, attacker.y);
        return;
      }
    }
    const tactical = this.getTacticalTarget(player);
    player.setTarget(tactical.x, tactical.y);
  }

  attackingMovement(player, owner) {
    if (player.id === owner.id) { this.moveBallCarrier(player); return; }
    const target = this.getAttackingTarget(player, owner);
    player.setTarget(target.x, target.y);
  }

  freeBallMovement(player, ball) {
    const nearest = this.getNearestPlayerToBall(player.teamSide);
    if (nearest?.id === player.id && player.distanceToPoint(ball.x, ball.y) < 320) {
      player.state = PLAYER_STATE.CHASING;
      player.setTarget(ball.x, ball.y);
      return;
    }
    const tactical = this.getTacticalTarget(player);
    player.setTarget(tactical.x, tactical.y);
  }

  updateGoalkeeper(gk) {
    const ball = this.ball.position;
    const ownGoalX = gk.teamSide === "home" ? 25 : PITCH.width - 25;
    const danger = this.distanceToOwnGoal(ball, gk.teamSide);

    if (
      (this.ball.state === BALL_STATE.SHOOTING || this.ball.state === BALL_STATE.CROSSING) &&
      danger < 320
    ) {
      gk.setTarget(ownGoalX, clamp(ball.y, 230, 450));
      return;
    }
    const t = this.getTactics(gk.teamSide);
    const sweep = t.defensiveLine === "high" ? 25 : 0;
    gk.setTarget(
      ownGoalX + (gk.teamSide === "home" ? sweep : -sweep),
      PITCH.height / 2 + clamp(ball.y - PITCH.height / 2, -100, 100) * 0.25
    );
  }

  /* ====================== DECISIONS ====================== */
  makeDecisions() {
    const owner = this.findPlayer(this.ball.ownerId);
    if (!owner || owner.redCard || owner.isInjured()) return;

    const pressure = this.calculatePressure(owner);
    const opponents = this.getOpponents(owner.teamSide);
    const dGoal = this.distanceToOpponentGoal(owner);

    if (this.shouldShoot(owner, dGoal, pressure)) { this.shoot(owner, pressure); return; }
    if (this.shouldCross(owner, dGoal)) { this.cross(owner); return; }
    if (this.shouldPass(owner, pressure)) {
      const target = this.choosePassTarget(owner, opponents);
      if (target) { this.pass(owner, target); return; }
    }
    if (this.shouldDribble(owner, pressure)) { this.dribble(owner, pressure); return; }
    if (pressure > 0.78) {
      const safe = this.choosePassTarget(owner, opponents, true);
      if (safe) { this.pass(owner, safe); return; }
      this.tryHoldBall(owner);
    }
  }

  calculatePressure(player) {
    const defenders = this.getOpponents(player.teamSide);
    if (!defenders.length) return 0;
    const distances = defenders.map(d => dist(player, d)).sort((a, b) => a - b);
    const nearest = distances[0] || 999;
    const second = distances[1] || 999;
    const p1 = clamp(1 - nearest / 180, 0, 1);
    const p2 = clamp(1 - second / 280, 0, 1);
    return clamp(p1 * 0.72 + p2 * 0.28, 0, 1);
  }

  mentalityMod(team) {
    const m = this.getTactics(team).mentality;
    return m === "attacking" ? 1.08 : m === "defensive" ? 0.92 : 1.0;
  }

  shouldShoot(player, dGoal, pressure) {
    if (player.position === "GK") return false;
    const range = player.position === "ATT" ? 320
      : player.position === "MID" ? 240 : 190;
    if (dGoal > range) return false;

    const shooting = player.shooting / 100;
    const composure = player.composure / 100;
    const form = player.form / 100;
    const teamMod = this.mentalityMod(player.teamSide);

    const p = clamp(
      (0.18 + shooting * 0.32 + composure * 0.12 + form * 0.05 - pressure * 0.20) * teamMod,
      0.06, 0.75
    );
    return chance(p);
  }

  shouldCross(player, dGoal) {
    if (!["LW", "RW", "LM", "RM", "LWB", "RWB"].includes(player.position)) return false;
    return dGoal < 400 && chance(0.42);
  }

  shouldPass(player, pressure) {
    const t = this.getTactics(player.teamSide);
    let p = 0.55;
    if (t.passingStyle === "short") p += 0.14;
    if (t.passingStyle === "direct") p -= 0.06;
    if (t.tempo === "fast") p += 0.05;
    if (t.tempo === "slow") p -= 0.05;
    p += (player.passing / 100) * 0.15;
    p += (player.vision / 100) * 0.10;
    p += pressure * 0.18;
    return chance(clamp(p, 0.25, 0.94));
  }

  shouldDribble(player, pressure) {
    const d = player.dribbling / 100;
    return chance(clamp(0.14 + d * 0.36 - pressure * 0.14, 0.06, 0.55));
  }

  choosePassTarget(passer, opponents, safeOnly = false) {
    const teammates = this.getTeamPlayers(passer.teamSide)
      .filter(p => p.id !== passer.id && !p.redCard && !p.isInjured());
    if (!teammates.length) return null;

    const t = this.getTactics(passer.teamSide);
    const styleBias = t.passingStyle === "direct" ? 1.35
      : t.passingStyle === "short" ? 0.7 : 1.0;

    const candidates = teammates.map(tm => {
      const pd = dist(passer, tm);
      const nearestOpp = Math.min(...opponents.map(o => dist(tm, o)));
      const forward = this.forwardProgress(passer, tm);
      const spaceScore = clamp(nearestOpp / 200, 0, 1);
      const progressScore = clamp(forward / 240, -1, 1);
      const positionBonus = tm.position === "ATT" ? 0.16
        : tm.position === "MID" ? 0.08 : 0;
      const distanceScore = clamp(1 - pd / 520, 0, 1);

      let score = spaceScore * 0.42 + progressScore * 0.28 + distanceScore * 0.17 + positionBonus;
      score *= (1 + styleBias * (pd / 600 - 0.5) * 0.15);
      if (safeOnly) score = spaceScore * 0.7 + distanceScore * 0.3;
      return { player: tm, score, distance: pd };
    }).filter(c => c.distance < 560).sort((a, b) => b.score - a.score);

    return candidates[0]?.player || null;
  }

  pass(passer, target) {
    const opponents = this.getOpponents(passer.teamSide);
    const pd = dist(passer, target);
    const pressure = this.calculatePressure(passer);

    let success = 0.60 + (passer.passing / 100) * 0.20 +
      (passer.vision / 100) * 0.10 + (passer.stamina / 100) * 0.05 +
      (passer.form / 100) * 0.03;
    success -= pressure * 0.18;
    success -= clamp(pd / 900, 0, 0.16);

    const interceptors = opponents.filter(o => this.pointNearLine(passer, target, o, 34));
    if (interceptors.length) success -= interceptors.length * 0.10;
    success = clamp(success, 0.32, 0.96);

    passer.stats.passes += 1;

    if (this.isOffsideAtPass(target)) {
      this.addEvent({
        type: EVENT_TYPES.OFFSIDE, team: passer.teamSide,
        playerId: target.id, playerName: target.name,
        detail: `${target.name} was offside.`,
      });
      this.awardGoalKick(passer.teamSide === "home" ? "away" : "home");
      return;
    }

    if (chance(success)) {
      passer.stats.passesCompleted += 1;
      const style = this.getTactics(passer.teamSide).passingStyle;
      const longPass = pd > 280 || style === "direct";
      const through = this.isThroughBall(passer, target);

      this.ball.kick(passer, target, longPass ? 340 : 250, BALL_STATE.PASSING, target.id);
      this.ball.lastTouchTeam = passer.teamSide;
      this.ball.lastTouchPlayer = passer.id;

      passer.hasBall = false;
      passer.state = PLAYER_STATE.MOVING;
      target.state = PLAYER_STATE.RECEIVING;

      this.addEvent({
        type: through ? EVENT_TYPES.THROUGH_BALL : EVENT_TYPES.PASS,
        team: passer.teamSide, playerId: passer.id, playerName: passer.name,
        targetPlayerId: target.id,
        detail: `${passer.name} → ${target.name}`,
      });
      return;
    }

    this.ball.kick(passer, {
      x: passer.x + rand(-90, 90),
      y: passer.y + rand(-90, 90),
    }, 190, BALL_STATE.PASSING);
    passer.hasBall = false;
    this.addEvent({
      type: EVENT_TYPES.PASS, team: passer.teamSide,
      playerId: passer.id, playerName: passer.name,
      detail: `${passer.name}'s pass went astray.`,
    });
  }

  isThroughBall(passer, target) {
    if (passer.position === "ST") return chance(0.30);
    const fwd = this.forwardProgress(passer, target);
    return fwd > 80 && chance(0.25);
  }

  dribble(player, pressure) {
    const defenders = this.getOpponents(player.teamSide);
    const nearest = defenders.sort((a, b) => dist(player, a) - dist(player, b))[0];
    const dribbleAbility = player.dribbling / 100;
    const defenderAbility = nearest
      ? (nearest.tackling + nearest.positioning) / 200 : 0.5;

    let success = 0.50 + dribbleAbility * 0.26 - defenderAbility * 0.18;
    success -= pressure * 0.12;
    success = clamp(success, 0.16, 0.88);

    player.stats.dribbles += 1;

    if (chance(success)) {
      const dir = player.teamSide === "home" ? 1 : -1;
      const nx = clamp(player.x + dir * rand(35, 85), 20, PITCH.width - 20);
      const ny = clamp(player.y + rand(-55, 55), 25, PITCH.height - 25);
      player.setTarget(nx, ny);
      this.addEvent({
        type: EVENT_TYPES.DRIBBLE, team: player.teamSide,
        playerId: player.id, playerName: player.name,
        detail: `${player.name} beats his man.`,
      });
      return;
    }
    if (nearest) this.tryTackle(nearest, player);
  }

  cross(player) {
    const attackers = this.getTeamPlayers(player.teamSide).filter(t =>
      t.id !== player.id && ["ST", "ATT", "AM", "LW", "RW"].includes(t.position)
    );
    if (!attackers.length) return;
    const target = attackers.sort((a, b) =>
      this.distanceToOpponentGoal(a) - this.distanceToOpponentGoal(b))[0];

    const crossTarget = {
      x: player.teamSide === "home" ? PITCH.width - 95 : 95,
      y: clamp(target.y + rand(-60, 60), 70, PITCH.height - 70),
    };

    this.ball.kick(player, crossTarget, 300, BALL_STATE.CROSSING, target.id);
    player.hasBall = false;
    this.addEvent({
      type: EVENT_TYPES.CROSS, team: player.teamSide,
      playerId: player.id, playerName: player.name,
      targetPlayerId: target.id,
      detail: `${player.name} whips in a cross.`,
    });
  }

  shoot(player, pressure) {
    const oppSide = player.teamSide === "home" ? "away" : "home";
    const gk = this.getTeamPlayers(oppSide).find(p => p.position === "GK");
    if (!gk) return;

    player.stats.shots += 1;
    const goalX = player.teamSide === "home" ? PITCH.width + 35 : -35;
    const goalY = PITCH.height / 2 + rand(-PITCH.goalWidth / 2 + 12, PITCH.goalWidth / 2 - 12);

    const accuracy = clamp(
      0.35 + (player.shooting / 100) * 0.42 +
      (player.composure / 100) * 0.15 +
      (player.form / 100) * 0.05 - pressure * 0.20,
      0.15, 0.94
    );

    const targetY = chance(accuracy)
      ? goalY
      : clamp(goalY + rand(-130, 130), 35, PITCH.height - 35);
    const power = 340 + player.shooting * 1.8;

    this.ball.kick(player, { x: goalX, y: targetY }, power, BALL_STATE.SHOOTING);
    this.ball.lastTouchTeam = player.teamSide;
    this.ball.lastTouchPlayer = player.id;

    player.hasBall = false;
    player.state = PLAYER_STATE.SHOOTING;

    this.addEvent({
      type: EVENT_TYPES.SHOT, team: player.teamSide,
      playerId: player.id, playerName: player.name,
      detail: `${player.name} shoots!`,
    });
  }

  /* ====================== BALL & POSSESSION ====================== */
  updateBall(dt) {
    const owner = this.findPlayer(this.ball.ownerId);
    if (owner) { this.ball.position.set(owner.x, owner.y); return; }
    this.ball.update(dt);
    this.checkPassReception();
  }

  updatePlayers(dt) {
    this.players.forEach(p => {
      if (p.redCard) return;
      p.update(dt);
      if (p.hasBall) this.keepPlayerBall(p);
    });
    this.preventPlayerOverlap();
  }

  checkPassReception() {
    if (!this.ball.targetId) { this.checkInterception(); return; }
    const target = this.findPlayer(this.ball.targetId);
    if (!target || target.redCard || target.isInjured()) {
      this.ball.targetId = null;
      return;
    }

    const d = dist(this.ball.position, target);
    if (d < 30) {
      const pressure = this.getOpponents(target.teamSide)
        .map(o => dist(target, o))
        .sort((a, b) => a - b)[0] || 999;
      const control = clamp(
        0.60 + (target.overall / 100) * 0.22 - pressure / 500,
        0.32, 0.94
      );
      if (chance(control)) { this.giveBall(target); return; }
    }
    this.checkInterception();
  }

  checkInterception() {
    if (this.ball.ownerId) return;
    const candidates = this.players
      .filter(p => !p.redCard && !p.isInjured())
      .map(p => ({ player: p, distance: dist(p, this.ball.position) }))
      .filter(i => i.distance < 24)
      .sort((a, b) => a.distance - b.distance);

    const c = candidates[0];
    if (!c) return;

    const p = c.player;
    const canControl = clamp(
      0.58 + (p.overall / 100) * 0.18 + (p.positioning / 100) * 0.12,
      0.35, 0.94
    );

    if (chance(canControl)) {
      this.giveBall(p);
      if (this.ball.lastTouchTeam && this.ball.lastTouchTeam !== p.teamSide) {
        p.stats.interceptions += 1;
        this.getStats(p.teamSide).interceptions += 1;
        this.addEvent({
          type: EVENT_TYPES.INTERCEPTION, team: p.teamSide,
          playerId: p.id, playerName: p.name,
          detail: `${p.name} intercepts.`,
        });
      }
    }
  }

  resolvePossession() {
    if (this.ball.ownerId) return;
    const nearby = this.players
      .filter(p => !p.redCard && !p.isInjured())
      .map(p => ({ player: p, distance: dist(p, this.ball.position) }))
      .filter(i => i.distance < 22)
      .sort((a, b) => a.distance - b.distance);
    if (nearby[0]) this.giveBall(nearby[0].player);
  }

  giveBall(player) {
    this.players.forEach(p => {
      p.hasBall = false;
      if (p.state === PLAYER_STATE.POSSESSED) p.state = PLAYER_STATE.MOVING;
    });
    player.hasBall = true;
    player.state = PLAYER_STATE.POSSESSED;
    this.ball.attach(player);
  }

  keepPlayerBall(player) { this.ball.position.set(player.x, player.y); }

  resolveTackles() {
    this.players.filter(p => p.hasBall && !p.redCard).forEach(carrier => {
      const defenders = this.getOpponents(carrier.teamSide)
        .filter(d => !d.redCard && !d.isInjured())
        .sort((a, b) => dist(a, carrier) - dist(b, carrier));
      const defender = defenders[0];
      if (!defender) return;
      if (dist(defender, carrier) > 28) return;
      if (chance(0.045)) this.tryTackle(defender, carrier);
    });
  }

  tryTackle(defender, attacker) {
    if (defender.redCard) return;
    const tackling = defender.tackling / 100;
    const attackerDribbling = attacker.dribbling / 100;
    const success = clamp(0.40 + tackling * 0.36 - attackerDribbling * 0.22, 0.18, 0.88);

    defender.stats.tackles += 1;
    this.getStats(defender.teamSide).tackles += 1;

    if (chance(success)) {
      attacker.hasBall = false;
      defender.hasBall = true;
      this.ball.attach(defender);
      this.tryInjure(attacker, "tackle");

      this.addEvent({
        type: EVENT_TYPES.TACKLE, team: defender.teamSide,
        playerId: defender.id, playerName: defender.name,
        detail: `${defender.name} wins the ball.`,
      });
      return;
    }
    this.commitFoul(defender, attacker);
  }

  commitFoul(defender, attacker) {
    defender.stats.fouls += 1;
    this.getStats(defender.teamSide).fouls += 1;
    const injured = this.tryInjure(attacker, "tackle");

    const severe = chance(0.025 + (100 - defender.tackling) / 1000);
    if (severe) {
      defender.yellowCards += 1;
      if (defender.yellowCards >= 2) {
        defender.redCard = true;
        defender.hasBall = false;
        this.getStats(defender.teamSide).red += 1;
        this.addEvent({
          type: EVENT_TYPES.RED, team: defender.teamSide,
          playerId: defender.id, playerName: defender.name,
          detail: `${defender.name} sent off!`,
        });
      } else {
        this.getStats(defender.teamSide).yellow += 1;
        this.addEvent({
          type: EVENT_TYPES.YELLOW, team: defender.teamSide,
          playerId: defender.id, playerName: defender.name,
          detail: `${defender.name} booked.`,
        });
      }
    }

    this.addEvent({
      type: EVENT_TYPES.FOUL, team: defender.teamSide,
      playerId: defender.id, playerName: defender.name,
      detail: `${defender.name} fouls ${attacker.name}${injured ? " (injury)" : ""}.`,
    });

    this.awardFreeKick(attacker.teamSide);
  }

  /* ====================== INJURIES ====================== */
  tryInjure(player, context = "fatigue") {
    if (!player || player.injury || player.redCard) return false;

    let base;
    if (context === "tackle") base = INJURY.TACKLE_BASE;
    else {
      if (player.stamina > INJURY.STAMINA_THRESHOLD) return false;
      base = INJURY.FATIGUE_BASE;
    }

    const staminaFactor = 1 + (100 - player.stamina) / 70;
    const fitnessFactor = 1 + (100 - player.fitness) / 150;
    const p = base * staminaFactor * fitnessFactor;

    if (Math.random() < p) {
      const severity = Math.random() < INJURY.SEVERE_CHANCE ? "severe" : "minor";
      const type = context === "tackle" ? "knock" : "strain";
      player.injure(type, severity);
      this.injuries[player.teamSide] += 1;
      this.addEvent({
        type: EVENT_TYPES.INJURY, team: player.teamSide,
        playerId: player.id, playerName: player.name,
        detail: `${player.name} is injured (${severity})!`,
      });
      return true;
    }
    return false;
  }

  updateStamina(dt) {
    this.players.forEach(p => {
      if (p.redCard) return;
      if (!p.isInjured() && p.stamina < INJURY.STAMINA_THRESHOLD) {
        this.tryInjure(p, "fatigue");
      }
      if (p.velocity.length() < 5) {
        p.fitness = clamp(p.fitness + dt * 0.2, 0, 100);
      }
      if (p.stamina < 20) {
        p.form = clamp(p.form - dt * 0.3, 60, 100);
      }
    });
  }

  /* ====================== SET PIECES ====================== */
  awardFreeKick(team) {
    this.ball.stop();
    const players = this.getTeamPlayers(team);
    const kicker = players
      .filter(p => !p.redCard && !p.isInjured() && p.position !== "GK")
      .sort((a, b) => b.passing - a.passing)[0];
    if (kicker) {
      this.ball.position.set(kicker.x, kicker.y);
      this.giveBall(kicker);
    }
  }

  checkBallOut() {
    if (this.ball.ownerId) return;
    const x = this.ball.position.x;
    const y = this.ball.position.y;
    const goalTop = (PITCH.height - PITCH.goalWidth) / 2;
    const goalBottom = goalTop + PITCH.goalWidth;

    if (x >= PITCH.width && (y < goalTop || y > goalBottom)) {
      this.handleGoalLineOut("away"); return;
    }
    if (x <= 0 && (y < goalTop || y > goalBottom)) {
      this.handleGoalLineOut("home"); return;
    }
    if (y <= 0 || y >= PITCH.height) this.handleThrowIn();
  }

  handleGoalLineOut(attackingSide) {
    const lastTouch = this.ball.lastTouchTeam;
    const defendingSide = attackingSide === "home" ? "away" : "home";
    if (lastTouch === attackingSide) this.awardCorner(attackingSide);
    else this.awardGoalKick(defendingSide);
  }

  awardCorner(team) {
    this.getStats(team).corners += 1;
    this.ball.stop();

    const x = team === "home" ? PITCH.width - 8 : 8;
    const y = this.ball.position.y < PITCH.height / 2 ? 8 : PITCH.height - 8;
    this.ball.position.set(x, y);

    const attackers = this.getTeamPlayers(team)
      .filter(p => !p.redCard && !p.isInjured() && p.position !== "GK");
    const defenders = this.getOpponents(team)
      .filter(p => !p.redCard && !p.isInjured() && p.position !== "GK");

    const targetX = team === "home" ? PITCH.width - 105 : 105;
    const targetY = PITCH.height / 2;

    const kicker = attackers.sort((a, b) => b.passing - a.passing)[0];
    attackers.forEach(p => {
      if (p.id === kicker?.id) return;
      p.setTarget(targetX + rand(-55, 55), targetY + rand(-150, 150));
    });
    defenders.forEach(p => {
      p.setTarget(targetX + rand(-35, 35), targetY + rand(-150, 150));
    });

    if (kicker) {
      kicker.setTarget(x, y);
      this.giveBall(kicker);
    }

    this.addEvent({
      type: EVENT_TYPES.CORNER, team,
      detail: `${this.getTeamName(team)} win a corner.`,
    });
  }

  awardGoalKick(team) {
    this.ball.stop();
    const gk = this.getTeamPlayers(team).find(p => p.position === "GK");
    if (gk) {
      gk.x = team === "home" ? 45 : PITCH.width - 45;
      gk.y = PITCH.height / 2;
      this.giveBall(gk);
    }
    this.addEvent({
      type: EVENT_TYPES.GOAL_KICK, team,
      detail: `${this.getTeamName(team)} goal kick.`,
    });
  }

  handleThrowIn() {
    const team = this.ball.lastTouchTeam === "home" ? "away" : "home";
    this.getStats(team).throwIns += 1;
    this.ball.stop();

    const thrower = this.getTeamPlayers(team)
      .filter(p => !p.redCard && !p.isInjured())
      .sort((a, b) => b.overall - a.overall)[0];
    if (thrower) {
      this.ball.position.y = clamp(this.ball.position.y, 15, PITCH.height - 15);
      this.giveBall(thrower);
    }
    this.addEvent({
      type: EVENT_TYPES.THROW_IN, team,
      detail: `${this.getTeamName(team)} throw-in.`,
    });
  }

  /* ====================== GOALS ====================== */
  checkGoal() {
    if (![BALL_STATE.SHOOTING, BALL_STATE.CROSSING, BALL_STATE.PASSING]
      .includes(this.ball.state)) return;

    const x = this.ball.position.x;
    const y = this.ball.position.y;
    const goalTop = (PITCH.height - PITCH.goalWidth) / 2;
    const goalBottom = goalTop + PITCH.goalWidth;
    if (y < goalTop || y > goalBottom) return;

    let scoringSide = null;
    if (x > PITCH.width + 5) scoringSide = "home";
    if (x < -5) scoringSide = "away";
    if (!scoringSide) return;

    const shooter = this.findLastShooter();
    const gk = this.getTeamPlayers(scoringSide === "home" ? "away" : "home")
      .find(p => p.position === "GK");

    if (gk && this.shouldGoalkeeperSave(gk, shooter)) {
      this.handleSave(gk, scoringSide);
      return;
    }
    this.scoreGoal(scoringSide, shooter);
  }

  shouldGoalkeeperSave(gk, shooter) {
    const skill = (gk.diving + gk.reaction + gk.handling + gk.positioning) / 400;
    const shooterSkill = shooter ? shooter.shooting / 100 : 0.65;
    const distance = shooter ? this.distanceToOpponentGoal(shooter) : 260;

    const difficulty = clamp(
      0.20 + shooterSkill * 0.32 +
      clamp(1 - distance / 500, 0, 1) * 0.22,
      0.15, 0.85
    );
    const saveP = clamp(
      skill * 0.72 - difficulty * 0.42 + gk.reaction / 100 * 0.20,
      0.04, 0.72
    );
    return chance(saveP);
  }

  handleSave(gk, attackingSide) {
    gk.stats.saves += 1;
    this.getStats(gk.teamSide).saves += 1;

    const catchP = clamp(0.35 + (gk.handling / 100) * 0.40, 0.20, 0.82);
    if (chance(catchP)) {
      this.giveBall(gk);
      this.ball.state = BALL_STATE.SAVED;
    } else {
      const dir = gk.teamSide === "home" ? 1 : -1;
      this.ball.kick(gk, {
        x: gk.x + dir * rand(80, 230),
        y: clamp(gk.y + rand(-130, 130), 30, PITCH.height - 30),
      }, 220, BALL_STATE.DEFLECTED);
    }
    this.addEvent({
      type: EVENT_TYPES.SAVE, team: gk.teamSide,
      playerId: gk.id, playerName: gk.name,
      detail: `${gk.name} saves!`,
    });
  }

  scoreGoal(team, shooter) {
    if (team === "home") this.homeScore += 1;
    else this.awayScore += 1;

    if (shooter) shooter.stats.goals += 1;
    this.getStats(team).shotsOnTarget += 1;

    this.addEvent({
      type: EVENT_TYPES.GOAL, team,
      playerId: shooter?.id || null,
      playerName: shooter?.name || "Unknown",
      detail: `GOAL! ${shooter?.name || "Unknown"} for ${this.getTeamName(team)}!`,
    });

    this.players.forEach(p => p.resetToFormation());
    this.ball.stop();
    this.ball.position.set(PITCH.width / 2, PITCH.height / 2);
    this.placeBallForKickoff(team === "home" ? "away" : "home");
  }

  findLastShooter() { return this.findPlayer(this.ball.lastTouchPlayer); }

  updatePossessionStats() {
    const owner = this.findPlayer(this.ball.ownerId);
    if (!owner) return;
    this.getStats(owner.teamSide).possessionSeconds += 1 / MATCH.FPS;
  }

  /* ====================== SUBSTITUTIONS ====================== */
  performSubstitution(team, playerOutId, playerInId) {
    if (this.substitutions[team] >= MATCH.MAX_SUBSTITUTIONS) return false;

    const lineup = team === "home" ? this.homeXI : this.awayXI;
    const bench = team === "home" ? this.homeBench : this.awayBench;

    const outIndex = lineup.findIndex(p => p.id === String(playerOutId));
    const inIndex = bench.findIndex(p =>
      String(p.id ?? p.playerId) === String(playerInId));
    if (outIndex < 0 || inIndex < 0) return false;

    const oldPlayer = lineup[outIndex];
    const rawNew = bench[inIndex];
    const position = getFormationPosition(
      team === "home" ? this.homeFormation : this.awayFormation,
      outIndex, team
    );

    const newPlayer = new Player({
      ...rawNew, teamSide: team,
      teamId: team === "home" ? this.homeClub?.id : this.awayClub?.id,
    }, position);

    lineup[outIndex] = newPlayer;
    bench.splice(inIndex, 1);
    bench.push({ ...oldPlayer });

    this.players = [...this.homeXI, ...this.awayXI];
    this.substitutions[team] += 1;

    this.addEvent({
      type: EVENT_TYPES.SUBSTITUTION, team,
      minute: this.getMinute(),
      detail: `${oldPlayer.name} ➜ ${newPlayer.name}`,
    });
    return true;
  }

  runAutomaticSubstitutions() {
    ["home", "away"].forEach(team => {
      this.autoSubInjured(team);
      if (this.isUserControlled(team)) return;
      if (this.substitutions[team] >= MATCH.MAX_SUBSTITUTIONS) return;
      if (this.getMinute() < 50) return;

      const lineup = team === "home" ? this.homeXI : this.awayXI;
      const bench = team === "home" ? this.homeBench : this.awayBench;
      if (!bench.length) return;

      const tired = lineup
        .filter(p => p.position !== "GK" && !p.redCard && !p.isInjured())
        .sort((a, b) => a.stamina - b.stamina)[0];
      if (!tired || tired.stamina > 45) return;

      const replacement = bench.slice()
        .sort((a, b) => Number(b.overall ?? 60) - Number(a.overall ?? 60))[0];
      if (replacement) {
        this.performSubstitution(team, tired.id, replacement.id ?? replacement.playerId);
      }
    });
  }

  autoSubInjured(team) {
    if (this.substitutions[team] >= MATCH.MAX_SUBSTITUTIONS) return;
    const lineup = team === "home" ? this.homeXI : this.awayXI;
    const bench = team === "home" ? this.homeBench : this.awayBench;

    const injured = lineup.find(p => p.isInjured() && !p.redCard);
    if (!injured || !bench.length) return;

    const replacement = bench.slice()
      .sort((a, b) => Number(b.overall ?? 60) - Number(a.overall ?? 60))[0];
    if (replacement) {
      this.performSubstitution(team, injured.id, replacement.id ?? replacement.playerId);
    }
  }

  /* ====================== HELPERS ====================== */
  getTacticalTarget(player) {
    const t = this.getTactics(player.teamSide);
    const dir = player.teamSide === "home" ? 1 : -1;
    let x = player.homeX, y = player.homeY;
    const ball = this.ball.position;
    const influence = t.mentality === "attacking" ? 0.19
      : t.mentality === "defensive" ? 0.08 : 0.13;

    x += (ball.x - PITCH.width / 2) * influence * dir;
    y += (ball.y - PITCH.height / 2) * 0.10;

    if (t.width === "wide") y += player.homeY < PITCH.height / 2 ? -18 : 18;
    if (t.width === "narrow") y += player.homeY < PITCH.height / 2 ? 15 : -15;

    const lineMod = t.defensiveLine === "high" ? 45
      : t.defensiveLine === "deep" ? -35 : 0;
    if (player.position !== "GK") x += dir * lineMod;

    return {
      x: clamp(x, 25, PITCH.width - 25),
      y: clamp(y, 25, PITCH.height - 25),
    };
  }

  getAttackingTarget(player, owner) {
    const dir = player.teamSide === "home" ? 1 : -1;
    let x = player.homeX, y = player.homeY;
    const t = this.getTactics(player.teamSide);
    const push = t.mentality === "attacking" ? 1.25
      : t.mentality === "defensive" ? 0.7 : 1.0;

    if (player.position === "ST") x += dir * 70 * push;
    if (["LW", "RW", "LM", "RM", "LWB", "RWB"].includes(player.position)) x += dir * 40 * push;
    if (["MID", "CM", "AM"].includes(player.position)) x += dir * 25 * push;

    const ownerDist = dist(player, owner);
    if (ownerDist < 120) y += player.y < PITCH.height / 2 ? -45 : 45;

    const fwd = this.forwardProgress(owner, player);
    if (fwd < 0) x -= dir * 20;

    return {
      x: clamp(x, 30, PITCH.width - 30),
      y: clamp(y, 25, PITCH.height - 25),
    };
  }

  moveBallCarrier(player) {
    const dir = player.teamSide === "home" ? 1 : -1;
    const goalX = player.teamSide === "home" ? PITCH.width : 0;
    const pressure = this.calculatePressure(player);
    const t = this.getTactics(player.teamSide);
    const tempoPush = t.tempo === "fast" ? 85
      : t.tempo === "slow" ? 55 : 70;

    let x = player.x, y = player.y;
    if (pressure < 0.35) x += dir * tempoPush;
    else y += player.y < PITCH.height / 2 ? 35 : -35;

    x = clamp(x, 20, PITCH.width - 20);
    y = clamp(y, 20, PITCH.height - 20);
    if (this.distanceToOpponentGoal(player) < 150) x = goalX;
    player.setTarget(x, y);
  }

  tryHoldBall(player) {
    player.setTarget(player.x, player.y);
    player.velocity.multiply(0.4);
  }

  preventPlayerOverlap() {
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i];
      if (a.redCard) continue;
      for (let j = i + 1; j < this.players.length; j++) {
        const b = this.players[j];
        if (b.redCard) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const min = a.radius + b.radius + 4;
        if (d <= 0 || d >= min) continue;
        const nx = dx / d, ny = dy / d;
        const push = (min - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }

  pointNearLine(start, end, point, tolerance) {
    const lx = end.x - start.x, ly = end.y - start.y;
    const len = Math.sqrt(lx * lx + ly * ly);
    if (len === 0) return false;
    const t = clamp(((point.x - start.x) * lx + (point.y - start.y) * ly) / (len * len), 0, 1);
    const cx = start.x + lx * t, cy = start.y + ly * t;
    const d = Math.sqrt((point.x - cx) ** 2 + (point.y - cy) ** 2);
    return d <= tolerance;
  }

  isOffsideAtPass(target) {
    const team = target.teamSide;
    const opponents = this.getOpponents(team).filter(p => p.position !== "GK" && !p.redCard);
    if (opponents.length < 2) return false;

    const dir = team === "home" ? 1 : -1;
    const sorted = opponents.map(p => p.x).sort((a, b) => dir === 1 ? b - a : a - b);
    const secondLast = sorted[1];
    const targetBeyond = dir === 1 ? target.x > secondLast : target.x < secondLast;
    const oppHalf = dir === 1 ? target.x > PITCH.width / 2 : target.x < PITCH.width / 2;
    return targetBeyond && oppHalf;
  }

  distanceToOpponentGoal(player) {
    const goalX = player.teamSide === "home" ? PITCH.width : 0;
    return Math.abs(player.x - goalX);
  }

  distanceToOwnGoal(point, side) {
    const goalX = side === "home" ? 0 : PITCH.width;
    return Math.abs(point.x - goalX);
  }

  forwardProgress(from, to) {
    const dir = from.teamSide === "home" ? 1 : -1;
    return (to.x - from.x) * dir;
  }

  getNearestPlayerToBall(team) {
    return this.getTeamPlayers(team)
      .filter(p => !p.redCard && !p.isInjured())
      .sort((a, b) => dist(a, this.ball.position) - dist(b, this.ball.position))[0];
  }

  getNearestDefender(team) {
    return this.getOpponents(team)
      .filter(p => p.position !== "GK" && !p.redCard && !p.isInjured())
      .sort((a, b) => dist(a, this.ball.position) - dist(b, this.ball.position))[0];
  }

  getTeamPlayers(team) { return this.players.filter(p => p.teamSide === team); }
  getOpponents(team) { return this.players.filter(p => p.teamSide !== team && !p.redCard); }
  findPlayer(id) {
    if (!id) return null;
    return this.players.find(p => String(p.id) === String(id)) || null;
  }
  getStats(team) { return team === "home" ? this.homeStats : this.awayStats; }
  getTactics(team) { return team === "home" ? this.homeTactics : this.awayTactics; }
  getTeamName(team) {
    return team === "home"
      ? (this.homeClub?.name || "Home")
      : (this.awayClub?.name || "Away");
  }
  getMinute() { return clamp(Math.floor(this.simulationTime), 0, 90); }

  addEvent(event) {
    const complete = {
      id: `ev-${Date.now()}-${this.eventCounter++}`,
      minute: this.getMinute(),
      timestamp: Date.now(),
      ...event,
    };
    this.events.unshift(complete);
    this.lastEvent = complete;
    if (this.events.length > 200) this.events = this.events.slice(0, 200);
  }

  /* ====================== SNAPSHOT ====================== */
  getSnapshot() {
    const total = this.homeStats.possessionSeconds + this.awayStats.possessionSeconds;
    const homePoss = total > 0
      ? (this.homeStats.possessionSeconds / total) * 100 : 50;

    const players = this.players.map(p => ({
      id: p.id, name: p.name, number: p.number,
      teamSide: p.teamSide, position: p.position, rawPosition: p.rawPosition,
      x: p.x, y: p.y, stamina: p.stamina, fitness: p.fitness, form: p.form,
      overall: p.overall, hasBall: p.hasBall, redCard: p.redCard,
      yellowCards: p.yellowCards, state: p.state, injury: p.injury,
      stats: p.stats,
    }));

    return {
      status: this.status,
      minute: this.getMinute(),
      simulationTime: this.simulationTime,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      ball: {
        x: this.ball.position.x, y: this.ball.position.y,
        state: this.ball.state, ownerId: this.ball.ownerId,
      },
      players,
      homeStats: { ...this.homeStats, possession: Number(homePoss.toFixed(1)) },
      awayStats: { ...this.awayStats, possession: Number((100 - homePoss).toFixed(1)) },
      events: [...this.events],
      substitutions: { ...this.substitutions },
      injuries: { ...this.injuries },
      homeFormation: this.homeFormation,
      awayFormation: this.awayFormation,
      homeTactics: { ...this.homeTactics },
      awayTactics: { ...this.awayTactics },
      homeBench: this.homeBench.map(b => ({
        id: String(b.id ?? b.playerId),
        name: b.name || b.fullName || "Unknown",
        position: b.position || b.primaryPosition || "MID",
        overall: b.overall ?? b.rating ?? 60,
        number: b.shirtNumber ?? b.number ?? "-",
      })),
      awayBench: this.awayBench.map(b => ({
        id: String(b.id ?? b.playerId),
        name: b.name || b.fullName || "Unknown",
        position: b.position || b.primaryPosition || "MID",
        overall: b.overall ?? b.rating ?? 60,
        number: b.shirtNumber ?? b.number ?? "-",
      })),
      homeLineup: this.homeXI.map(p => ({
        id: p.id, name: p.name, number: p.number, position: p.position,
        overall: p.overall, stamina: Math.round(p.stamina),
        fitness: Math.round(p.fitness), injury: p.injury,
        goals: p.stats.goals, yellowCards: p.yellowCards, redCard: p.redCard,
        hasBall: p.hasBall,
      })),
      awayLineup: this.awayXI.map(p => ({
        id: p.id, name: p.name, number: p.number, position: p.position,
        overall: p.overall, stamina: Math.round(p.stamina),
        fitness: Math.round(p.fitness), injury: p.injury,
        goals: p.stats.goals, yellowCards: p.yellowCards, redCard: p.redCard,
        hasBall: p.hasBall,
      })),
    };
  }
}

/* ====================== STATIC HELPERS ====================== */
function chooseBestXI(players, formation) {
  const req = getFormationRequirements(formation);
  const remaining = [...players];
  const result = [];

  const take = (cat, count) => {
    const candidates = remaining
      .filter(p => normalizePosition(p.position) === cat)
      .sort((a, b) => getOverall(b) - getOverall(a))
      .slice(0, count);
    candidates.forEach(p => {
      const idx = remaining.indexOf(p);
      if (idx >= 0) remaining.splice(idx, 1);
      result.push(p);
    });
  };
  take("GK", req.GK);
  take("DEF", req.DEF);
  take("MID", req.MID);
  take("ATT", req.ATT);

  remaining.sort((a, b) => getOverall(b) - getOverall(a));
  while (result.length < 11 && remaining.length) result.push(remaining.shift());
  return result.slice(0, 11);
}

function getFormationRequirements(formation) {
  const v = {
    "4-4-2": { GK: 1, DEF: 4, MID: 4, ATT: 2 },
    "4-3-3": { GK: 1, DEF: 4, MID: 3, ATT: 3 },
    "3-5-2": { GK: 1, DEF: 3, MID: 5, ATT: 2 },
    "5-3-2": { GK: 1, DEF: 5, MID: 3, ATT: 2 },
    "4-2-3-1": { GK: 1, DEF: 4, MID: 5, ATT: 1 },
  };
  return v[formation] || v["4-4-2"];
}

function normalizePosition(value) {
  const p = String(value || "").toLowerCase();
  if (p === "gk" || p.includes("goalkeeper") || p.includes("keeper")) return "GK";
  if (p.includes("def") || p.includes("back") ||
    ["cb", "lb", "rb", "lwb", "rwb"].includes(p)) return "DEF";
  if (p.includes("attack") || p.includes("forward") || p.includes("striker") ||
    ["st", "cf", "lw", "rw"].includes(p)) return "ATT";
  return "MID";
}

function getOverall(p) {
  return clamp(Number(p?.overall ?? p?.rating ?? p?.ovr ?? 60) || 60, 35, 99);
}

function normalizeStatus(status) {
  const v = String(status || "").toLowerCase();
  if (["finished", "completed", "full-time", "full_time", "ended"].includes(v))
    return MATCH_STATUS.FINISHED;
  if (["live", "playing", "started", "in-progress", "in_progress"].includes(v))
    return MATCH_STATUS.LIVE;
  if (["half-time", "halftime", "half_time"].includes(v))
    return MATCH_STATUS.HALF_TIME;
  return MATCH_STATUS.READY;
}

function normalizeTactics(t) { return { ...DEFAULT_TACTICS, ...(t || {}) }; }

function createStats(source) {
  return {
    possessionSeconds: 0, possession: 50,
    shots: 0, shotsOnTarget: 0,
    passes: 0, passesCompleted: 0,
    tackles: 0, interceptions: 0, fouls: 0,
    corners: 0, throwIns: 0, saves: 0,
    yellow: 0, red: 0,
    attacks: 0, dangerousAttacks: 0,
    dribbles: 0, offsides: 0,
    ...(source || {}),
  };
}
