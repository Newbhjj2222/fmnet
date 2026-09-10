import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Head from "next/head";

import MatchEngine from "../../lib/match-engine/MatchEngine";
import MatchCanvas from "../../components/match/MatchCanvas";

import styles from "./Mach.module.css";

function createPlayers(
  teamSide,
  teamName
) {
  const positions = [
    "GK",
    "LB",
    "CB",
    "CB",
    "RB",
    "CM",
    "CM",
    "CM",
    "LW",
    "ST",
    "RW",
  ];

  const names = [
    "Goalkeeper",
    "Left Back",
    "Centre Back",
    "Centre Back",
    "Right Back",
    "Midfielder",
    "Midfielder",
    "Midfielder",
    "Left Wing",
    "Striker",
    "Right Wing",
  ];

  return positions.map(
    (position, index) => ({
      id:
        `${teamSide}-${index + 1}`,

      number:
        index + 1,

      name:
        `${teamName} ${names[index]}`,

      position,

      speed:
        68 +
        Math.floor(
          Math.random() * 20
        ),

      acceleration:
        65 +
        Math.floor(
          Math.random() * 25
        ),

      stamina:
        85 +
        Math.floor(
          Math.random() * 15
        ),

      passing:
        65 +
        Math.floor(
          Math.random() * 30
        ),

      shooting:
        60 +
        Math.floor(
          Math.random() * 35
        ),

      dribbling:
        60 +
        Math.floor(
          Math.random() * 35
        ),

      tackling:
        60 +
        Math.floor(
          Math.random() * 35
        ),

      positioning:
        65 +
        Math.floor(
          Math.random() * 30
        ),

      vision:
        65 +
        Math.floor(
          Math.random() * 30
        ),

      decisionMaking:
        65 +
        Math.floor(
          Math.random() * 30
        ),

      composure:
        65 +
        Math.floor(
          Math.random() * 30
        ),

      reaction:
        70 +
        Math.floor(
          Math.random() * 25
        ),

      handling:
        65 +
        Math.floor(
          Math.random() * 30
        ),

      diving:
        65 +
        Math.floor(
          Math.random() * 30
        ),
    })
  );
}

function createTeam(
  side,
  name
) {
  return {
    id:
      `${side}-team`,

    name,

    side,

    formation: "4-3-3",

    players:
      createPlayers(
        side,
        name
      ),

    substitutes: [
      {
        number: 12,
        name: "Reserve GK",
        position: "GK",
      },
      {
        number: 13,
        name: "Reserve Defender",
        position: "CB",
      },
      {
        number: 14,
        name: "Reserve Defender",
        position: "RB",
      },
      {
        number: 15,
        name: "Reserve Midfielder",
        position: "CM",
      },
      {
        number: 16,
        name: "Reserve Midfielder",
        position: "CM",
      },
      {
        number: 17,
        name: "Reserve Forward",
        position: "ST",
      },
      {
        number: 18,
        name: "Reserve Forward",
        position: "ST",
      },
    ],

    coach:
      side === "home"
        ? "Home Coach"
        : "Away Coach",
  };
}

export default function MatchPage({
  matchId,
}) {
  const [engine, setEngine] =
    useState(null);

  const [
    status,
    setStatus,
  ] = useState(
    "not_started"
  );

  const [
    score,
    setScore,
  ] = useState(
    "0 - 0"
  );

  const [
    minute,
    setMinute,
  ] = useState(0);

  const [
    ballOwner,
    setBallOwner,
  ] = useState(null);

  const homeTeam =
    useMemo(
      () =>
        createTeam(
          "home",
          "New Talents FC"
        ),
      []
    );

  const awayTeam =
    useMemo(
      () =>
        createTeam(
          "away",
          "Kigali United"
        ),
      []
    );

  useEffect(() => {
    const newEngine =
      new MatchEngine({
        homeTeam,
        awayTeam,
      });

    setEngine(
      newEngine
    );

    return () => {
      newEngine.stop();
    };
  }, [
    homeTeam,
    awayTeam,
  ]);

  useEffect(() => {
    if (!engine) {
      return;
    }

    const interval =
      setInterval(() => {
        const snapshot =
          engine.getSnapshot();

        setStatus(
          snapshot.status
        );

        setScore(
          `${snapshot.homeScore} - ${snapshot.awayScore}`
        );

        setMinute(
          Math.floor(
            snapshot.time /
              60
          )
        );

        const owner =
          snapshot.players.find(
            player =>
              player.hasBall
          );

        setBallOwner(
          owner || null
        );
      }, 100);

    return () => {
      clearInterval(
        interval
      );
    };
  }, [engine]);

  const startMatch = () => {
    if (!engine) {
      return;
    }

    engine.start();

    setStatus(
      "playing"
    );
  };

  const pauseMatch = () => {
    if (!engine) {
      return;
    }

    engine.pause();

    setStatus(
      "paused"
    );
  };

  const resumeMatch = () => {
    if (!engine) {
      return;
    }

    engine.resume();

    setStatus(
      "playing"
    );
  };

  const stopMatch = () => {
    if (!engine) {
      return;
    }

    engine.stop();

    setStatus(
      "finished"
    );
  };

  const formatMinute = () => {
    const minuteValue =
      Math.floor(
        minute
      );

    const display =
      Math.min(
        minuteValue,
        90
      );

    return `${display}'`;
  };

  return (
    <>
      <Head>
        <title>
          2D Match Engine | New Talents
        </title>

        <meta
          name="description"
          content="Real-time 2D football match simulation engine."
        />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        <section
          className={
            styles.header
          }
        >
          <div>
            <span
              className={
                styles.eyebrow
              }
            >
              VIRTUAL FOOTBALL MANAGER
            </span>

            <h1>
              2D Match Engine
            </h1>

            <p>
              Match ID:{" "}
              {matchId}
            </p>
          </div>

          <div
            className={
              styles.scoreBox
            }
          >
            <span>
              {formatMinute()}
            </span>

            <strong>
              {score}
            </strong>

            <small>
              {status}
            </small>
          </div>
        </section>

        <section
          className={
            styles.matchArea
          }
        >
          <div
            className={
              styles.pitchWrapper
            }
          >
            {engine ? (
              <MatchCanvas
                engine={
                  engine
                }
              />
            ) : (
              <div
                className={
                  styles.loading
                }
              >
                Loading engine...
              </div>
            )}
          </div>

          <aside
            className={
              styles.sidebar
            }
          >
            <div
              className={
                styles.teamCard
              }
            >
              <div
                className={
                  styles.teamHeader
                }
              >
                <span
                  className={
                    styles.homeDot
                  }
                />

                <strong>
                  {homeTeam.name}
                </strong>
              </div>

              <div
                className={
                  styles.teamMeta
                }
              >
                Formation:{" "}
                {homeTeam.formation}
              </div>

              <div
                className={
                  styles.bench
                }
              >
                <h3>
                  Substitutes
                </h3>

                {homeTeam.substitutes.map(
                  player => (
                    <div
                      key={
                        player.number
                      }
                      className={
                        styles.benchPlayer
                      }
                    >
                      <span>
                        {
                          player.number
                        }
                      </span>

                      <label>
                        {
                          player.name
                        }
                      </label>
                    </div>
                  )
                )}
              </div>

              <div
                className={
                  styles.coach
                }
              >
                <span>
                  COACH
                </span>

                <strong>
                  {
                    homeTeam.coach
                  }
                </strong>
              </div>
            </div>

            <div
              className={
                styles.teamCard
              }
            >
              <div
                className={
                  styles.teamHeader
                }
              >
                <span
                  className={
                    styles.awayDot
                  }
                />

                <strong>
                  {awayTeam.name}
                </strong>
              </div>

              <div
                className={
                  styles.teamMeta
                }
              >
                Formation:{" "}
                {awayTeam.formation}
              </div>

              <div
                className={
                  styles.bench
                }
              >
                <h3>
                  Substitutes
                </h3>

                {awayTeam.substitutes.map(
                  player => (
                    <div
                      key={
                        player.number
                      }
                      className={
                        styles.benchPlayer
                      }
                    >
                      <span>
                        {
                          player.number
                        }
                      </span>

                      <label>
                        {
                          player.name
                        }
                      </label>
                    </div>
                  )
                )}
              </div>

              <div
                className={
                  styles.coach
                }
              >
                <span>
                  COACH
                </span>

                <strong>
                  {
                    awayTeam.coach
                  }
                </strong>
              </div>
            </div>

            <div
              className={
                styles.controlCard
              }
            >
              <h3>
                Match Controls
              </h3>

              <div
                className={
                  styles.controls
                }
              >
                {status ===
                "not_started" ? (
                  <button
                    onClick={
                      startMatch
                    }
                    className={
                      styles.primaryButton
                    }
                  >
                    ▶ Start Match
                  </button>
                ) : null}

                {status ===
                "playing" ? (
                  <button
                    onClick={
                      pauseMatch
                    }
                    className={
                      styles.secondaryButton
                    }
                  >
                    ⏸ Pause
                  </button>
                ) : null}

                {status ===
                "paused" ? (
                  <button
                    onClick={
                      resumeMatch
                    }
                    className={
                      styles.primaryButton
                    }
                  >
                    ▶ Resume
                  </button>
                ) : null}

                {status !==
                  "finished" &&
                status !==
                  "not_started" ? (
                  <button
                    onClick={
                      stopMatch
                    }
                    className={
                      styles.dangerButton
                    }
                  >
                    ■ Stop
                  </button>
                ) : null}
              </div>
            </div>

            <div
              className={
                styles.possessionCard
              }
            >
              <span>
                BALL POSSESSION
              </span>

              <strong>
                {ballOwner
                  ? `${ballOwner.teamSide === "home"
                      ? homeTeam.name
                      : awayTeam.name
                    } #${ballOwner.number}`
                  : "Free Ball"}
              </strong>
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}

export async function getServerSideProps(
  context
) {
  const {
    id,
  } = context.params;

  return {
    props: {
      matchId:
        String(id),
    },
  };
}
