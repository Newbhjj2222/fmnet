// pages/match/[id].js

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

function normalizePlayer(
  data,
  id
) {
  return {
    id,

    ...data,

    shirtNumber:
      data?.shirtNumber ??
      data?.jerseyNumber ??
      data?.kitNumber ??
      data?.number ??
      null,

    number:
      data?.shirtNumber ??
      data?.jerseyNumber ??
      data?.kitNumber ??
      data?.number ??
      null,

    overall:
      Number(
        data?.overall ??
        data?.rating ??
        data?.ovr ??
        60
      ),
  };
}

async function loadPlayers(
  clubId
) {
  if (!clubId) {
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
      console.error(
        `Player query failed: ${field}`,
        error
      );
    }
  }

  return [];
}

function idsFromPlayers(
  players
) {
  return players
    .map(
      (player) =>
        player.id ??
        player.playerId
    )
    .filter(Boolean);
}

function getEmbeddedPlayers(
  match,
  side
) {
  const candidates =
    side === "home"
      ? [
          match.homePlayers,
          match.homeLineup,
          match.homeSquad,
        ]
      : [
          match.awayPlayers,
          match.awayLineup,
          match.awaySquad,
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
            player.id ??
              player.playerId ??
              `embedded-${side}-${index}`
          )
      );
    }
  }

  return [];
}

export default function MatchPage() {
  const router =
    useRouter();

  const {
    id: matchId,
  } = router.query;

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

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [snapshot, setSnapshot] =
    useState(null);

  const [matchData, setMatchData] =
    useState(null);

  const [userTactics, setUserTactics] =
    useState(
      DEFAULT_TACTICS
    );

  const [formation, setFormation] =
    useState("4-4-2");

  const [saving, setSaving] =
    useState(false);

  const saveMatch =
    useCallback(
      async (
        engine,
        final = false
      ) => {
        if (!matchId || !engine) {
          return;
        }

        try {
          setSaving(true);

          const result =
            engine.serializeResult();

          await updateDoc(
            doc(
              db,
              "matches",
              matchId
            ),
            {
              status:
                final
                  ? "finished"
                  : "live",

              minute:
                result.minute,

              second:
                engine.second,

              homeScore:
                result.homeScore,

              awayScore:
                result.awayScore,

              score:
                result.score,

              homeStats:
                result.homeStats,

              awayStats:
                result.awayStats,

              events:
                result.events,

              homeLineupIds:
                engine.home.players.map(
                  (p) => p.id
                ),

              awayLineupIds:
                engine.away.players.map(
                  (p) => p.id
                ),

              homeFormation:
                engine.home.formation,

              awayFormation:
                engine.away.formation,

              homeTactics:
                engine.home.tactics,

              awayTactics:
                engine.away.tactics,

              homeSubsUsed:
                engine.home.substitutionsUsed,

              awaySubsUsed:
                engine.away.substitutionsUsed,

              result:
                result.result,

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
        } catch (err) {
          console.error(
            "Match save error:",
            err
          );
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
      }
    };
  }, []);

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
        setError("");

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
            "Match not found."
          );
        }

        const match =
          matchSnap.data();

        if (cancelled) {
          return;
        }

        const homeClubId =
          match.homeClubId ??
          match.homeTeamId;

        const awayClubId =
          match.awayClubId ??
          match.awayTeamId;

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
          Array.isArray(
            match.homeLineupIds
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
            match.awayLineupIds
          )
            ? match.awayLineupIds
            : idsFromPlayers(
                awayPlayers.slice(
                  0,
                  11
                )
              );

        const homeFormation =
          match.homeFormation ??
          "4-4-2";

        const awayFormation =
          match.awayFormation ??
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

        const initialScore = {
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
        };

        const engine =
          new MatchEngine({
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

            initialScore,

            initialMinute:
              Number(
                match.minute || 0
              ),

            initialEvents:
              Array.isArray(
                match.events
              )
                ? match.events
                : [],
          });

        engineRef.current =
          engine;

        eventIndexRef.current =
          engine.events.length;

        setMatchData(
          match
        );

        setUserTactics(
          homeTactics
        );

        setFormation(
          homeFormation
        );

        setSnapshot(
          engine.getSnapshot()
        );

        engine.start();

        await updateDoc(
          matchRef,
          {
            status: "live",

            homeLineupIds:
              engine.home.players.map(
                (p) => p.id
              ),

            awayLineupIds:
              engine.away.players.map(
                (p) => p.id
              ),

            homeFormation:
              engine.home.formation,

            awayFormation:
              engine.away.formation,

            homeTactics:
              engine.home.tactics,

            awayTactics:
              engine.away.tactics,

            startedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp(),
          }
        );

        setLoading(false);

        startAnimationLoop(
          engine
        );
      } catch (err) {
        console.error(err);

        if (
          !cancelled
        ) {
          setError(
            err?.message ||
              "Failed to load match."
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

  function startAnimationLoop(
    engine
  ) {
    lastFrameRef.current =
      performance.now();

    let lastUi =
      performance.now();

    function frame(now) {
      if (
        !mountedRef.current
      ) {
        return;
      }

      const dt =
        Math.min(
          0.05,
          Math.max(
            0,
            (now -
              lastFrameRef.current) /
              1000
          )
        );

      lastFrameRef.current =
        now;

      engine.update(dt);

      if (
        now - lastUi >
        33
      ) {
        lastUi = now;

        setSnapshot(
          engine.getSnapshot()
        );

        if (
          engine.events.length >
          eventIndexRef.current
        ) {
          eventIndexRef.current =
            engine.events.length;
        }
      }

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

      if (
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

  async function handleTacticsChange(
    nextTactics
  ) {
    const engine =
      engineRef.current;

    if (!engine) return;

    setUserTactics(
      nextTactics
    );

    engine.setUserTactics(
      nextTactics
    );

    await saveMatch(
      engine,
      false
    );
  }

  async function handleFormationChange(
    nextFormation
  ) {
    const engine =
      engineRef.current;

    if (!engine) return;

    setFormation(
      nextFormation
    );

    engine.setFormation(
      "home",
      nextFormation
    );

    await saveMatch(
      engine,
      false
    );
  }

  async function handleSubstitution(
    outgoingId,
    incomingId
  ) {
    const engine =
      engineRef.current;

    if (!engine) return;

    const success =
      engine.substituteUser(
        outgoingId,
        incomingId
      );

    if (!success) {
      return;
    }

    setSnapshot(
      engine.getSnapshot()
    );

    await saveMatch(
      engine,
      false
    );
  }

  if (loading) {
    return (
      <div
        className={styles.loading}
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

  if (error) {
    return (
      <div
        className={styles.error}
      >
        <h2>
          Match Error
        </h2>

        <p>
          {error}
        </p>
      </div>
    );
  }

  const home =
    snapshot?.home;

  const away =
    snapshot?.away;

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
        className={styles.page}
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
              {home?.name}
            </strong>
          </div>

          <div
            className={styles.score}
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
              {away?.name}
            </strong>
          </div>
        </header>

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
                ...home,
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
