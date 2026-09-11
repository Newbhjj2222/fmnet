// lib/match-engine/defending.js

import {
  EVENTS,
  distance,
  clamp,
} from "./constants";

export function findPressingPlayer(
  defendingTeam,
  attacker
) {
  let best = null;
  let bestDistance =
    Infinity;

  for (const player of defendingTeam.players) {
    if (
      player.redCard ||
      player.position === "GK"
    ) {
      continue;
    }

    const d =
      distance(
        player,
        attacker
      );

    if (
      d < bestDistance
    ) {
      bestDistance = d;
      best = player;
    }
  }

  return best;
}

export function attemptTackle(
  engine,
  defender,
  attacker,
  defendingTeam
) {
  if (
    !defender ||
    !attacker ||
    defender.redCard ||
    attacker.redCard
  ) {
    return false;
  }

  const d =
    distance(
      defender,
      attacker
    );

  if (d > 28) {
    return false;
  }

  const staminaFactor =
    defender.stamina /
    100;

  const tackleQuality =
    defender.tackling *
    0.55 +
    defender.positioning *
      0.20 +
    defender.strength *
      0.10 +
    defender.decisionMaking *
      0.15;

  const dribbleQuality =
    attacker.dribbling *
    0.55 +
    attacker.strength *
      0.20 +
    attacker.pace *
      0.25;

  const chance =
    clamp(
      0.38 +
        (tackleQuality -
          dribbleQuality) /
          250 +
        staminaFactor *
          0.12,
      0.12,
      0.82
    );

  if (
    Math.random() <
    chance
  ) {
    defender.tackles += 1;
    defendingTeam.stats.tackles += 1;

    attacker.hasBall = false;

    engine.ball.ownerId =
      defender.id;

    engine.ball.state =
      "possessed";

    engine.ball.x =
      defender.x;

    engine.ball.y =
      defender.y;

    defender.hasBall = true;

    engine.addEvent({
      type: EVENTS.TACKLE,
      team: defendingTeam.side,
      player: defender,
      relatedPlayer: attacker,
      text: `${defender.name} wins the ball from ${attacker.name}`,
    });

    return true;
  }

  const foulChance =
    clamp(
      0.035 +
        (70 -
          defender.tackling) /
          1500,
      0.015,
      0.09
    );

  if (
    Math.random() <
    foulChance
  ) {
    defender.fouls += 1;
    defendingTeam.stats.fouls += 1;

    engine.ball.ownerId =
      null;

    engine.ball.state =
      "free";

    engine.addEvent({
      type: EVENTS.FOUL,
      team: defendingTeam.side,
      player: defender,
      relatedPlayer: attacker,
      text: `${defender.name} fouls ${attacker.name}`,
    });

    if (
      Math.random() <
      0.18
    ) {
      defender.yellowCard = true;

      defendingTeam.stats.yellowCards += 1;

      engine.addEvent({
        type: EVENTS.YELLOW,
        team: defendingTeam.side,
        player: defender,
        text: `${defender.name} receives a yellow card`,
      });
    }

    return true;
  }

  return false;
}

export function attemptInterception(
  engine,
  defender,
  receiver,
  defendingTeam
) {
  if (
    !defender ||
    !receiver
  ) {
    return false;
  }

  const d =
    distance(
      defender,
      receiver
    );

  if (d > 32) {
    return false;
  }

  const chance =
    clamp(
      0.12 +
        defender.positioning /
          500 +
        defender.tackling /
          700 -
        receiver.passing /
          800,
      0.05,
      0.5
    );

  if (
    Math.random() <
    chance
  ) {
    defender.interceptions += 1;

    defendingTeam.stats.interceptions +=
      1;

    engine.ball.ownerId =
      defender.id;

    engine.ball.state =
      "possessed";

    receiver.hasBall = false;
    defender.hasBall = true;

    engine.addEvent({
      type: EVENTS.INTERCEPTION,
      team: defendingTeam.side,
      player: defender,
      relatedPlayer: receiver,
      text: `${defender.name} intercepts the pass`,
    });

    return true;
  }

  return false;
}
