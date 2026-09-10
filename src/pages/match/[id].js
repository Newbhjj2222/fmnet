import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import dynamic from "next/dynamic";

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

import styles from "./Mach.module.css";

const MatchCanvas =
  dynamic(
    () =>
      import(
        "../../components/match/MatchCanvas"
      ),
    {
      ssr: false,
    }
  );

const FORMATIONS = [
  "4-4-2",
  "4-3-3",
  "3-5-2",
  "5-3-2",
  "4-2-3-1",
];

const normalize = (
  value
) =>
  String(value || "")
    .trim()
    .toLowerCase();

function getClubId(
  club,
  fallback
) {
  return String(
    club?.id ??
      club?.clubId ??
      club?.teamId ??
      fallback ??
      ""
  );
}

async function getClubPlayers(
  clubId
) {
  if (!clubId) {
    return [];
  }

  const queries = [
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
    ),

    query(
      collection(
        db,
        "players"
      ),
      where(
        "currentClub",
        "==",
        clubId
      )
    ),

    query(
      collection(
        db,
        "players"
      ),
      where(
        "teamId",
        "==",
        clubId
      )
    ),
  ];

  const players =
    new Map();

  for (
    const playerQuery of queries
  ) {
    try {
      const snapshot =
        await getDocs(
          playerQuery
        );

      snapshot.forEach(
        (item) => {
          players.set(
            item.id,
            {
              id: item.id,
              ...item.data(),
            }
          );
        }
      );
    } catch {
      // Different databases use different player schemas.
    }
  }

  return [
    ...players.values(),
  ];
}

function managerMatchesClub({
  club,
  uid,
  username,
  currentClubId,
}) {
  if (!club) {
    return false;
  }

  const managerId =
    club.managerId ??
    club.managerUid ??
    club.managerUserId;

  if (managerId) {
    return (
      Boolean(uid) &&
      String(managerId) ===
        String(uid)
    );
  }

  const managerUsername =
    club.managerUsername ??
    club.managerName;

  if (
    managerUsername &&
    username
  ) {
    return (
      normalize(
        managerUsername
      ) ===
      normalize(username)
    );
  }

  if (currentClubId) {
    return (
      getClubId(club) ===
      String(currentClubId)
    );
  }

  return false;
}

export default function MatchPage() {
  const router =
    useRouter();

  const { id } =
    router.query;

  const {
    user: authUser,
  } = useAuth();

  const engineRef =
    useRef(null);

  const animationRef =
    useRef(null);

  const lastFrameRef =
    useRef(null);

  const lastSavedMinuteRef =
    useRef(-1);

  const [snapshot, setSnapshot] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [managerTeam, setManagerTeam] =
    useState(null);

  const [saving, setSaving] =
    useState(false);

  const [selectedOut, setSelectedOut] =
    useState("");

  const [selectedIn, setSelectedIn] =
    useState("");

  const saveMatch =
    useCallback(
      async () => {
        const engine =
          engineRef.current;

        if (
          !engine ||
          !id
        ) {
          return;
        }

        setSaving(true);

        try {
          await updateDoc(
            doc(
              db,
              "matches",
              String(id)
            ),
            {
              ...engine.getSavePayload(),

              updatedAt:
                serverTimestamp(),
            }
          );

          lastSavedMinuteRef.current =
            Math.floor(
              engine.simulationTime
            );
        } catch (saveError) {
          console.error(
            "Match save failed:",
            saveError
          );
        } finally {
          setSaving(false);
        }
      },
      [id]
    );

  useEffect(() => {
    if (
      !router.isReady ||
      !id
    ) {
      return undefined;
    }

    let cancelled = false;

    async function loadMatch() {
      try {
        setLoading(true);

        setError("");

        const matchSnapshot =
          await getDoc(
            doc(
              db,
              "matches",
              String(id)
            )
          );

        if (
          !matchSnapshot.exists()
        ) {
          throw new Error(
            "Match ntiyabonetse muri database."
          );
        }

        const match = {
          id:
            matchSnapshot.id,

          ...matchSnapshot.data(),
        };

        const homeId =
          getClubId(
            match.homeClub,
            match.homeClubId ??
              match.homeTeamId
          );

        const awayId =
          getClubId(
            match.awayClub,
            match.awayClubId ??
              match.awayTeamId
          );

        const [
          homeClubSnapshot,
          awayClubSnapshot,
        ] =
          await Promise.all([
            homeId
              ? getDoc(
                  doc(
                    db,
                    "clubs",
                    homeId
                  )
                )
              : Promise.resolve(null),

            awayId
              ? getDoc(
                  doc(
                    db,
                    "clubs",
                    awayId
                  )
                )
              : Promise.resolve(null),
          ]);

        const homeClub =
          homeClubSnapshot?.exists()
            ? {
                id:
                  homeClubSnapshot.id,

                ...homeClubSnapshot.data(),
              }
            : {
                id: homeId,

                name: "Home",
              };

        const awayClub =
          awayClubSnapshot?.exists()
            ? {
                id:
                  awayClubSnapshot.id,

                ...awayClubSnapshot.data(),
              }
            : {
                id: awayId,

                name: "Away",
              };

        const [
          homePlayers,
          awayPlayers,
        ] =
          await Promise.all([
            getClubPlayers(
              homeId
            ),

            getClubPlayers(
              awayId
            ),
          ]);

        let profile = null;

        if (authUser?.uid) {
          const profileSnapshot =
            await getDoc(
              doc(
                db,
                "users",
                authUser.uid
              )
            );

          if (
            profileSnapshot.exists()
          ) {
            profile =
              profileSnapshot.data();
          }
        }

        const uid =
          authUser?.uid ||
          null;

        const username =
          profile?.username ??
          profile?.userName ??
          profile?.displayName ??
          null;

        const currentClub =
          profile?.careerData
            ?.currentClub ??
          profile?.currentClub ??
          null;

        const currentClubId =
          typeof currentClub ===
          "object"
            ? currentClub?.id ??
              currentClub?.clubId
            : currentClub;

        let controlledTeam =
          null;

        if (
          managerMatchesClub({
            club: homeClub,
            uid,
            username,
            currentClubId,
          })
        ) {
          controlledTeam =
            "home";
        } else if (
          managerMatchesClub({
            club: awayClub,
            uid,
            username,
            currentClubId,
          })
        ) {
          controlledTeam =
            "away";
        }

        const engine =
          new MatchEngine({
            match,

            homeClub,

            awayClub,

            homePlayers,

            awayPlayers,
          });

        engine.setUserControlled(
          controlledTeam
        );

        if (
          cancelled
        ) {
          return;
        }

        engineRef.current =
          engine;

        setManagerTeam(
          controlledTeam
        );

        setSnapshot(
          engine.getSnapshot()
        );

        setLoading(false);

        const status =
          normalize(
            match.status
          );

        if (
          [
            "live",
            "playing",
            "in_progress",
          ].includes(status)
        ) {
          engine.start();
        }
      } catch (loadError) {
        console.error(
          loadError
        );

        if (!cancelled) {
          setError(
            loadError?.message ||
              "Habaye ikibazo mu gufungura umukino."
          );

          setLoading(false);
        }
      }
    }

    loadMatch();

    return () => {
      cancelled = true;
    };
  }, [
    router.isReady,
    id,
    authUser?.uid,
  ]);

  useEffect(() => {
    const engine =
      engineRef.current;

    if (!engine) {
      return undefined;
    }

    const frame =
      (timestamp) => {
        if (
          lastFrameRef.current ===
          null
        ) {
          lastFrameRef.current =
            timestamp;
        }

        const delta =
          Math.min(
            (
              timestamp -
              lastFrameRef.current
            ) / 1000,

            0.12
          );

        lastFrameRef.current =
          timestamp;

        engine.update(
          delta
        );

        const nextSnapshot =
          engine.getSnapshot();

        setSnapshot(
          nextSnapshot
        );

        const minute =
          Math.floor(
            engine.simulationTime
          );

        if (
          engine.status ===
            "live" &&
          minute > 0 &&
          minute % 5 === 0 &&
          minute !==
            lastSavedMinuteRef.current
        ) {
          saveMatch();
        }

        if (
          engine.finished &&
          minute >= 90 &&
          minute !==
            lastSavedMinuteRef.current
        ) {
          saveMatch();
        }

        animationRef.current =
          requestAnimationFrame(
            frame
          );
      };

    animationRef.current =
      requestAnimationFrame(
        frame
      );

    return () => {
      if (
        animationRef.current
      ) {
        cancelAnimationFrame(
          animationRef.current
        );
      }

      lastFrameRef.current =
        null;
    };
  }, [saveMatch]);

  const startMatch =
    () => {
      engineRef.current?.start();

      setSnapshot(
        engineRef.current?.getSnapshot()
      );
    };

  const pauseMatch =
    () => {
      engineRef.current?.pause();

      setSnapshot(
        engineRef.current?.getSnapshot()
      );

      saveMatch();
    };

  const resumeMatch =
    () => {
      engineRef.current?.resume();

      setSnapshot(
        engineRef.current?.getSnapshot()
      );
    };

  const changeFormation =
    (formation) => {
      if (!managerTeam) {
        return;
      }

      engineRef.current?.setFormation(
        managerTeam,
        formation
      );

      setSnapshot(
        engineRef.current?.getSnapshot()
      );

      saveMatch();
    };

  const changeTactic =
    (
      key,
      value
    ) => {
      if (!managerTeam) {
        return;
      }

      engineRef.current?.setTactics(
        managerTeam,
        {
          [key]: value,
        }
      );

      setSnapshot(
        engineRef.current?.getSnapshot()
      );

      saveMatch();
    };

  const makeSubstitution =
    () => {
      if (
        !managerTeam ||
        !selectedOut ||
        !selectedIn
      ) {
        return;
      }

      const success =
        engineRef.current?.performSubstitution(
          managerTeam,
          selectedOut,
          selectedIn,
          false
        );

      if (success) {
        setSelectedOut("");

        setSelectedIn("");

        setSnapshot(
          engineRef.current.getSnapshot()
        );

        saveMatch();
      }
    };

  if (loading) {
    return (
      <div
        className={
          styles.loading
        }
      >
        Loading match engine...
      </div>
    );
  }

  if (
    error ||
    !snapshot
  ) {
    return (
      <div
        className={
          styles.error
        }
      >
        {error ||
          "Match unavailable."}
      </div>
    );
  }

  const homeName =
    snapshot.homeClub
      ?.name ||
    "Home";

  const awayName =
    snapshot.awayClub
      ?.name ||
    "Away";

  const managerXI =
    managerTeam === "home"
      ? snapshot.homeXI
      : snapshot.awayXI;

  const managerBench =
    managerTeam === "home"
      ? snapshot.homeBench
      : snapshot.awayBench;

  const managerFormation =
    managerTeam === "home"
      ? snapshot.homeFormation
      : snapshot.awayFormation;

  const managerTactics =
    managerTeam === "home"
      ? snapshot.homeTactics
      : snapshot.awayTactics;

  return (
    <>
      <Head>
        <title>
          {homeName} vs{" "}
          {awayName} | Virtual Football Manager
        </title>

        <meta
          name="description"
          content="2D football match simulation with real-time players, tactics, score and match events."
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.container
          }
        >
          <header
            className={
              styles.header
            }
          >
            <div
              className={
                styles.club
              }
            >
              <span
                className={
                  styles.clubName
                }
              >
                {homeName}
              </span>

              <span
                className={
                  styles.score
                }
              >
                {snapshot.homeScore}
              </span>
            </div>

            <div
              className={
                styles.clock
              }
            >
              <span
                className={
                  styles.minute
                }
              >
                {snapshot.minute.toFixed(
                  snapshot.minute % 1
                    ? 1
                    : 0
                )}
                &apos;
              </span>

              <span
                className={
                  styles.status
                }
              >
                {snapshot.status}
              </span>
            </div>

            <div
              className={
                styles.club
              }
            >
              <span
                className={
                  styles.clubName
                }
              >
                {awayName}
              </span>

              <span
                className={
                  styles.score
                }
              >
                {snapshot.awayScore}
              </span>
            </div>
          </header>

          <div
            className={
              styles.layout
            }
          >
            <section
              className={
                styles.main
              }
            >
              <MatchCanvas
                snapshot={
                  snapshot
                }
              />

              <div
                className={
                  styles.card
                }
              >
                <div
                  className={
                    styles.controls
                  }
                >
                  {snapshot.status ===
                    "ready" && (
                    <button
                      className={`${styles.button} ${styles.primary}`}
                      onClick={
                        startMatch
                      }
                    >
                      ▶ Start Match
                    </button>
                  )}

                  {snapshot.status ===
                    "live" && (
                    <button
                      className={
                        styles.button
                      }
                      onClick={
                        pauseMatch
                      }
                    >
                      ⏸ Pause
                    </button>
                  )}

                  {snapshot.status ===
                    "halftime" && (
                    <button
                      className={`${styles.button} ${styles.primary}`}
                      onClick={
                        startMatch
                      }
                    >
                      ▶ Start 2nd Half
                    </button>
                  )}

                  {snapshot.status ===
                    "finished" && (
                    <button
                      className={
                        styles.button
                      }
                      disabled
                    >
                      Full Time
                    </button>
                  )}

                  <button
                    className={
                      styles.button
                    }
                    onClick={
                      saveMatch
                    }
                    disabled={
                      saving
                    }
                  >
                    {saving
                      ? "Saving..."
                      : "Save"}
                  </button>
                </div>

                {snapshot.lastEvent && (
                  <p
                    className={
                      styles.small
                    }
                  >
                    Latest:{" "}
                    <strong>
                      {
                        snapshot
                          .lastEvent
                          .minute
                      }
                      &apos;
                    </strong>{" "}
                    {
                      snapshot
                        .lastEvent
                        .text
                    }
                  </p>
                )}
              </div>
            </section>

            <aside
              className={
                styles.side
              }
            >
              <section
                className={
                  styles.card
                }
              >
                <h3
                  className={
                    styles.heading
                  }
                >
                  Match Stats
                </h3>

                <div
                  className={
                    styles.statRow
                  }
                >
                  <span>
                    Possession
                  </span>

                  <strong>
                    {
                      snapshot
                        .possession
                        .home
                    }
                    % -{" "}
                    {
                      snapshot
                        .possession
                        .away
                    }
                    %
                  </strong>
                </div>

                <div
                  className={
                    styles.statRow
                  }
                >
                  <span>
                    Shots
                  </span>

                  <strong>
                    {
                      snapshot
                        .homeStats
                        .shots
                    }{" "}
                    -{" "}
                    {
                      snapshot
                        .awayStats
                        .shots
                    }
                  </strong>
                </div>

                <div
                  className={
                    styles.statRow
                  }
                >
                  <span>
                    On target
                  </span>

                  <strong>
                    {
                      snapshot
                        .homeStats
                        .shotsOnTarget
                    }{" "}
                    -{" "}
                    {
                      snapshot
                        .awayStats
                        .shotsOnTarget
                    }
                  </strong>
                </div>

                <div
                  className={
                    styles.statRow
                  }
                >
                  <span>
                    Corners
                  </span>

                  <strong>
                    {
                      snapshot
                        .homeStats
                        .corners
                    }{" "}
                    -{" "}
                    {
                      snapshot
                        .awayStats
                        .corners
                    }
                  </strong>
                </div>

                <div
                  className={
                    styles.statRow
                  }
                >
                  <span>
                    Fouls
                  </span>

                  <strong>
                    {
                      snapshot
                        .homeStats
                        .fouls
                    }{" "}
                    -{" "}
                    {
                      snapshot
                        .awayStats
                        .fouls
                    }
                  </strong>
                </div>
              </section>

              {managerTeam && (
                <section
                  className={
                    styles.card
                  }
                >
                  <h3
                    className={
                      styles.heading
                    }
                  >
                    Manager Controls
                  </h3>

                  <div
                    className={
                      styles.label
                    }
                  >
                    Formation
                  </div>

                  <div
                    className={
                      styles.controls
                    }
                  >
                    {FORMATIONS.map(
                      (
                        formation
                      ) => (
                        <button
                          key={
                            formation
                          }
                          className={`${styles.button} ${
                            managerFormation ===
                            formation
                              ? styles.primary
                              : ""
                          }`}
                          onClick={() =>
                            changeFormation(
                              formation
                            )
                          }
                        >
                          {
                            formation
                          }
                        </button>
                      )
                    )}
                  </div>

                  <div
                    style={{
                      marginTop:
                        12,
                    }}
                  >
                    <div
                      className={
                        styles.label
                      }
                    >
                      Mentality
                    </div>

                    <select
                      className={
                        styles.select
                      }
                      value={
                        managerTactics.mentality
                      }
                      onChange={(
                        event
                      ) =>
                        changeTactic(
                          "mentality",
                          event.target
                            .value
                        )
                      }
                    >
                      <option value="defensive">
                        Defensive
                      </option>

                      <option value="balanced">
                        Balanced
                      </option>

                      <option value="positive">
                        Positive
                      </option>

                      <option value="attacking">
                        Attacking
                      </option>
                    </select>
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                    }}
                  >
                    <div
                      className={
                        styles.label
                      }
                    >
                      Pressing
                    </div>

                    <select
                      className={
                        styles.select
                      }
                      value={
                        managerTactics.pressing
                      }
                      onChange={(
                        event
                      ) =>
                        changeTactic(
                          "pressing",
                          event.target
                            .value
                        )
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
                    style={{
                      marginTop: 8,
                    }}
                  >
                    <div
                      className={
                        styles.label
                      }
                    >
                      Passing
                    </div>

                    <select
                      className={
                        styles.select
                      }
                      value={
                        managerTactics.passingStyle
                      }
                      onChange={(
                        event
                      ) =>
                        changeTactic(
                          "passingStyle",
                          event.target
                            .value
                        )
                      }
                    >
                      <option value="short">
                        Short
                      </option>

                      <option value="mixed">
                        Mixed
                      </option>

                      <option value="direct">
                        Direct
                      </option>
                    </select>
                  </div>
                </section>
              )}

              {managerTeam && (
                <section
                  className={
                    styles.card
                  }
                >
                  <h3
                    className={
                      styles.heading
                    }
                  >
                    Substitutions (
                    {
                      snapshot
                        .substitutions[
                        managerTeam
                      ]
                    }
                    /5)
                  </h3>

                  <div
                    className={
                      styles.subRow
                    }
                  >
                    <select
                      className={
                        styles.select
                      }
                      value={
                        selectedOut
                      }
                      onChange={(
                        event
                      ) =>
                        setSelectedOut(
                          event.target
                            .value
                        )
                      }
                    >
                      <option value="">
                        Player out
                      </option>

                      {managerXI
                        .filter(
                          (player) =>
                            player.active &&
                            !player.injury &&
                            !player.redCard
                        )
                        .map(
                          (
                            player
                          ) => (
                            <option
                              key={
                                player.id
                              }
                              value={
                                player.id
                              }
                            >
                              {
                                player.number
                              }
                              .{" "}
                              {
                                player.name
                              }
                            </option>
                          )
                        )}
                    </select>

                    <select
                      className={
                        styles.select
                      }
                      value={
                        selectedIn
                      }
                      onChange={(
                        event
                      ) =>
                        setSelectedIn(
                          event.target
                            .value
                        )
                      }
                    >
                      <option value="">
                        Player in
                      </option>

                      {managerBench
                        .filter(
                          (player) =>
                            player.active &&
                            !player.injury &&
                            !player.redCard
                        )
                        .map(
                          (
                            player
                          ) => (
                            <option
                              key={
                                player.id
                              }
                              value={
                                player.id
                              }
                            >
                              {
                                player.number
                              }
                              .{" "}
                              {
                                player.name
                              }
                            </option>
                          )
                        )}
                    </select>
                  </div>

                  <div
                    className={
                      styles.controls
                    }
                  >
                    <button
                      className={`${styles.button} ${styles.primary}`}
                      onClick={
                        makeSubstitution
                      }
                      disabled={
                        !selectedOut ||
                        !selectedIn ||
                        snapshot
                          .substitutions[
                          managerTeam
                        ] >= 5
                      }
                    >
                      Make
                      Substitution
                    </button>
                  </div>
                </section>
              )}

              <section
                className={
                  styles.card
                }
              >
                <h3
                  className={
                    styles.heading
                  }
                >
                  Match Events
                </h3>

                <div
                  className={
                    styles.eventList
                  }
                >
                  {[
                    ...snapshot.events,
                  ]
                    .reverse()
                    .map(
                      (event) => (
                        <div
                          className={
                            styles.event
                          }
                          key={
                            event.id
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
                            &apos;
                          </span>

                          {
                            event.text
                          }
                        </div>
                      )
                    )}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
