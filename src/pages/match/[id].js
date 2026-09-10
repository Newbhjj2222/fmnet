import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Head from "next/head";
import { useRouter } from "next/router";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../components/firebase";
import { useAuth } from "../../context/AuthContext";

import MatchEngine from "../../lib/match-engine/MatchEngine";
import MatchCanvas from "../../components/match/MatchCanvas";

import {
  MATCH_STATUS,
} from "../../lib/match-engine/constants";

import styles from "./Mach.module.css";

export default function MatchPage() {
  const router =
    useRouter();

  const { id } =
    router.query;

  const {
    user,
    loading:
      authLoading,
  } = useAuth();

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  const [
    match,
    setMatch,
  ] = useState(null);

  const [
    homeClub,
    setHomeClub,
  ] = useState(null);

  const [
    awayClub,
    setAwayClub,
  ] = useState(null);

  const [
    engine,
    setEngine,
  ] = useState(null);

  const [
    snapshot,
    setSnapshot,
  ] = useState(null);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const engineRef =
    useRef(null);

  const lastSaveRef =
    useRef(0);

  const loadPlayers =
    useCallback(
      async clubId => {
        if (!clubId) {
          return [];
        }

        const playersRef =
          collection(
            db,
            "players"
          );

        const queries = [
          query(
            playersRef,
            where(
              "clubId",
              "==",
              clubId
            )
          ),

          query(
            playersRef,
            where(
              "currentClub",
              "==",
              clubId
            )
          ),

          query(
            playersRef,
            where(
              "teamId",
              "==",
              clubId
            )
          ),
        ];

        const snapshots =
          await Promise.all(
            queries.map(
              async q => {
                try {
                  return await getDocs(
                    q
                  );
                } catch {
                  return null;
                }
              }
            )
          );

        const unique =
          new Map();

        snapshots.forEach(
          snap => {
            if (!snap) {
              return;
            }

            snap.docs.forEach(
              playerDoc => {
                unique.set(
                  playerDoc.id,
                  {
                    id:
                      playerDoc.id,
                    ...playerDoc.data(),
                  }
                );
              }
            );
          }
        );

        return Array.from(
          unique.values()
        );
      },
      []
    );

  const loadMatch =
    useCallback(
      async () => {
        if (
          authLoading ||
          !id
        ) {
          return;
        }

        try {
          setLoading(
            true
          );

          setError("");

          const matchRef =
            doc(
              db,
              "matches",
              String(id)
            );

          const matchSnap =
            await getDoc(
              matchRef
            );

          if (
            !matchSnap.exists()
          ) {
            throw new Error(
              "Match not found."
            );
          }

          const matchData = {
            id:
              matchSnap.id,
            ...matchSnap.data(),
          };

          const [
            homeSnap,
            awaySnap,
          ] =
            await Promise.all(
              [
                matchData.homeClubId
                  ? getDoc(
                      doc(
                        db,
                        "clubs",
                        matchData.homeClubId
                      )
                    )
                  : null,

                matchData.awayClubId
                  ? getDoc(
                      doc(
                        db,
                        "clubs",
                        matchData.awayClubId
                      )
                    )
                  : null,
              ]
            );

          const home =
            homeSnap?.exists()
              ? {
                  id:
                    homeSnap.id,
                  ...homeSnap.data(),
                }
              : {
                  id:
                    matchData.homeClubId,
                  name:
                    matchData.homeClubName ||
                    "Home",
                };

          const away =
            awaySnap?.exists()
              ? {
                  id:
                    awaySnap.id,
                  ...awaySnap.data(),
                }
              : {
                  id:
                    matchData.awayClubId,
                  name:
                    matchData.awayClubName ||
                    "Away",
                };

          const [
            homePlayers,
            awayPlayers,
          ] =
            await Promise.all(
              [
                loadPlayers(
                  home.id
                ),

                loadPlayers(
                  away.id
                ),
              ]
            );

          if (
            homePlayers.length <
            11
          ) {
            throw new Error(
              `${home.name} does not have enough players.`
            );
          }

          if (
            awayPlayers.length <
            11
          ) {
            throw new Error(
              `${away.name} does not have enough players.`
            );
          }

          const newEngine =
            new MatchEngine({
              match:
                matchData,

              homeClub:
                home,

              awayClub:
                away,

              homePlayers,

              awayPlayers,
            });

          engineRef.current =
            newEngine;

          setEngine(
            newEngine
          );

          setMatch(
            matchData
          );

          setHomeClub(
            home
          );

          setAwayClub(
            away
          );

          setSnapshot(
            newEngine.getSnapshot()
          );
        } catch (
          loadError
        ) {
          console.error(
            "MATCH LOAD ERROR:",
            loadError
          );

          setError(
            loadError?.message ||
              "Failed to load match."
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        id,
        authLoading,
        loadPlayers,
      ]
    );

  useEffect(() => {
    loadMatch();

    return () => {
      engineRef.current?.stop();
      engineRef.current =
        null;
    };
  }, [
    loadMatch,
  ]);

  const saveMatch =
    useCallback(
      async (
        force = false
      ) => {
        const current =
          engineRef.current;

        if (
          !current ||
          !match?.id
        ) {
          return;
        }

        const now =
          Date.now();

        if (
          !force &&
          now -
            lastSaveRef.current <
            10000
        ) {
          return;
        }

        lastSaveRef.current =
          now;

        try {
          setSaving(
            true
          );

          const data =
            current.getSnapshot();

          await updateDoc(
            doc(
              db,
              "matches",
              match.id
            ),
            {
              status:
                data.status,

              minute:
                data.minute,

              homeScore:
                data.homeScore,

              awayScore:
                data.awayScore,

              result: {
                homeScore:
                  data.homeScore,

                awayScore:
                  data.awayScore,
              },

              events:
                data.events,

              homeStats:
                data.homeStats,

              awayStats:
                data.awayStats,

              homeFormation:
                data.homeFormation,

              awayFormation:
                data.awayFormation,

              homeTactics:
                data.homeTactics,

              awayTactics:
                data.awayTactics,

              homeLineupIds:
                current.homeXI.map(
                  player =>
                    player.id
                ),

              awayLineupIds:
                current.awayXI.map(
                  player =>
                    player.id
                ),

              homeSubsUsed:
                data.substitutions
                  .home,

              awaySubsUsed:
                data.substitutions
                  .away,

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (
          saveError
        ) {
          console.error(
            "MATCH SAVE ERROR:",
            saveError
          );
        } finally {
          setSaving(
            false
          );
        }
      },
      [match]
    );

  useEffect(() => {
    if (
      !engine
    ) {
      return;
    }

    const timer =
      setInterval(() => {
        const data =
          engine.getSnapshot();

        setSnapshot(
          data
        );

        if (
          data.status ===
          MATCH_STATUS.FINISHED
        ) {
          saveMatch(
            true
          );
        } else {
          saveMatch(
            false
          );
        }
      }, 250);

    return () => {
      clearInterval(
        timer
      );
    };
  }, [
    engine,
    saveMatch,
  ]);

  const startMatch =
    () => {
      if (
        !engine
      ) {
        return;
      }

      engine.start();

      saveMatch(
        true
      );
    };

  const pauseMatch =
    () => {
      engine?.pause();

      saveMatch(
        true
      );
    };

  const resumeMatch =
    () => {
      engine?.resume();

      saveMatch(
        true
      );
    };

  const stopMatch =
    () => {
      engine?.stop();

      saveMatch(
        true
      );
    };

  const score =
    snapshot
      ? `${snapshot.homeScore} - ${snapshot.awayScore}`
      : "0 - 0";

  const minute =
    snapshot?.minute ??
    0;

  const status =
    snapshot?.status ||
    "loading";

  const ballOwner =
    useMemo(() => {
      if (
        !snapshot
      ) {
        return null;
      }

      return (
        snapshot.players.find(
          player =>
            player.hasBall
        ) || null
      );
    }, [
      snapshot,
    ]);

  const recentEvents =
    useMemo(
      () =>
        snapshot?.events?.slice(
          0,
          8
        ) || [],
      [snapshot]
    );

  if (
    authLoading ||
    loading
  ) {
    return (
      <main
        className={
          styles.loadingPage
        }
      >
        <div
          className={
            styles.spinner
          }
        />

        <h2>
          Loading Match Engine
        </h2>

        <p>
          Loading clubs,
          players and
          match intelligence...
        </p>
      </main>
    );
  }

  if (
    error
  ) {
    return (
      <main
        className={
          styles.errorPage
        }
      >
        <div
          className={
            styles.errorIcon
          }
        >
          ⚠️
        </div>

        <h1>
          Match Error
        </h1>

        <p>
          {error}
        </p>

        <button
          onClick={() =>
            router.push(
              "/fixtures"
            )
          }
          className={
            styles.primaryButton
          }
        >
          ← Back to Fixtures
        </button>
      </main>
    );
  }

  if (
    !engine ||
    !snapshot ||
    !homeClub ||
    !awayClub
  ) {
    return null;
  }

  return (
    <>
      <Head>
        <title>
          {homeClub.name} vs{" "}
          {awayClub.name} |
          Match Centre
        </title>

        <meta
          name="theme-color"
          content="#050816"
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
        <header
          className={
            styles.header
          }
        >
          <button
            className={
              styles.backButton
            }
            onClick={() =>
              router.push(
                "/fixtures"
              )
            }
          >
            ← Fixtures
          </button>

          <div
            className={
              styles.headerTitle
            }
          >
            <span>
              {match?.leagueName ||
                match?.competition ||
                "Football Match"}
            </span>

            <h1>
              Match Centre
            </h1>
          </div>

          <div
            className={
              styles.statusBadge
            }
          >
            {saving
              ? "SAVING"
              : status.toUpperCase()}
          </div>
        </header>

        <section
          className={
            styles.scoreboard
          }
        >
          <div
            className={
              styles.teamScore
            }
          >
            <div
              className={
                styles.logo
              }
            >
              {homeClub.logo ? (
                <img
                  src={
                    homeClub.logo
                  }
                  alt=""
                />
              ) : (
                "⚽"
              )}
            </div>

            <strong>
              {homeClub.name}
            </strong>

            <span>
              HOME
            </span>
          </div>

          <div
            className={
              styles.scoreCenter
            }
          >
            <small>
              {minute}'
            </small>

            <strong>
              {score}
            </strong>

            <span>
              {status}
            </span>
          </div>

          <div
            className={
              styles.teamScore
            }
          >
            <div
              className={
                styles.logo
              }
            >
              {awayClub.logo ? (
                <img
                  src={
                    awayClub.logo
                  }
                  alt=""
                />
              ) : (
                "⚽"
              )}
            </div>

            <strong>
              {awayClub.name}
            </strong>

            <span>
              AWAY
            </span>
          </div>
        </section>

        <section
          className={
            styles.mainGrid
          }
        >
          <div
            className={
              styles.pitchCard
            }
          >
            <MatchCanvas
              engine={
                engine
              }
            />
          </div>

          <aside
            className={
              styles.sidebar
            }
          >
            <section
              className={
                styles.controlCard
              }
            >
              <h2>
                Match Controls
              </h2>

              <div
                className={
                  styles.buttonGrid
                }
              >
                {status ===
                  MATCH_STATUS.READY && (
                  <button
                    className={
                      styles.primaryButton
                    }
                    onClick={
                      startMatch
                    }
                  >
                    ▶ Start
                  </button>
                )}

                {status ===
                  MATCH_STATUS.LIVE && (
                  <button
                    className={
                      styles.secondaryButton
                    }
                    onClick={
                      pauseMatch
                    }
                  >
                    ⏸ Pause
                  </button>
                )}

                {status ===
                  MATCH_STATUS.HALF_TIME && (
                  <button
                    className={
                      styles.primaryButton
                    }
                    onClick={
                      resumeMatch
                    }
                  >
                    ▶ Resume
                  </button>
                )}

                {status ===
                  MATCH_STATUS.LIVE &&
                  snapshot.minute <
                    90 && (
                    <button
                      className={
                        styles.dangerButton
                      }
                      onClick={
                        stopMatch
                      }
                    >
                      ■ Finish
                    </button>
                  )}

                {status ===
                  MATCH_STATUS.FINISHED && (
                  <div
                    className={
                      styles.finishedMessage
                    }
                  >
                    Full Time
                  </div>
                )}
              </div>
            </section>

            <section
              className={
                styles.infoCard
              }
            >
              <span>
                BALL
              </span>

              <strong>
                {ballOwner
                  ? `${ballOwner.name} #${ballOwner.number}`
                  : "Free Ball"}
              </strong>
            </section>

            <section
              className={
                styles.statsCard
              }
            >
              <h2>
                Match Statistics
              </h2>

              <StatRow
                label="Possession"
                home={
                  snapshot.homeStats
                    .possession
                }
                away={
                  snapshot.awayStats
                    .possession
                }
                suffix="%"
              />

              <StatRow
                label="Shots"
                home={
                  snapshot.homeStats
                    .shots
                }
                away={
                  snapshot.awayStats
                    .shots
                }
              />

              <StatRow
                label="On Target"
                home={
                  snapshot.homeStats
                    .shotsOnTarget
                }
                away={
                  snapshot.awayStats
                    .shotsOnTarget
                }
              />

              <StatRow
                label="Passes"
                home={
                  snapshot.homeStats
                    .passesCompleted
                }
                away={
                  snapshot.awayStats
                    .passesCompleted
                }
              />

              <StatRow
                label="Tackles"
                home={
                  snapshot.homeStats
                    .tackles
                }
                away={
                  snapshot.awayStats
                    .tackles
                }
              />

              <StatRow
                label="Corners"
                home={
                  snapshot.homeStats
                    .corners
                }
                away={
                  snapshot.awayStats
                    .corners
                }
              />

              <StatRow
                label="Fouls"
                home={
                  snapshot.homeStats
                    .fouls
                }
                away={
                  snapshot.awayStats
                    .fouls
                }
              />

              <StatRow
                label="Saves"
                home={
                  snapshot.homeStats
                    .saves
                }
                away={
                  snapshot.awayStats
                    .saves
                }
              />
            </section>

            <section
              className={
                styles.eventsCard
              }
            >
              <h2>
                Match Events
              </h2>

              {recentEvents.length ===
              0 ? (
                <p
                  className={
                    styles.empty
                  }
                >
                  No events yet.
                </p>
              ) : (
                recentEvents.map(
                  event => (
                    <div
                      key={
                        event.id
                      }
                      className={
                        styles.event
                      }
                    >
                      <span>
                        {event.minute}'
                      </span>

                      <div>
                        <strong>
                          {event.type.replace(
                            "_",
                            " "
                          )}
                        </strong>

                        <p>
                          {
                            event.detail
                          }
                        </p>
                      </div>
                    </div>
                  )
                )
              )}
            </section>

            <section
              className={
                styles.benchCard
              }
            >
              <h2>
                Substitutes
              </h2>

              <div
                className={
                  styles.benchColumns
                }
              >
                <div>
                  <h3>
                    {homeClub.name}
                  </h3>

                  {engine.homeBench.map(
                    player => (
                      <div
                        key={
                          player.id ||
                          player.playerId
                        }
                        className={
                          styles.benchPlayer
                        }
                      >
                        <span>
                          {player.shirtNumber ||
                            player.number ||
                            "-"}
                        </span>

                        <label>
                          {player.name ||
                            player.fullName ||
                            "Player"}
                        </label>
                      </div>
                    )
                  )}
                </div>

                <div>
                  <h3>
                    {awayClub.name}
                  </h3>

                  {engine.awayBench.map(
                    player => (
                      <div
                        key={
                          player.id ||
                          player.playerId
                        }
                        className={
                          styles.benchPlayer
                        }
                      >
                        <span>
                          {player.shirtNumber ||
                            player.number ||
                            "-"}
                        </span>

                        <label>
                          {player.name ||
                            player.fullName ||
                            "Player"}
                        </label>
                      </div>
                    )
                  )}
                </div>
              </div>
            </section>
          </aside>
        </section>
      </main>
    </>
  );
}

function StatRow({
  label,
  home,
  away,
  suffix = "",
}) {
  return (
    <div
      className={
        styles.statRow
      }
    >
      <strong>
        {home}
        {suffix}
      </strong>

      <span>
        {label}
      </span>

      <strong>
        {away}
        {suffix}
      </strong>
    </div>
  );
}
