// pages/match/[id].js

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

import dynamic from "next/dynamic";
import Head from "next/head";
import { useRouter } from "next/router";

import { db } from "../../components/firebase";
import { useAuth } from "../../context/AuthContext";

import toast from "react-hot-toast";

import styles from "./match.module.css";

import {
  calculateTeamStrength,
  createMatchSimulation,
  getVisualState,
  selectStartingXI,
  simulateAction,
  advancePlayers,
} from "../../components/match/matchSimulation";

const ThreePitch = dynamic(
  () =>
    import(
      "../../components/ThreePitch"
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="pitch-loading"
        style={{
          height: "520px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Loading 3D pitch...
      </div>
    ),
  }
);

// ============================================================
// CONSTANTS
// ============================================================

const MATCH_DURATION = 90;

const MATCH_TICK_MS = 1000;

const SIMULATION_ACTIONS_PER_TICK = 3;

// ============================================================
// HELPERS
// ============================================================

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}

function createStats() {
  return {
    shots: 0,
    shotsOnTarget: 0,
    possession: 50,
    passes: 0,
    fouls: 0,
    corners: 0,
    offsides: 0,
    yellow: 0,
    red: 0,
    saves: 0,
    tackles: 0,
    interceptions: 0,
  };
}

// ============================================================
// COMPONENT
// ============================================================

export default function MatchPage() {
  const router =
    useRouter();

  const { id } =
    router.query;

  const {
    user,
    loading: authLoading,
  } = useAuth();

  // ----------------------------------------------------------
  // MATCH DATA
  // ----------------------------------------------------------

  const [match, setMatch] =
    useState(null);

  const [homeClub, setHomeClub] =
    useState(null);

  const [awayClub, setAwayClub] =
    useState(null);

  const [homeXI, setHomeXI] =
    useState([]);

  const [awayXI, setAwayXI] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState(null);

  // ----------------------------------------------------------
  // MATCH STATE
  // ----------------------------------------------------------

  const [matchStatus, setMatchStatus] =
    useState("loading");

  const [matchMinute, setMatchMinute] =
    useState(0);

  const [homeScore, setHomeScore] =
    useState(0);

  const [awayScore, setAwayScore] =
    useState(0);

  const [events, setEvents] =
    useState([]);

  const [homeStats, setHomeStats] =
    useState(createStats());

  const [awayStats, setAwayStats] =
    useState(createStats());

  const [isPaused, setIsPaused] =
    useState(false);

  const [isSaving, setIsSaving] =
    useState(false);

  // ----------------------------------------------------------
  // SIMULATION
  // ----------------------------------------------------------

  const simulationRef =
    useRef(null);

  const homeStrengthRef =
    useRef(60);

  const awayStrengthRef =
    useRef(60);

  // ----------------------------------------------------------
  // TIMER
  // ----------------------------------------------------------

  const timerRef =
    useRef(null);

  // ----------------------------------------------------------
  // SCORE
  // ----------------------------------------------------------

  const scoreRef =
    useRef({
      home: 0,
      away: 0,
    });

  // ----------------------------------------------------------
  // STATS
  // ----------------------------------------------------------

  const statsRef =
    useRef({
      home: createStats(),
      away: createStats(),
    });

  // ----------------------------------------------------------
  // EVENTS
  // ----------------------------------------------------------

  const eventsRef =
    useRef([]);

  // ----------------------------------------------------------
  // MINUTE
  // ----------------------------------------------------------

  const minuteRef =
    useRef(0);

  // ==========================================================
  // LOAD PLAYERS
  // ==========================================================

  const loadClubPlayers =
    useCallback(
      async clubId => {
        if (!clubId) {
          return [];
        }

        try {
          const {
            collection,
            getDocs,
            query,
            where,
          } = await import(
            "firebase/firestore"
          );

          const q =
            query(
              collection(
                db,
                "players"
              ),
              where(
                "clubId",
                "==",
                clubId
              )
            );

          const snapshot =
            await getDocs(q);

          return snapshot.docs.map(
            playerDoc => ({
              id: playerDoc.id,
              ...playerDoc.data(),
            })
          );
        } catch (err) {
          console.error(
            "Players loading error:",
            err
          );

          return [];
        }
      },
      []
    );

  // ==========================================================
  // LOAD MATCH
  // ==========================================================

  useEffect(() => {
    if (
      authLoading ||
      !id ||
      !user
    ) {
      return;
    }

    let cancelled = false;

    async function loadMatch() {
      try {
        setLoading(true);
        setError(null);

        const matchRef =
          doc(
            db,
            "matches",
            id
          );

        const matchSnap =
          await getDoc(
            matchRef
          );

        if (
          !matchSnap.exists()
        ) {
          setError(
            "Match not found in database."
          );

          setLoading(false);

          return;
        }

        const matchData = {
          id: matchSnap.id,
          ...matchSnap.data(),
        };

        if (cancelled) {
          return;
        }

        setMatch(
          matchData
        );

        // ----------------------------------------------------
        // CLUBS
        // ----------------------------------------------------

        const [
          homeSnap,
          awaySnap,
        ] =
          await Promise.all([
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
          ]);

        const home =
          homeSnap?.exists()
            ? {
                id: homeSnap.id,
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
                id: awaySnap.id,
                ...awaySnap.data(),
              }
            : {
                id:
                  matchData.awayClubId,
                name:
                  matchData.awayClubName ||
                  "Away",
              };

        setHomeClub(home);
        setAwayClub(away);

        // ----------------------------------------------------
        // PLAYERS
        // ----------------------------------------------------

        const [
          homePlayers,
          awayPlayers,
        ] =
          await Promise.all([
            loadClubPlayers(
              matchData.homeClubId
            ),

            loadClubPlayers(
              matchData.awayClubId
            ),
          ]);

        const formation =
          matchData.formation ||
          "4-4-2";

        const startingHome =
          selectStartingXI(
            homePlayers,
            formation
          );

        const startingAway =
          selectStartingXI(
            awayPlayers,
            formation
          );

        setHomeXI(
          startingHome
        );

        setAwayXI(
          startingAway
        );

        // ----------------------------------------------------
        // STRENGTH
        // ----------------------------------------------------

        homeStrengthRef.current =
          calculateTeamStrength(
            startingHome
          );

        awayStrengthRef.current =
          calculateTeamStrength(
            startingAway
          );

        // ----------------------------------------------------
        // INITIAL SIMULATION
        // ----------------------------------------------------

        simulationRef.current =
          createMatchSimulation(
            startingHome,
            startingAway,
            formation
          );

        // ----------------------------------------------------
        // RESTORE MATCH
        // ----------------------------------------------------

        const savedHomeScore =
          safeNumber(
            matchData.homeScore,
            0
          );

        const savedAwayScore =
          safeNumber(
            matchData.awayScore,
            0
          );

        scoreRef.current = {
          home:
            savedHomeScore,

          away:
            savedAwayScore,
        };

        statsRef.current = {
          home: {
            ...createStats(),
            ...(matchData.homeStats ||
              {}),
          },

          away: {
            ...createStats(),
            ...(matchData.awayStats ||
              {}),
          },
        };

        eventsRef.current =
          Array.isArray(
            matchData.events
          )
            ? matchData.events
            : [];

        minuteRef.current =
          safeNumber(
            matchData.minute,
            0
          );

        setHomeScore(
          savedHomeScore
        );

        setAwayScore(
          savedAwayScore
        );

        setHomeStats({
          ...statsRef.current
            .home,
        });

        setAwayStats({
          ...statsRef.current
            .away,
        });

        setEvents([
          ...eventsRef.current,
        ]);

        setMatchMinute(
          minuteRef.current
        );

        // ----------------------------------------------------
        // STATUS
        // ----------------------------------------------------

        if (
          matchData.status ===
          "finished"
        ) {
          setMatchStatus(
            "finished"
          );

          setIsPaused(true);
        } else if (
          matchData.status ===
          "live"
        ) {
          setMatchStatus(
            "live"
          );

          setIsPaused(false);
        } else if (
          matchData.status ===
          "half-time"
        ) {
          setMatchStatus(
            "half-time"
          );

          setIsPaused(true);
        } else {
          setMatchStatus(
            "ready"
          );

          setIsPaused(true);
        }
      } catch (err) {
        console.error(
          "Match loading error:",
          err
        );

        setError(
          "Failed to load match: " +
            err.message
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMatch();

    return () => {
      cancelled = true;
    };
  }, [
    id,
    user,
    authLoading,
    loadClubPlayers,
  ]);

  // ==========================================================
  // SAVE MATCH
  // ==========================================================

  const saveMatchState =
    useCallback(
      async status => {
        if (
          !match?.id ||
          !user
        ) {
          return;
        }

        try {
          setIsSaving(true);

          await updateDoc(
            doc(
              db,
              "matches",
              match.id
            ),
            {
              status:
                status ||
                matchStatus,

              minute:
                minuteRef.current,

              homeScore:
                scoreRef.current
                  .home,

              awayScore:
                scoreRef.current
                  .away,

              result: {
                homeScore:
                  scoreRef.current
                    .home,

                awayScore:
                  scoreRef.current
                    .away,
              },

              events:
                eventsRef.current,

              homeStats:
                statsRef.current
                  .home,

              awayStats:
                statsRef.current
                  .away,

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (err) {
          console.error(
            "Saving match error:",
            err
          );
        } finally {
          setIsSaving(false);
        }
      },
      [
        match,
        user,
        matchStatus,
      ]
    );

  // ==========================================================
  // RUN ONE SIMULATION STEP
  // ==========================================================

  const runSimulation =
    useCallback(
      () => {
        const engine =
          simulationRef.current;

        if (!engine) {
          return;
        }

        // Three actions every real second
        for (
          let i = 0;
          i <
          SIMULATION_ACTIONS_PER_TICK;
          i++
        ) {
          const action =
            simulateAction(
              engine,
              homeStrengthRef.current,
              awayStrengthRef.current
            );

          if (!action) {
            continue;
          }

          // --------------------------------------------------
          // PASS
          // --------------------------------------------------

          if (
            action.type ===
            "pass"
          ) {
            statsRef.current[
              action.team
            ].passes += 1;
          }

          // --------------------------------------------------
          // DRIBBLE
          // --------------------------------------------------

          if (
            action.type ===
            "dribble"
          ) {
            // Nothing needed here
          }

          // --------------------------------------------------
          // SHOT
          // --------------------------------------------------

          if (
            action.type ===
              "shot" ||
            action.type ===
              "goal"
          ) {
            const team =
              action.team;

            statsRef.current[
              team
            ].shots += 1;

            if (
              Math.random() <
              0.65
            ) {
              statsRef.current[
                team
              ].shotsOnTarget += 1;
            }
          }

          // --------------------------------------------------
          // GOAL
          // --------------------------------------------------

          if (
            action.type ===
              "goal" &&
            action.goal
          ) {
            scoreRef.current[
              action.team
            ] += 1;

            const event = {
              id:
                `goal-${Date.now()}-${Math.random()}`,

              type: "goal",

              team:
                action.team,

              minute:
                minuteRef.current,

              playerName:
                action.player?.name ||
                action.player
                  ?.fullName ||
                "Player",

              detail:
                `${
                  action.player?.name ||
                  action.player?.fullName ||
                  "Player"
                } scored!`,
            };

            eventsRef.current = [
              event,
              ...eventsRef.current,
            ];

            toast.success(
              `⚽ ${event.playerName} scored!`
            );
          }
        }

        // ------------------------------------------------------
        // PLAYER MOVEMENT
        // ------------------------------------------------------

        advancePlayers(
          engine,
          0.9
        );

        // ------------------------------------------------------
        // POSSESSION
        // ------------------------------------------------------

        const possession =
          engine.possession;

        if (
          possession
        ) {
          statsRef.current.home.possession =
            possession.team ===
            "home"
              ? Math.min(
                  80,
                  statsRef.current
                    .home
                    .possession +
                    0.15
                )
              : Math.max(
                  20,
                  statsRef.current
                    .home
                    .possession -
                    0.15
                );

          statsRef.current.away.possession =
            100 -
            statsRef.current
              .home
              .possession;
        }

        // ------------------------------------------------------
        // UI
        // ------------------------------------------------------

        setHomeScore(
          scoreRef.current.home
        );

        setAwayScore(
          scoreRef.current.away
        );

        setHomeStats({
          ...statsRef.current
            .home,
        });

        setAwayStats({
          ...statsRef.current
            .away,
        });

        setEvents([
          ...eventsRef.current,
        ]);
      },
      []
    );

  // ==========================================================
  // MATCH CLOCK
  // ==========================================================

  useEffect(() => {
    if (
      matchStatus !==
        "live" ||
      isPaused ||
      loading
    ) {
      return;
    }

    timerRef.current =
      setInterval(() => {
        const next =
          minuteRef.current +
          1;

        minuteRef.current =
          next;

        setMatchMinute(
          next
        );

        runSimulation();

        if (
          next >=
          MATCH_DURATION
        ) {
          clearInterval(
            timerRef.current
          );

          timerRef.current =
            null;

          setMatchStatus(
            "finished"
          );

          setIsPaused(
            true
          );

          saveMatchState(
            "finished"
          );

          toast.success(
            `Full Time: ${
              scoreRef.current
                .home
            } - ${
              scoreRef.current
                .away
            }`
          );

          return;
        }

        // Save every 5 minutes
        if (
          next % 5 ===
          0
        ) {
          saveMatchState(
            "live"
          );
        }
      }, MATCH_TICK_MS);

    return () => {
      if (
        timerRef.current
      ) {
        clearInterval(
          timerRef.current
        );

        timerRef.current =
          null;
      }
    };
  }, [
    matchStatus,
    isPaused,
    loading,
    runSimulation,
    saveMatchState,
  ]);

  // ==========================================================
  // START MATCH
  // ==========================================================

  const startMatch =
    useCallback(
      async () => {
        if (
          matchStatus !==
            "ready" &&
          matchStatus !==
            "half-time"
        ) {
          return;
        }

        setMatchStatus(
          "live"
        );

        setIsPaused(
          false
        );

        await saveMatchState(
          "live"
        );

        toast.success(
          "Match started!"
        );
      },
      [
        matchStatus,
        saveMatchState,
      ]
    );

  // ==========================================================
  // PAUSE
  // ==========================================================

  const togglePause =
    useCallback(() => {
      if (
        matchStatus !==
        "live"
      ) {
        return;
      }

      setIsPaused(
        previous =>
          !previous
      );
    }, [
      matchStatus,
    ]);

  // ==========================================================
  // LOADING
  // ==========================================================

  if (
    authLoading ||
    loading
  ) {
    return (
      <div
        className={
          styles.loading
        }
      >
        <div
          className={
            styles.spinner
          }
        />

        <p>
          Loading match...
        </p>
      </div>
    );
  }

  // ==========================================================
  // ERROR
  // ==========================================================

  if (error) {
    return (
      <div
        className={
          styles.errorContainer
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

        <p>{error}</p>

        <button
          onClick={() =>
            router.push(
              "/fixtures"
            )
          }
        >
          Back to Fixtures
        </button>
      </div>
    );
  }

  if (
    !match ||
    !homeClub ||
    !awayClub
  ) {
    return (
      <div
        className={
          styles.errorContainer
        }
      >
        <h1>
          Match Not Found
        </h1>

        <button
          onClick={() =>
            router.push(
              "/fixtures"
            )
          }
        >
          Back to Fixtures
        </button>
      </div>
    );
  }

  // ==========================================================
  // VISUAL SIMULATION
  // ==========================================================

  const visualSimulation =
    simulationRef.current
      ? getVisualState(
          simulationRef.current
        )
      : null;

  // ==========================================================
  // STATUS
  // ==========================================================

  const statusLabel =
    matchStatus ===
    "ready"
      ? "READY"
      : matchStatus ===
        "live"
      ? isPaused
        ? "PAUSED"
        : "LIVE"
      : matchStatus ===
        "half-time"
      ? "HALF TIME"
      : "FULL TIME";

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <>
      <Head>
        <title>
          {homeClub.name} vs{" "}
          {awayClub.name} |
          Match
        </title>
      </Head>

      <main
        className={
          styles.page
        }
      >
        {/* ================================================== */}
        {/* HEADER */}
        {/* ================================================== */}

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

          <h1>
            Match Centre
          </h1>

          <span
            className={`${styles.status} ${
              matchStatus ===
              "live"
                ? styles.live
                : ""
            }`}
          >
            {statusLabel}
          </span>
        </header>

        {/* ================================================== */}
        {/* 3D MATCH */}
        {/* ================================================== */}

        <div
          className={
            styles.pitchContainer
          }
        >
          <ThreePitch
            homeXI={homeXI}
            awayXI={awayXI}
            homeColor={
              homeClub.primaryColor ||
              "#2563eb"
            }
            awayColor={
              awayClub.primaryColor ||
              "#dc2626"
            }
            formation={
              match.formation ||
              "4-4-2"
            }
            simulation={
              visualSimulation
            }
          />
        </div>

        {/* ================================================== */}
        {/* SCORE */}
        {/* ================================================== */}

        <section
          className={
            styles.scoreboard
          }
        >
          <div
            className={
              styles.scoreTeam
            }
          >
            <div
              className={
                styles.clubLogo
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

            <span
              className={
                styles.badge
              }
            >
              HOME
            </span>
          </div>

          <div
            className={
              styles.scoreMiddle
            }
          >
            <div
              className={
                styles.score
              }
            >
              <strong
                className={
                  styles.homeScore
                }
              >
                {homeScore}
              </strong>

              <span>
                -
              </span>

              <strong
                className={
                  styles.awayScore
                }
              >
                {awayScore}
              </strong>
            </div>

            <div
              className={
                styles.matchClock
              }
            >
              {matchMinute}'
            </div>

            <small>
              {statusLabel}
            </small>
          </div>

          <div
            className={
              styles.scoreTeam
            }
          >
            <div
              className={
                styles.clubLogo
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

            <span
              className={
                styles.badge
              }
            >
              AWAY
            </span>
          </div>
        </section>

        {/* ================================================== */}
        {/* CONTROLS */}
        {/* ================================================== */}

        <section
          className={
            styles.controls
          }
        >
          {matchStatus ===
            "ready" && (
            <button
              className={
                styles.primaryButton
              }
              onClick={
                startMatch
              }
              disabled={
                isSaving
              }
            >
              ▶ START MATCH
            </button>
          )}

          {matchStatus ===
            "half-time" && (
            <button
              className={
                styles.primaryButton
              }
              onClick={
                startMatch
              }
            >
              ▶ START SECOND HALF
            </button>
          )}

          {matchStatus ===
            "live" && (
            <>
              <button
                onClick={
                  togglePause
                }
              >
                {isPaused
                  ? "▶ Resume"
                  : "⏸ Pause"}
              </button>

              <button
                onClick={async () => {
                  setMatchStatus(
                    "finished"
                  );

                  setIsPaused(
                    true
                  );

                  await saveMatchState(
                    "finished"
                  );
                }}
              >
                ⏹ Finish
              </button>
            </>
          )}

          {matchStatus ===
            "finished" && (
            <button
              onClick={() =>
                router.push(
                  "/fixtures"
                )
              }
            >
              Back to Fixtures
            </button>
          )}
        </section>

        {/* ================================================== */}
        {/* STATS */}
        {/* ================================================== */}

        <section
          className={
            styles.statsSection
          }
        >
          <div
            className={
              styles.sectionHeader
            }
          >
            <span>
              MATCH STATISTICS
            </span>

            <strong>
              {homeScore} -{" "}
              {awayScore}
            </strong>
          </div>

          {[
            [
              "Possession",
              `${homeStats.possession.toFixed(
                1
              )}%`,
              `${awayStats.possession.toFixed(
                1
              )}%`,
            ],

            [
              "Shots",
              homeStats.shots,
              awayStats.shots,
            ],

            [
              "Shots on Target",
              homeStats.shotsOnTarget,
              awayStats.shotsOnTarget,
            ],

            [
              "Passes",
              homeStats.passes,
              awayStats.passes,
            ],

            [
              "Fouls",
              homeStats.fouls,
              awayStats.fouls,
            ],

            [
              "Corners",
              homeStats.corners,
              awayStats.corners,
            ],

            [
              "Saves",
              homeStats.saves,
              awayStats.saves,
            ],
          ].map(row => (
            <div
              key={row[0]}
              className={
                styles.statRow
              }
            >
              <strong
                className={
                  styles.homeStat
                }
              >
                {row[1]}
              </strong>

              <span>
                {row[0]}
              </span>

              <strong
                className={
                  styles.awayStat
                }
              >
                {row[2]}
              </strong>
            </div>
          ))}
        </section>

        {/* ================================================== */}
        {/* EVENTS */}
        {/* ================================================== */}

        <section
          className={
            styles.eventsSection
          }
        >
          <div
            className={
              styles.sectionHeader
            }
          >
            <div>
              <span>
                LIVE FEED
              </span>

              <h2>
                Match Events
              </h2>
            </div>
          </div>

          <div
            className={
              styles.eventsList
            }
          >
            {events.length >
            0 ? (
              events
                .slice(0, 30)
                .map(event => (
                  <div
                    key={
                      event.id
                    }
                    className={
                      styles.event
                    }
                  >
                    <span
                      className={
                        styles.eventMinute
                      }
                    >
                      {
                        event.minute
                      }
                      '
                    </span>

                    <span
                      className={
                        styles.eventIcon
                      }
                    >
                      {event.type ===
                      "goal"
                        ? "⚽"
                        : event.type ===
                          "shot"
                        ? "💥"
                        : "🔄"}
                    </span>

                    <div>
                      <strong>
                        {event.type.toUpperCase()}
                      </strong>

                      <p>
                        {
                          event.detail
                        }
                      </p>
                    </div>

                    <span
                      className={
                        event.team ===
                        "home"
                          ? styles.homeEvent
                          : styles.awayEvent
                      }
                    >
                      {event.team ===
                      "home"
                        ? homeClub.name
                        : awayClub.name}
                    </span>
                  </div>
                ))
            ) : (
              <div
                className={
                  styles.noEvents
                }
              >
                Match has no
                events yet.
              </div>
            )}
          </div>
        </section>

        {/* ================================================== */}
        {/* LINEUPS */}
        {/* ================================================== */}

        <section
          className={
            styles.lineups
          }
        >
          <div
            className={
              styles.lineupCard
            }
          >
            <h3>
              {homeClub.name}{" "}
              <small>
                Starting XI
              </small>
            </h3>

            {homeXI
              .slice(0, 11)
              .map(player => (
                <div
                  key={
                    player.id
                  }
                  className={
                    styles.lineupPlayer
                  }
                >
                  <span>
                    {player.name ||
                      player.fullName ||
                      "Player"}
                  </span>

                  <span
                    className={
                      styles.playerRating
                    }
                  >
                    {Number(
                      player.overall ||
                        player.rating ||
                        60
                    )}
                  </span>
                </div>
              ))}
          </div>

          <div
            className={
              styles.lineupCard
            }
          >
            <h3>
              {awayClub.name}{" "}
              <small>
                Starting XI
              </small>
            </h3>

            {awayXI
              .slice(0, 11)
              .map(player => (
                <div
                  key={
                    player.id
                  }
                  className={
                    styles.lineupPlayer
                  }
                >
                  <span>
                    {player.name ||
                      player.fullName ||
                      "Player"}
                  </span>

                  <span
                    className={
                      styles.playerRating
                    }
                  >
                    {Number(
                      player.overall ||
                        player.rating ||
                        60
                    )}
                  </span>
                </div>
              ))}
          </div>
        </section>

        {/* ================================================== */}
        {/* INFO */}
        {/* ================================================== */}

        <section
          className={
            styles.matchInfo
          }
        >
          <div>
            <span>
              STADIUM
            </span>

            <strong>
              {match.stadium ||
                "Unknown Stadium"}
            </strong>
          </div>

          <div>
            <span>
              LEAGUE
            </span>

            <strong>
              {match.leagueName ||
                match.competition ||
                "Friendly"}
            </strong>
          </div>

          <div>
            <span>
              DATE
            </span>

            <strong>
              {match.date
                ? new Date(
                    match.date
                  ).toLocaleDateString()
                : "-"}
            </strong>
          </div>
        </section>
      </main>
    </>
  );
}
