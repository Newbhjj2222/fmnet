import MatchState from "./MatchState";
import Player from "./Player";
import Ball from "./Ball";
import {
  MATCH,
  TEAM_SIDE,
  PITCH,
} from "./constants";
import {
  getFormationPosition,
} from "./Formation";
import {
  separatePlayers,
} from "./Movement";

export default class MatchEngine {
  constructor({
    homeTeam,
    awayTeam,
  }) {
    this.state =
      new MatchState(
        homeTeam,
        awayTeam
      );

    this.fixedStep =
      1 / MATCH.simulationFPS;

    this.accumulator = 0;

    this.running = false;

    this.createPlayers();

    this.state.ball =
      new Ball();
  }

  createPlayers() {
    const teams = [
      {
        ...this.state.homeTeam,
        side: TEAM_SIDE.HOME,
      },

      {
        ...this.state.awayTeam,
        side: TEAM_SIDE.AWAY,
      },
    ];

    teams.forEach(team => {
      const players =
        team.players.slice(0, 11);

      players.forEach(
        (data, index) => {
          const formationPosition =
            getFormationPosition(
              team.formation ||
                MATCH.defaultFormation,

              index,

              team.side
            );

          const player =
            new Player({
              ...data,

              id:
                data.id ||
                `${team.side}-${index + 1}`,

              teamId:
                team.id,

              teamSide:
                team.side,

              x:
                formationPosition.x,

              y:
                formationPosition.y,

              position:
                formationPosition.role ||
                data.position,
            });

          player.homeX =
            formationPosition.x;

          player.homeY =
            formationPosition.y;

          this.state.players.push(
            player
          );
        }
      );
    });
  }

  start() {
    if (this.state.status === "finished") {
      return;
    }

    this.state.status = "playing";
    this.running = true;
  }

  pause() {
    this.running = false;

    if (
      this.state.status ===
      "playing"
    ) {
      this.state.status =
        "paused";
    }
  }

  resume() {
    if (
      this.state.status ===
      "paused"
    ) {
      this.state.status =
        "playing";

      this.running = true;
    }
  }

  stop() {
    this.running = false;

    this.state.status =
      "finished";
  }

  update(deltaTime) {
    if (!this.running) {
      return;
    }

    this.accumulator += deltaTime;

    while (
      this.accumulator >=
      this.fixedStep
    ) {
      this.fixedUpdate(
        this.fixedStep
      );

      this.accumulator -=
        this.fixedStep;
    }
  }

  fixedUpdate(dt) {
    this.state.time += dt;

    if (
      this.state.time >=
      90 * 60
    ) {
      this.state.time =
        90 * 60;

      this.stop();

      return;
    }

    this.updatePlayers(dt);

    this.updateBall(dt);

    separatePlayers(
      this.state.players
    );

    this.updateSimpleBallAttraction();

    this.checkPossession();
  }

  updatePlayers(dt) {
    this.state.players.forEach(
      player => {
        const target =
          this.getPlayerTarget(
            player
          );

        player.setTarget(
          target.x,
          target.y
        );

        player.update(dt);
      }
    );
  }

  getPlayerTarget(player) {
    const ball =
      this.state.ball;

    if (!ball) {
      return {
        x: player.homeX,
        y: player.homeY,
      };
    }

    const ballX =
      ball.position.x;

    const ballY =
      ball.position.y;

    const distance =
      Math.sqrt(
        Math.pow(
          ballX - player.x,
          2
        ) +
        Math.pow(
          ballY - player.y,
          2
        )
      );

    /*
     * Nearest players move more
     * toward the ball.
     *
     * This is deliberately only
     * the foundation for Phase 2.
     */
    const isClosest =
      this.isClosestPlayerToBall(
        player
      );

    if (
      isClosest &&
      distance < 280
    ) {
      return {
        x: ballX,
        y: ballY,
      };
    }

    /*
     * Other players preserve
     * their tactical positions.
     */
    const ballOffsetX =
      (ballX -
        PITCH.width / 2) *
      0.15;

    const ballOffsetY =
      (ballY -
        PITCH.height / 2) *
      0.12;

    let targetX =
      player.homeX +
      ballOffsetX;

    let targetY =
      player.homeY +
      ballOffsetY;

    /*
     * Attackers can move a little
     * more toward opponent goal.
     */
    if (player.position === "ST") {
      const attackDirection =
        player.teamSide ===
        TEAM_SIDE.HOME
          ? 1
          : -1;

      targetX +=
        attackDirection * 25;
    }

    return {
      x: targetX,
      y: targetY,
    };
  }

  isClosestPlayerToBall(player) {
    const ball =
      this.state.ball;

    if (!ball) {
      return false;
    }

    const teammates =
      this.state.players.filter(
        p =>
          p.teamSide ===
          player.teamSide
      );

    let closest =
      null;

    let closestDistance =
      Infinity;

    teammates.forEach(
      teammate => {
        const distance =
          Math.sqrt(
            Math.pow(
              teammate.x -
                ball.position.x,
              2
            ) +
            Math.pow(
              teammate.y -
                ball.position.y,
              2
            )
          );

        if (
          distance <
          closestDistance
        ) {
          closestDistance =
            distance;

          closest =
            teammate;
        }
      }
    );

    return closest?.id ===
      player.id;
  }

  updateBall(dt) {
    this.state.ball.update(
      dt,
      this.state.players
    );
  }

  updateSimpleBallAttraction() {
    const ball =
      this.state.ball;

    if (
      ball.ownerId
    ) {
      return;
    }

    let closest =
      null;

    let closestDistance =
      Infinity;

    this.state.players.forEach(
      player => {
        const distance =
          Math.sqrt(
            Math.pow(
              player.x -
                ball.position.x,
              2
            ) +
            Math.pow(
              player.y -
                ball.position.y,
              2
            )
          );

        if (
          distance <
          closestDistance
        ) {
          closestDistance =
            distance;

          closest =
            player;
        }
      }
    );

    /*
     * Only very close players
     * can collect a free ball.
     */
    if (
      closest &&
      closestDistance <
        26
    ) {
      this.giveBallToPlayer(
        closest
      );
    }
  }

  checkPossession() {
    const ball =
      this.state.ball;

    if (
      ball.ownerId
    ) {
      return;
    }

    this.state.players.forEach(
      player => {
        const distance =
          Math.sqrt(
            Math.pow(
              player.x -
                ball.position.x,
              2
            ) +
            Math.pow(
              player.y -
                ball.position.y,
              2
            )
          );

        if (
          distance <
          player.radius +
            ball.radius +
            3
        ) {
          this.giveBallToPlayer(
            player
          );
        }
      }
    );
  }

  giveBallToPlayer(player) {
    this.state.players.forEach(
      p => {
        p.hasBall = false;
      }
    );

    player.hasBall = true;

    player.state =
      "possessed";

    this.state.ball.attachTo(
      player
    );
  }

  getSnapshot() {
    return {
      status:
        this.state.status,

      time:
        this.state.time,

      homeScore:
        this.state.homeScore,

      awayScore:
        this.state.awayScore,

      players:
        this.state.players.map(
          player => ({
            id: player.id,
            teamId:
              player.teamId,

            teamSide:
              player.teamSide,

            number:
              player.number,

            name:
              player.name,

            position:
              player.position,

            x:
              player.x,

            y:
              player.y,

            hasBall:
              player.hasBall,

            stamina:
              player.stamina,
          })
        ),

      ball: {
        x:
          this.state.ball.position.x,

        y:
          this.state.ball.position.y,

        ownerId:
          this.state.ball.ownerId,

        state:
          this.state.ball.state,
      },

      events:
        this.state.events,
    };
  }
}
