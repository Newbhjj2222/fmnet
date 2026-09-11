// components/match/SubstitutionPanel.js

import styles from "./SubstitutionPanel.module.css";

export default function SubstitutionPanel({
  team,
  onSubstitute,
  disabled = false,
}) {
  if (!team) return null;

  const used =
    team.substitutionsUsed || 0;

  const remaining =
    Math.max(
      0,
      5 - used
    );

  return (
    <section
      className={styles.panel}
    >
      <div
        className={styles.header}
      >
        <div>
          <h3>
            Substitutions
          </h3>

          <span>
            {remaining} remaining
          </span>
        </div>
      </div>

      {team.players
        ?.filter(
          (player) =>
            player.position !==
            "GK" &&
            !player.redCard
        )
        .map(
          (player) => (
            <div
              key={player.id}
              className={
                styles.player
              }
            >
              <div
                className={
                  styles.info
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
                  {player.overall} ·{" "}
                  stamina{" "}
                  {Math.round(
                    player.stamina
                  )}
                </small>
              </div>

              <select
                disabled={
                  disabled ||
                  remaining === 0
                }
                defaultValue=""
                onChange={(e) => {
                  if (
                    e.target.value
                  ) {
                    onSubstitute?.(
                      player.id,
                      e.target.value
                    );

                    e.target.value =
                      "";
                  }
                }}
              >
                <option value="">
                  Sub
                </option>

                {team.bench?.map(
                  (bench) => (
                    <option
                      key={
                        bench.id
                      }
                      value={
                        bench.id
                      }
                    >
                      #
                      {
                        bench.shirtNumber ??
                        bench.jerseyNumber ??
                        bench.number ??
                        ""
                      }{" "}
                      {bench.name}{" "}
                      (
                      {bench.overall ??
                        bench.rating ??
                        60}
                      )
                    </option>
                  )
                )}
              </select>
            </div>
          )
        )}
    </section>
  );
}
