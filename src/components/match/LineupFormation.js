// components/match/LineupFormation.js

import styles from "./LineupFormation.module.css";

export default function LineupFormation({
  team,
  editable = false,
  players = [],
  onPlayerChange,
}) {
  if (!team) {
    return null;
  }

  const formation =
    team.formation ||
    "4-4-2";

  return (
    <section
      className={styles.container}
    >
      <div
        className={styles.header}
      >
        <div>
          <h3>
            {team.name}
          </h3>

          <span>
            {formation}
          </span>
        </div>

        <strong>
          XI
        </strong>
      </div>

      <div
        className={styles.pitch}
      >
        <div
          className={
            styles.centerLine
          }
        />

        <div
          className={
            styles.centerCircle
          }
        />

        {team.players?.map(
          (player) => (
            <div
              key={player.id}
              className={
                styles.player
              }
              style={{
                left:
                  `${Math.min(
                    94,
                    Math.max(
                      6,
                      (player.homeX ??
                        0.5) *
                        100
                    )
                  )}%`,

                top:
                  `${Math.min(
                    94,
                    Math.max(
                      6,
                      (player.homeY ??
                        0.5) *
                        100
                    )
                  )}%`,
              }}
            >
              <div
                className={
                  styles.number
                }
              >
                {player.number}
              </div>

              <div
                className={
                  styles.name
                }
              >
                {player.shortName ||
                  player.name}
              </div>

              <div
                className={
                  styles.rating
                }
              >
                {player.overall}
              </div>
            </div>
          )
        )}
      </div>

      {editable &&
        players.length > 0 && (
          <div
            className={
              styles.editor
            }
          >
            {team.players.map(
              (player) => (
                <div
                  key={player.id}
                  className={
                    styles.row
                  }
                >
                  <div
                    className={
                      styles.playerInfo
                    }
                  >
                    <strong>
                      #{player.number}
                    </strong>

                    <span>
                      {player.name}
                    </span>

                    <small>
                      {player.position} ·{" "}
                      {player.overall}
                    </small>
                  </div>

                  <select
                    value={
                      player.id
                    }
                    onChange={(e) =>
                      onPlayerChange?.(
                        player.id,
                        e.target.value
                      )
                    }
                    className={
                      styles.select
                    }
                  >
                    {players.map(
                      (option) => (
                        <option
                          key={
                            option.id
                          }
                          value={
                            option.id
                          }
                        >
                          #
                          {
                            option.shirtNumber ??
                            option.jerseyNumber ??
                            option.number ??
                            ""
                          }{" "}
                          {option.name}{" "}
                          ({option.overall ??
                            option.rating ??
                            60})
                        </option>
                      )
                    )}
                  </select>
                </div>
              )
            )}
          </div>
        )}
    </section>
  );
}
