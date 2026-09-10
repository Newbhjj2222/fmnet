import Player from "./Player";
import Ball from "./Ball";

import {
  BALL_STATE,
  DEFAULT_TACTICS,
  EVENT_TYPES,
  INJURY,
  MATCH,
  MATCH_STATUS,
  PITCH,
  PLAYER_STATE,
} from "./constants";

import {
  getFormationPosition,
  normalizeFormation,
} from "./Formation";

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, value));

const random = (min = 0, max = 1) =>
  min + Math.random() * (max - min);

const chance = (probability) =>
  Math.random() < probability;

const distance = (a, b) =>
  Math.hypot(
    (a?.x || 0) - (b?.x || 0),
    (a?.y || 0) - (b?.y || 0)
  );

const normalizeTactics = (
  tactics = {}
) => ({
  ...DEFAULT_TACTICS,
  ...(tactics || {}),
});

const normalizeStatus = (
  status
) => {
  const value =
    String(status || "")
      .toLowerCase();

  if (
    [
      "live",
      "playing",
      "in_progress",
    ].includes(value)
  ) {
    return MATCH_STATUS.LIVE;
  }

  if (
    [
      "halftime",
      "half_time",
      "half-time",
    ].includes(value)
  ) {
    return MATCH_STATUS.HALF_TIME;
  }

  if (
    [
      "finished",
      "complete",
      "completed",
    ].includes(value)
  ) {
    return MATCH_STATUS.FINISHED;
  }

  return MATCH_STATUS.READY;
};

const createStats = (
  stats = {}
) => ({
  shots: Number(stats.shots) || 0,

  shotsOnTarget:
    Number(stats.shotsOnTarget) || 0,

  goals:
    Number(stats.goals) || 0,

  corners:
    Number(stats.corners) || 0,

  fouls:
    Number(stats.fouls) || 0,

  offsides:
    Number(stats.offsides) || 0,

  yellowCards:
    Number(stats.yellowCards) || 0,

  redCards:
    Number(stats.redCards) || 0,

  passes:
    Number(stats.passes) || 0,

  completedPasses:
    Number(stats.completedPasses) || 0,

  tackles:
    Number(stats.tackles) || 0,

  interceptions:
    Number(stats.interceptions) || 0,

  possessionSeconds:
    Number(stats.possessionSeconds) || 0,
});

const normalizePosition = (
  position
) => {
  const value =
    String(position || "")
      .toUpperCase();

  if (
    value.includes("GK") ||
    value.includes("KEEP")
  ) {
    return "GK";
  }

  if (
    value.includes("CB") ||
    value.includes("LB") ||
    value.includes("RB") ||
    value.includes("DEF")
  ) {
    return "DEF";
  }

  if (
    value.includes("ST") ||
    value.includes("CF") ||
    value.includes("FW") ||
    value.includes("ATT") ||
    value.includes("FWD")
  ) {
    return "FWD";
  }

  return "MID";
};

const getOverall = (player) => {
  const rating = Number(
    player?.overall ??
    player?.rating ??
    player?.ovr ??
    player?.score
  );

  return Number.isFinite(rating)
    ? rating
    : 65;
};

export default class MatchEngine {
  constructor({
    match = {},
    homeClub = {},
    awayClub = {},
    homePlayers = [],
    awayPlayers = [],
  } = {}) {
    this.match = match;

    this.homeClub = homeClub;

    this.awayClub = awayClub;

    this.running = false;

    this.paused = false;

    this.finished = false;

    this.userControlled = null;

    this.simulationTime = clamp(
      Number(match?.minute) || 0,
      0,
      90
    );

    this.homeScore =
      Number(match?.homeScore) || 0;

    this.awayScore =
      Number(match?.awayScore) || 0;

    this.status =
      normalizeStatus(
        match?.status
      );

    this.decisionTimer = 0;

    this.aiTimer = 0;

    this.aiTacticsTimer = 0;

    this.subsTimer = 0;

    this.eventCounter = 0;

    this.lastEvent = null;

    this.ball = new Ball();

    this.players = [];

    this.homeXI = [];

    this.awayXI = [];

    this.homeBench = [];

    this.awayBench = [];

    this.substitutions = {
      home:
        Number(
          match?.homeSubsUsed ??
          match?.substitutions?.home
        ) || 0,

      away:
        Number(
          match?.awaySubsUsed ??
          match?.substitutions?.away
        ) || 0,
    };

    this.injuries = {
      home: 0,
      away: 0,
    };

    this.homeFormation =
      normalizeFormation(
        match?.homeFormation ||
        "4-4-2"
      );

    this.awayFormation =
      normalizeFormation(
        match?.awayFormation ||
        "4-4-2"
      );

    this.homeTactics =
      normalizeTactics(
        match?.homeTactics
      );

    this.awayTactics =
      normalizeTactics(
        match?.awayTactics
      );

    this.homeStats =
      createStats(
        match?.homeStats
      );

    this.awayStats =
      createStats(
        match?.awayStats
      );

    this.events =
      Array.isArray(match?.events)
        ? [...match.events]
        : [];

    this.buildTeams(
      homePlayers,
      awayPlayers
    );

    if (
      this.status ===
        MATCH_STATUS.FINISHED ||
      this.simulationTime >= 90
    ) {
      this.simulationTime = 90;

      this.status =
        MATCH_STATUS.FINISHED;

      this.finished = true;

      this.running = false;
    } else if (
      this.status ===
        MATCH_STATUS.HALF_TIME ||
      this.simulationTime >= 45
    ) {
      this.simulationTime = 45;

      this.status =
        MATCH_STATUS.HALF_TIME;

      this.running = false;

      this.paused = true;
    }

    this.placeBallForKickoff();
  }

  static chooseBestXI(
    players = [],
    formation = "4-4-2"
  ) {
    const list =
      Array.isArray(players)
        ? players
        : [];

    const requirements =
      MatchEngine.getFormationRequirements(
        formation
      );

    const used =
      new Set();

    const result = [];

    for (
      const role of requirements
    ) {
      let candidates =
        list
          .map(
            (player, index) => ({
              player,
              index,
            })
          )
          .filter(
            ({ player, index }) =>
              !used.has(index) &&
              normalizePosition(
                player?.position
              ) === role
          )
          .sort(
            (a, b) =>
              getOverall(b.player) -
              getOverall(a.player)
          );

      if (!candidates.length) {
        candidates =
          list
            .map(
              (player, index) => ({
                player,
                index,
              })
            )
            .filter(
              ({ index }) =>
                !used.has(index)
            )
            .sort(
              (a, b) =>
                getOverall(b.player) -
                getOverall(a.player)
            );
      }

      if (candidates[0]) {
        used.add(
          candidates[0].index
        );

        result.push(
          candidates[0].player
        );
      }
    }

    return result.slice(0, 11);
  }

  static getFormationRequirements(
    formation
  ) {
    const map = {
      "4-4-2": [
        "GK",
        "DEF",
        "DEF",
        "DEF",
        "DEF",
        "MID",
        "MID",
        "MID",
        "MID",
        "FWD",
        "FWD",
      ],

      "4-3-3": [
        "GK",
        "DEF",
        "DEF",
        "DEF",
        "DEF",
        "MID",
        "MID",
        "MID",
        "FWD",
        "FWD",
        "FWD",
      ],

      "3-5-2": [
        "GK",
        "DEF",
        "DEF",
        "DEF",
        "MID",
        "MID",
        "MID",
        "MID",
        "MID",
        "FWD",
        "FWD",
      ],

      "5-3-2": [
        "GK",
        "DEF",
        "DEF",
        "DEF",
        "DEF",
        "DEF",
        "MID",
        "MID",
        "MID",
        "FWD",
        "FWD",
      ],

      "4-2-3-1": [
        "GK",
        "DEF",
        "DEF",
        "DEF",
        "DEF",
        "MID",
        "MID",
        "MID",
        "MID",
        "MID",
        "FWD",
      ],
    };

    return (
      map[
        normalizeFormation(
          formation
        )
      ] ||
      map["4-4-2"]
    );
  }

  buildTeams(
    homePlayers = [],
    awayPlayers = []
  ) {
    const home =
      this.prepareRawPlayers(
        homePlayers,
        "home"
      );

    const away =
      this.prepareRawPlayers(
        awayPlayers,
        "away"
      );

    this.homeXI =
      this.createPlayers(
        this.pickSavedXI(
          home,
          this.match?.homeLineupIds,
          this.homeFormation
        ),
        "home"
      );

    this.awayXI =
      this.createPlayers(
        this.pickSavedXI(
          away,
          this.match?.awayLineupIds,
          this.awayFormation
        ),
        "away"
      );

    this.homeBench =
      this.createBench(
        home,
        this.homeXI,
        "home"
      );

    this.awayBench =
      this.createBench(
        away,
        this.awayXI,
        "away"
      );

    while (
      this.homeXI.length < 11
    ) {
      this.homeXI.push(
        this.makeFallbackPlayer(
          "home",
          this.homeXI.length
        )
      );
    }

    while (
      this.awayXI.length < 11
    ) {
      this.awayXI.push(
        this.makeFallbackPlayer(
          "away",
          this.awayXI.length
        )
      );
    }

    this.players = [
      ...this.homeXI,
      ...this.awayXI,
      ...this.homeBench,
      ...this.awayBench,
    ];

    this.positionTeam("home");

    this.positionTeam("away");

    const owner =
      this.activePlayers()
        .find(
          (player) =>
            player.id ===
            String(
              this.match?.ballOwnerId
            )
        );

    if (owner) {
      this.ball.attach(owner);
    }
  }

  prepareRawPlayers(
    players,
    team
  ) {
    const list =
      Array.isArray(players)
        ? players.filter(Boolean)
        : [];

    if (list.length >= 18) {
      return list;
    }

    const result = [...list];

    for (
      let i = result.length;
      i < 18;
      i += 1
    ) {
      result.push(
        this.makeFallbackRaw(
          team,
          i
        )
      );
    }

    return result;
  }

  makeFallbackRaw(
    team,
    index
  ) {
    const roles = [
      "GK",
      "DEF",
      "DEF",
      "DEF",
      "DEF",
      "MID",
      "MID",
      "MID",
      "MID",
      "FWD",
      "FWD",
      "MID",
      "DEF",
      "MID",
      "FWD",
      "DEF",
      "MID",
      "FWD",
    ];

    const role =
      roles[index] || "MID";

    const rating =
      58 +
      (index % 5) * 2;

    return {
      id:
        `fallback-${team}-${index + 1}`,

      name:
        `${team === "home" ? "Home" : "Away"} Player ${index + 1}`,

      number:
        index + 1,

      position:
        role,

      overall:
        rating,

      passing:
        rating,

      shooting:
        rating,

      dribbling:
        rating,

      tackling:
        rating,

      defending:
        rating,

      pace:
        rating,

      stamina:
        90,
    };
  }

  makeFallbackPlayer(
    team,
    index
  ) {
    return new Player(
      this.makeFallbackRaw(
        team,
        index
      ),
      team,
      index
    );
  }

  pickSavedXI(
    rawPlayers,
    savedIds,
    formation
  ) {
    const ids =
      Array.isArray(savedIds)
        ? savedIds.map(String)
        : [];

    if (ids.length === 11) {
      const map =
        new Map(
          rawPlayers.map(
            (player) => [
              String(
                player.id ??
                player.playerId
              ),
              player,
            ]
          )
        );

      const selected =
        ids
          .map(
            (id) => map.get(id)
          )
          .filter(Boolean);

      if (selected.length === 11) {
        return selected;
      }
    }

    return MatchEngine.chooseBestXI(
      rawPlayers,
      formation
    );
  }

  createPlayers(
    rawPlayers,
    team
  ) {
    return rawPlayers
      .slice(0, 11)
      .map(
        (raw, index) =>
          new Player(
            raw,
            team,
            index
          )
      );
  }

  createBench(
    rawPlayers,
    xi
  ) {
    const ids =
      new Set(
        xi.map(
          (player) =>
            String(player.id)
        )
      );

    return rawPlayers
      .filter(
        (raw) =>
          !ids.has(
            String(
              raw.id ??
              raw.playerId
            )
          )
      )
      .slice(0, 9)
      .map(
        (raw, index) =>
          new Player(
            raw,
            "bench",
            11 + index
          )
      );
  }

  positionTeam(team) {
    const formation =
      team === "home"
        ? this.homeFormation
        : this.awayFormation;

    const players =
      team === "home"
        ? this.homeXI
        : this.awayXI;

    players.forEach(
      (player, index) => {
        const position =
          getFormationPosition(
            formation,
            index,
            team
          );

        player.index = index;

        player.setPosition(
          position.x,
          position.y
        );

        player.state =
          PLAYER_STATE.IDLE;
      }
    );
  }

  placeBallForKickoff() {
    this.ball.stop();

    this.ball.position.set(
      PITCH.width / 2,
      PITCH.height / 2
    );

    const team =
      this.homeScore === 0 &&
      this.awayScore === 0
        ? "home"
        : "away";

    const players =
      this.getTeam(team)
        .filter(
          (player) =>
            player.active &&
            !player.injury &&
            !player.redCard
        );

    const striker =
      players.find(
        (player) =>
          player.position === "FWD"
      ) ||
      players[0];

    if (!striker) {
      return;
    }

    striker.setPosition(
      team === "home"
        ? PITCH.width / 2 - 14
        : PITCH.width / 2 + 14,
      PITCH.height / 2
    );

    this.ball.attach(striker);
  }

  setUserControlled(team) {
    this.userControlled =
      team === "home" ||
      team === "away"
        ? team
        : null;
  }

  isUserControlled(team) {
    return (
      this.userControlled ===
      team
    );
  }

  start() {
    if (this.finished) {
      return false;
    }

    if (
      this.status ===
        MATCH_STATUS.HALF_TIME ||
      this.simulationTime >= 45
    ) {
      return this.startSecondHalf();
    }

    this.status =
      MATCH_STATUS.LIVE;

    this.running = true;

    this.paused = false;

    if (
      this.simulationTime <= 0 &&
      !this.hasEvent(
        EVENT_TYPES.KICKOFF
      )
    ) {
      this.addEvent(
        EVENT_TYPES.KICKOFF,
        "Kick-off"
      );
    }

    return true;
  }

  startSecondHalf() {
    if (
      this.finished ||
      this.simulationTime >= 90
    ) {
      return false;
    }

    this.simulationTime =
      Math.max(
        45,
        this.simulationTime
      );

    this.status =
      MATCH_STATUS.LIVE;

    this.running = true;

    this.paused = false;

    this.placeBallForKickoff();

    this.addEvent(
      EVENT_TYPES.SECOND_HALF,
      "Second half"
    );

    return true;
  }

  pause() {
    if (this.finished) {
      return;
    }

    this.running = false;

    this.paused = true;
  }

  resume() {
    if (this.finished) {
      return;
    }

    if (
      this.status ===
      MATCH_STATUS.HALF_TIME
    ) {
      return this.startSecondHalf();
    }

    this.running = true;

    this.paused = false;

    this.status =
      MATCH_STATUS.LIVE;
  }

  stop() {
    this.finishMatch();
  }

  setTactics(
    team,
    tactics
  ) {
    if (team === "home") {
      this.homeTactics =
        normalizeTactics({
          ...this.homeTactics,
          ...tactics,
        });
    }

    if (team === "away") {
      this.awayTactics =
        normalizeTactics({
          ...this.awayTactics,
          ...tactics,
        });
    }
  }

  setFormation(
    team,
    formation
  ) {
    const normalized =
      normalizeFormation(
        formation
      );

    if (team === "home") {
      this.homeFormation =
        normalized;
    }

    if (team === "away") {
      this.awayFormation =
        normalized;
    }

    this.positionTeam(team);
  }

  update(
    realDeltaSeconds
  ) {
    if (
      !this.running ||
      this.finished
    ) {
      return;
    }

    let remaining =
      clamp(
        Number(
          realDeltaSeconds
        ) || 0,
        0,
        0.12
      );

    while (
      remaining > 0 &&
      this.running
    ) {
      const dt =
        Math.min(
          MATCH.FIXED_DT,
          remaining
        );

      this.fixedUpdate(dt);

      remaining -= dt;
    }
  }

  fixedUpdate(dt) {
    if (
      !this.running ||
      this.finished
    ) {
      return;
    }

    const previousMinute =
      this.simulationTime;

    this.simulationTime +=
      dt *
      MATCH.SIM_MINUTES_PER_REAL_SECOND;

    if (
      previousMinute < 45 &&
      this.simulationTime >= 45
    ) {
      this.simulationTime = 45;

      this.status =
        MATCH_STATUS.HALF_TIME;

      this.running = false;

      this.paused = true;

      this.ball.stop();

      this.addEvent(
        EVENT_TYPES.HALF_TIME,
        "Half-time"
      );

      return;
    }

    if (
      this.simulationTime >= 90
    ) {
      this.simulationTime = 90;

      this.finishMatch();

      return;
    }

    this.aiTimer -= dt;

    this.decisionTimer -= dt;

    this.aiTacticsTimer -= dt;

    this.subsTimer -= dt;

    if (
      this.aiTacticsTimer <= 0
    ) {
      this.aiTacticsTimer =
        MATCH.AI_TACTICS_INTERVAL;

      this.adaptAITactics();
    }

    if (
      this.aiTimer <= 0
    ) {
      this.aiTimer =
        MATCH.AI_UPDATE_INTERVAL;

      this.updateAI();
    }

    this.updatePlayers(dt);

    this.updateBall(dt);

    this.checkPassReception();

    this.checkInterception();

    this.resolvePossession();

    this.resolveTackles(dt);

    this.updateStamina(dt);

    this.checkGoal();

    if (
      this.decisionTimer <= 0
    ) {
      this.decisionTimer =
        MATCH.DECISION_INTERVAL;

      this.makeBallDecision();
    }

    this.checkBallOut();

    if (
      this.subsTimer <= 0
    ) {
      this.subsTimer = 4;

      this.runAutomaticSubstitutions();
    }

    this.updatePossessionStats(
      dt
    );
  }

  activePlayers(team = null) {
    let players;

    if (team === "home") {
      players = this.homeXI;
    } else if (team === "away") {
      players = this.awayXI;
    } else {
      players = [
        ...this.homeXI,
        ...this.awayXI,
      ];
    }

    return players.filter(
      (player) =>
        player.active &&
        !player.injury &&
        !player.redCard
    );
  }

  getTeam(team) {
    return team === "home"
      ? this.homeXI
      : this.awayXI;
  }

  getBench(team) {
    return team === "home"
      ? this.homeBench
      : this.awayBench;
  }

  getOpponents(team) {
    return this.activePlayers(
      team === "home"
        ? "away"
        : "home"
    );
  }

  getBallCarrier() {
    if (!this.ball.ownerId) {
      return null;
    }

    return this.activePlayers()
      .find(
        (player) =>
          player.id ===
          this.ball.ownerId
      ) || null;
  }

  updatePlayers(dt) {
    const carrier =
      this.getBallCarrier();

    const players =
      this.activePlayers();

    for (
      const player of players
    ) {
      if (
        carrier &&
        player.id === carrier.id
      ) {
        player.target.set(
          player.x,
          player.y
        );

        player.state =
          PLAYER_STATE.POSSESSED;

        this.ball.position.set(
          player.x,
          player.y
        );

        continue;
      }

      if (
        carrier &&
        carrier.team ===
          player.team
      ) {
        const target =
          this.getSupportTarget(
            player,
            carrier
          );

        player.setTarget(
          target.x,
          target.y
        );
      }

      player.update(dt);
    }
  }

  updateBall(dt) {
    const carrier =
      this.getBallCarrier();

    if (carrier) {
      this.ball.position.set(
        carrier.x,
        carrier.y
      );

      return;
    }

    this.ball.update(dt);
  }

  updateAI() {
    const carrier =
      this.getBallCarrier();

    for (
      const team of [
        "home",
        "away",
      ]
    ) {
      const players =
        this.getTeam(team);

      const tactics =
        team === "home"
          ? this.homeTactics
          : this.awayTactics;

      for (
        const player of players
      ) {
        if (
          !player.active ||
          player.redCard ||
          player.injury
        ) {
          continue;
        }

        const formationPoint =
          getFormationPosition(
            team === "home"
              ? this.homeFormation
              : this.awayFormation,
            player.index,
            team
          );

        if (
          carrier &&
          carrier.id === player.id
        ) {
          this.setCarrierTarget(
            player,
            tactics
          );

          continue;
        }

        if (!carrier) {
          const ballDistance =
            distance(
              player,
              this.ball.position
            );

          if (
            ballDistance < 230 &&
            player.position !== "GK"
          ) {
            player.state =
              PLAYER_STATE.CHASING;

            player.setTarget(
              this.ball.position.x,
              this.ball.position.y
            );
          } else {
            player.setTarget(
              formationPoint.x,
              formationPoint.y
            );
          }

          continue;
        }

        if (
          carrier.team !== team
        ) {
          this.setDefensiveTarget(
            player,
            carrier,
            formationPoint,
            tactics
          );
        } else {
          this.setAttackingTarget(
            player,
            carrier,
            formationPoint,
            tactics
          );
        }
      }
    }
  }

  setCarrierTarget(
    player,
    tactics
  ) {
    const direction =
      player.team === "home"
        ? 1
        : -1;

    const goalX =
      player.team === "home"
        ? PITCH.width
        : 0;

    const distanceToGoal =
      Math.abs(
        goalX - player.x
      );

    if (
      player.position === "GK"
    ) {
      player.setTarget(
        player.team === "home"
          ? 100
          : PITCH.width - 100,

        PITCH.height / 2
      );

      return;
    }

    if (
      distanceToGoal < 220
    ) {
      player.setTarget(
        player.x +
          direction * 65,

        clamp(
          player.y +
            random(-35, 35),
          55,
          PITCH.height - 55
        )
      );

      return;
    }

    const tempo =
      tactics.tempo === "fast"
        ? 1.2
        : tactics.tempo === "slow"
          ? 0.75
          : 1;

    player.setTarget(
      clamp(
        player.x +
          direction *
            80 *
            tempo,
        30,
        PITCH.width - 30
      ),

      clamp(
        player.y +
          random(-20, 20),
        45,
        PITCH.height - 45
      )
    );
  }

  setDefensiveTarget(
    player,
    carrier,
    formationPoint,
    tactics
  ) {
    if (
      player.position === "GK"
    ) {
      this.updateGoalkeeper(
        player,
        carrier
      );

      return;
    }

    const pressing =
      tactics.pressing === "high"
        ? 1
        : tactics.pressing === "low"
          ? 0.35
          : 0.65;

    const d =
      distance(
        player,
        carrier
      );

    if (
      d <
      210 * pressing
    ) {
      player.state =
        PLAYER_STATE.CHASING;

      player.setTarget(
        carrier.x,
        carrier.y
      );

      return;
    }

    const x =
      formationPoint.x +
      (carrier.x -
        PITCH.width / 2) *
        0.12;

    const y =
      formationPoint.y +
      (carrier.y -
        PITCH.height / 2) *
        0.16;

    player.setTarget(
      clamp(
        x,
        35,
        PITCH.width - 35
      ),

      clamp(
        y,
        35,
        PITCH.height - 35
      )
    );
  }

  setAttackingTarget(
    player,
    carrier,
    formationPoint,
    tactics
  ) {
    if (
      player.position === "GK"
    ) {
      player.setTarget(
        formationPoint.x,
        formationPoint.y
      );

      return;
    }

    const direction =
      player.team === "home"
        ? 1
        : -1;

    const width =
      tactics.width === "wide"
        ? 1.25
        : tactics.width === "narrow"
          ? 0.72
          : 1;

    let x =
      formationPoint.x +
      direction * 24;

    let y =
      PITCH.height / 2 +
      (formationPoint.y -
        PITCH.height / 2) *
        width;

    if (
      player.position === "FWD"
    ) {
      x += direction * 55;
    }

    if (
      distance(
        player,
        carrier
      ) < 70
    ) {
      y +=
        player.y <
        PITCH.height / 2
          ? 65
          : -65;
    }

    player.setTarget(
      clamp(
        x,
        35,
        PITCH.width - 35
      ),

      clamp(
        y,
        35,
        PITCH.height - 35
      )
    );
  }

  updateGoalkeeper(
    player,
    carrier
  ) {
    const goalX =
      player.team === "home"
        ? 42
        : PITCH.width - 42;

    const goalY =
      PITCH.height / 2;

    let targetY =
      clamp(
        carrier?.y ??
          goalY,

        goalY -
          PITCH.goalWidth / 2 +
          15,

        goalY +
          PITCH.goalWidth / 2 -
          15
      );

    let targetX = goalX;

    if (
      distance(
        player,
        this.ball.position
      ) < 220
    ) {
      targetX +=
        player.team === "home"
          ? 30
          : -30;

      targetY =
        this.ball.position.y;
    }

    player.setTarget(
      targetX,
      targetY
    );
  }

  adaptAITactics() {
    for (
      const team of [
        "home",
        "away",
      ]
    ) {
      if (
        team ===
        this.userControlled
      ) {
        continue;
      }

      const scoreFor =
        team === "home"
          ? this.homeScore
          : this.awayScore;

      const scoreAgainst =
        team === "home"
          ? this.awayScore
          : this.homeScore;

      const minute =
        this.simulationTime;

      let mentality =
        "balanced";

      if (
        scoreFor <
        scoreAgainst
      ) {
        mentality =
          minute > 65
            ? "attacking"
            : "positive";
      }

      if (
        scoreFor >
        scoreAgainst
      ) {
        mentality =
          minute > 75
            ? "defensive"
            : "balanced";
      }

      const current =
        team === "home"
          ? this.homeTactics
          : this.awayTactics;

      this.setTactics(
        team,
        {
          mentality,

          pressing:
            mentality ===
            "attacking"
              ? "high"
              : mentality ===
                  "defensive"
                ? "low"
                : current.pressing,

          tempo:
            mentality ===
            "attacking"
              ? "fast"
              : mentality ===
                  "defensive"
                ? "slow"
                : current.tempo,
        }
      );
    }
  }

  makeBallDecision() {
    const carrier =
      this.getBallCarrier();

    if (!carrier) {
      return;
    }

    const tactics =
      carrier.team === "home"
        ? this.homeTactics
        : this.awayTactics;

    const goalX =
      carrier.team === "home"
        ? PITCH.width
        : 0;

    const distanceToGoal =
      Math.abs(
        goalX - carrier.x
      );

    const defenders =
      this.getOpponents(
        carrier.team
      );

    const nearest =
      this.nearestTo(
        defenders,
        carrier
      );

    if (
      carrier.position === "GK"
    ) {
      this.passFromGK(
        carrier
      );

      return;
    }

    if (
      distanceToGoal < 205 &&
      this.canShoot(carrier)
    ) {
      this.shoot(carrier);

      return;
    }

    const pressure =
      nearest
        ? distance(
            nearest,
            carrier
          )
        : 999;

    if (
      pressure < 50
    ) {
      if (chance(0.72)) {
        const target =
          this.findPassTarget(
            carrier,
            true
          );

        if (target) {
          this.pass(
            carrier,
            target,
            true
          );

          return;
        }
      }

      if (chance(0.35)) {
        this.dribble(carrier);

        return;
      }
    }

    if (
      carrier.position === "FWD" &&
      distanceToGoal < 330 &&
      chance(0.26)
    ) {
      const target =
        this.findCrossTarget(
          carrier
        );

      if (target) {
        this.cross(
          carrier,
          target
        );

        return;
      }
    }

    const passChance =
      tactics.passingStyle ===
      "short"
        ? 0.72
        : tactics.passingStyle ===
            "direct"
          ? 0.43
          : 0.58;

    if (
      chance(passChance)
    ) {
      const target =
        this.findPassTarget(
          carrier,
          false
        );

      if (target) {
        this.pass(
          carrier,
          target,
          chance(0.22)
        );

        return;
      }
    }

    this.dribble(carrier);
  }

  passFromGK(player) {
    const target =
      this.findPassTarget(
        player,
        false
      );

    if (
      target &&
      target !== player
    ) {
      this.pass(
        player,
        target,
        false
      );
    }
  }

  findPassTarget(
    from,
    underPressure
  ) {
    const teammates =
      this.activePlayers(
        from.team
      ).filter(
        (player) =>
          player !== from
      );

    const direction =
      from.team === "home"
        ? 1
        : -1;

    const candidates =
      teammates
        .map((player) => {
          const forward =
            (player.x -
              from.x) *
            direction;

          const opponent =
            this.nearestTo(
              this.getOpponents(
                from.team
              ),
              player
            );

          const space =
            opponent
              ? distance(
                  opponent,
                  player
                )
              : 100;

          const roleBonus =
            player.position ===
            "FWD"
              ? 22
              : player.position ===
                  "MID"
                ? 10
                : 0;

          const score =
            forward * 0.55 +
            space * 0.35 +
            player.vision *
              0.45 +
            roleBonus;

          return {
            player,
            score,
          };
        })
        .filter(
          ({ player }) =>
            distance(
              player,
              from
            ) <
            (underPressure
              ? 330
              : 470)
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    return (
      candidates[0]?.player ||
      null
    );
  }

  findCrossTarget(
    from
  ) {
    return this.activePlayers(
      from.team
    )
      .filter(
        (player) =>
          player !== from &&
          player.position === "FWD"
      )
      .sort(
        (a, b) =>
          Math.abs(
            a.x - from.x
          ) -
          Math.abs(
            b.x - from.x
          )
      )[0] || null;
  }

  canShoot(player) {
    const goalX =
      player.team === "home"
        ? PITCH.width
        : 0;

    const distanceToGoal =
      Math.abs(
        goalX - player.x
      );

    const quality =
      player.shooting / 100;

    return (
      distanceToGoal < 245 &&
      chance(
        0.58 +
          quality * 0.32
      )
    );
  }

  pass(
    from,
    target,
    through = false
  ) {
    if (
      !from ||
      !target
    ) {
      return false;
    }

    const stats =
      from.team === "home"
        ? this.homeStats
        : this.awayStats;

    stats.passes += 1;

    from.stats.passes += 1;

    const passDistance =
      distance(
        from,
        target
      );

    const accuracy =
      clamp(
        0.58 +
          from.passing / 240 +
          from.vision / 300 -
          passDistance / 900 -
          (through ? 0.12 : 0),

        0.38,
        0.96
      );

    if (
      chance(accuracy)
    ) {
      this.ball.kick(
        from,
        target,
        through
          ? 330
          : 275,
        BALL_STATE.PASSING,
        target.id
      );

      stats.completedPasses += 1;

      from.stats.completedPasses += 1;

      this.addEvent(
        through
          ? EVENT_TYPES.THROUGH_BALL
          : EVENT_TYPES.PASS,

        `${from.name} pass to ${target.name}`,

        from.team,

        from.id,

        target.id
      );

      return true;
    }

    const opponents =
      this.getOpponents(
        from.team
      );

    const interceptor =
      this.nearestTo(
        opponents,
        {
          x:
            (from.x +
              target.x) /
            2,

          y:
            (from.y +
              target.y) /
            2,
        }
      );

    this.ball.kick(
      from,
      interceptor || target,
      215,
      BALL_STATE.PASSING,
      interceptor?.id || null
    );

    this.addEvent(
      EVENT_TYPES.PASS,
      `${from.name} misplaces a pass`,
      from.team,
      from.id
    );

    return false;
  }

  dribble(player) {
    if (!player) {
      return false;
    }

    const direction =
      player.team === "home"
        ? 1
        : -1;

    const vertical =
      chance(0.5)
        ? -1
        : 1;

    player.hasBall = true;

    this.ball.attach(player);

    const success =
      chance(
        clamp(
          0.48 +
            player.dribbling / 250 -
            this.nearestOpponentDistance(
              player
            ) / 700,

          0.18,
          0.9
        )
      );

    if (success) {
      player.setTarget(
        clamp(
          player.x +
            direction * 80,
          25,
          PITCH.width - 25
        ),

        clamp(
          player.y +
            vertical *
              random(25, 85),
          25,
          PITCH.height - 25
        )
      );

      this.addEvent(
        EVENT_TYPES.DRIBBLE,
        `${player.name} dribbles`,
        player.team,
        player.id
      );

      return true;
    }

    const defender =
      this.nearestTo(
        this.getOpponents(
          player.team
        ),
        player
      );

    if (
      defender &&
      distance(
        defender,
        player
      ) < 80
    ) {
      this.resolveTackle(
        defender,
        player
      );
    }

    return false;
  }

  cross(
    from,
    target
  ) {
    const accuracy =
      clamp(
        0.5 +
          from.passing / 240 +
          from.vision / 350,

        0.35,
        0.94
      );

    if (
      chance(accuracy)
    ) {
      this.ball.kick(
        from,
        {
          x:
            target.x +
            (from.team === "home"
              ? 25
              : -25),

          y: target.y,
        },
        300,
        BALL_STATE.CROSSING,
        target.id
      );

      this.addEvent(
        EVENT_TYPES.CROSS,
        `${from.name} crosses`,
        from.team,
        from.id,
        target.id
      );

      return true;
    }

    this.ball.kick(
      from,
      {
        x:
          from.team === "home"
            ? PITCH.width + 30
            : -30,

        y:
          random(
            80,
            PITCH.height - 80
          ),
      },
      280,
      BALL_STATE.CROSSING
    );

    this.addEvent(
      EVENT_TYPES.CROSS,
      `${from.name} crosses unsuccessfully`,
      from.team,
      from.id
    );

    return false;
  }

  shoot(player) {
    if (!player) {
      return false;
    }

    const stats =
      player.team === "home"
        ? this.homeStats
        : this.awayStats;

    stats.shots += 1;

    player.stats.shots += 1;

    const goalX =
      player.team === "home"
        ? PITCH.width + 20
        : -20;

    const goalY =
      clamp(
        PITCH.height / 2 +
          random(
            -PITCH.goalWidth / 2 + 10,
            PITCH.goalWidth / 2 - 10
          ),

        PITCH.height / 2 -
          PITCH.goalWidth / 2 +
          8,

        PITCH.height / 2 +
          PITCH.goalWidth / 2 -
          8
      );

    const target = {
      x: goalX,
      y: goalY,
    };

    const distanceToGoal =
      Math.abs(
        (player.team === "home"
          ? PITCH.width
          : 0) -
          player.x
      );

    const quality =
      clamp(
        0.30 +
          player.shooting / 190 +
          player.composure / 400 -
          distanceToGoal / 900,

        0.20,
        0.92
      );

    const onTarget =
      chance(quality);

    if (onTarget) {
      stats.shotsOnTarget += 1;

      player.stats.shotsOnTarget += 1;
    }

    this.ball.kick(
      player,
      target,
      420,
      BALL_STATE.SHOOTING
    );

    this.addEvent(
      EVENT_TYPES.SHOT,
      `${player.name} shoots`,
      player.team,
      player.id
    );

    return true;
  }

  checkPassReception() {
    if (
      this.ball.ownerId
    ) {
      return;
    }

    const target =
      this.players.find(
        (player) =>
          player.id ===
            this.ball.targetId &&
          player.active &&
          !player.injury &&
          !player.redCard
      );

    if (
      target &&
      distance(
        target,
        this.ball.position
      ) < 34
    ) {
      this.ball.attach(
        target
      );

      return;
    }

    const nearby =
      this.activePlayers()
        .filter(
          (player) =>
            distance(
              player,
              this.ball.position
            ) < 20
        );

    if (!nearby.length) {
      return;
    }

    nearby.sort(
      (a, b) => {
        const aScore =
          distance(
            a,
            this.ball.position
          ) -
          (a.team ===
          this.ball.lastTouchTeam
            ? 5
            : 0);

        const bScore =
          distance(
            b,
            this.ball.position
          ) -
          (b.team ===
          this.ball.lastTouchTeam
            ? 5
            : 0);

        return aScore - bScore;
      }
    );

    this.ball.attach(
      nearby[0]
    );
  }

  checkInterception() {
    if (
      this.ball.ownerId
    ) {
      return;
    }

    const candidates =
      this.activePlayers()
        .filter(
          (player) =>
            distance(
              player,
              this.ball.position
            ) < 24
        );

    const interceptor =
      candidates.find(
        (player) =>
          player.team !==
          this.ball.lastTouchTeam
      );

    if (!interceptor) {
      return;
    }

    this.ball.attach(
      interceptor
    );

    interceptor.stats
      .interceptions += 1;

    const stats =
      interceptor.team === "home"
        ? this.homeStats
        : this.awayStats;

    stats.interceptions += 1;

    this.addEvent(
      EVENT_TYPES.INTERCEPTION,
      `${interceptor.name} intercepts`,
      interceptor.team,
      interceptor.id
    );
  }

  resolvePossession() {
    const carrier =
      this.getBallCarrier();

    if (!carrier) {
      return;
    }

    const defender =
      this.nearestTo(
        this.getOpponents(
          carrier.team
        ),
        carrier
      );

    if (
      !defender ||
      distance(
        defender,
        carrier
      ) > 25
    ) {
      return;
    }

    if (chance(0.18)) {
      this.resolveTackle(
        defender,
        carrier
      );
    }
  }

  resolveTackles(dt) {
    const carrier =
      this.getBallCarrier();

    if (!carrier) {
      return;
    }

    const defenders =
      this.getOpponents(
        carrier.team
      );

    const defender =
      this.nearestTo(
        defenders.filter(
          (player) =>
            player.position !==
            "GK"
        ),
        carrier
      );

    if (!defender) {
      return;
    }

    const d =
      distance(
        defender,
        carrier
      );

    if (
      d < 27 &&
      chance(
        0.16 *
          dt *
          30
      )
    ) {
      this.resolveTackle(
        defender,
        carrier
      );
    }
  }

  resolveTackle(
    defender,
    attacker
  ) {
    if (
      !defender ||
      !attacker ||
      !this.ball.ownerId
    ) {
      return;
    }

    defender.stats.tackles += 1;

    const stats =
      defender.team === "home"
        ? this.homeStats
        : this.awayStats;

    stats.tackles += 1;

    const tacklePower =
      defender.tackling * 0.62 +
      defender.strength * 0.25;

    const dribblePower =
      attacker.dribbling * 0.58 +
      attacker.strength * 0.25;

    const success =
      chance(
        clamp(
          0.45 +
            (tacklePower -
              dribblePower) /
              220,

          0.18,
          0.82
        )
      );

    if (success) {
      this.ball.attach(
        defender
      );

      this.addEvent(
        EVENT_TYPES.TACKLE,
        `${defender.name} wins the ball`,
        defender.team,
        defender.id,
        attacker.id
      );

      if (chance(0.10)) {
        this.commitFoul(
          defender,
          attacker
        );
      }

      return;
    }

    if (chance(0.05)) {
      this.commitFoul(
        defender,
        attacker
      );
    }
  }

  commitFoul(
    defender,
    attacker
  ) {
    const stats =
      defender.team === "home"
        ? this.homeStats
        : this.awayStats;

    stats.fouls += 1;

    defender.stats.fouls += 1;

    this.addEvent(
      EVENT_TYPES.FOUL,
      `${defender.name} fouls ${attacker.name}`,
      defender.team,
      defender.id,
      attacker.id
    );

    if (chance(0.13)) {
      defender.yellowCards += 1;

      defender.stats.yellow += 1;

      stats.yellowCards += 1;

      this.addEvent(
        EVENT_TYPES.YELLOW,
        `${defender.name} receives a yellow card`,
        defender.team,
        defender.id
      );

      if (
        defender.yellowCards >= 2 &&
        chance(0.08)
      ) {
        defender.redCard = true;

        defender.active = false;

        defender.stats.red += 1;

        stats.redCards += 1;

        this.addEvent(
          EVENT_TYPES.RED,
          `${defender.name} is sent off`,
          defender.team,
          defender.id
        );

        if (
          this.ball.ownerId ===
          defender.id
        ) {
          this.ball.stop();
        }
      }
    }
  }

  tryInjure(
    player,
    reason = "knock"
  ) {
    if (
      !player ||
      player.injury ||
      player.redCard
    ) {
      return false;
    }

    const fatigue =
      player.stamina <
      INJURY.STAMINA_THRESHOLD
        ? 2.5
        : 1;

    const probability =
      INJURY.TACKLE_BASE *
      fatigue;

    if (
      !chance(probability)
    ) {
      return false;
    }

    if (
      player.injure(reason)
    ) {
      this.injuries[
        player.team
      ] += 1;

      this.addEvent(
        EVENT_TYPES.INJURY,
        `${player.name} is injured`,
        player.team,
        player.id
      );

      if (
        this.ball.ownerId ===
        player.id
      ) {
        this.ball.stop();
      }

      return true;
    }

    return false;
  }

  updateStamina(dt) {
    for (
      const player of
        this.activePlayers()
    ) {
      if (
        player.stamina < 12 &&
        chance(
          INJURY.FATIGUE_BASE *
            dt *
            30
        )
      ) {
        this.tryInjure(
          player,
          "fatigue"
        );
      }
    }
  }

  checkGoal() {
    if (
      this.ball.state !==
        BALL_STATE.SHOOTING &&
      this.ball.state !==
        BALL_STATE.CROSSING
    ) {
      return;
    }

    const x =
      this.ball.position.x;

    const y =
      this.ball.position.y;

    const top =
      PITCH.height / 2 -
      PITCH.goalWidth / 2;

    const bottom =
      PITCH.height / 2 +
      PITCH.goalWidth / 2;

    if (
      y < top ||
      y > bottom
    ) {
      return;
    }

    if (
      x >=
      PITCH.width +
        PITCH.goalDepth * 0.15
    ) {
      if (
        this.ball.lastTouchTeam ===
        "home"
      ) {
        this.scoreGoal("home");
      } else {
        this.ball.stop();
      }

      return;
    }

    if (
      x <=
      -PITCH.goalDepth * 0.15
    ) {
      if (
        this.ball.lastTouchTeam ===
        "away"
      ) {
        this.scoreGoal("away");
      } else {
        this.ball.stop();
      }
    }
  }

  scoreGoal(team) {
    const scorer =
      this.findLastShooter(
        team
      );

    const stats =
      team === "home"
        ? this.homeStats
        : this.awayStats;

    if (team === "home") {
      this.homeScore += 1;
    } else {
      this.awayScore += 1;
    }

    stats.goals += 1;

    if (scorer) {
      scorer.stats.goals += 1;
    }

    const clubName =
      team === "home"
        ? this.homeClub?.name ||
          "Home"
        : this.awayClub?.name ||
          "Away";

    this.addEvent(
      EVENT_TYPES.GOAL,
      `${clubName} score!`,
      team,
      scorer?.id || null
    );

    this.ball.stop();

    this.placeBallForKickoff();
  }

  findLastShooter(team) {
    return this.getTeam(team)
      .find(
        (player) =>
          player.id ===
          this.ball.lastTouchPlayer
      ) || null;
  }

  updatePossessionStats(dt) {
    const carrier =
      this.getBallCarrier();

    if (!carrier) {
      return;
    }

    const stats =
      carrier.team === "home"
        ? this.homeStats
        : this.awayStats;

    stats.possessionSeconds += dt;
  }

  checkBallOut() {
    if (
      this.ball.ownerId
    ) {
      return;
    }

    const x =
      this.ball.position.x;

    const y =
      this.ball.position.y;

    const topGoal =
      PITCH.height / 2 -
      PITCH.goalWidth / 2;

    const bottomGoal =
      PITCH.height / 2 +
      PITCH.goalWidth / 2;

    if (
      x < 0 ||
      x > PITCH.width
    ) {
      if (
        x > PITCH.width &&
        y >= topGoal &&
        y <= bottomGoal
      ) {
        return;
      }

      if (
        x < 0 &&
        y >= topGoal &&
        y <= bottomGoal
      ) {
        return;
      }

      if (
        x > PITCH.width
      ) {
        this.awardGoalKick(
          "away"
        );
      } else {
        this.awardGoalKick(
          "home"
        );
      }

      return;
    }

    if (
      y < 0 ||
      y > PITCH.height
    ) {
      this.handleThrowIn(
        x,
        y
      );
    }
  }

  handleThrowIn(
    x,
    y
  ) {
    const lastTeam =
      this.ball.lastTouchTeam ||
      "home";

    const team =
      lastTeam === "home"
        ? "away"
        : "home";

    const players =
      this.activePlayers(
        team
      );

    const target =
      this.nearestTo(
        players,
        {
          x: clamp(
            x,
            40,
            PITCH.width - 40
          ),

          y:
            y < 0
              ? 20
              : PITCH.height - 20,
        }
      );

    this.ball.stop();

    if (target) {
      target.setPosition(
        clamp(
          x,
          25,
          PITCH.width - 25
        ),

        y < 0
          ? 22
          : PITCH.height - 22
      );

      this.ball.attach(
        target
      );
    }

    this.addEvent(
      EVENT_TYPES.THROW_IN,
      "Throw-in",
      team,
      target?.id || null
    );
  }

  awardGoalKick(team) {
    const goalkeeper =
      this.getTeam(team)
        .find(
          (player) =>
            player.position ===
              "GK" &&
            player.active &&
            !player.redCard &&
            !player.injury
        );

    this.ball.stop();

    if (goalkeeper) {
      goalkeeper.setPosition(
        team === "home"
          ? 55
          : PITCH.width - 55,

        PITCH.height / 2
      );

      this.ball.attach(
        goalkeeper
      );
    }

    this.addEvent(
      EVENT_TYPES.GOAL_KICK,
      "Goal kick",
      team,
      goalkeeper?.id || null
    );
  }

  awardCorner(team) {
    const players =
      this.activePlayers(
        team
      ).filter(
        (player) =>
          player.position !==
          "GK"
      );

    const target =
      this.nearestTo(
        players,
        {
          x:
            team === "home"
              ? PITCH.width - 18
              : 18,

          y:
            this.ball.position.y <
            PITCH.height / 2
              ? 18
              : PITCH.height - 18,
        }
      );

    this.ball.stop();

    if (target) {
      target.setPosition(
        team === "home"
          ? PITCH.width - 18
          : 18,

        this.ball.position.y <
          PITCH.height / 2
          ? 18
          : PITCH.height - 18
      );

      this.ball.attach(
        target
      );
    }

    const stats =
      team === "home"
        ? this.homeStats
        : this.awayStats;

    stats.corners += 1;

    this.addEvent(
      EVENT_TYPES.CORNER,
      "Corner",
      team,
      target?.id || null
    );
  }

  runAutomaticSubstitutions() {
    for (
      const team of [
        "home",
        "away",
      ]
    ) {
      if (
        team ===
        this.userControlled
      ) {
        continue;
      }

      if (
        this.substitutions[team] >=
        MATCH.MAX_SUBSTITUTIONS
      ) {
        continue;
      }

      if (
        this.simulationTime < 55 ||
        this.simulationTime > 88
      ) {
        continue;
      }

      const players =
        this.getTeam(team);

      const bench =
        this.getBench(team)
          .filter(
            (player) =>
              player.active &&
              !player.injury &&
              !player.redCard
          );

      const tired =
        players
          .filter(
            (player) =>
              player.active &&
              !player.injury &&
              !player.redCard
          )
          .sort(
            (a, b) =>
              a.stamina -
              b.stamina
          )[0];

      if (
        !tired ||
        tired.stamina > 24 ||
        !bench.length
      ) {
        continue;
      }

      const replacement =
        bench
          .filter(
            (player) =>
              normalizePosition(
                player.position
              ) ===
              normalizePosition(
                tired.position
              )
          )
          .sort(
            (a, b) =>
              b.overall -
              a.overall
          )[0] ||
        bench[0];

      if (replacement) {
        this.performSubstitution(
          team,
          tired.id,
          replacement.id,
          true
        );
      }
    }
  }

  performSubstitution(
    team,
    outId,
    inId,
    automatic = false
  ) {
    if (
      team !== "home" &&
      team !== "away"
    ) {
      return false;
    }

    if (
      this.substitutions[team] >=
      MATCH.MAX_SUBSTITUTIONS
    ) {
      return false;
    }

    const xi =
      this.getTeam(team);

    const bench =
      this.getBench(team);

    const outgoing =
      xi.find(
        (player) =>
          player.id ===
          String(outId)
      );

    const incoming =
      bench.find(
        (player) =>
          player.id ===
          String(inId)
      );

    if (
      !outgoing ||
      !incoming
    ) {
      return false;
    }

    if (
      !outgoing.active ||
      incoming.injury ||
      incoming.redCard
    ) {
      return false;
    }

    const index =
      xi.indexOf(
        outgoing
      );

    incoming.active = true;

    incoming.injury = null;

    incoming.redCard = false;

    incoming.index =
      outgoing.index;

    incoming.setPosition(
      outgoing.x,
      outgoing.y
    );

    if (
      outgoing.hasBall
    ) {
      this.ball.attach(
        incoming
      );
    }

    outgoing.hasBall = false;

    outgoing.active = false;

    xi[index] = incoming;

    bench.splice(
      bench.indexOf(
        incoming
      ),
      1
    );

    bench.push(
      outgoing
    );

    this.substitutions[team] += 1;

    this.players = [
      ...this.homeXI,
      ...this.awayXI,
      ...this.homeBench,
      ...this.awayBench,
    ];

    this.addEvent(
      EVENT_TYPES.SUBSTITUTION,

      `${incoming.name} replaces ${outgoing.name}`,

      team,

      incoming.id,

      outgoing.id,

      {
        automatic,
      }
    );

    return true;
  }

  nearestTo(
    players,
    point
  ) {
    if (
      !players?.length
    ) {
      return null;
    }

    let closest =
      players[0];

    let closestDistance =
      distance(
        closest,
        point
      );

    for (
      let i = 1;
      i < players.length;
      i += 1
    ) {
      const current =
        distance(
          players[i],
          point
        );

      if (
        current <
        closestDistance
      ) {
        closest =
          players[i];

        closestDistance =
          current;
      }
    }

    return closest;
  }

  nearestOpponentDistance(
    player
  ) {
    const opponent =
      this.nearestTo(
        this.getOpponents(
          player.team
        ),
        player
      );

    return opponent
      ? distance(
          opponent,
          player
        )
      : 999;
  }

  getSupportTarget(
    player,
    carrier
  ) {
    const direction =
      player.team === "home"
        ? 1
        : -1;

    return {
      x: clamp(
        carrier.x -
          direction *
            random(25, 75),

        30,
        PITCH.width - 30
      ),

      y: clamp(
        player.y +
          random(-45, 45),

        30,
        PITCH.height - 30
      ),
    };
  }

  hasEvent(type) {
    return this.events.some(
      (event) =>
        event.type === type
    );
  }

  addEvent(
    type,
    text,
    team = null,
    playerId = null,
    relatedPlayerId = null,
    extra = {}
  ) {
    const event = {
      id:
        `${Date.now()}-${this.eventCounter++}`,

      type,

      minute:
        Math.round(
          this.simulationTime * 10
        ) / 10,

      text,

      team,

      playerId,

      relatedPlayerId,

      ...extra,
    };

    this.events.push(
      event
    );

    if (
      this.events.length >
      MATCH.MAX_EVENTS
    ) {
      this.events.splice(
        0,
        this.events.length -
          MATCH.MAX_EVENTS
      );
    }

    this.lastEvent = event;

    return event;
  }

  finishMatch() {
    this.simulationTime = 90;

    this.status =
      MATCH_STATUS.FINISHED;

    this.running = false;

    this.paused = false;

    this.finished = true;

    this.ball.stop();

    if (
      !this.hasEvent(
        EVENT_TYPES.FULL_TIME
      )
    ) {
      this.addEvent(
        EVENT_TYPES.FULL_TIME,

        `Full-time: ${this.homeScore}-${this.awayScore}`
      );
    }
  }

  getPossession() {
    const total =
      this.homeStats
        .possessionSeconds +
      this.awayStats
        .possessionSeconds;

    if (total <= 0) {
      return {
        home: 50,
        away: 50,
      };
    }

    const home =
      (
        this.homeStats
          .possessionSeconds /
        total
      ) * 100;

    return {
      home:
        Math.round(
          home * 10
        ) / 10,

      away:
        Math.round(
          (100 - home) * 10
        ) / 10,
    };
  }

  getSnapshot() {
    return {
      minute:
        Math.round(
          this.simulationTime * 10
        ) / 10,

      status:
        this.status,

      running:
        this.running,

      paused:
        this.paused,

      finished:
        this.finished,

      homeScore:
        this.homeScore,

      awayScore:
        this.awayScore,

      homeClub:
        this.homeClub,

      awayClub:
        this.awayClub,

      homeFormation:
        this.homeFormation,

      awayFormation:
        this.awayFormation,

      homeTactics: {
        ...this.homeTactics,
      },

      awayTactics: {
        ...this.awayTactics,
      },

      homeStats: {
        ...this.homeStats,
      },

      awayStats: {
        ...this.awayStats,
      },

      possession:
        this.getPossession(),

      substitutions: {
        ...this.substitutions,
      },

      homeXI:
        this.homeXI.map(
          (player) =>
            player.toSnapshot()
        ),

      awayXI:
        this.awayXI.map(
          (player) =>
            player.toSnapshot()
        ),

      homeBench:
        this.homeBench.map(
          (player) =>
            player.toSnapshot()
        ),

      awayBench:
        this.awayBench.map(
          (player) =>
            player.toSnapshot()
        ),

      ball:
        this.ball.toSnapshot(),

      lastEvent:
        this.lastEvent,

      events: [
        ...this.events,
      ],
    };
  }

  getSavePayload() {
    return {
      status:
        this.status,

      minute:
        this.simulationTime,

      homeScore:
        this.homeScore,

      awayScore:
        this.awayScore,

      homeStats: {
        ...this.homeStats,
      },

      awayStats: {
        ...this.awayStats,
      },

      homeFormation:
        this.homeFormation,

      awayFormation:
        this.awayFormation,

      homeTactics: {
        ...this.homeTactics,
      },

      awayTactics: {
        ...this.awayTactics,
      },

      homeLineupIds:
        this.homeXI.map(
          (player) =>
            player.id
        ),

      awayLineupIds:
        this.awayXI.map(
          (player) =>
            player.id
        ),

      homeSubsUsed:
        this.substitutions.home,

      awaySubsUsed:
        this.substitutions.away,

      ballOwnerId:
        this.ball.ownerId,

      events: [
        ...this.events,
      ],
    };
  }
}

export {
  normalizeStatus,
  normalizeTactics,
  normalizePosition,
  getOverall,
  createStats,
};
