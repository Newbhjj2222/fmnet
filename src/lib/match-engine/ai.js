// lib/match-engine/ai.js

import {
  FIELD,
  distance,
} from "./constants";

import {
  attemptPass,
} from "./passing";

import {
  attemptShot,
} from "./shooting";

import {
  attemptTackle,
} from "./defending";

function opponentDistance(
  player,
  opponents
) {
  return opponents.reduce(
    (nearest, opponent) =>
      Math.min(
        nearest,
        distance(
          player,
          opponent
        )
      ),
    Infinity
  );
}

function chooseAction(
  engine,
  team,
  opponents,
  player
) {
  const goal = {
    x:
      team.attackDirection === 1
        ? FIELD.width
        : 0,

    y:
      FIELD.centerY,
  };

  const goalDistance =
    distance(
      player,
      goal
    );

  const pressure =
    opponentDistance(
      player,
      opponents
    );

  const shootingChance =
    goalDistance < 430
      ? 0.28 +
        player.shooting /
          400
      : 0.02;

  const passingChance =
    pressure < 75
      ? 0.72
      : 0.55;

  const random =
    Math.random();

  if (
    goalDistance < 320 &&
    random < shootingChance
  ) {
    return "shot";
  }

  if (
    random <
    passingChance
  ) {
    return "pass";
  }

  return "dribble";
}

export function updateAI(
  engine,
  team,
  opponents,
  dt
) {
  const carrier =
    team.players.find(
      (p) =>
        p.hasBall &&
        !p.redCard
    );

  if (carrier) {
    carrier.lastActionAt += dt;

    if (
      carrier.lastActionAt >
      1.1 +
        Math.random() *
          1.6
    ) {
      const action =
        chooseAction(
          engine,
          team,
          opponents,
          carrier
        );

      if (action === "shot") {
        if (
          attemptShot(
            engine,
            team,
            opponents,
            carrier
          )
        ) {
          carrier.lastActionAt = 0;
        }
      } else if (
        action === "pass"
      ) {
        if (
          attemptPass(
            engine,
            team,
            opponents,
            carrier
          )
        ) {
          carrier.lastActionAt = 0;
        }
      } else {
        const direction =
          team.attackDirection;

        carrier.x +=
          direction *
          10 *
          dt;

        carrier.lastActionAt = 0;

        team.stats.dribbles += 1;
        carrier.dribbles += 1;

        engine.addEvent({
          type: "dribble",
          team: team.side,
          player: carrier,
          text: `${carrier.name} drives forward with the ball`,
        });
      }
    }
  }

  const opponentCarrier =
    opponents.players.find(
      (p) =>
        p.hasBall &&
        !p.redCard
    );

  if (opponentCarrier) {
    const nearest =
      team.players
        .filter(
          (p) =>
            !p.redCard &&
            p.position !== "GK"
        )
        .sort(
          (a, b) =>
            distance(
              a,
              opponentCarrier
            ) -
            distance(
              b,
              opponentCarrier
            )
        )[0];

    if (nearest) {
      const d =
        distance(
          nearest,
          opponentCarrier
        );

      const pressRange =
        team.tactics.pressing ===
        "high"
          ? 170
          : team.tactics.pressing ===
            "low"
          ? 75
          : 115;

      if (
        d <
        pressRange
      ) {
        nearest.state =
          "press";
      }

      if (
        d < 28 &&
        Math.random() <
          0.08 *
            (team.tactics.pressing ===
            "high"
              ? 1.5
              : 1)
      ) {
        attemptTackle(
          engine,
          nearest,
          opponentCarrier,
          team
        );
      }
    }
  }
}
