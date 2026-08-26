// pages/match/[id].js

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  useRouter,
} from "next/router";

import Head from "next/head";

import dynamic from "next/dynamic";

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

import {
  useAuth,
} from "../../context/AuthContext";

import toast from "react-hot-toast";

import {
  getPlayerId,
  getPlayerName,
  getPlayerOverall,
  getPlayerRole,
  selectAIStartingXI,
  validateStartingXI,
} from "../../lib/football";

import {
  createInitialEngineState,
  simulateMinute,
} from "../../lib/matchEngine";

import LineupSelector from "../../components/LineupSelector";

import styles from "./match.module.css";

const ThreePitch =
  dynamic(
    () =>
      import(
        "../../components/ThreePitch"
      ),
    {
      ssr: false,
      loading: () => (
        <div
          style={{
            height: "560px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#07111f",
            color: "#fff",
          }}
        >
          Loading 3D pitch...
        </div>
      ),
    }
  );

const MATCH_MINUTES = 90;

function safeNumber(
  value,
  fallback = 0
) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function createDefaultStats() {
  return {
    possession: 50,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passesCompleted: 0,
    tackles: 0,
    interceptions: 0,
    fouls: 0,
    corners: 0,
    offsides: 0,
    yellow: 0,
    red: 0,
    saves: 0,
    attacks: 0,
    dangerousAttacks: 0,
    successfulDribbles: 0,
    blockedShots: 0,
  };
}

function normalizeEngineState(
  saved,
  homeXI,
  awayXI,
  formation
) {
  if (
    saved &&
    saved.players &&
    saved.ball &&
    saved.stats
  ) {
    return {
      ...saved,

      score: {
        home: safeNumber(
          saved.score?.home,
          0
        ),
        away: safeNumber(
          saved.score?.away,
          0
        ),
      },

      stats: {
        home: {
          ...createDefaultStats(),
          ...(saved.stats?.home || {}),
        },

        away: {
          ...createDefaultStats(),
          ...(saved.stats?.away || {}),
        },
      },

      events: saved.events || [],
    };
  }

  return createInitialEngineState(
    homeXI,
    awayXI,
    formation
  );
}

function hasManager(club) {
  if (!club) return false;

  if (
    club.managerId ||
    club.managerUid ||
    club.managerUsername ||
    club.managerName
  ) {
    return true;
  }

  if (
    club.manager &&
    typeof club.manager ===
      "object"
  ) {
    return Boolean(
      club.manager.id ||
      club.manager.uid ||
      club.manager.username ||
      club.manager.name
    );
  }

  return false;
}

export default function MatchPage() {
  const router = useRouter();

  const {
    user,
    loading: authLoading,
  } = useAuth();

  const {
    id,
  } = router.query;

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState(null);

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
    homeSquad,
    setHomeSquad,
  ] = useState([]);

  const [
    awaySquad,
    setAwaySquad,
  ] = useState([]);

  const [
    homeXI,
    setHomeXI,
  ] = useState([]);

  const [
    awayXI,
    setAwayXI,
  ] = useState([]);

  const [
    selectedIds,
    setSelectedIds,
  ] = useState([]);

  const [
    controlledTeam,
    setControlledTeam,
  ] = useState(null);

  const [
    matchStatus,
    setMatchStatus,
  ] = useState("loading");

  const [
    matchMinute,
    setMatchMinute,
  ] = useState(0);

  const [
    isPaused,
    setIsPaused,
  ] = useState(false);

  const [
    injuryTime,
    setInjuryTime,
  ] = useState({
    firstHalf: 2,
    secondHalf: 3,
  });

  const [
    engineState,
    setEngineState,
  ] = useState(null);

  const [
    isSaving,
    setIsSaving,
  ] = useState(false);

  const engineRef =
    useRef(null);

  const minuteRef =
    useRef(0);

  const statusRef =
    useRef("loading");

  const matchRef =
    useRef(null);

  const userRef =
    useRef(null);

  // ==========================================================
  // LOAD PLAYERS
  // ==========================================================

  const loadPlayers = useCallback(
    async (clubId) => {
      if (!clubId) return [];

      try {
        const q = query(
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
          (item) => ({
            id: item.id,
            ...item.data(),
          })
        );
      } catch (err) {
        console.error(
          "Player loading error:",
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
      !user ||
      !id
    ) {
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        userRef.current =
          user;

        const matchSnapshot =
          await getDoc(
            doc(
              db,
              "matches",
              id
            )
          );

        if (
          !matchSnapshot.exists()
        ) {
          throw new Error(
            "Match not found."
          );
        }

        const matchData = {
          id: matchSnapshot.id,
          ...matchSnapshot.data(),
        };

        matchRef.current =
          matchData;

        setMatch(
          matchData
        );

        const [
          homeSnapshot,
          awaySnapshot,
        ] = await Promise.all([
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

        if (cancelled) return;

        const home =
          homeSnapshot?.exists()
            ? {
                id:
                  homeSnapshot.id,
                ...homeSnapshot.data(),
              }
            : {
                id:
                  matchData.homeClubId,
                name:
                  matchData.homeClubName ||
                  "Home",
              };

        const away =
          awaySnapshot?.exists()
            ? {
                id:
                  awaySnapshot.id,
                ...awaySnapshot.data(),
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

        // ====================================================
        // USER CLUB
        // ====================================================

        let userClubId =
          user?.clubId ||
          user?.currentClub ||
          user?.careerData?.currentClub ||
          null;

        try {
          const userDoc =
            await getDoc(
              doc(
                db,
                "users",
                user.uid
              )
            );

          if (
            userDoc.exists()
          ) {
            const profile =
              userDoc.data();

            userClubId =
              profile?.clubId ||
              profile?.currentClub ||
              profile?.careerData?.currentClub ||
              userClubId;
          }
        } catch (profileError) {
          console.warn(
            "Could not load user profile:",
            profileError
          );
        }

        let userTeam = null;

        if (
          String(userClubId) ===
          String(home.id)
        ) {
          userTeam = "home";
        }

        if (
          String(userClubId) ===
          String(away.id)
        ) {
          userTeam = "away";
        }

        setControlledTeam(
          userTeam
        );

        // ====================================================
        // LOAD SQUADS
        // ====================================================

        const [
          homePlayers,
          awayPlayers,
        ] = await Promise.all([
          loadPlayers(
            home.id
          ),

          loadPlayers(
            away.id
          ),
        ]);

        if (cancelled) return;

        setHomeSquad(
          homePlayers
        );

        setAwaySquad(
          awayPlayers
        );

        const formation =
          matchData.formation ||
          "4-4-2";

        // ====================================================
        // LINEUPS
        // ====================================================

        let savedHomeXI =
          matchData.homeLineup
            ?.players || [];

        let savedAwayXI =
          matchData.awayLineup
            ?.players || [];

        if (
          !savedHomeXI.length &&
          matchData.homeLineupIds?.length
        ) {
          savedHomeXI =
            homePlayers.filter(
              (player) =>
                matchData.homeLineupIds.includes(
                  getPlayerId(player)
                )
            );
        }

        if (
          !savedAwayXI.length &&
          matchData.awayLineupIds?.length
        ) {
          savedAwayXI =
            awayPlayers.filter(
              (player) =>
                matchData.awayLineupIds.includes(
                  getPlayerId(player)
                )
            );
        }

        // ====================================================
        // USER TEAM
        // ====================================================

        if (
          userTeam === "home"
        ) {
          if (
            savedHomeXI.length === 11
          ) {
            setHomeXI(
              savedHomeXI
            );

            setSelectedIds(
              savedHomeXI.map(
                getPlayerId
              )
            );
          } else {
            setHomeXI([]);
            setSelectedIds([]);
          }

          const aiAway =
            savedAwayXI.length === 11
              ? savedAwayXI
              : selectAIStartingXI(
                  awayPlayers,
                  formation
                );

          setAwayXI(
            aiAway
          );
        } else if (
          userTeam === "away"
        ) {
          if (
            savedAwayXI.length === 11
          ) {
            setAwayXI(
              savedAwayXI
            );

            setSelectedIds(
              savedAwayXI.map(
                getPlayerId
              )
            );
          } else {
            setAwayXI([]);
            setSelectedIds([]);
          }

          const aiHome =
            savedHomeXI.length === 11
              ? savedHomeXI
              : selectAIStartingXI(
                  homePlayers,
                  formation
                );

          setHomeXI(
            aiHome
          );
        } else {
          // Spectator / neutral
          const aiHome =
            savedHomeXI.length === 11
              ? savedHomeXI
              : selectAIStartingXI(
                  homePlayers,
                  formation
                );

          const aiAway =
            savedAwayXI.length === 11
              ? savedAwayXI
              : selectAIStartingXI(
                  awayPlayers,
                  formation
                );

          setHomeXI(aiHome);
          setAwayXI(aiAway);
        }

        // ====================================================
        // STATUS
        // ====================================================

        const status =
          matchData.status ||
          "ready";

        const minute =
          safeNumber(
            matchData.minute,
            0
          );

        setMatchStatus(
          status
        );

        statusRef.current =
          status;

        setMatchMinute(
          minute
        );

        minuteRef.current =
          minute;

        const firstHalf =
          safeNumber(
            matchData.injuryTimeFirstHalf,
            2
          );

        const secondHalf =
          safeNumber(
            matchData.injuryTimeSecondHalf,
            3
          );

        setInjuryTime({
          firstHalf,
          secondHalf,
        });

        // ====================================================
        // RESTORE ENGINE
        // ====================================================

        if (
          status === "live" ||
          status === "half-time" ||
          status === "finished"
        ) {
          const savedEngine =
            normalizeEngineState(
              matchData.simulation,
              savedHomeXI,
              savedAwayXI,
              formation
            );

          engineRef.current =
            savedEngine;

          setEngineState(
            savedEngine
          );
        }
      } catch (err) {
        console.error(
          "Match loading error:",
          err
        );

        if (!cancelled) {
          setError(
            err.message ||
              "Failed to load match."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [
    id,
    user,
    authLoading,
    loadPlayers,
  ]);

  // ==========================================================
  // CURRENT FORMATION
  // ==========================================================

  const formation =
    match?.formation ||
    "4-4-2";

  // ==========================================================
  // SAVE
  // ==========================================================

  const saveMatchState =
    useCallback(
      async (
        nextStatus = statusRef.current
      ) => {
        const currentMatch =
          matchRef.current;

        const currentUser =
          userRef.current;

        const currentEngine =
          engineRef.current;

        if (
          !currentMatch?.id ||
          !currentUser ||
          !currentEngine
        ) {
          return;
        }

        try {
          setIsSaving(true);

          await updateDoc(
            doc(
              db,
              "matches",
              currentMatch.id
            ),
            {
              status: nextStatus,

              minute:
                minuteRef.current,

              homeScore:
                currentEngine.score.home,

              awayScore:
                currentEngine.score.away,

              result: {
                homeScore:
                  currentEngine.score.home,

                awayScore:
                  currentEngine.score.away,
              },

              homeStats:
                currentEngine.stats.home,

              awayStats:
                currentEngine.stats.away,

              simulation:
                currentEngine,

              events:
                currentEngine.events,

              homeLineup: {
                players:
                  homeXI,
                playerIds:
                  homeXI.map(
                    getPlayerId
                  ),
              },

              awayLineup: {
                players:
                  awayXI,
                playerIds:
                  awayXI.map(
                    getPlayerId
                  ),
              },

              homeLineupIds:
                homeXI.map(
                  getPlayerId
                ),

              awayLineupIds:
                awayXI.map(
                  getPlayerId
                ),

              injuryTimeFirstHalf:
                injuryTime.firstHalf,

              injuryTimeSecondHalf:
                injuryTime.secondHalf,

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (err) {
          console.error(
            "Match save error:",
            err
          );
        } finally {
          setIsSaving(false);
        }
      },
      [
        homeXI,
        awayXI,
        injuryTime,
      ]
    );

  // ==========================================================
  // START MATCH
  // ==========================================================

  const startMatch =
    useCallback(
      async () => {
        let finalHomeXI =
          homeXI;

        let finalAwayXI =
          awayXI;

        // User team must have
        // a valid lineup.
        if (
          controlledTeam === "home"
        ) {
          const validation =
            validateStartingXI(
              homeXI,
              formation
            );

          if (!validation.valid) {
            toast.error(
              validation.message
            );

            return;
          }
        }

        if (
          controlledTeam === "away"
        ) {
          const validation =
            validateStartingXI(
              awayXI,
              formation
            );

          if (!validation.valid) {
            toast.error(
              validation.message
            );

            return;
          }
        }

        // AI fallback
        if (
          finalHomeXI.length !== 11
        ) {
          finalHomeXI =
            selectAIStartingXI(
              homeSquad,
              formation
            );

          setHomeXI(
            finalHomeXI
          );
        }

        if (
          finalAwayXI.length !== 11
        ) {
          finalAwayXI =
            selectAIStartingXI(
              awaySquad,
              formation
            );

          setAwayXI(
            finalAwayXI
          );
        }

        if (
          finalHomeXI.length !== 11 ||
          finalAwayXI.length !== 11
        ) {
          toast.error(
            "Both teams need 11 players."
          );

          return;
        }

        const engine =
          createInitialEngineState(
            finalHomeXI,
            finalAwayXI,
            formation
          );

        engineRef.current =
          engine;

        setEngineState(
          engine
        );

        minuteRef.current =
          0;

        setMatchMinute(
          0
        );

        statusRef.current =
          "live";

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
        homeXI,
        awayXI,
        homeSquad,
        awaySquad,
        controlledTeam,
        formation,
        saveMatchState,
      ]
    );

  // ==========================================================
  // TIMER / REAL MATCH ENGINE
  // ==========================================================

  useEffect(() => {
    if (
      matchStatus !== "live" ||
      isPaused ||
      !engineRef.current
    ) {
      return;
    }

    const timer =
      setInterval(() => {
        const nextMinute =
          minuteRef.current + 1;

        // First half
        const firstHalfEnd =
          45 +
          injuryTime.firstHalf;

        // Full match
        const fullTime =
          90 +
          injuryTime.firstHalf +
          injuryTime.secondHalf;

        if (
          nextMinute >= fullTime
        ) {
          minuteRef.current =
            fullTime;

          setMatchMinute(
            fullTime
          );

          statusRef.current =
            "finished";

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
            "FULL TIME"
          );

          return;
        }

        // Half time
        if (
          nextMinute ===
          firstHalfEnd
        ) {
          minuteRef.current =
            nextMinute;

          setMatchMinute(
            nextMinute
          );

          statusRef.current =
            "half-time";

          setMatchStatus(
            "half-time"
          );

          setIsPaused(
            true
          );

          saveMatchState(
            "half-time"
          );

          toast.success(
            "HALF TIME"
          );

          return;
        }

        // Simulate one minute
        const nextState =
          simulateMinute(
            engineRef.current,
            nextMinute
          );

        engineRef.current =
          nextState;

        minuteRef.current =
          nextMinute;

        setMatchMinute(
          nextMinute
        );

        setEngineState(
          nextState
        );

        // Autosave
        if (
          nextMinute % 5 === 0
        ) {
          saveMatchState(
            "live"
          );
        }
      }, 1000);

    return () => {
      clearInterval(
        timer
      );
    };
  }, [
    matchStatus,
    isPaused,
    injuryTime,
    saveMatchState,
  ]);

  // ==========================================================
  // SECOND HALF
  // ==========================================================

  const startSecondHalf =
    useCallback(
      async () => {
        if (
          matchStatus !==
          "half-time"
        ) {
          return;
        }

        statusRef.current =
          "live";

        setMatchStatus(
          "live"
        );

        setIsPaused(
          false
        );

        await saveMatchState(
          "live"
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
    useCallback(
      async () => {
        if (
          matchStatus !==
          "live"
        ) {
          return;
        }

        setIsPaused(
          (value) => !value
        );

        await saveMatchState(
          "live"
        );
      },
      [
        matchStatus,
        saveMatchState,
      ]
    );

  // ==========================================================
  // FINISH
  // ==========================================================

  const finishMatch =
    useCallback(
      async () => {
        statusRef.current =
          "finished";

        setMatchStatus(
          "finished"
        );

        setIsPaused(
          true
        );

        await saveMatchState(
          "finished"
        );
      },
      [saveMatchState]
    );

  // ==========================================================
  // DISPLAY
  // ==========================================================

  const homeStats =
    engineState?.stats?.home ||
    createDefaultStats();

  const awayStats =
    engineState?.stats?.away ||
    createDefaultStats();

  const homeScore =
    engineState?.score?.home ||
    0;

  const awayScore =
    engineState?.score?.away ||
    0;

  const events =
    engineState?.events ||
    [];

  const statusLabel =
    matchStatus === "ready"
      ? "READY"
      : matchStatus === "live"
      ? isPaused
        ? "PAUSED"
        : "LIVE"
      : matchStatus ===
        "half-time"
      ? "HALF TIME"
      : matchStatus ===
        "finished"
      ? "FULL TIME"
      : "LOADING";

  const displayMinute =
    matchMinute > 90
      ? `90+${matchMinute - 90}`
      : matchMinute;

  const controlledClub =
    controlledTeam === "home"
      ? homeClub
      : awayClub;

  const lineupIsValid =
    controlledTeam === "home"
      ? validateStartingXI(
          homeXI,
          formation
        ).valid
      : controlledTeam === "away"
      ? validateStartingXI(
          awayXI,
          formation
        ).valid
      : true;

  // ==========================================================
  // RENDER STATES
  // ==========================================================

  if (
    authLoading ||
    loading
  ) {
    return (
      <div
        className={styles.loading}
      >
        Loading match...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={
          styles.errorContainer
        }
      >
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
        Match not found.
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>
          {homeClub.name} vs{" "}
          {awayClub.name} | Match
        </title>
      </Head>

      <main
        className={styles.page}
      >
        {/* ============================================== */}
        {/* HEADER */}
        {/* ============================================== */}

        <header
          className={
            styles.header
          }
        >
          <button
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

          <strong>
            {statusLabel}
          </strong>
        </header>

        {/* ============================================== */}
        {/* SCORE */}
        {/* ============================================== */}

        <section
          className={
            styles.scoreboard
          }
        >
          <div>
            <strong>
              {homeClub.name}
            </strong>

            <small>
              HOME
            </small>
          </div>

          <div
            className={
              styles.scoreMiddle
            }
          >
            <strong>
              {homeScore} -{" "}
              {awayScore}
            </strong>

            <span>
              {displayMinute}'
            </span>
          </div>

          <div>
            <strong>
              {awayClub.name}
            </strong>

            <small>
              AWAY
            </small>
          </div>
        </section>

        {/* ============================================== */}
        {/* LINEUP SELECTION */}
        {/* ============================================== */}

        {matchStatus ===
          "ready" &&
          controlledTeam && (
            <LineupSelector
              squad={
                controlledTeam ===
                "home"
                  ? homeSquad
                  : awaySquad
              }
              formation={
                formation
              }
              selectedIds={
                selectedIds
              }
              onChange={
                (ids) => {
                  setSelectedIds(
                    ids
                  );

                  const selected =
                    (
                      controlledTeam ===
                      "home"
                        ? homeSquad
                        : awaySquad
                    ).filter(
                      (player) =>
                        ids.includes(
                          getPlayerId(
                            player
                          )
                        )
                    );

                  if (
                    controlledTeam ===
                    "home"
                  ) {
                    setHomeXI(
                      selected
                    );
                  } else {
                    setAwayXI(
                      selected
                    );
                  }
                }
              }
            />
          )}

        {/* ============================================== */}
        {/* AI INFO */}
        {/* ============================================== */}

        {matchStatus ===
          "ready" && (
          <div
            style={{
              padding: "12px",
              borderRadius: "10px",
              background:
                "#111827",
              color:
                "#cbd5e1",
              marginBottom:
                "15px",
            }}
          >
            <strong>
              AI Team Selection
            </strong>

            <p
              style={{
                margin:
                  "5px 0 0",
              }}
            >
              {hasManager(
                controlledTeam ===
                  "home"
                  ? awayClub
                  : homeClub
              )
                ? "Opponent has a manager. Saved lineup will be used when available."
                : "Opponent has no manager. System AI automatically selects the strongest suitable Starting XI."}
            </p>
          </div>
        )}

        {/* ============================================== */}
        {/* 3D PITCH */}
        {/* ============================================== */}

        <section
          className={
            styles.pitchContainer
          }
        >
          <ThreePitch
            playerStates={
              engineState?.players || {
                home: [],
                away: [],
              }
            }
            ballState={
              engineState?.ball ||
              null
            }
            lastAction={
              engineState?.lastAction ||
              null
            }
            homeColor={
              homeClub.primaryColor ||
              homeClub.color ||
              "#2563eb"
            }
            awayColor={
              awayClub.primaryColor ||
              awayClub.color ||
              "#dc2626"
            }
          />
        </section>

        {/* ============================================== */}
        {/* CONTROLS */}
        {/* ============================================== */}

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
              disabled={
                !lineupIsValid ||
                isSaving
              }
              onClick={
                startMatch
              }
            >
              ▶ START MATCH
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
                onClick={
                  finishMatch
                }
              >
                ⏹ Finish
              </button>
            </>
          )}

          {matchStatus ===
            "half-time" && (
            <button
              className={
                styles.primaryButton
              }
              onClick={
                startSecondHalf
              }
            >
              ▶ START SECOND HALF
            </button>
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

        {/* ============================================== */}
        {/* TEAM STATISTICS */}
        {/* ============================================== */}

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
              "Passes Completed",
              homeStats.passesCompleted,
              awayStats.passesCompleted,
            ],

            [
              "Tackles",
              homeStats.tackles,
              awayStats.tackles,
            ],

            [
              "Interceptions",
              homeStats.interceptions,
              awayStats.interceptions,
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

            [
              "Yellow Cards",
              homeStats.yellow,
              awayStats.yellow,
            ],

            [
              "Red Cards",
              homeStats.red,
              awayStats.red,
            ],

            [
              "Attacks",
              homeStats.attacks,
              awayStats.attacks,
            ],

            [
              "Dangerous Attacks",
              homeStats.dangerousAttacks,
              awayStats.dangerousAttacks,
            ],

            [
              "Dribbles",
              homeStats.successfulDribbles,
              awayStats.successfulDribbles,
            ],
          ].map(
            (row) => (
              <div
                key={row[0]}
                className={
                  styles.statRow
                }
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

        {/* ============================================== */}
        {/* LIVE MATCH PLAY */}
        {/* ============================================== */}

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
            <span>
              LIVE MATCH PLAY
            </span>

            <strong>
              {events.length} events
            </strong>
          </div>

          <div
            className={
              styles.eventsList
            }
          >
            {events.length ? (
              events
                .slice(0, 50)
                .map(
                  (event) => (
                    <div
                      key={
                        event.id
                      }
                      className={
                        styles.event
                      }
                    >
                      <strong>
                        {event.minute}'
                      </strong>

                      <span>
                        {event.type ===
                        "goal"
                          ? "⚽"
                          : event.type ===
                            "pass"
                          ? "➡️"
                          : event.type ===
                            "shot"
                          ? "💥"
                          : event.type ===
                            "save"
                          ? "🧤"
                          : event.type ===
                            "tackle"
                          ? "🦵"
                          : event.type ===
                            "yellow"
                          ? "🟨"
                          : event.type ===
                            "foul"
                          ? "⚠️"
                          : "🔄"}
                      </span>

                      <div
                        style={{
                          flex: 1,
                        }}
                      >
                        <strong>
                          {event.type.toUpperCase()}
                        </strong>

                        <p>
                          {
                            event.detail
                          }
                        </p>
                      </div>

                      <small>
                        {event.team ===
                        "home"
                          ? homeClub.name
                          : awayClub.name}
                      </small>
                    </div>
                  )
                )
            ) : (
              <p>
                No match events yet.
              </p>
            )}
          </div>
        </section>

        {/* ============================================== */}
        {/* LINEUPS */}
        {/* ============================================== */}

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
              {homeClub.name}
              <small>
                Starting XI
              </small>
            </h3>

            {homeXI.map(
              (player) => (
                <div
                  key={
                    getPlayerId(
                      player
                    )
                  }
                  className={
                    styles.lineupPlayer
                  }
                >
                  <span>
                    {getPlayerName(
                      player
                    )}
                  </span>

                  <small>
                    {getPlayerRole(
                      player
                    )}
                  </small>

                  <strong>
                    {getPlayerOverall(
                      player
                    )}
                  </strong>
                </div>
              )
            )}
          </div>

          <div
            className={
              styles.lineupCard
            }
          >
            <h3>
              {awayClub.name}
              <small>
                Starting XI
              </small>
            </h3>

            {awayXI.map(
              (player) => (
                <div
                  key={
                    getPlayerId(
                      player
                    )
                  }
                  className={
                    styles.lineupPlayer
                  }
                >
                  <span>
                    {getPlayerName(
                      player
                    )}
                  </span>

                  <small>
                    {getPlayerRole(
                      player
                    )}
                  </small>

                  <strong>
                    {getPlayerOverall(
                      player
                    )}
                  </strong>
                </div>
              )
            )}
          </div>
        </section>

        {/* ============================================== */}
        {/* MATCH INFORMATION */}
        {/* ============================================== */}

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
              FORMATION
            </span>

            <strong>
              {formation}
            </strong>
          </div>

          <div>
            <span>
              INJURY TIME
            </span>

            <strong>
              +
              {
                injuryTime.firstHalf
              }{" "}
              / +
              {
                injuryTime.secondHalf
              }
            </strong>
          </div>
        </section>
      </main>
    </>
  );
}
