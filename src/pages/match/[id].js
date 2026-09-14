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

import PythonMatchEngine from "../../lib/match-engine/python-engine";

import {
  DEFAULT_TACTICS,
} from "../../lib/match-engine/constants";

import MatchCanvas from "../../components/match/MatchCanvas";
import LineupFormation from "../../components/match/LineupFormation";
import TacticsPanel from "../../components/match/TacticsPanel";
import SubstitutionPanel from "../../components/match/SubstitutionPanel";
import MatchStats from "../../components/match/MatchStats";
import MatchEvents from "../../components/match/MatchEvents";

import styles from "./match.module.css";


const MATCH_CONFIG = {
  footballMinutes: 90,
  realDurationSeconds: 480,
  firstHalfMinutes: 45,
  secondHalfMinutes: 45,
};


function normalizePlayer(
  data,
  id
) {
  const source =
    data || {};

  return {
    id,

    ...source,

    overall:
      Number(
        source.overall ??
        source.rating ??
        source.ovr ??
        60
      ),

    shirtNumber:
      source.shirtNumber ??
      source.jerseyNumber ??
      source.number ??
      null,

    number:
      source.shirtNumber ??
      source.jerseyNumber ??
      source.number ??
      null,
  };
}


async function loadPlayers(
  clubId
) {
  if (!clubId) {
    return [];
  }

  const fields = [
    "clubId",
    "teamId",
    "currentClub",
  ];

  for (
    const field of fields
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
            clubId
          )
        );

      const snap =
        await getDocs(q);

      if (!snap.empty) {
        return snap.docs.map(
          (item) =>
            normalizePlayer(
              item.data(),
              item.id
            )
        );
      }
    } catch (error) {
      console.error(
        `Player query failed for ${field}`,
        error
      );
    }
  }

  return [];
}


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
            `${side}-${index}`
          )
      );
    }
  }

  return [];
}


function idsFromPlayers(
  players
) {
  return (
    Array.isArray(players)
      ? players
      : []
  )
    .map(
      (player) =>
        player?.id ??
        player?.playerId
    )
    .filter(Boolean);
}


function getScore(
  snapshot,
  side
) {
  if (!snapshot) {
    return 0;
  }

  const direct =
    side === "home"
      ? snapshot.homeScore
      : snapshot.awayScore;

  return Number(
    direct ??
    snapshot.score?.[side] ??
    0
  );
}


export default function MatchPage() {
  const router =
    useRouter();

  const matchId =
    router.query.id;

  const engineRef =
    useRef(null);

  const pollRef =
    useRef(null);

  const mountedRef =
    useRef(true);

  const savingRef =
    useRef(false);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState(null);

  const [snapshot, setSnapshot] =
    useState(null);

  const [formation, setFormation] =
    useState("4-4-2");

  const [userTactics, setUserTactics] =
    useState(
      DEFAULT_TACTICS
    );

  const [starting, setStarting] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [finishing, setFinishing] =
    useState(false);


  const saveMatch =
    useCallback(
      async (
        currentSnapshot,
        final = false
      ) => {
        if (
          !matchId ||
          !currentSnapshot ||
          savingRef.current
        ) {
          return;
        }

        try {
          savingRef.current =
            true;

          setSaving(true);

          const matchRef =
            doc(
              db,
              "matches",
              matchId
            );

          const home =
            currentSnapshot.home ||
            {};

          const away =
            currentSnapshot.away ||
            {};

          await updateDoc(
            matchRef,
            {
              status:
                final
                  ? "finished"
                  : currentSnapshot.status,

              minute:
                Number(
                  currentSnapshot.minute ||
                  0
                ),

              second:
                Number(
                  currentSnapshot.second ||
                  0
                ),

              homeScore:
                getScore(
                  currentSnapshot,
                  "home"
                ),

              awayScore:
                getScore(
                  currentSnapshot,
                  "away"
                ),

              score:
                currentSnapshot.score ||
                {
                  home: 0,
                  away: 0,
                },

              homeStats:
                home.stats ||
                {},

              awayStats:
                away.stats ||
                {},

              events:
                currentSnapshot.events ||
                [],

              homeLineupIds:
                (
                  home.players ||
                  []
                )
                  .filter(
                    (p) =>
                      p.onPitch !==
                      false
                  )
                  .map(
                    (p) =>
                      p.id
                  ),

              awayLineupIds:
                (
                  away.players ||
                  []
                )
                  .filter(
                    (p) =>
                      p.onPitch !==
                      false
                  )
                  .map(
                    (p) =>
                      p.id
                  ),

              homeFormation:
                home.formation ||
                "4-4-2",

              awayFormation:
                away.formation ||
                "4-4-2",

              homeTactics:
                home.tactics ||
                {},

              awayTactics:
                away.tactics ||
                {},

              result:
                currentSnapshot.result ||
                null,

              updatedAt:
                serverTimestamp(),

              ...(final
                ? {
                    finishedAt:
                      serverTimestamp(),
                  }
                : {}),
            }
          );
        } catch (err) {
          console.error(
            "Firestore save failed",
            err
          );
        } finally {
          savingRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setSaving(false);
          }
        }
      },
      [matchId]
    );


  const pollPython =
    useCallback(
      async () => {
        const engine =
          engineRef.current;

        if (!engine) {
          return;
        }

        try {
          const next =
            await engine.update();

          if (
            mountedRef.current
          ) {
            setSnapshot(
              next
            );
          }

          if (
            next.status ===
              "finished" ||
            Number(
              next.minute || 0
            ) >= 90
          ) {
            await finishMatch(
              next
            );
          }
        } catch (err) {
          console.error(
            "Python engine update failed",
            err
          );

          if (
            mountedRef.current
          ) {
            setError(
              err.message ||
              "Python engine connection failed"
            );
          }
        }
      },
      []
    );


  const startPolling =
    useCallback(
      () => {
        if (
          pollRef.current
        ) {
          clearInterval(
            pollRef.current
          );
        }

        /*
         * Python simulation is driven
         * by wall-clock time.
         *
         * 100ms = 10 updates/sec.
         */

        pollRef.current =
          setInterval(
            pollPython,
            100
          );
      },
      [pollPython]
    );


  const stopPolling =
    useCallback(
      () => {
        if (
          pollRef.current
        ) {
          clearInterval(
            pollRef.current
          );

          pollRef.current =
            null;
        }
      },
      []
    );


  const finishMatch =
    useCallback(
      async (
        finalSnapshot
      ) => {
        if (
          !finalSnapshot ||
          finishing
        ) {
          return;
        }

        setFinishing(
          true
        );

        stopPolling();

        try {
          await saveMatch(
            {
              ...finalSnapshot,
              status:
                "finished",
              minute: 90,
              second: 0,
            },
            true
          );

          setSnapshot(
            {
              ...finalSnapshot,
              status:
                "finished",
              minute: 90,
              second: 0,
              finished: true,
              running: false,
            }
          );

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
            1800
          );
        } finally {
          setFinishing(
            false
          );
        }
      },
      [
        finishing,
        router,
        saveMatch,
        stopPolling,
      ]
    );


  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;

      stopPolling();
    };
  }, [
    stopPolling,
  ]);


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
            "Match not found"
          );
        }

        const match =
          matchSnap.data();

        let homePlayers =
          getEmbeddedPlayers(
            match,
            "home"
          );

        let awayPlayers =
          getEmbeddedPlayers(
            match,
            "away"
          );

        const homeClubId =
          match.homeClubId ??
          match.homeTeamId ??
          match.homeTeam?.id;

        const awayClubId =
          match.awayClubId ??
          match.awayTeamId ??
          match.awayTeam?.id;

        if (
          !homePlayers.length
        ) {
          homePlayers =
            await loadPlayers(
              homeClubId
            );
        }

        if (
          !awayPlayers.length
        ) {
          awayPlayers =
            await loadPlayers(
              awayClubId
            );
        }

        const homeLineupIds =
          match.homeLineupIds?.length
            ? match.homeLineupIds
            : idsFromPlayers(
                homePlayers.slice(
                  0,
                  11
                )
              );

        const awayLineupIds =
          match.awayLineupIds?.length
            ? match.awayLineupIds
            : idsFromPlayers(
                awayPlayers.slice(
                  0,
                  11
                )
              );

        const homeFormation =
          match.homeFormation ||
          "4-4-2";

        const awayFormation =
          match.awayFormation ||
          "4-4-2";

        const homeTactics = {
          ...DEFAULT_TACTICS,
          ...(match.homeTactics ||
            {}),
        };

        const awayTactics = {
          ...DEFAULT_TACTICS,
          ...(match.awayTactics ||
            {}),
        };

        const engine =
          new PythonMatchEngine(
            {
              matchId,

              homeTeam: {
                id:
                  homeClubId,

                name:
                  match.homeTeamName ??
                  match.homeClubName ??
                  match.homeTeam?.name ??
                  "Home",

                logo:
                  match.homeTeamLogo ??
                  match.homeTeam?.logo ??
                  "",
              },

              awayTeam: {
                id:
                  awayClubId,

                name:
                  match.awayTeamName ??
                  match.awayClubName ??
                  match.awayTeam?.name ??
                  "Away",

                logo:
                  match.awayTeamLogo ??
                  match.awayTeam?.logo ??
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

              initialScore: {
                home:
                  Number(
                    match.homeScore ??
                    match.score?.home ??
                    0
                  ),

                away:
                  Number(
                    match.awayScore ??
                    match.score?.away ??
                    0
                  ),
              },

              initialMinute:
                Number(
                  match.minute ||
                  0
                ),

              initialEvents:
                match.events ||
                [],
            }
          );

        engineRef.current =
          engine;

        const initial =
          await engine.create();

        if (
          cancelled
        ) {
          return;
        }

        setSnapshot(
          initial
        );

        setFormation(
          homeFormation
        );

        setUserTactics(
          homeTactics
        );

        setLoading(false);

        startPolling();
      } catch (err) {
        console.error(
          "Match initialization failed",
          err
        );

        if (
          !cancelled
        ) {
          setError(
            err.message ||
            "Match initialization failed"
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
    startPolling,
  ]);


  const startMatch =
    useCallback(
      async () => {
        const engine =
          engineRef.current;

        if (
          !engine ||
          starting
        ) {
          return;
        }

        try {
          setStarting(true);

          setError(null);

          const next =
            await engine.start();

          setSnapshot(
            next
          );

          startPolling();
        } catch (err) {
          setError(
            err.message
          );
        } finally {
          setStarting(false);
        }
      },
      [
        starting,
        startPolling,
      ]
    );


  const startSecondHalf =
    useCallback(
      async () => {
        const engine =
          engineRef.current;

        if (!engine) {
          return;
        }

        try {
          const next =
            await engine.startSecondHalf();

          setSnapshot(
            next
          );

          startPolling();
        } catch (err) {
          setError(
            err.message
          );
        }
      },
      [startPolling]
    );


  const handleTacticsChange =
    async (
      tactics
    ) => {
      const engine =
        engineRef.current;

      if (!engine) {
        return;
      }

      try {
        const safe = {
          ...DEFAULT_TACTICS,
          ...(tactics || {}),
        };

        setUserTactics(
          safe
        );

        const next =
          await engine.setUserTactics(
            safe
          );

        setSnapshot(
          next
        );
      } catch (err) {
        setError(
          err.message
        );
      }
    };


  const handleFormationChange =
    async (
      nextFormation
    ) => {
      const engine =
        engineRef.current;

      if (!engine) {
        return;
      }

      try {
        setFormation(
          nextFormation
        );

        const next =
          await engine.setFormation(
            "home",
            nextFormation
          );

        setSnapshot(
          next
        );
      } catch (err) {
        setError(
          err.message
        );
      }
    };


  const handleSubstitution =
    async (
      outgoingId,
      incomingId
    ) => {
      const engine =
        engineRef.current;

      if (!engine) {
        return;
      }

      try {
        const success =
          await engine.substituteUser(
            outgoingId,
            incomingId
          );

        if (success) {
          setSnapshot(
            engine.getSnapshot()
          );
        }
      } catch (err) {
        setError(
          err.message
        );
      }
    };


  if (loading) {
    return (
      <main
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
          Loading Python football engine...
        </p>
      </main>
    );
  }


  if (error) {
    return (
      <main
        className={
          styles.error
        }
      >
        <h1>
          Match Engine Error
        </h1>

        <p>
          {error}
        </p>

        <button
          onClick={() =>
            window.location.reload()
          }
        >
          Reload Match
        </button>
      </main>
    );
  }


  const home =
    snapshot?.home || {};

  const away =
    snapshot?.away || {};

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

  const minute =
    Number(
      snapshot?.minute || 0
    );

  const second =
    Number(
      snapshot?.second || 0
    );

  const halfTime =
    snapshot?.phase ===
    "half_time";

  const finished =
    snapshot?.status ===
      "finished" ||
    minute >= 90;


  return (
    <>
      <Head>
        <title>
          {home.name || "Home"} vs{" "}
          {away.name || "Away"} |
          Virtual Football Manager
        </title>

        <meta
          name="description"
          content="Live Python-powered 2D football simulation."
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
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
              {home.name}
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
                minute
              ).padStart(2, "0")}
              :
              {String(
                second
              ).padStart(2, "0")}
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
              {away.name}
            </strong>
          </div>
        </header>


        <section
          style={{
            display:
              "flex",

            justifyContent:
              "center",

            gap: 10,

            padding: 14,

            flexWrap:
              "wrap",
          }}
        >
          {!finished &&
            !halfTime && (
              <button
                onClick={
                  startMatch
                }
                disabled={
                  starting ||
                  snapshot?.running
                }
              >
                {starting
                  ? "STARTING..."
                  : "START MATCH"}
              </button>
            )}


          {halfTime &&
            !finished && (
              <button
                onClick={
                  startSecondHalf
                }
              >
                START SECOND HALF
              </button>
            )}


          {halfTime &&
            !finished && (
              <strong>
                HALF TIME
              </strong>
            )}


          {finished && (
            <strong>
              FULL TIME
              {finishing
                ? " • Saving..."
                : ""}
            </strong>
          )}
        </section>


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
            {finished
              ? "FULL TIME"
              : halfTime
                ? "HALF TIME"
                : snapshot?.running
                  ? "LIVE"
                  : "READY"}

            {saving &&
              " • Saving..."}
          </div>
        </section>


        <section
          style={{
            textAlign:
              "center",

            padding: 10,
          }}
        >
          <small>
            90 football minutes =
            8 real minutes
          </small>
        </section>


        <section
          className={
            styles.controlGrid
          }
        >
          <LineupFormation
            team={
              home
            }
          />

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
                finished
              }
            />

            <div
              className={
                styles.spacer
              }
            />

            <SubstitutionPanel
              team={
                home
              }

              onSubstitute={
                handleSubstitution
              }

              disabled={
                finished
              }
            />
          </div>
        </section>


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
              home.stats
            }

            away={
              away.stats
            }
          />
        </section>


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
