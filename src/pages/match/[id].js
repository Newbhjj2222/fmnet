import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import Head from "next/head";
import { useRouter } from "next/router";

import {
  doc,
  getDoc,
  updateDoc,
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
   ERROR HELPERS
========================================================= */

function getErrorLocation(error) {
  const stack = String(
    error?.stack || ""
  );

  /*
   * Matches:
   *   at function (file.js:10:20)
   *   at file.js:10:20
   *   file.js:10:20
   */
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

  const {
    collection,
    getDocs,
    query,
    where,
  } =
    await import(
      "firebase/firestore"
    );

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
   MAIN PAGE
========================================================= */

export default function MatchPage() {
  const router =
    useRouter();

  const {
    id: matchId,
  } = router.query;

  /* -------------------------------------------------------
     REFS
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     STATE
  ------------------------------------------------------- */

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

  /* =======================================================
     GLOBAL BROWSER ERROR HANDLERS
  ======================================================= */

  useEffect(() => {
    if (
      typeof window ===
      "undefined"
    ) {
      return;
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
          return;
        }

        try {
          setSaving(true);

          let result;

          try {
            result =
              engine.serializeResult();
          } catch (error) {
            const details =
              printDetailedError(
                error,
                "engine.serializeResult()"
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
                result?.minute ??
                0,

              second:
                engine?.second ??
                0,

              homeScore:
                result?.homeScore ??
                0,

              awayScore:
                result?.awayScore ??
                0,

              score:
                result?.score ?? {
                  home: 0,
                  away: 0,
                },

              homeStats:
                result?.homeStats ??
                {},

              awayStats:
                result?.awayStats ??
                {},

              events:
                Array.isArray(
                  result?.events
                )
                  ? result.events
                  : [],

              homeLineupIds:
                Array.isArray(
                  engine?.home?.players
                )
                  ? engine.home.players.map(
                      (p) => p.id
                    )
                  : [],

              awayLineupIds:
                Array.isArray(
                  engine?.away?.players
                )
                  ? engine.away.players.map(
                      (p) => p.id
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
                engine?.home
                  ?.substitutionsUsed ??
                0,

              awaySubsUsed:
                engine?.away
                  ?.substitutionsUsed ??
                0,

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
     MOUNT / UNMOUNT
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
     INITIALIZE MATCH
  ======================================================= */

  useEffect(() => {
    if (
      !router.isReady ||
      !matchId
    ) {
      return;
    }

    let cancelled =
      false;

    async function initialize() {
      try {
        setLoading(true);
        setError(null);
        crashedRef.current =
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

        const homeClubId =
          match?.homeClubId ??
          match?.homeTeamId;

        const awayClubId =
          match?.awayClubId ??
          match?.awayTeamId;

        /* -----------------------------------------------
           HOME PLAYERS
        ------------------------------------------------ */

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

        /* -----------------------------------------------
           AWAY PLAYERS
        ------------------------------------------------ */

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

        /* -----------------------------------------------
           LINEUPS
        ------------------------------------------------ */

        const homeLineupIds =
          Array.isArray(
            match?.homeLineupIds
          )
            ? match.homeLineupIds
            : idsFromPlayers(
                homePlayers.slice(
                  0,
                  11
                )
              );

        const awayLineupIds =
          Array.isArray(
            match?.awayLineupIds
          )
            ? match.awayLineupIds
            : idsFromPlayers(
                awayPlayers.slice(
                  0,
                  11
                )
              );

        /* -----------------------------------------------
           FORMATIONS
        ------------------------------------------------ */

        const homeFormation =
          match?.homeFormation ??
          "4-4-2";

        const awayFormation =
          match?.awayFormation ??
          "4-4-2";

        /* -----------------------------------------------
           TACTICS
        ------------------------------------------------ */

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

        /* -----------------------------------------------
           SCORE
        ------------------------------------------------ */

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

        /* -----------------------------------------------
           ENGINE CONFIG
        ------------------------------------------------ */

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

          initialMinute:
            Number(
              match?.minute || 0
            ) || 0,

          initialEvents:
            Array.isArray(
              match?.events
            )
              ? match.events
              : [],
        };

        console.log(
          "⚙️ Creating MatchEngine:",
          engineConfig
        );

        /* -----------------------------------------------
           CREATE ENGINE
        ------------------------------------------------ */

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

        eventIndexRef.current =
          Array.isArray(
            engine.events
          )
            ? engine.events.length
            : 0;

        /* -----------------------------------------------
           UI STATE
        ------------------------------------------------ */

        setUserTactics(
          homeTactics
        );

        setFormation(
          homeFormation
        );

        /* -----------------------------------------------
           INITIAL SNAPSHOT
        ------------------------------------------------ */

        let initialSnapshot;

        try {
          initialSnapshot =
            engine.getSnapshot();
        } catch (error) {
          const details =
            printDetailedError(
              error,
              "engine.getSnapshot() during initialization"
            );

          throw Object.assign(
            new Error(
              `Could not create initial snapshot: ${details.message}`
            ),
            {
              originalError:
                error,
              details,
            }
          );
        }

        setSnapshot(
          initialSnapshot
        );

        /* -----------------------------------------------
           START ENGINE
        ------------------------------------------------ */

        try {
          if (
            typeof engine.start ===
            "function"
          ) {
            engine.start();
          }
        } catch (error) {
          const details =
            printDetailedError(
              error,
              "engine.start()"
            );

          throw Object.assign(
            new Error(
              `MatchEngine.start() failed: ${details.message}`
            ),
            {
              originalError:
                error,
              details,
            }
          );
        }

        /* -----------------------------------------------
           SAVE LIVE STATUS
        ------------------------------------------------ */

        try {
          await updateDoc(
            matchRef,
            {
              status:
                "live",

              homeLineupIds:
                engine?.home?.players?.map(
                  (p) => p.id
                ) || [],

              awayLineupIds:
                engine?.away?.players?.map(
                  (p) => p.id
                ) || [],

              homeFormation:
                engine?.home?.formation ??
                homeFormation,

              awayFormation:
                engine?.away?.formation ??
                awayFormation,

              homeTactics:
                engine?.home?.tactics ??
                homeTactics,

              awayTactics:
                engine?.away?.tactics ??
                awayTactics,

              startedAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (error) {
          /*
           * Firestore failure should not destroy
           * the actual match engine.
           */
          printDetailedError(
            error,
            "initial match Firestore update"
          );
        }

        if (cancelled) {
          return;
        }

        setLoading(false);

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

      dt = Math.min(
        0.05,
        Math.max(
          0,
          dt
        )
      );

      lastFrameRef.current =
        now;

      /* -----------------------------------------------
         ENGINE UPDATE
      ------------------------------------------------ */

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

      /* -----------------------------------------------
         UI UPDATE
      ------------------------------------------------ */

      if (
        now - lastUi >
        33
      ) {
        lastUi = now;

        try {
          const nextSnapshot =
            engine.getSnapshot();

          setSnapshot(
            nextSnapshot
          );
        } catch (error) {
          crashedRef.current =
            true;

          const details =
            printDetailedError(
              error,
              "engine.getSnapshot() during animation"
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
      }

      /* -----------------------------------------------
         AUTO SAVE TIMER
      ------------------------------------------------ */

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

      /* -----------------------------------------------
         FINISH CHECK
      ------------------------------------------------ */

      try {
        if (
          typeof engine.isFinished ===
            "function" &&
          engine.isFinished()
        ) {
          setSnapshot(
            engine.getSnapshot()
          );

          saveMatch(
            engine,
            true
          );

          return;
        }
      } catch (error) {
        crashedRef.current =
          true;

        const details =
          printDetailedError(
            error,
            "engine.isFinished()"
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

      /* -----------------------------------------------
         NEXT FRAME
      ------------------------------------------------ */

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

      engine.setUserTactics(
        safeTactics
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

      setError(
        details
      );
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

      engine.setFormation(
        "home",
        nextFormation
      );

      setSnapshot(
        engine.getSnapshot()
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

      setError(
        details
      );
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
        engine.getSnapshot()
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

      setError(
        details
      );
    }
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
          className={styles.error}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "900px",
              margin: "0 auto",
              padding: "20px",
            }}
          >
            <h1>
              Match Engine Error
            </h1>

            <p>
              Umukino wahagaritswe kubera
              error. Noneho aho gukeka file,
              page irakubwira aho error
              yaturutse.
            </p>

            <div
              style={{
                marginTop: "20px",
                padding: "16px",
                borderRadius: "12px",
                background:
                  "rgba(255,0,0,0.08)",
                border:
                  "1px solid rgba(255,0,0,0.25)",
                overflowX: "auto",
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
                marginTop: "20px",
              }}
            >
              <summary>
                Show full stack trace
              </summary>

              <pre
                style={{
                  marginTop: "12px",
                  padding: "16px",
                  whiteSpace:
                    "pre-wrap",
                  wordBreak:
                    "break-word",
                  overflowX: "auto",
                  borderRadius: "12px",
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
                marginTop: "20px",
                padding:
                  "12px 18px",
                border: "none",
                borderRadius:
                  "10px",
                cursor: "pointer",
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
        {/* ================================================
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
              {home?.score ??
                0}
            </span>

            <small>
              {snapshot?.minute ??
                0}
              :
              {String(
                snapshot?.second ??
                  0
              ).padStart(
                2,
                "0"
              )}
            </small>

            <span>
              {away?.score ??
                0}
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

        {/* ================================================
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
            {snapshot?.status ===
            "finished"
              ? "FULL TIME"
              : "LIVE"}

            {saving && (
              <span>
                Saving...
              </span>
            )}
          </div>
        </section>

        {/* ================================================
            USER CONTROLS
        ================================================= */}

        <section
          className={
            styles.controlGrid
          }
        >
          <div>
            <LineupFormation
              team={home}
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
                snapshot?.status ===
                "finished"
              }
            />

            <div
              className={
                styles.spacer
              }
            />

            <SubstitutionPanel
              team={{
                ...(home || {}),
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
                snapshot?.status ===
                "finished"
              }
            />
          </div>
        </section>

        {/* ================================================
            AWAY / STATS
        ================================================= */}

        <section
          className={
            styles.controlGrid
          }
        >
          <LineupFormation
            team={away}
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

        {/* ================================================
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
