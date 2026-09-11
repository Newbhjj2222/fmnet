import {
  useCallback,
  useEffect,
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

import MatchEngine from "../../lib/match-engine/engine";

import {
  DEFAULT_TACTICS,
} from "../../lib/match-engine/constants";

import MatchCanvas from "../../components/match/MatchCanvas";
import LineupFormation from "../../components/match/LineupFormation";
import TacticsPanel from "../../components/match/TacticsPanel";
import SubstitutionPanel from "../../components/match/SubstitutionPanel";
import MatchStats from "../../components/match/MatchStats";
import MatchEvents from "../../components/match/MatchEvents";

import styles from "./Mach.module.css";

/* =========================================================
   MATCH TIME CONFIGURATION

   90 football minutes = 8 real minutes

   8 minutes = 480 seconds
   480 / 90 = 5.333 real seconds per football minute
========================================================= */

const MATCH_CONFIG = {
  footballMinutes: 90,

  realDurationSeconds: 8 * 60,

  firstHalfMinutes: 45,

  secondHalfMinutes: 45,
};

/* =========================================================
   ERROR HELPERS
========================================================= */

function getErrorLocation(error) {
  const stack = String(
    error?.stack || ""
  );

  const patterns = [
    /at\s+.*?\((.*?):(\d+):(\d+)\)/,
    /at\s+(.*?):(\d+):(\d+)/,
    /(.*?):(\d+):(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = stack.match(pattern);

    if (match) {
      return {
        file: match[1] || "Unknown file",
        line: match[2] || "?",
        column: match[3] || "?",
      };
    }
  }

  return {
    file: "Unknown file",
    line: "?",
    column: "?",
  };
}

function createDetailedError(
  error,
  context = "Unknown context"
) {
  const message =
    error?.message ||
    String(error) ||
    "Unknown error";

  const stack =
    error?.stack ||
    `${error?.name || "Error"}: ${message}`;

  const location =
    getErrorLocation(error);

  return {
    name:
      error?.name ||
      "Error",

    message,

    context,

    file:
      location.file,

    line:
      location.line,

    column:
      location.column,

    stack,
  };
}

function printDetailedError(
  error,
  context = "Unknown context"
) {
  const details =
    createDetailedError(
      error,
      context
    );

  console.error(
    "\n========================================"
  );

  console.error(
    "🔥 MATCH ENGINE ERROR"
  );

  console.error(
    "========================================"
  );

  console.error(
    "Context:",
    details.context
  );

  console.error(
    "Name:",
    details.name
  );

  console.error(
    "Message:",
    details.message
  );

  console.error(
    "File:",
    details.file
  );

  console.error(
    "Line:",
    details.line
  );

  console.error(
    "Column:",
    details.column
  );

  console.error(
    "Stack:",
    details.stack
  );

  console.error(
    "========================================\n"
  );

  return details;
}

/* =========================================================
   PLAYER NORMALIZATION
========================================================= */

function normalizePlayer(
  data,
  id
) {
  const source =
    data || {};

  const overall = Number(
    source.overall ??
      source.rating ??
      source.ovr ??
      60
  );

  return {
    id,

    ...source,

    shirtNumber:
      source.shirtNumber ??
      source.jerseyNumber ??
      source.kitNumber ??
      source.number ??
      null,

    number:
      source.shirtNumber ??
      source.jerseyNumber ??
      source.kitNumber ??
      source.number ??
      null,

    overall:
      Number.isFinite(
        overall
      )
        ? overall
        : 60,
  };
}

/* =========================================================
   LOAD PLAYERS
========================================================= */

async function loadPlayers(
  clubId
) {
  if (!clubId) {
    console.warn(
      "⚠️ loadPlayers called without clubId"
    );

    return [];
  }

  const sources = [
    ["clubId", clubId],
    ["teamId", clubId],
    ["currentClub", clubId],
  ];

  for (
    const [field, value] of sources
  ) {
    try {
      const q =
        query(
          collection(
            db,
            "players"
          ),
          where(
            field,
            "==",
            value
          )
        );

      const snap =
        await getDocs(q);

      if (
        !snap.empty
      ) {
        return snap.docs.map(
          (docSnap) =>
            normalizePlayer(
              docSnap.data(),
              docSnap.id
            )
        );
      }
    } catch (error) {
      printDetailedError(
        error,
        `loadPlayers -> players where ${field}`
      );
    }
  }

  console.warn(
    `⚠️ No players found for club ${clubId}`
  );

  return [];
}

/* =========================================================
   PLAYER IDS
========================================================= */

function idsFromPlayers(
  players
) {
  if (
    !Array.isArray(players)
  ) {
    return [];
  }

  return players
    .map(
      (player) =>
        player?.id ??
        player?.playerId
    )
    .filter(Boolean);
}

/* =========================================================
   EMBEDDED PLAYERS
========================================================= */

function getEmbeddedPlayers(
  match,
  side
) {
  const candidates =
    side === "home"
      ? [
          match?.homePlayers,
          match?.homeLineup,
          match?.homeSquad,
        ]
      : [
          match?.awayPlayers,
          match?.awayLineup,
          match?.awaySquad,
        ];

  for (
    const value of candidates
  ) {
    if (
      Array.isArray(value) &&
      value.length
    ) {
      return value.map(
        (player, index) =>
          normalizePlayer(
            player,
            player?.id ??
              player?.playerId ??
              `embedded-${side}-${index}`
          )
      );
    }
  }

  return [];
}

/* =========================================================
   SAFE ENGINE SNAPSHOT
========================================================= */

function getSafeSnapshot(
  engine
) {
  if (!engine) {
    return null;
  }

  if (
    typeof engine.getSnapshot ===
    "function"
  ) {
    return engine.getSnapshot();
  }

  if (
    typeof engine.serializeResult ===
    "function"
  ) {
    return engine.serializeResult();
  }

  if (
    typeof engine.getState ===
    "function"
  ) {
    return engine.getState();
  }

  throw new Error(
    "MatchEngine has no getSnapshot(), serializeResult(), or getState() method."
  );
}

/* =========================================================
   SAFE SERIALIZE RESULT
========================================================= */

function getSerializableResult(
  engine
) {
  if (!engine) {
    return null;
  }

  if (
    typeof engine.serializeResult ===
    "function"
  ) {
    return engine.serializeResult();
  }

  if (
    typeof engine.getSnapshot ===
    "function"
  ) {
    return engine.getSnapshot();
  }

  if (
    typeof engine.getState ===
    "function"
  ) {
    return engine.getState();
  }

  throw new Error(
    "MatchEngine cannot serialize its result."
  );
}

/* =========================================================
   FORMAT SCORE
========================================================= */

function getScore(
  snapshot,
  side
) {
  const direct =
    side === "home"
      ? snapshot?.homeScore
      : snapshot?.awayScore;

  if (
    Number.isFinite(
      Number(direct)
    )
  ) {
    return Number(
      direct
    );
  }

  return Number(
    snapshot?.score?.[side] ??
      snapshot?.[side]?.score ??
      0
  );
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function MatchPage() {
  const router =
    useRouter();

  const {
    id: matchId,
  } = router.query;

  /* =======================================================
     REFS
  ======================================================= */

  const engineRef =
    useRef(null);

  const animationRef =
    useRef(null);

  const lastFrameRef =
    useRef(null);

  const saveTimerRef =
    useRef(0);

  const eventIndexRef =
    useRef(0);

  const mountedRef =
    useRef(true);

  const crashedRef =
    useRef(false);

  const finishHandledRef =
    useRef(false);

  const halftimeHandledRef =
    useRef(false);

  const redirectTimerRef =
    useRef(null);

  /* =======================================================
     STATE
  ======================================================= */

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState(null);

  const [snapshot, setSnapshot] =
    useState(null);

  const [userTactics, setUserTactics] =
    useState(
      DEFAULT_TACTICS
    );

  const [formation, setFormation] =
    useState(
      "4-4-2"
    );

  const [saving, setSaving] =
    useState(false);

  const [matchStarted, setMatchStarted] =
    useState(false);

  const [starting, setStarting] =
    useState(false);

  const [halfTime, setHalfTime] =
    useState(false);

  const [finishing, setFinishing] =
    useState(false);

  /* =======================================================
     GLOBAL ERROR HANDLERS
  ======================================================= */

  useEffect(() => {
    if (
      typeof window ===
      "undefined"
    ) {
      return undefined;
    }

    function handleWindowError(
      event
    ) {
      const originalError =
        event?.error ||
        new Error(
          event?.message ||
            "Unknown window error"
        );

      const details =
        printDetailedError(
          originalError,
          "window.onerror"
        );

      if (
        mountedRef.current
      ) {
        setError(
          details
        );
      }
    }

    function handleUnhandledRejection(
      event
    ) {
      const reason =
        event?.reason;

      const originalError =
        reason instanceof Error
          ? reason
          : new Error(
              String(
                reason ||
                  "Unhandled promise rejection"
              )
            );

      const details =
        printDetailedError(
          originalError,
          "unhandledrejection"
        );

      if (
        mountedRef.current
      ) {
        setError(
          details
        );
      }
    }

    window.addEventListener(
      "error",
      handleWindowError
    );

    window.addEventListener(
      "unhandledrejection",
      handleUnhandledRejection
    );

    return () => {
      window.removeEventListener(
        "error",
        handleWindowError
      );

      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection
      );
    };
  }, []);

  /* =======================================================
     CLEANUP
  ======================================================= */

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;

      if (
        animationRef.current
      ) {
        cancelAnimationFrame(
          animationRef.current
        );

        animationRef.current =
          null;
      }

      if (
        redirectTimerRef.current
      ) {
        clearTimeout(
          redirectTimerRef.current
        );

        redirectTimerRef.current =
          null;
      }

      const engine =
        engineRef.current;

      if (
        engine &&
        typeof engine.stop ===
          "function"
      ) {
        try {
          engine.stop();
        } catch (error) {
          printDetailedError(
            error,
            "engine.stop() during cleanup"
          );
        }
      }
    };
  }, []);

  /* =======================================================
     SAVE MATCH
  ======================================================= */

  const saveMatch =
    useCallback(
      async (
        engine,
        final = false
      ) => {
        if (
          !matchId ||
          !engine
        ) {
          return false;
        }

        try {
          setSaving(true);

          const result =
            getSerializableResult(
              engine
            );

          const homeScore =
            getScore(
              result,
              "home"
            );

          const awayScore =
            getScore(
              result,
              "away"
            );

          const matchRef =
            doc(
              db,
              "matches",
              matchId
            );

          await updateDoc(
            matchRef,
            {
              status:
                final
                  ? "finished"
                  : "live",

              minute:
                Number(
                  result?.minute ??
                    engine?.minute ??
                    0
                ),

              second:
                Number(
                  result?.second ??
                    engine?.second ??
                    0
                ),

              homeScore,

              awayScore,

              score: {
                home:
                  homeScore,

                away:
                  awayScore,
              },

              homeStats:
                result?.homeStats ??
                result?.home?.stats ??
                engine?.home?.stats ??
                {},

              awayStats:
                result?.awayStats ??
                result?.away?.stats ??
                engine?.away?.stats ??
                {},

              events:
                Array.isArray(
                  result?.events
                )
                  ? result.events
                  : Array.isArray(
                      engine?.events
                    )
                    ? engine.events
                    : [],

              homeLineupIds:
                Array.isArray(
                  engine?.home?.players
                )
                  ? engine.home.players
                      .filter(
                        (p) =>
                          p?.onPitch !==
                            false &&
                          !p?.substituted
                      )
                      .map(
                        (p) =>
                          p.id
                      )
                  : [],

              awayLineupIds:
                Array.isArray(
                  engine?.away?.players
                )
                  ? engine.away.players
                      .filter(
                        (p) =>
                          p?.onPitch !==
                            false &&
                          !p?.substituted
                      )
                      .map(
                        (p) =>
                          p.id
                      )
                  : [],

              homeFormation:
                engine?.home?.formation ??
                "4-4-2",

              awayFormation:
                engine?.away?.formation ??
                "4-4-2",

              homeTactics:
                engine?.home?.tactics ??
                {},

              awayTactics:
                engine?.away?.tactics ??
                {},

              homeSubsUsed:
                Number(
                  engine?.home
                    ?.substitutionsUsed ??
                    0
                ),

              awaySubsUsed:
                Number(
                  engine?.away
                    ?.substitutionsUsed ??
                    0
                ),

              result:
                result?.result ??
                null,

              ...(final
                ? {
                    finishedAt:
                      serverTimestamp(),
                  }
                : {}),

              updatedAt:
                serverTimestamp(),
            }
          );

          return true;
        } catch (error) {
          const details =
            printDetailedError(
              error,
              "saveMatch -> Firestore updateDoc"
            );

          if (
            mountedRef.current
          ) {
            setError(
              details
            );
          }

          return false;
        } finally {
          if (
            mountedRef.current
          ) {
            setSaving(false);
          }
        }
      },
      [matchId]
    );

  /* =======================================================
     INITIALIZE MATCH
  ======================================================= */

  useEffect(() => {
    if (
      !router.isReady ||
      !matchId
    ) {
      return undefined;
    }

    let cancelled =
      false;

    async function initialize() {
      try {
        setLoading(true);
        setError(null);

        crashedRef.current =
          false;

        finishHandledRef.current =
          false;

        halftimeHandledRef.current =
          false;

        console.log(
          "🏟️ Initializing match:",
          matchId
        );

        const matchRef =
          doc(
            db,
            "matches",
            matchId
          );

        const matchSnap =
          await getDoc(
            matchRef
          );

        if (
          !matchSnap.exists()
        ) {
          throw new Error(
            `Match not found: ${matchId}`
          );
        }

        const match =
          matchSnap.data();

        if (cancelled) {
          return;
        }

        console.log(
          "📦 Match data loaded:",
          match
        );

        /* =================================================
           CLUB IDS
        ================================================= */

        const homeClubId =
          match?.homeClubId ??
          match?.homeTeamId ??
          match?.homeTeam?.id ??
          null;

        const awayClubId =
          match?.awayClubId ??
          match?.awayTeamId ??
          match?.awayTeam?.id ??
          null;

        /* =================================================
           HOME PLAYERS
        ================================================= */

        let homePlayers =
          getEmbeddedPlayers(
            match,
            "home"
          );

        if (
          !homePlayers.length
        ) {
          homePlayers =
            await loadPlayers(
              homeClubId
            );
        }

        /* =================================================
           AWAY PLAYERS
        ================================================= */

        let awayPlayers =
          getEmbeddedPlayers(
            match,
            "away"
          );

        if (
          !awayPlayers.length
        ) {
          awayPlayers =
            await loadPlayers(
              awayClubId
            );
        }

        console.log(
          "👥 Home players:",
          homePlayers.length
        );

        console.log(
          "👥 Away players:",
          awayPlayers.length
        );

        /* =================================================
           LINEUPS
        ================================================= */

        const storedHomeLineup =
          Array.isArray(
            match?.homeLineupIds
          )
            ? match.homeLineupIds
            : [];

        const storedAwayLineup =
          Array.isArray(
            match?.awayLineupIds
          )
            ? match.awayLineupIds
            : [];

        const homeLineupIds =
          storedHomeLineup.length
            ? storedHomeLineup
            : idsFromPlayers(
                homePlayers.slice(
                  0,
                  11
                )
              );

        const awayLineupIds =
          storedAwayLineup.length
            ? storedAwayLineup
            : idsFromPlayers(
                awayPlayers.slice(
                  0,
                  11
                )
              );

        /* =================================================
           FORMATIONS
        ================================================= */

        const homeFormation =
          match?.homeFormation ??
          "4-4-2";

        const awayFormation =
          match?.awayFormation ??
          "4-4-2";

        /* =================================================
           TACTICS
        ================================================= */

        const homeTactics = {
          ...DEFAULT_TACTICS,

          ...(match?.homeTactics ||
            {}),
        };

        const awayTactics = {
          ...DEFAULT_TACTICS,

          ...(match?.awayTactics ||
            {}),
        };

        /* =================================================
           SCORE
        ================================================= */

        const initialScore = {
          home:
            Number(
              match?.homeScore ??
                match?.score?.home ??
                0
            ) || 0,

          away:
            Number(
              match?.awayScore ??
                match?.score?.away ??
                0
            ) || 0,
        };

        /* =================================================
           CURRENT MINUTE

           If an existing live match is loaded, continue
           from its saved minute.

           Otherwise start at minute 0.
        ================================================= */

        const initialMinute =
          Math.max(
            0,
            Math.min(
              90,
              Number(
                match?.minute ??
                  0
              ) || 0
            )
          );

        /* =================================================
           ENGINE CONFIGURATION

           IMPORTANT:

           90 football minutes
           = 480 real seconds
        ================================================= */

        const engineConfig = {
          matchId,

          homeTeam: {
            id:
              homeClubId,

            name:
              match?.homeTeamName ??
              match?.homeClubName ??
              match?.homeTeam?.name ??
              "Home",

            logo:
              match?.homeTeamLogo ??
              match?.homeTeam?.logo ??
              "",
          },

          awayTeam: {
            id:
              awayClubId,

            name:
              match?.awayTeamName ??
              match?.awayClubName ??
              match?.awayTeam?.name ??
              "Away",

            logo:
              match?.awayTeamLogo ??
              match?.awayTeam?.logo ??
              "",
          },

          homePlayers,

          awayPlayers,

          homeLineupIds,

          awayLineupIds,

          formationHome:
            homeFormation,

          formationAway:
            awayFormation,

          tacticsHome:
            homeTactics,

          tacticsAway:
            awayTactics,

          initialScore,

          initialMinute,

          initialEvents:
            Array.isArray(
              match?.events
            )
              ? match.events
              : [],

          /*
           * MATCH CLOCK
           */

          durationMinutes:
            MATCH_CONFIG.footballMinutes,

          matchDurationMinutes:
            MATCH_CONFIG.footballMinutes,

          realDurationSeconds:
            MATCH_CONFIG.realDurationSeconds,

          realMatchDurationSeconds:
            MATCH_CONFIG.realDurationSeconds,

          firstHalfMinutes:
            MATCH_CONFIG.firstHalfMinutes,

          secondHalfMinutes:
            MATCH_CONFIG.secondHalfMinutes,

          /*
           * DO NOT AUTO START.
           *
           * User must press Start.
           */

          autoStart:
            false,

          startPaused:
            true,
        };

        console.log(
          "⚙️ Creating MatchEngine:",
          engineConfig
        );

        /* =================================================
           CREATE ENGINE
        ================================================= */

        let engine;

        try {
          engine =
            new MatchEngine(
              engineConfig
            );
        } catch (error) {
          const details =
            printDetailedError(
              error,
              "new MatchEngine()"
            );

          throw Object.assign(
            new Error(
              `MatchEngine initialization failed: ${details.message}`
            ),
            {
              originalError:
                error,

              details,
            }
          );
        }

        if (!engine) {
          throw new Error(
            "MatchEngine returned undefined."
          );
        }

        engineRef.current =
          engine;

        /* =================================================
           FORCE CLOCK CONFIG IF ENGINE SUPPORTS IT
        ================================================= */

        if (
          "realDurationSeconds" in
          engine
        ) {
          engine.realDurationSeconds =
            MATCH_CONFIG.realDurationSeconds;
        }

        if (
          "matchDurationMinutes" in
          engine
        ) {
          engine.matchDurationMinutes =
            MATCH_CONFIG.footballMinutes;
        }

        if (
          "durationMinutes" in
          engine
        ) {
          engine.durationMinutes =
            MATCH_CONFIG.footballMinutes;
        }

        if (
          "autoStart" in
          engine
        ) {
          engine.autoStart =
            false;
        }

        if (
          "running" in
          engine
        ) {
          engine.running =
            false;
        }

        if (
          "started" in
          engine
        ) {
          engine.started =
            false;
        }

        eventIndexRef.current =
          Array.isArray(
            engine.events
          )
            ? engine.events.length
            : 0;

        /* =================================================
           UI STATE
        ================================================= */

        setUserTactics(
          homeTactics
        );

        setFormation(
          homeFormation
        );

        /* =================================================
           INITIAL SNAPSHOT
        ================================================= */

        const initialSnapshot =
          getSafeSnapshot(
            engine
          );

        setSnapshot(
          initialSnapshot
        );

        /* =================================================
           INITIAL UI CLOCK
        ================================================= */

        const currentMinute =
          Number(
            initialSnapshot?.minute ??
              initialMinute ??
              0
          );

        if (
          currentMinute >= 45 &&
          currentMinute < 90
        ) {
          setHalfTime(true);
        } else {
          setHalfTime(false);
        }

        setMatchStarted(
          false
        );

        /* =================================================
           SAVE LIVE CONFIG

           We intentionally DON'T start the engine here.
        ================================================= */

        try {
          await updateDoc(
            matchRef,
            {
              status:
                initialMinute >=
                  90
                  ? "finished"
                  : "ready",

              homeLineupIds,

              awayLineupIds,

              homeFormation,

              awayFormation,

              homeTactics,

              awayTactics,

              matchDurationMinutes:
                MATCH_CONFIG.footballMinutes,

              realDurationSeconds:
                MATCH_CONFIG.realDurationSeconds,

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (error) {
          printDetailedError(
            error,
            "initial match Firestore configuration update"
          );
        }

        if (cancelled) {
          return;
        }

        setLoading(false);

        /*
         * IMPORTANT:
         *
         * We start the animation loop,
         * but NOT the football engine.
         *
         * The loop waits for Start button.
         */

        startAnimationLoop(
          engine
        );
      } catch (error) {
        const details =
          error?.details ||
          printDetailedError(
            error,
            "Match initialization"
          );

        console.error(
          "❌ MATCH INITIALIZATION FAILED:",
          details
        );

        if (
          !cancelled &&
          mountedRef.current
        ) {
          setError(
            details
          );

          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [
    router.isReady,
    matchId,
  ]);

  /* =======================================================
     START / RESUME ENGINE
  ======================================================= */

  const startMatch =
    useCallback(
      async () => {
        const engine =
          engineRef.current;

        if (!engine) {
          return;
        }

        if (starting) {
          return;
        }

        if (
          finishHandledRef.current
        ) {
          return;
        }

        try {
          setStarting(true);
          setError(null);

          /*
           * Check if match is already finished.
           */

          if (
            typeof engine.isFinished ===
              "function" &&
            engine.isFinished()
          ) {
            return;
          }

          /*
           * Different engine versions may use
           * start() or resume().
           */

          if (
            typeof engine.start ===
            "function"
          ) {
            engine.start();
          } else if (
            typeof engine.resume ===
            "function"
          ) {
            engine.resume();
          } else {
            throw new Error(
              "MatchEngine has neither start() nor resume()."
            );
          }

          /*
           * Mark engine as running if the
           * property exists.
           */

          if (
            "running" in
            engine
          ) {
            engine.running =
              true;
          }

          if (
            "started" in
            engine
          ) {
            engine.started =
              true;
          }

          if (
            "paused" in
            engine
          ) {
            engine.paused =
              false;
          }

          setMatchStarted(
            true
          );

          setHalfTime(
            false
          );

          /*
           * Save status immediately.
           */

          await saveMatch(
            engine,
            false
          );
        } catch (error) {
          const details =
            printDetailedError(
              error,
              "startMatch"
            );

          if (
            mountedRef.current
          ) {
            setError(
              details
            );
          }
        } finally {
          if (
            mountedRef.current
          ) {
            setStarting(false);
          }
        }
      },
      [
        starting,
        saveMatch,
      ]
    );

  /* =======================================================
     PAUSE ENGINE
  ======================================================= */

  const pauseEngine =
    useCallback(
      (
        engine
      ) => {
        if (!engine) {
          return;
        }

        try {
          if (
            typeof engine.pause ===
            "function"
          ) {
            engine.pause();
          } else if (
            typeof engine.stop ===
            "function"
          ) {
            /*
             * DO NOT call stop if engine.stop()
             * permanently destroys the match.
             *
             * Prefer running=false.
             */
          }

          if (
            "running" in
            engine
          ) {
            engine.running =
              false;
          }

          if (
            "paused" in
            engine
          ) {
            engine.paused =
              true;
          }
        } catch (error) {
          printDetailedError(
            error,
            "pauseEngine"
          );
        }
      },
      []
    );

  /* =======================================================
     HANDLE HALFTIME
  ======================================================= */

  const handleHalfTime =
    useCallback(
      async (
        engine
      ) => {
        if (!engine) {
          return;
        }

        if (
          halftimeHandledRef.current
        ) {
          return;
        }

        halftimeHandledRef.current =
          true;

        pauseEngine(
          engine
        );

        setHalfTime(
          true
        );

        setMatchStarted(
          false
        );

        try {
          const current =
            getSafeSnapshot(
              engine
            );

          setSnapshot(
            current
          );
        } catch (error) {
          const details =
            printDetailedError(
              error,
              "handleHalfTime -> getSnapshot"
            );

          if (
            mountedRef.current
          ) {
            setError(
              details
            );
          }
        }

        await saveMatch(
          engine,
          false
        );
      },
      [
        pauseEngine,
        saveMatch,
      ]
    );

  /* =======================================================
     FINISH MATCH
  ======================================================= */

  const finishMatch =
    useCallback(
      async (
        engine
      ) => {
        if (!engine) {
          return;
        }

        if (
          finishHandledRef.current
        ) {
          return;
        }

        finishHandledRef.current =
          true;

        setFinishing(
          true
        );

        try {
          pauseEngine(
            engine
          );

          if (
            "minute" in
            engine
          ) {
            engine.minute =
              90;
          }

          if (
            "second" in
            engine
          ) {
            engine.second =
              0;
          }

          const finalSnapshot =
            getSafeSnapshot(
              engine
            );

          setSnapshot(
            finalSnapshot
          );

          /*
           * Save final result BEFORE redirect.
           */

          await saveMatch(
            engine,
            true
          );

          /*
           * Small delay so the user can see
           * Full Time before leaving.
           */

          redirectTimerRef.current =
            setTimeout(
              () => {
                if (
                  mountedRef.current
                ) {
                  router.push(
                    "/fixtures"
                  );
                }
              },
              1200
            );
        } catch (error) {
          const details =
            printDetailedError(
              error,
              "finishMatch"
            );

          finishHandledRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setError(
              details
            );
          }
        }
      },
      [
        pauseEngine,
        saveMatch,
        router,
      ]
    );

  /* =======================================================
     ANIMATION LOOP
  ======================================================= */

  function startAnimationLoop(
    engine
  ) {
    if (!engine) {
      const details =
        createDetailedError(
          new Error(
            "Cannot start animation loop: engine is undefined."
          ),
          "startAnimationLoop"
        );

      setError(
        details
      );

      return;
    }

    if (
      animationRef.current
    ) {
      cancelAnimationFrame(
        animationRef.current
      );
    }

    lastFrameRef.current =
      performance.now();

    let lastUi =
      performance.now();

    function frame(now) {
      if (
        !mountedRef.current ||
        crashedRef.current
      ) {
        return;
      }

      const previousFrame =
        lastFrameRef.current ??
        now;

      let dt =
        (now -
          previousFrame) /
        1000;

      /*
       * Prevent giant time jumps when
       * browser goes to background.
       */

      dt = Math.min(
        0.05,
        Math.max(
          0,
          dt
        )
      );

      lastFrameRef.current =
        now;

      /* =================================================
         ENGINE UPDATE

         ONLY update when the match is running.
      ================================================= */

      const engineRunning =
        engine?.running === true ||
        engine?.isRunning === true ||
        engine?.started === true;

      /*
       * If engine doesn't expose running state,
       * matchStarted controls it.
       */

      const shouldUpdate =
        engineRunning ||
        matchStarted;

      if (
        shouldUpdate &&
        !halfTime &&
        !finishing
      ) {
        try {
          if (
            typeof engine.update !==
            "function"
          ) {
            throw new Error(
              "MatchEngine.update is not a function."
            );
          }

          engine.update(
            dt
          );
        } catch (error) {
          crashedRef.current =
            true;

          const details =
            printDetailedError(
              error,
              "engine.update(dt)"
            );

          if (
            mountedRef.current
          ) {
            setError(
              details
            );
          }

          if (
            animationRef.current
          ) {
            cancelAnimationFrame(
              animationRef.current
            );

            animationRef.current =
              null;
          }

          return;
        }
      }

      /* =================================================
         UI UPDATE
      ================================================= */

      if (
        now - lastUi >
        33
      ) {
        lastUi = now;

        try {
          const nextSnapshot =
            getSafeSnapshot(
              engine
            );

          if (
            mountedRef.current
          ) {
            setSnapshot(
              nextSnapshot
            );
          }

          if (
            Array.isArray(
              engine.events
            ) &&
            engine.events.length >
              eventIndexRef.current
          ) {
            eventIndexRef.current =
              engine.events.length;
          }

          /* =============================================
             MINUTE DETECTION
          ============================================= */

          const currentMinute =
            Number(
              nextSnapshot?.minute ??
                engine?.minute ??
                0
            );

          /*
           * Half time
           *
           * We only trigger this when the match
           * has actually started.
           */

          if (
            currentMinute >=
              45 &&
            currentMinute <
              90 &&
            matchStarted &&
            !halftimeHandledRef.current
          ) {
            handleHalfTime(
              engine
            );
          }

          /*
           * Full time
           */

          if (
            currentMinute >=
              90 &&
            !finishHandledRef.current
          ) {
            finishMatch(
              engine
            );
          }

          /*
           * Engine itself may report finished.
           */

          if (
            typeof engine.isFinished ===
              "function" &&
            engine.isFinished() &&
            !finishHandledRef.current
          ) {
            finishMatch(
              engine
            );
          }
        } catch (error) {
          crashedRef.current =
            true;

          const details =
            printDetailedError(
              error,
              "engine snapshot during animation"
            );

          if (
            mountedRef.current
          ) {
            setError(
              details
            );
          }

          return;
        }
      }

      /* =================================================
         AUTO SAVE

         Every 10 seconds of real time.
      ================================================= */

      if (
        shouldUpdate &&
        !finishing
      ) {
        saveTimerRef.current +=
          dt * 1000;

        if (
          saveTimerRef.current >=
          10000
        ) {
          saveTimerRef.current =
            0;

          saveMatch(
            engine,
            false
          );
        }
      }

      /* =================================================
         NEXT FRAME
      ================================================= */

      animationRef.current =
        requestAnimationFrame(
          frame
        );
    }

    animationRef.current =
      requestAnimationFrame(
        frame
      );
  }

  /* =======================================================
     TACTICS
  ======================================================= */

  async function handleTacticsChange(
    nextTactics
  ) {
    const engine =
      engineRef.current;

    if (!engine) {
      return;
    }

    try {
      const safeTactics = {
        ...DEFAULT_TACTICS,
        ...(nextTactics ||
          {}),
      };

      setUserTactics(
        safeTactics
      );

      if (
        typeof engine.setUserTactics !==
        "function"
      ) {
        throw new Error(
          "engine.setUserTactics is not a function."
        );
      }

      /*
       * This method is intentionally for
       * the managed HOME team.
       */

      engine.setUserTactics(
        safeTactics
      );

      setSnapshot(
        getSafeSnapshot(
          engine
        )
      );

      await saveMatch(
        engine,
        false
      );
    } catch (error) {
      const details =
        printDetailedError(
          error,
          "handleTacticsChange"
        );

      if (
        mountedRef.current
      ) {
        setError(
          details
        );
      }
    }
  }

  /* =======================================================
     FORMATION
  ======================================================= */

  async function handleFormationChange(
    nextFormation
  ) {
    const engine =
      engineRef.current;

    if (!engine) {
      return;
    }

    try {
      if (
        !nextFormation
      ) {
        throw new Error(
          "Formation is empty."
        );
      }

      setFormation(
        nextFormation
      );

      if (
        typeof engine.setFormation !==
        "function"
      ) {
        throw new Error(
          "engine.setFormation is not a function."
        );
      }

      /*
       * HOME = user's managed team.
       */

      engine.setFormation(
        "home",
        nextFormation
      );

      setSnapshot(
        getSafeSnapshot(
          engine
        )
      );

      await saveMatch(
        engine,
        false
      );
    } catch (error) {
      const details =
        printDetailedError(
          error,
          "handleFormationChange"
        );

      if (
        mountedRef.current
      ) {
        setError(
          details
        );
      }
    }
  }

  /* =======================================================
     SUBSTITUTION
  ======================================================= */

  async function handleSubstitution(
    outgoingId,
    incomingId
  ) {
    const engine =
      engineRef.current;

    if (!engine) {
      return;
    }

    try {
      if (
        typeof engine.substituteUser !==
        "function"
      ) {
        throw new Error(
          "engine.substituteUser is not a function."
        );
      }

      const success =
        engine.substituteUser(
          outgoingId,
          incomingId
        );

      if (!success) {
        console.warn(
          "⚠️ Substitution failed:",
          {
            outgoingId,
            incomingId,
          }
        );

        return;
      }

      setSnapshot(
        getSafeSnapshot(
          engine
        )
      );

      await saveMatch(
        engine,
        false
      );
    } catch (error) {
      const details =
        printDetailedError(
          error,
          "handleSubstitution"
        );

      if (
        mountedRef.current
      ) {
        setError(
          details
        );
      }
    }
  }

  /* =======================================================
     START BUTTON LABEL
  ======================================================= */

  const currentMinute =
    Number(
      snapshot?.minute ??
        engineRef.current?.minute ??
        0
    );

  const isFinished =
    snapshot?.status ===
      "finished" ||
    currentMinute >=
      90 ||
    (
      typeof engineRef.current
        ?.isFinished ===
        "function" &&
      engineRef.current.isFinished()
    );

  let startButtonText =
    "START FIRST HALF";

  if (
    halfTime ||
    (
      currentMinute >=
        45 &&
      currentMinute <
        90
    )
  ) {
    startButtonText =
      "START SECOND HALF";
  }

  if (
    starting
  ) {
    startButtonText =
      "STARTING...";
  }

  /* =======================================================
     ERROR SCREEN
  ======================================================= */

  if (error) {
    return (
      <>
        <Head>
          <title>
            Match Engine Error
          </title>
        </Head>

        <main
          className={
            styles.error
          }
        >
          <div
            style={{
              width:
                "100%",
              maxWidth:
                "900px",
              margin:
                "0 auto",
              padding:
                "20px",
            }}
          >
            <h1>
              Match Engine Error
            </h1>

            <p>
              Umukino wahagaritswe kubera
              error. Error iri hasi irakwereka
              neza method cyangwa file byateje
              ikibazo.
            </p>

            <div
              style={{
                marginTop:
                  "20px",

                padding:
                  "16px",

                borderRadius:
                  "12px",

                background:
                  "rgba(255,0,0,0.08)",

                border:
                  "1px solid rgba(255,0,0,0.25)",

                overflowX:
                  "auto",
              }}
            >
              <p>
                <strong>
                  Error:
                </strong>{" "}
                {error.message}
              </p>

              <p>
                <strong>
                  Context:
                </strong>{" "}
                {error.context}
              </p>

              <p>
                <strong>
                  File:
                </strong>{" "}
                {error.file}
              </p>

              <p>
                <strong>
                  Line:
                </strong>{" "}
                {error.line}
              </p>

              <p>
                <strong>
                  Column:
                </strong>{" "}
                {error.column}
              </p>
            </div>

            <details
              style={{
                marginTop:
                  "20px",
              }}
            >
              <summary>
                Show full stack trace
              </summary>

              <pre
                style={{
                  marginTop:
                    "12px",

                  padding:
                    "16px",

                  whiteSpace:
                    "pre-wrap",

                  wordBreak:
                    "break-word",

                  overflowX:
                    "auto",

                  borderRadius:
                    "12px",

                  background:
                    "rgba(0,0,0,0.35)",
                }}
              >
                {error.stack}
              </pre>
            </details>

            <button
              type="button"
              onClick={() =>
                window.location.reload()
              }
              style={{
                marginTop:
                  "20px",

                padding:
                  "13px 20px",

                border:
                  "none",

                borderRadius:
                  "10px",

                cursor:
                  "pointer",

                fontWeight:
                  "700",
              }}
            >
              Reload Match
            </button>
          </div>
        </main>
      </>
    );
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
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
          Loading match engine...
        </p>
      </div>
    );
  }

  /* =======================================================
     SNAPSHOT
  ======================================================= */

  const home =
    snapshot?.home;

  const away =
    snapshot?.away;

  const homeScore =
    getScore(
      snapshot,
      "home"
    );

  const awayScore =
    getScore(
      snapshot,
      "away"
    );

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          {home?.name ||
            "Home"}{" "}
          vs{" "}
          {away?.name ||
            "Away"}{" "}
          | Virtual Football Manager
        </title>

        <meta
          name="description"
          content="Live 2D football match simulation."
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        {/* =================================================
            SCORE HEADER
        ================================================= */}

        <header
          className={
            styles.scoreHeader
          }
        >
          <div
            className={
              styles.teamHeader
            }
          >
            <strong>
              {home?.name ||
                "Home"}
            </strong>
          </div>

          <div
            className={
              styles.score
            }
          >
            <span>
              {homeScore}
            </span>

            <small>
              {String(
                currentMinute
              ).padStart(
                2,
                "0"
              )}
              :
              {String(
                Number(
                  snapshot?.second ??
                    0
                )
              ).padStart(
                2,
                "0"
              )}
            </small>

            <span>
              {awayScore}
            </span>
          </div>

          <div
            className={
              styles.teamHeader
            }
          >
            <strong>
              {away?.name ||
                "Away"}
            </strong>
          </div>
        </header>

        {/* =================================================
            MATCH STATUS
        ================================================= */}

        <section
          style={{
            display:
              "flex",

            justifyContent:
              "center",

            alignItems:
              "center",

            gap:
              "10px",

            flexWrap:
              "wrap",

            padding:
              "14px 12px",
          }}
        >
          {/* ===============================================
              START BUTTON
          =============================================== */}

          {!isFinished && (
            <button
              type="button"
              onClick={
                startMatch
              }
              disabled={
                starting ||
                (
                  matchStarted &&
                  !halfTime
                )
              }
              style={{
                minWidth:
                  "190px",

                padding:
                  "14px 22px",

                border:
                  "none",

                borderRadius:
                  "12px",

                cursor:
                  starting ||
                  (
                    matchStarted &&
                    !halfTime
                  )
                    ? "not-allowed"
                    : "pointer",

                fontWeight:
                  "800",

                fontSize:
                  "15px",

                opacity:
                  starting ||
                  (
                    matchStarted &&
                    !halfTime
                  )
                    ? 0.65
                    : 1,
              }}
            >
              {startButtonText}
            </button>
          )}

          {/* ===============================================
              HALFTIME MESSAGE
          =============================================== */}

          {halfTime &&
            !isFinished && (
              <div
                style={{
                  padding:
                    "10px 16px",

                  borderRadius:
                    "10px",

                  fontWeight:
                    "700",
                }}
              >
                HALF TIME
              </div>
            )}

          {/* ===============================================
              FULL TIME
          =============================================== */}

          {isFinished && (
            <div
              style={{
                padding:
                  "12px 18px",

                borderRadius:
                  "12px",

                fontWeight:
                  "800",
              }}
            >
              FULL TIME
              {finishing && (
                <span>
                  {" "}
                  • Saving...
                </span>
              )}
            </div>
          )}
        </section>

        {/* =================================================
            PITCH
        ================================================= */}

        <section
          className={
            styles.pitchSection
          }
        >
          <MatchCanvas
            snapshot={
              snapshot
            }
          />

          <div
            className={
              styles.liveBadge
            }
          >
            {isFinished
              ? "FULL TIME"
              : halfTime
                ? "HALF TIME"
                : matchStarted
                  ? "LIVE"
                  : "READY"}

            {saving && (
              <span>
                {" "}
                • Saving...
              </span>
            )}
          </div>
        </section>

        {/* =================================================
            MATCH CLOCK INFO
        ================================================= */}

        <section
          style={{
            textAlign:
              "center",

            padding:
              "10px 15px",

            opacity:
              0.85,
          }}
        >
          <small>
            90 football minutes =
            8 minutes real time
          </small>
        </section>

        {/* =================================================
            USER CONTROLS
        ================================================= */}

        <section
          className={
            styles.controlGrid
          }
        >
          <div>
            <LineupFormation
              team={
                home
              }
            />
          </div>

          <div>
            <TacticsPanel
              tactics={
                userTactics
              }
              formation={
                formation
              }
              onChange={
                handleTacticsChange
              }
              onFormationChange={
                handleFormationChange
              }
              disabled={
                isFinished
              }
            />

            <div
              className={
                styles.spacer
              }
            />

            <SubstitutionPanel
              team={{
                ...(home ||
                  {}),

                bench:
                  engineRef.current
                    ?.home
                    ?.bench ||
                  [],
              }}
              onSubstitute={
                handleSubstitution
              }
              disabled={
                isFinished
              }
            />
          </div>
        </section>

        {/* =================================================
            AWAY / STATS
        ================================================= */}

        <section
          className={
            styles.controlGrid
          }
        >
          <LineupFormation
            team={
              away
            }
          />

          <MatchStats
            home={
              home?.stats
            }
            away={
              away?.stats
            }
          />
        </section>

        {/* =================================================
            EVENTS
        ================================================= */}

        <section>
          <MatchEvents
            events={
              snapshot?.events ||
              []
            }
          />
        </section>
      </main>
    </>
  );
}
