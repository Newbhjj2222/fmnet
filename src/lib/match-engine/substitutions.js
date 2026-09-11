// lib/match-engine/substitutions.js

import {
  MATCH,
} from "./constants";

function playerScore(player) {
  if (!player) return 0;

  return (
    player.performance +
    player.stamina * 0.25 +
    player.overall * 0.3
  );
}

function chooseBenchPlayer(
  team,
  outgoing
) {
  if (!team.bench?.length) {
    return null;
  }

  const candidates =
    team.bench
      .filter(
        (p) =>
          !team.players.some(
            (active) =>
              String(active.id) ===
              String(p.id)
          )
      )
      .sort(
        (a, b) =>
          Number(
            b.overall ??
            b.rating ??
            60
          ) -
          Number(
            a.overall ??
            a.rating ??
            60
          )
      );

  if (!candidates.length) {
    return null;
  }

  const samePosition =
    candidates.find(
      (p) =>
        String(
          p.position
        ).toUpperCase() ===
        String(
          outgoing.position
        ).toUpperCase()
    );

  return (
    samePosition ||
    candidates[0]
  );
}

export function aiSubstitute(
  engine,
  team
) {
  if (
    team.substitutionsUsed >=
    MATCH.MAX_SUBSTITUTIONS
  ) {
    return false;
  }

  if (
    engine.minute < 55 ||
    engine.minute > 82
  ) {
    return false;
  }

  const candidates =
    team.players
      .filter(
        (p) =>
          !p.redCard &&
          p.position !== "GK"
      )
      .sort(
        (a, b) =>
          playerScore(a) -
          playerScore(b)
      );

  const outgoing =
    candidates[0];

  if (!outgoing) {
    return false;
  }

  const shouldSub =
    outgoing.stamina <
      48 ||
    outgoing.performance <
      outgoing.overall - 8 ||
    (
      outgoing.yellowCard &&
      Math.random() <
        0.45
    );

  if (!shouldSub) {
    return false;
  }

  const incoming =
    chooseBenchPlayer(
      team,
      outgoing
    );

  if (!incoming) {
    return false;
  }

  return performSubstitution(
    engine,
    team,
    outgoing.id,
    incoming.id,
    true
  );
}

export function performSubstitution(
  engine,
  team,
  outgoingId,
  incomingId,
  isAI = false
) {
  if (
    team.substitutionsUsed >=
    MATCH.MAX_SUBSTITUTIONS
  ) {
    return false;
  }

  const index =
    team.players.findIndex(
      (p) =>
        String(p.id) ===
        String(outgoingId)
    );

  if (index === -1) {
    return false;
  }

  const benchIndex =
    team.bench.findIndex(
      (p) =>
        String(p.id) ===
        String(incomingId)
    );

  if (
    benchIndex === -1
  ) {
    return false;
  }

  const outgoing =
    team.players[index];

  const incomingData =
    team.bench[benchIndex];

  if (
    outgoing.redCard
  ) {
    return false;
  }

  const slot = {
    x:
      outgoing.homeX,
    y:
      outgoing.homeY,
  };

  const incoming = {
    ...incomingData,

    x: outgoing.x,
    y: outgoing.y,

    homeX: slot.x,
    homeY: slot.y,

    vx: 0,
    vy: 0,

    side: team.side,

    hasBall: false,

    state: "support",

    stamina: 100,

    redCard: false,
    yellowCard: false,

    goals: 0,
    assists: 0,

    shots: 0,
    shotsOnTarget: 0,

    passes: 0,
    passesCompleted: 0,

    tackles: 0,
    interceptions: 0,
    fouls: 0,

    dribbles: 0,

    minutesPlayed: 0,

    performance:
      Number(
        incomingData.overall ??
        incomingData.rating ??
        65
      ),
  };

  if (
    outgoing.hasBall
  ) {
    outgoing.hasBall = false;

    engine.ball.ownerId =
      incoming.id;

    engine.ball.state =
      "possessed";

    incoming.hasBall = true;

    engine.ball.x =
      incoming.x;

    engine.ball.y =
      incoming.y;
  }

  team.players[index] =
    incoming;

  team.bench.splice(
    benchIndex,
    1
  );

  team.bench.push(
    outgoing
  );

  team.substitutionsUsed +=
    1;

  engine.addEvent({
    type: "substitution",
    team: team.side,
    player: incoming,
    relatedPlayer: outgoing,
    text: `${team.name}: ${incoming.name} replaces ${outgoing.name}`,
  });

  return true;
}
