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
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../components/firebase";

import MatchEngine from "../../lib/match-engine/python-engine";

import styles from "./Mach.module.css";


/* =========================================================
   HELPERS
========================================================= */

function firstValue(object, keys, fallback = null) {
  if (!object) return fallback;

  for (const key of keys) {
    const value = object[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return fallback;
}


function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


function safeString(value, fallback = "") {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const result = String(value).trim();

  return result || fallback;
}


function normalizeId(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  if (typeof value === "object") {
    return String(
      value.id ||
      value.clubId ||
      value.teamId ||
      value.value ||
      ""
    );
  }

  return String(value);
}


/* =========================================================
   PLAYER HELPERS
========================================================= */

function playerBelongsToClub(player, clubId) {
  const wanted = normalizeId(clubId);

  if (!wanted) {
    return false;
  }

  const values = [
    player.clubId,
    player.currentClub,
    player.currentClubId,
    player.teamId,
    player.team,
    player.club,
    player.clubID,
  ]
    .filter(
      value =>
        value !== undefined &&
        value !== null
    )
    .map(value =>
      normalizeId(value)
    )
    .filter(Boolean);

  return values.includes(wanted);
}


function normalizePlayer(player = {}, index = 0) {
  const ratings =
    player.ratings ||
    player.stats ||
    {};

  return {
    id: String(
      player.id ||
      player.playerId ||
      player.uid ||
      `player-${index + 1}`
    ),

    name:
      player.name ||
      player.displayName ||
      player.fullName ||
      player.playerName ||
      `Player ${index + 1}`,

    number: safeNumber(
      player.number ??
      player.shirtNumber ??
      player.jerseyNumber,
      index + 1
    ),

    position:
      player.position ||
      player.preferredPosition ||
      player.role ||
      "CM",

    role:
      player.role ||
      player.position ||
      "CM",

    pace: safeNumber(
      player.pace ??
      ratings.pace ??
      ratings.speed,
      70
    ),

    passing: safeNumber(
      player.passing ??
      ratings.passing ??
      ratings.pass,
      70
    ),

    shooting: safeNumber(
      player.shooting ??
      ratings.shooting ??
      ratings.shoot,
      65
    ),

    dribbling: safeNumber(
      player.dribbling ??
      ratings.dribbling ??
      ratings.dribble,
      68
    ),

    defending: safeNumber(
      player.defending ??
      ratings.defending ??
      ratings.defence ??
      ratings.defense,
      65
    ),

    stamina: safeNumber(
      player.stamina ??
      ratings.stamina,
      80
    ),

    strength: safeNumber(
      player.strength ??
      ratings.strength ??
      ratings.physical,
      70
    ),

    vision: safeNumber(
      player.vision ??
      ratings.vision,
      70
    ),

    goalkeeping: safeNumber(
      player.goalkeeping ??
      ratings.goalkeeping ??
      ratings.gk,
      60
    ),

    composure: safeNumber(
      player.composure ??
      ratings.composure,
      65
    ),

    positioning: safeNumber(
      player.positioning ??
      ratings.positioning,
      65
    ),

    acceleration: safeNumber(
      player.acceleration ??
      ratings.acceleration,
      68
    ),

    aggression: safeNumber(
      player.aggression ??
      ratings.aggression,
      60
    ),

    balance: safeNumber(
      player.balance ??
      ratings.balance,
      65
    ),
  };
}


/* =========================================================
   CLUB HELPERS
========================================================= */

function normalizeClub(
  club,
  fallbackId
) {
  return {
    id: String(
      club?.id ||
      club?.clubId ||
      fallbackId
    ),

    name:
      club?.name ||
      club?.clubName ||
      club?.title ||
      "Unknown Club",

    logo:
      club?.logo ||
      club?.logoUrl ||
      club?.image ||
      club?.imageUrl ||
      "",

    formation:
      club?.formation ||
      "4-3-3",

    tactics:
      club?.tactics || {},

    players:
      Array.isArray(club?.players)
        ? club.players
        : [],

    bench:
      Array.isArray(club?.bench)
        ? club.bench
        : [],
  };
}


function getClubId(match, side) {
  if (side === "home") {
    return firstValue(
      match,
      [
        "homeClubId",
        "homeTeamId",
        "homeId",
        "homeClub",
        "homeTeam",
      ]
    );
  }

  return firstValue(
    match,
    [
      "awayClubId",
      "awayTeamId",
      "awayId",
      "awayClub",
      "awayTeam",
    ]
  );
}


function extractEmbeddedPlayers(
  club,
  side
) {
  const possible = [
    club?.players,
    club?.squad,
    club?.lineup,
    club?.[`players${side}`],
  ];

  for (const list of possible) {
    if (Array.isArray(list)) {
      return list;
    }
  }

  return [];
}


/* =========================================================
   BUILD BENCH
========================================================= */

function buildBench(
  explicitBench,
  clubBench,
  allPlayers,
  clubId,
  startingPlayers
) {
  let source = [];

  if (
    Array.isArray(explicitBench) &&
    explicitBench.length
  ) {
    source = explicitBench;
  } else if (
    Array.isArray(clubBench) &&
    clubBench.length
  ) {
    source = clubBench;
  } else {
    const startingIds =
      new Set(
        startingPlayers.map(
          player => String(player.id)
        )
      );

    source =
      allPlayers.filter(
        player =>
          playerBelongsToClub(
            player,
            clubId
          ) &&
          !startingIds.has(
            String(
              player.id ||
              player.playerId ||
              player.uid
            )
          )
      );
  }

  const unique = [];
  const ids = new Set();

  source.forEach(
    (player, index) => {
      const normalized =
        normalizePlayer(
          player,
          index
        );

      if (
        !ids.has(
          normalized.id
        )
      ) {
        ids.add(
          normalized.id
        );

        unique.push(
          normalized
        );
      }
    }
  );

  return unique.slice(0, 9);
}


/* =========================================================
   CLOCK
========================================================= */

function formatClock(
  minute,
  second
) {
  const safeMinute =
    Math.max(
      0,
      Math.floor(
        safeNumber(
          minute,
          0
        )
      )
    );

  const safeSecond =
    Math.max(
      0,
      Math.floor(
        safeNumber(
          second,
          0
        )
      )
    );

  return `${String(
    safeMinute
  ).padStart(2, "0")}:${String(
    safeSecond
  ).padStart(2, "0")}`;
}


/* =========================================================
   FIRESTORE RESULT SAVE
========================================================= */

async function saveFinalResult(
  matchId,
  snapshot
) {
  if (
    !matchId ||
    !snapshot
  ) {
    throw new Error(
      "Final match result is missing."
    );
  }

  const score =
    snapshot.score || {
      home: 0,
      away: 0,
    };

  const home =
    snapshot.home || {};

  const away =
    snapshot.away || {};

  const finalResult = {
    status: "finished",

    minute: safeNumber(
      snapshot.minute,
      90
    ),

    second: safeNumber(
      snapshot.second,
      0
    ),

    score: {
      home: safeNumber(
        score.home,
        0
      ),

      away: safeNumber(
        score.away,
        0
      ),
    },

    homeScore: safeNumber(
      score.home,
      0
    ),

    awayScore: safeNumber(
      score.away,
      0
    ),

    homeTeam: {
      id: safeString(
        home.id
      ),

      name: safeString(
        home.name,
        "Home"
      ),

      logo:
        home.logo || "",
    },

    awayTeam: {
      id: safeString(
        away.id
      ),

      name: safeString(
        away.name,
        "Away"
      ),

      logo:
        away.logo || "",
    },

    stats:
      snapshot.stats || {},

    events:
      Array.isArray(
        snapshot.events
      )
        ? snapshot.events
        : [],

    lastEvent:
      snapshot.lastEvent || null,

    ball:
      snapshot.ball || null,

    result:
      snapshot.result || {
        home:
          safeNumber(
            score.home,
            0
          ),

        away:
          safeNumber(
            score.away,
            0
          ),
      },

    updatedAt:
      serverTimestamp(),

    finishedAt:
      serverTimestamp(),

    resultSaved:
      true,
  };

  const matchRef =
    doc(
      db,
      "matches",
      String(matchId)
    );

  await setDoc(
    matchRef,
    {
      finalResult,
      score: finalResult.score,
      homeScore:
        finalResult.homeScore,
      awayScore:
        finalResult.awayScore,

      status: "finished",

      stats:
        finalResult.stats,

      events:
        finalResult.events,

      result:
        finalResult.result,

      resultSaved: true,

      finishedAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp(),
    },
    {
      merge: true,
    }
  );

  return true;
}


/* =========================================================
   MAIN PAGE
========================================================= */

export default function MatchPage() {
  const router =
    useRouter();

  const {
    id,
  } = router.query;

  const engineRef =
    useRef(null);

  const updateTimerRef =
    useRef(null);

  const resultSavingRef =
    useRef(false);

  const redirectingRef =
    useRef(false);

  const [loading, setLoading] =
    useState(true);

  const [starting, setStarting] =
    useState(false);

  const [savingTactics, setSavingTactics] =
    useState(false);

  const [substituting, setSubstituting] =
    useState(false);

  const [error, setError] =
    useState("");

  const [matchDoc, setMatchDoc] =
    useState(null);

  const [snapshot, setSnapshot] =
    useState(null);

  const [events, setEvents] =
    useState([]);

  const [activeTab, setActiveTab] =
    useState("events");

  const [tactics, setTactics] =
    useState({
      mentality: "balanced",
      tempo: 60,
      pressing: "medium",
      defensiveLine: "medium",
      width: 55,
    });

  const [formation, setFormation] =
    useState("4-3-3");

  const [outgoingPlayer, setOutgoingPlayer] =
    useState("");

  const [incomingPlayer, setIncomingPlayer] =
    useState("");

  const [savingResult, setSavingResult] =
    useState(false);


  /* =======================================================
     SAVE FINAL RESULT + REDIRECT
  ======================================================= */

  const finishAndSave =
    useCallback(
      async finalSnapshot => {
        if (
          !finalSnapshot ||
          !id ||
          resultSavingRef.current ||
          redirectingRef.current
        ) {
          return;
        }

        resultSavingRef.current =
          true;

        setSavingResult(true);
        setError("");

        let lastError =
          null;

        /*
         * Retry Firestore several times.
         * This handles temporary connection problems.
         */

        for (
          let attempt = 1;
          attempt <= 5;
          attempt++
        ) {
          try {
            await saveFinalResult(
              String(id),
              finalSnapshot
            );

            redirectingRef.current =
              true;

            setSavingResult(false);

            /*
             * Give Firestore a moment to finish
             * its local/server synchronization.
             */

            setTimeout(
              () => {
                router.replace(
                  "/fixtures"
                );
              },
              500
            );

            return;
          } catch (err) {
            lastError = err;

            console.error(
              `Final result save attempt ${attempt} failed:`,
              err
            );

            if (
              attempt < 5
            ) {
              await new Promise(
                resolve =>
                  setTimeout(
                    resolve,
                    attempt * 1000
                  )
              );
            }
          }
        }

        resultSavingRef.current =
          false;

        setSavingResult(false);

        setError(
          lastError?.message ||
          "Final result ntibashije kubikwa muri database."
        );
      },
      [id, router]
    );


  /* =======================================================
     LOAD MATCH
  ======================================================= */

  useEffect(() => {
    if (
      !router.isReady ||
      !id
    ) {
      return;
    }

    let cancelled = false;

    async function loadMatch() {
      let engine = null;

      try {
        setLoading(true);
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
            "Match ntiboneka muri database."
          );
        }

        const match =
          matchSnap.data();

        if (cancelled) {
          return;
        }

        setMatchDoc({
          id: matchSnap.id,
          ...match,
        });

        const homeClubId =
          getClubId(
            match,
            "home"
          );

        const awayClubId =
          getClubId(
            match,
            "away"
          );

        if (
          !homeClubId ||
          !awayClubId
        ) {
          throw new Error(
            "Match ibura homeClubId cyangwa awayClubId."
          );
        }

        const normalizedHomeId =
          normalizeId(
            homeClubId
          );

        const normalizedAwayId =
          normalizeId(
            awayClubId
          );

        const [
          homeClubSnap,
          awayClubSnap,
          playersSnap,
        ] =
          await Promise.all([
            getDoc(
              doc(
                db,
                "clubs",
                normalizedHomeId
              )
            ),

            getDoc(
              doc(
                db,
                "clubs",
                normalizedAwayId
              )
            ),

            getDocs(
              collection(
                db,
                "players"
              )
            ),
          ]);

        if (cancelled) {
          return;
        }

        const homeClub =
          normalizeClub(
            homeClubSnap.exists()
              ? homeClubSnap.data()
              : {},
            normalizedHomeId
          );

        const awayClub =
          normalizeClub(
            awayClubSnap.exists()
              ? awayClubSnap.data()
              : {},
            normalizedAwayId
          );

        const allPlayers =
          playersSnap.docs.map(
            playerDoc => ({
              id: playerDoc.id,
              ...playerDoc.data(),
            })
          );


        /* ===============================================
           FIND HOME PLAYERS
        =============================================== */

        let homePlayers =
          allPlayers.filter(
            player =>
              playerBelongsToClub(
                player,
                normalizedHomeId
              )
          );


        /* ===============================================
           FIND AWAY PLAYERS
        =============================================== */

        let awayPlayers =
          allPlayers.filter(
            player =>
              playerBelongsToClub(
                player,
                normalizedAwayId
              )
          );


        /* ===============================================
           MATCH EMBEDDED LINEUPS
        =============================================== */

        const embeddedHome =
          match?.home?.players ||
          match?.home?.lineup ||
          match?.homeLineup ||
          match?.homePlayers ||
          [];

        const embeddedAway =
          match?.away?.players ||
          match?.away?.lineup ||
          match?.awayLineup ||
          match?.awayPlayers ||
          [];

        if (
          Array.isArray(
            embeddedHome
          ) &&
          embeddedHome.length >= 11
        ) {
          homePlayers =
            embeddedHome;
        }

        if (
          Array.isArray(
            embeddedAway
          ) &&
          embeddedAway.length >= 11
        ) {
          awayPlayers =
            embeddedAway;
        }


        /* ===============================================
           CLUB EMBEDDED PLAYERS
        =============================================== */

        if (
          homePlayers.length < 11
        ) {
          const embedded =
            extractEmbeddedPlayers(
              homeClub,
              "home"
            );

          if (
            embedded.length >= 11
          ) {
            homePlayers =
              embedded;
          }
        }

        if (
          awayPlayers.length < 11
        ) {
          const embedded =
            extractEmbeddedPlayers(
              awayClub,
              "away"
            );

          if (
            embedded.length >= 11
          ) {
            awayPlayers =
              embedded;
          }
        }


        /* ===============================================
           NORMALIZE STARTING XI
        =============================================== */

        homePlayers =
          homePlayers
            .slice(0, 11)
            .map(
              normalizePlayer
            );

        awayPlayers =
          awayPlayers
            .slice(0, 11)
            .map(
              normalizePlayer
            );

        if (
          homePlayers.length < 11 ||
          awayPlayers.length < 11
        ) {
          throw new Error(
            `Abakinnyi ntibuzuye. ${homeClub.name}: ${homePlayers.length}, ${awayClub.name}: ${awayPlayers.length}.`
          );
        }


        /* ===============================================
           TACTICS
        =============================================== */

        const homeTactics =
          match?.home?.tactics ||
          homeClub.tactics ||
          {};

        setTactics({
          mentality:
            homeTactics.mentality ||
            "balanced",

          tempo:
            safeNumber(
              homeTactics.tempo,
              60
            ),

          pressing:
            homeTactics.pressing ||
            "medium",

          defensiveLine:
            homeTactics.defensiveLine ||
            "medium",

          width:
            safeNumber(
              homeTactics.width,
              55
            ),
        });

        setFormation(
          match?.home?.formation ||
          homeClub.formation ||
          "4-3-3"
        );


        /* ===============================================
           BENCH
        =============================================== */

        const homeBench =
          buildBench(
            match?.home?.bench,
            homeClub.bench,
            allPlayers,
            normalizedHomeId,
            homePlayers
          );

        const awayBench =
          buildBench(
            match?.away?.bench,
            awayClub.bench,
            allPlayers,
            normalizedAwayId,
            awayPlayers
          );


        /* ===============================================
           ENGINE CONFIG
        =============================================== */

        const engineConfig = {
          matchId: String(id),

          home: {
            ...homeClub,

            players:
              homePlayers,

            bench:
              homeBench,
          },

          away: {
            ...awayClub,

            players:
              awayPlayers,

            bench:
              awayBench,
          },

          metadata: {
            source:
              "firebase",

            matchId:
              String(id),
          },
        };


        engine =
          new MatchEngine(
            engineConfig
          );

        engineRef.current =
          engine;


        /* ===============================================
           ENGINE SUBSCRIPTION
        =============================================== */

        engine.subscribe(
          nextSnapshot => {
            if (
              cancelled ||
              !nextSnapshot
            ) {
              return;
            }

            setSnapshot(
              nextSnapshot
            );

            setEvents(
              Array.isArray(
                nextSnapshot.events
              )
                ? nextSnapshot.events
                : []
            );


            /* ==========================================
               UPDATE FORMATION
            ========================================== */

            if (
              nextSnapshot.home
                ?.formation
            ) {
              setFormation(
                nextSnapshot.home.formation
              );
            }


            /* ==========================================
               UPDATE TACTICS
            ========================================== */

            if (
              nextSnapshot.home
                ?.tactics
            ) {
              setTactics(
                previous => ({
                  ...previous,
                  ...nextSnapshot.home.tactics,
                })
              );
            }


            /* ==========================================
               MATCH FINISHED
            ========================================== */

            if (
              nextSnapshot.status ===
              "finished"
            ) {
              setStarting(false);

              finishAndSave(
                nextSnapshot
              );
            }
          }
        );


        /* ===============================================
           WAIT ENGINE READY
        =============================================== */

        await engine.ready;

        if (cancelled) {
          engine.destroy();
          return;
        }

        const initial =
          engine.getState();

        setSnapshot(
          initial
        );

        setEvents(
          initial?.events || []
        );

        setLoading(false);


        /*
         * If backend already reports finished,
         * save it immediately.
         */

        if (
          initial?.status ===
          "finished"
        ) {
          finishAndSave(
            initial
          );
        }

      } catch (err) {
        console.error(
          "Match loading error:",
          err
        );

        if (!cancelled) {
          setError(
            err?.message ||
            "Failed to load match."
          );

          setLoading(false);
        }

        if (
          engine &&
          cancelled
        ) {
          engine.destroy();
        }
      }
    }

    loadMatch();

    return () => {
      cancelled = true;

      if (
        updateTimerRef.current
      ) {
        clearInterval(
          updateTimerRef.current
        );

        updateTimerRef.current =
          null;
      }

      if (
        engineRef.current
      ) {
        engineRef.current.destroy();

        engineRef.current =
          null;
      }
    };
  }, [
    router.isReady,
    id,
    finishAndSave,
  ]);


  /* =======================================================
     LIVE ENGINE POLLING
  ======================================================= */

  useEffect(() => {
    const engine =
      engineRef.current;

    if (
      !engine ||
      !snapshot
    ) {
      return;
    }

    if (
      snapshot.status !==
      "playing"
    ) {
      if (
        updateTimerRef.current
      ) {
        clearInterval(
          updateTimerRef.current
        );

        updateTimerRef.current =
          null;
      }

      return;
    }

    if (
      updateTimerRef.current
    ) {
      clearInterval(
        updateTimerRef.current
      );
    }

    /*
     * 350ms gives frequent state updates
     * without hammering Render every few milliseconds.
     */

    updateTimerRef.current =
      setInterval(
        () => {
          const current =
            engineRef.current;

          if (
            current &&
            current.isRunning()
          ) {
            current.update();
          }
        },
        350
      );

    return () => {
      if (
        updateTimerRef.current
      ) {
        clearInterval(
          updateTimerRef.current
        );

        updateTimerRef.current =
          null;
      }
    };
  }, [
    snapshot?.status,
  ]);


  /* =======================================================
     START MATCH
  ======================================================= */

  const startMatch =
    useCallback(
      async () => {
        const engine =
          engineRef.current;

        if (!engine) {
          return;
        }

        try {
          setStarting(true);
          setError("");

          await engine.start();

          const state =
            engine.getState();

          setSnapshot(
            state
          );

          setEvents(
            state?.events || []
          );

          setStarting(false);
        } catch (err) {
          console.error(
            "Start error:",
            err
          );

          setError(
            err?.message ||
            "Match ntiyatangiye."
          );

          setStarting(false);
        }
      },
      []
    );


  /* =======================================================
     PAUSE MATCH
  ======================================================= */

  const pauseMatch =
    useCallback(
      async () => {
        const engine =
          engineRef.current;

        if (!engine) {
          return;
        }

        try {
          setError("");

          await engine.pause();

          const state =
            engine.getState();

          setSnapshot(
            state
          );

          setEvents(
            state?.events || []
          );
        } catch (err) {
          console.error(
            "Pause error:",
            err
          );

          setError(
            err?.message ||
            "Pause failed."
          );
        }
      },
      []
    );


  /* =======================================================
     UPDATE TACTIC
  ======================================================= */

  function updateTactic(
    field,
    value
  ) {
    setTactics(
      previous => ({
        ...previous,
        [field]: value,
      })
    );
  }


  /* =======================================================
     SAVE TACTICS
  ======================================================= */

  async function saveTactics() {
    const engine =
      engineRef.current;

    if (!engine) {
      return;
    }

    try {
      setSavingTactics(true);
      setError("");

      await engine.setUserTactics({
        mentality:
          tactics.mentality,

        tempo:
          safeNumber(
            tactics.tempo,
            60
          ),

        pressing:
          tactics.pressing,

        defensiveLine:
          tactics.defensiveLine,

        width:
          safeNumber(
            tactics.width,
            55
          ),
      });

      if (
        formation
      ) {
        await engine.setFormation(
          formation
        );
      }

      const state =
        engine.getState();

      setSnapshot(
        state
      );
    } catch (err) {
      console.error(
        "Tactics error:",
        err
      );

      setError(
        err?.message ||
        "Tactics ntizibitswe."
      );
    } finally {
      setSavingTactics(false);
    }
  }


  /* =======================================================
     FORMATION
  ======================================================= */

  function updateFormationLocal(
    value
  ) {
    setFormation(value);
  }


  /* =======================================================
     SUBSTITUTION
  ======================================================= */

  async function makeSubstitution() {
    const engine =
      engineRef.current;

    if (!engine) {
      return;
    }

    if (
      !outgoingPlayer ||
      !incomingPlayer
    ) {
      setError(
        "Hitamo umukinnyi usohoka n'umusimbura."
      );

      return;
    }

    try {
      setSubstituting(true);
      setError("");

      await engine.substituteUser(
        outgoingPlayer,
        incomingPlayer
      );

      const state =
        engine.getState();

      setSnapshot(
        state
      );

      setEvents(
        state?.events || []
      );

      setOutgoingPlayer("");
      setIncomingPlayer("");
    } catch (err) {
      console.error(
        "Substitution error:",
        err
      );

      setError(
        err?.message ||
        "Substitution yanze."
      );
    } finally {
      setSubstituting(false);
    }
  }


  /* =======================================================
     SNAPSHOT DATA
  ======================================================= */

  const home =
    snapshot?.home || null;

  const away =
    snapshot?.away || null;

  const score =
    snapshot?.score || {
      home: 0,
      away: 0,
    };

  const minute =
    safeNumber(
      snapshot?.minute,
      0
    );

  const second =
    safeNumber(
      snapshot?.second,
      0
    );

  const clock =
    formatClock(
      minute,
      second
    );

  const status =
    snapshot?.status ||
    "created";


  /* =======================================================
     PLAYERS
  ======================================================= */

  const allPlayers =
    useMemo(
      () => {
        const homePlayers =
          Array.isArray(
            home?.players
          )
            ? home.players
            : [];

        const awayPlayers =
          Array.isArray(
            away?.players
          )
            ? away.players
            : [];

        return [
          ...homePlayers.map(
            player => ({
              ...player,
              side: "home",
            })
          ),

          ...awayPlayers.map(
            player => ({
              ...player,
              side: "away",
            })
          ),
        ];
      },
      [
        home,
        away,
      ]
    );


  /* =======================================================
     HOME BENCH
  ======================================================= */

  const homeBench =
    useMemo(
      () =>
        Array.isArray(
          home?.bench
        )
          ? home.bench
          : [],
      [home]
    );


  /* =======================================================
     HOME PLAYERS
  ======================================================= */

  const homeOnPitch =
    useMemo(
      () =>
        Array.isArray(
          home?.players
        )
          ? home.players
          : [],
      [home]
    );


  /* =======================================================
     STATS
  ======================================================= */

  const homeStats =
    snapshot?.stats?.home ||
    {};

  const awayStats =
    snapshot?.stats?.away ||
    {};


  /* =======================================================
     RENDER LOADING
  ======================================================= */

  if (loading) {
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

        <p>
          Loading match...
        </p>
      </main>
    );
  }


  /* =======================================================
     ERROR PAGE
  ======================================================= */

  if (
    error &&
    !snapshot
  ) {
    return (
      <main
        className={
          styles.errorPage
        }
      >
        <h2>
          Match Error
        </h2>

        <p>
          {error}
        </p>
      </main>
    );
  }


  /* =======================================================
     PAGE
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
          | Live Match
        </title>

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

        {/* ===============================================
            HEADER
        =============================================== */}

        <header
          className={
            styles.header
          }
        >
          <div
            className={
              styles.status
            }
          >
            <span
              className={
                status ===
                "playing"
                  ? styles.liveDot
                  : styles.statusDot
              }
            />

            {status ===
            "playing"
              ? "LIVE MATCH"
              : status ===
                "finished"
              ? "FULL TIME"
              : status ===
                "paused"
              ? "PAUSED"
              : "READY"}
          </div>


          <div
            className={
              styles.clock
            }
          >
            {clock}
          </div>


          {savingResult && (
            <div
              className={
                styles.savingResult
              }
            >
              Saving result...
            </div>
          )}
        </header>


        {/* ===============================================
            SCOREBOARD
        =============================================== */}

        <section
          className={
            styles.scoreboard
          }
        >

          <div
            className={
              styles.team
            }
          >
            {home?.logo ? (
              <img
                src={
                  home.logo
                }
                alt={
                  home.name
                }
                className={
                  styles.logo
                }
              />
            ) : (
              <div
                className={
                  styles.logoPlaceholder
                }
              >
                ⚽
              </div>
            )}

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
              {safeNumber(
                score.home,
                0
              )}
            </span>

            <small>
              -
            </small>

            <span>
              {safeNumber(
                score.away,
                0
              )}
            </span>
          </div>


          <div
            className={
              styles.team
            }
          >
            {away?.logo ? (
              <img
                src={
                  away.logo
                }
                alt={
                  away.name
                }
                className={
                  styles.logo
                }
              />
            ) : (
              <div
                className={
                  styles.logoPlaceholder
                }
              >
                ⚽
              </div>
            )}

            <strong>
              {away?.name ||
                "Away"}
            </strong>
          </div>

        </section>


        {/* ===============================================
            CONTROLS
        =============================================== */}

        <section
          className={
            styles.controls
          }
        >

          {status !==
            "finished" &&
            status !==
              "playing" && (
              <button
                onClick={
                  startMatch
                }
                disabled={
                  starting ||
                  savingResult
                }
                className={
                  styles.startButton
                }
              >
                {starting
                  ? "Starting..."
                  : "▶ START MATCH"}
              </button>
            )}


          {status ===
            "playing" && (
            <button
              onClick={
                pauseMatch
              }
              className={
                styles.pauseButton
              }
            >
              ⏸ PAUSE
            </button>
          )}

        </section>


        {/* ===============================================
            ERROR
        =============================================== */}

        {error && (
          <div
            className={
              styles.errorBox
            }
          >
            {error}
          </div>
        )}


        {/* ===============================================
            PITCH
        =============================================== */}

        <section
          className={
            styles.pitch
          }
        >

          <div
            className={
              styles.halfLine
            }
          />

          <div
            className={
              styles.centerCircle
            }
          />

          <div
            className={
              styles.centerSpot
            }
          />

          <div
            className={`${styles.penaltyBox} ${styles.leftBox}`}
          />

          <div
            className={`${styles.penaltyBox} ${styles.rightBox}`}
          />

          <div
            className={`${styles.goalBox} ${styles.leftGoal}`}
          />

          <div
            className={`${styles.goalBox} ${styles.rightGoal}`}
          />


          {/* ==========================================
              PLAYERS
          ========================================== */}

          {allPlayers.map(
            player => {
              const x =
                safeNumber(
                  player.x,
                  player.side ===
                    "home"
                    ? 25
                    : 75
                );

              const y =
                safeNumber(
                  player.y,
                  50
                );

              return (
                <div
                  key={`${player.side}-${player.id}`}
                  className={`${styles.player} ${
                    player.side ===
                    "home"
                      ? styles.homePlayer
                      : styles.awayPlayer
                  } ${
                    player.hasBall
                      ? styles.hasBall
                      : ""
                  }`}
                  style={{
                    left: `${Math.max(
                      2,
                      Math.min(
                        98,
                        x
                      )
                    )}%`,

                    top: `${Math.max(
                      3,
                      Math.min(
                        97,
                        y
                      )
                    )}%`,
                  }}
                >

                  <span
                    className={
                      styles.playerNumber
                    }
                  >
                    {
                      player.number
                    }
                  </span>

                  <span
                    className={
                      styles.playerName
                    }
                  >
                    {
                      player.name
                    }
                  </span>

                </div>
              );
            }
          )}


          {/* ==========================================
              BALL
          ========================================== */}

          {snapshot?.ball && (
            <div
              className={
                styles.ball
              }
              style={{
                left: `${Math.max(
                  1,
                  Math.min(
                    99,
                    safeNumber(
                      snapshot.ball.x,
                      50
                    )
                  )
                )}%`,

                top: `${Math.max(
                  2,
                  Math.min(
                    98,
                    safeNumber(
                      snapshot.ball.y,
                      50
                    )
                  )
                )}%`,
              }}
            >
              ⚽
            </div>
          )}

        </section>


        {/* ===============================================
            CONTENT
        =============================================== */}

        <section
          className={
            styles.contentGrid
          }
        >

          <div
            className={
              styles.panel
            }
          >

            {/* ==========================================
                TABS
            ========================================== */}

            <div
              className={
                styles.tabs
              }
            >

              <button
                className={
                  activeTab ===
                  "events"
                    ? styles.activeTab
                    : ""
                }
                onClick={() =>
                  setActiveTab(
                    "events"
                  )
                }
              >
                Events
              </button>

              <button
                className={
                  activeTab ===
                  "players"
                    ? styles.activeTab
                    : ""
                }
                onClick={() =>
                  setActiveTab(
                    "players"
                  )
                }
              >
                Players
              </button>

              <button
                className={
                  activeTab ===
                  "stats"
                    ? styles.activeTab
                    : ""
                }
                onClick={() =>
                  setActiveTab(
                    "stats"
                  )
                }
              >
                Stats
              </button>

              <button
                className={
                  activeTab ===
                  "tactics"
                    ? styles.activeTab
                    : ""
                }
                onClick={() =>
                  setActiveTab(
                    "tactics"
                  )
                }
              >
                Tactics
              </button>

              <button
                className={
                  activeTab ===
                  "subs"
                    ? styles.activeTab
                    : ""
                }
                onClick={() =>
                  setActiveTab(
                    "subs"
                  )
                }
              >
                Substitutions
              </button>

            </div>


            {/* ==========================================
                EVENTS
            ========================================== */}

            {activeTab ===
              "events" && (
              <div
                className={
                  styles.events
                }
              >

                {events
                  .slice()
                  .reverse()
                  .map(
                    (event, index) => (
                      <div
                        key={
                          event.id ||
                          `${event.minute}-${event.second}-${event.type}-${index}`
                        }
                        className={
                          styles.event
                        }
                      >

                        <span>
                          {
                            event.minute
                          }
                          '
                        </span>

                        <p>
                          {
                            event.text ||
                            event.description ||
                            event.type
                          }
                        </p>

                      </div>
                    )
                  )}

                {!events.length && (
                  <p
                    className={
                      styles.empty
                    }
                  >
                    Match has not started.
                  </p>
                )}

              </div>
            )}


            {/* ==========================================
                PLAYERS
            ========================================== */}

            {activeTab ===
              "players" && (
              <div
                className={
                  styles.playerList
                }
              >

                <div>
                  <h3>
                    {home?.name}
                  </h3>

                  {home?.players?.map(
                    player => (
                      <div
                        className={
                          styles.listPlayer
                        }
                        key={
                          player.id
                        }
                      >
                        <b>
                          {
                            player.number
                          }
                        </b>

                        <span>
                          {
                            player.name
                          }
                        </span>

                        <small>
                          {
                            player.position
                          }
                        </small>
                      </div>
                    )
                  )}
                </div>


                <div>
                  <h3>
                    {away?.name}
                  </h3>

                  {away?.players?.map(
                    player => (
                      <div
                        className={
                          styles.listPlayer
                        }
                        key={
                          player.id
                        }
                      >
                        <b>
                          {
                            player.number
                          }
                        </b>

                        <span>
                          {
                            player.name
                          }
                        </span>

                        <small>
                          {
                            player.position
                          }
                        </small>
                      </div>
                    )
                  )}
                </div>

              </div>
            )}


            {/* ==========================================
                STATS
            ========================================== */}

            {activeTab ===
              "stats" && (
              <div
                className={
                  styles.stats
                }
              >

                {[
                  [
                    "Possession",
                    `${safeNumber(
                      homeStats.possession,
                      0
                    )}%`,
                    `${safeNumber(
                      awayStats.possession,
                      0
                    )}%`,
                  ],

                  [
                    "Shots",
                    safeNumber(
                      homeStats.shots,
                      0
                    ),
                    safeNumber(
                      awayStats.shots,
                      0
                    ),
                  ],

                  [
                    "Shots on target",
                    safeNumber(
                      homeStats.shotsOnTarget,
                      0
                    ),
                    safeNumber(
                      awayStats.shotsOnTarget,
                      0
                    ),
                  ],

                  [
                    "Passes",
                    safeNumber(
                      homeStats.passes,
                      0
                    ),
                    safeNumber(
                      awayStats.passes,
                      0
                    ),
                  ],

                  [
                    "Corners",
                    safeNumber(
                      homeStats.corners,
                      0
                    ),
                    safeNumber(
                      awayStats.corners,
                      0
                    ),
                  ],

                  [
                    "Tackles",
                    safeNumber(
                      homeStats.tackles,
                      0
                    ),
                    safeNumber(
                      awayStats.tackles,
                      0
                    ),
                  ],

                  [
                    "Interceptions",
                    safeNumber(
                      homeStats.interceptions,
                      0
                    ),
                    safeNumber(
                      awayStats.interceptions,
                      0
                    ),
                  ],

                  [
                    "Saves",
                    safeNumber(
                      homeStats.saves,
                      0
                    ),
                    safeNumber(
                      awayStats.saves,
                      0
                    ),
                  ],

                  [
                    "Fouls",
                    safeNumber(
                      homeStats.fouls,
                      0
                    ),
                    safeNumber(
                      awayStats.fouls,
                      0
                    ),
                  ],

                ].map(
                  row => (
                    <div
                      className={
                        styles.statRow
                      }
                      key={
                        row[0]
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

              </div>
            )}


            {/* ==========================================
                TACTICS
            ========================================== */}

            {activeTab ===
              "tactics" && (
              <div
                className={
                  styles.tacticsPanel
                }
              >

                <div
                  className={
                    styles.sectionTitle
                  }
                >
                  <h3>
                    {home?.name ||
                      "Your Team"}{" "}
                    Tactics
                  </h3>

                  <span>
                    Manager
                  </span>
                </div>


                <div
                  className={
                    styles.formGroup
                  }
                >
                  <label>
                    Formation
                  </label>

                  <select
                    value={
                      formation
                    }
                    onChange={event =>
                      updateFormationLocal(
                        event.target.value
                      )
                    }
                    disabled={
                      status ===
                      "finished"
                    }
                  >
                    <option value="4-3-3">
                      4-3-3
                    </option>

                    <option value="4-4-2">
                      4-4-2
                    </option>

                    <option value="4-2-3-1">
                      4-2-3-1
                    </option>

                    <option value="3-5-2">
                      3-5-2
                    </option>

                    <option value="5-3-2">
                      5-3-2
                    </option>
                  </select>
                </div>


                <div
                  className={
                    styles.formGroup
                  }
                >
                  <label>
                    Mentality
                  </label>

                  <select
                    value={
                      tactics.mentality
                    }
                    onChange={event =>
                      updateTactic(
                        "mentality",
                        event.target.value
                      )
                    }
                    disabled={
                      status ===
                      "finished"
                    }
                  >
                    <option value="very_defensive">
                      Very Defensive
                    </option>

                    <option value="defensive">
                      Defensive
                    </option>

                    <option value="balanced">
                      Balanced
                    </option>

                    <option value="attacking">
                      Attacking
                    </option>

                    <option value="very_attacking">
                      Very Attacking
                    </option>
                  </select>
                </div>


                <div
                  className={
                    styles.formGroup
                  }
                >
                  <label>
                    Pressing
                  </label>

                  <select
                    value={
                      tactics.pressing
                    }
                    onChange={event =>
                      updateTactic(
                        "pressing",
                        event.target.value
                      )
                    }
                    disabled={
                      status ===
                      "finished"
                    }
                  >
                    <option value="low">
                      Low
                    </option>

                    <option value="medium">
                      Medium
                    </option>

                    <option value="high">
                      High
                    </option>

                    <option value="very_high">
                      Very High
                    </option>
                  </select>
                </div>


                <div
                  className={
                    styles.formGroup
                  }
                >
                  <label>
                    Defensive Line
                  </label>

                  <select
                    value={
                      tactics.defensiveLine
                    }
                    onChange={event =>
                      updateTactic(
                        "defensiveLine",
                        event.target.value
                      )
                    }
                    disabled={
                      status ===
                      "finished"
                    }
                  >
                    <option value="low">
                      Low
                    </option>

                    <option value="medium">
                      Medium
                    </option>

                    <option value="high">
                      High
                    </option>
                  </select>
                </div>


                <div
                  className={
                    styles.formGroup
                  }
                >
                  <label>
                    Tempo:{" "}
                    {tactics.tempo}
                  </label>

                  <input
                    type="range"
                    min="20"
                    max="100"
                    value={
                      tactics.tempo
                    }
                    onChange={event =>
                      updateTactic(
                        "tempo",
                        Number(
                          event.target.value
                        )
                      )
                    }
                    disabled={
                      status ===
                      "finished"
                    }
                  />
                </div>


                <div
                  className={
                    styles.formGroup
                  }
                >
                  <label>
                    Width:{" "}
                    {tactics.width}
                  </label>

                  <input
                    type="range"
                    min="20"
                    max="100"
                    value={
                      tactics.width
                    }
                    onChange={event =>
                      updateTactic(
                        "width",
                        Number(
                          event.target.value
                        )
                      )
                    }
                    disabled={
                      status ===
                      "finished"
                    }
                  />
                </div>


                <button
                  className={
                    styles.saveTacticsButton
                  }
                  onClick={
                    saveTactics
                  }
                  disabled={
                    savingTactics ||
                    status ===
                      "finished"
                  }
                >
                  {savingTactics
                    ? "Saving..."
                    : "✓ APPLY TACTICS"}
                </button>

              </div>
            )}


            {/* ==========================================
                SUBSTITUTIONS
            ========================================== */}

            {activeTab ===
              "subs" && (
              <div
                className={
                  styles.substitutionPanel
                }
              >

                <div
                  className={
                    styles.sectionTitle
                  }
                >
                  <h3>
                    Substitution
                  </h3>

                  <span>
                    {home?.name}
                  </span>
                </div>


                <div
                  className={
                    styles.formGroup
                  }
                >
                  <label>
                    Player coming off
                  </label>

                  <select
                    value={
                      outgoingPlayer
                    }
                    onChange={event =>
                      setOutgoingPlayer(
                        event.target.value
                      )
                    }
                    disabled={
                      status ===
                        "finished" ||
                      status ===
                        "created" ||
                      substituting
                    }
                  >
                    <option value="">
                      Select player
                    </option>

                    {homeOnPitch.map(
                      player => (
                        <option
                          key={
                            player.id
                          }
                          value={
                            player.id
                          }
                        >
                          #{player.number}{" "}
                          {player.name}{" "}
                          ({player.position})
                        </option>
                      )
                    )}
                  </select>
                </div>


                <div
                  className={
                    styles.formGroup
                  }
                >
                  <label>
                    Player coming on
                  </label>

                  <select
                    value={
                      incomingPlayer
                    }
                    onChange={event =>
                      setIncomingPlayer(
                        event.target.value
                      )
                    }
                    disabled={
                      status ===
                        "finished" ||
                      status ===
                        "created" ||
                      substituting
                    }
                  >
                    <option value="">
                      Select substitute
                    </option>

                    {homeBench.map(
                      player => (
                        <option
                          key={
                            player.id
                          }
                          value={
                            player.id
                          }
                        >
                          #{player.number}{" "}
                          {player.name}{" "}
                          ({player.position})
                        </option>
                      )
                    )}
                  </select>
                </div>


                <button
                  className={
                    styles.substituteButton
                  }
                  onClick={
                    makeSubstitution
                  }
                  disabled={
                    substituting ||
                    status ===
                      "finished" ||
                    status ===
                      "created" ||
                    !outgoingPlayer ||
                    !incomingPlayer
                  }
                >
                  {substituting
                    ? "Making substitution..."
                    : "⇄ MAKE SUBSTITUTION"}
                </button>


                <div
                  className={
                    styles.substitutionInfo
                  }
                >
                  <p>
                    Substitutions used:{" "}
                    <strong>
                      {safeNumber(
                        home?.substitutionsUsed,
                        0
                      )}
                    </strong>
                    / 5
                  </p>

                  <p>
                    Available substitutes:{" "}
                    <strong>
                      {
                        homeBench.length
                      }
                    </strong>
                  </p>
                </div>

              </div>
            )}

          </div>

        </section>

      </main>
    </>
  );
}
