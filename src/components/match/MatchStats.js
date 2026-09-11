// components/match/MatchStats.js

import styles from "./MatchStats.module.css";

export default function MatchStats({
  home,
  away,
}) {
  if (!home || !away) {
    return null;
  }

  const possessionTotal =
    home.possessionSeconds +
    away.possessionSeconds;

  const homePossession =
    possessionTotal > 0
      ? Math.round(
          (home.possessionSeconds /
            possessionTotal) *
            100
        )
      : 50;

  const awayPossession =
    100 -
    homePossession;

  const rows = [
    [
      "Possession",
      `${homePossession}%`,
      `${awayPossession}%`,
    ],

    [
      "Shots",
      home.shots,
      away.shots,
    ],

    [
      "Shots on target",
      home.shotsOnTarget,
      away.shotsOnTarget,
    ],

    [
      "Passes",
      home.passes,
      away.passes,
    ],

    [
      "Completed passes",
      home.passesCompleted,
      away.passesCompleted,
    ],

    [
      "Tackles",
      home.tackles,
      away.tackles,
    ],

    [
      "Interceptions",
      home.interceptions,
      away.interceptions,
    ],

    [
      "Fouls",
      home.fouls,
      away.fouls,
    ],

    [
      "Corners",
      home.corners,
      away.corners,
    ],

    [
      "Offsides",
      home.offsides,
      away.offsides,
    ],

    [
      "Yellow cards",
      home.yellowCards,
      away.yellowCards,
    ],

    [
      "Saves",
      home.saves,
      away.saves,
    ],

    [
      "xG",
      Number(home.xG || 0).toFixed(
        2
      ),
      Number(away.xG || 0).toFixed(
        2
      ),
    ],
  ];

  return (
    <section
      className={styles.panel}
    >
      <div
        className={styles.heading}
      >
        <strong>
          {home.name}
        </strong>

        <span>
          Statistics
        </span>

        <strong>
          {away.name}
        </strong>
      </div>

      {rows.map(
        (row) => (
          <div
            className={styles.row}
            key={row[0]}
          >
            <strong>
              {row[1]}
            </strong>

            <span>
              {row[0]}
            </span>

            <strong>
              {row[2]}
            </strong>
          </div>
        )
      )}
    </section>
  );
}
