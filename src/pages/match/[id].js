import {
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
} from "firebase/firestore";

import { db } from "../../components/firebase";

import MatchEngine from "../../lib/match-engine/engine";

import styles from "./match.module.css";


function firstValue(
  object,
  keys,
  fallback = null
) {
  for (const key of keys) {
    const value =
      object?.[key];

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


function playerBelongsToClub(
  player,
  clubId
) {
  const wanted =
    String(clubId);

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
      String(
        typeof value ===
          "object"
          ? value.id ||
              value.clubId ||
              value.teamId ||
              ""
          : value
      )
    );

  return values.includes(
    wanted
  );
}


function normalizePlayer(
  player,
  index
) {
  const ratings =
    player.ratings || {};

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
      `Player ${index + 1}`,

    number:
      Number(
        player.number ||
          player.shirtNumber ||
          player.jerseyNumber ||
          index + 1
      ),

    position:
      player.position ||
      player.role ||
      "CM",

    role:
      player.role ||
      player.position ||
      "CM",

    pace:
      Number(
        player.pace ??
          ratings.pace ??
          70
      ),

    passing:
      Number(
        player.passing ??
          ratings.passing ??
          70
      ),

    shooting:
      Number(
        player.shooting ??
          ratings.shooting ??
          65
      ),

    dribbling:
      Number(
        player.dribbling ??
          ratings.dribbling ??
          68
      ),

    defending:
      Number(
        player.defending ??
          ratings.defending ??
          65
      ),

    stamina:
      Number(
        player.stamina ??
          ratings.stamina ??
          80
      ),

    strength:
      Number(
        player.strength ??
          ratings.strength ??
          70
      ),

    vision:
      Number(
        player.vision ??
          ratings.vision ??
          70
      ),

    goalkeeping:
      Number(
        player.goalkeeping ??
          ratings.goalkeeping ??
          60
      ),
  };
}


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
  };
}


function getClubId(
  match,
  side
) {
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


export default function MatchPage() {
  const router =
    useRouter();

  const {
    id,
  } = router.query;

  const engineRef =
    useRef(null);

  const [loading, setLoading] =
    useState(true);

  const [starting, setStarting] =
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


  useEffect(() => {
    if (!router.isReady || !id) {
      return;
    }

    let cancelled = false;

    async function loadMatch() {
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

        if (!matchSnap.exists()) {
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
                String(
                  typeof homeClubId ===
                    "object"
                    ? homeClubId.id
                    : homeClubId
                )
              )
            ),

            getDoc(
              doc(
                db,
                "clubs",
                String(
                  typeof awayClubId ===
                    "object"
                    ? awayClubId.id
                    : awayClubId
                )
              )
            ),

            getDocs(
              collection(
                db,
                "players"
              )
            ),
          ]);

        const homeClub =
          normalizeClub(
            homeClubSnap.exists()
              ? homeClubSnap.data()
              : {},
            homeClubId
          );

        const awayClub =
          normalizeClub(
            awayClubSnap.exists()
              ? awayClubSnap.data()
              : {},
            awayClubId
          );

        const allPlayers =
          playersSnap.docs.map(
            playerDoc => ({
              id: playerDoc.id,
              ...playerDoc.data(),
            })
          );

        let homePlayers =
          allPlayers.filter(
            player =>
              playerBelongsToClub(
                player,
                homeClubId
              )
          );

        let awayPlayers =
          allPlayers.filter(
            player =>
              playerBelongsToClub(
                player,
                awayClubId
              )
          );

        /*
         * Match itself may already contain
         * a selected lineup. Prefer that lineup.
         */

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
          embeddedHome.length
        ) {
          homePlayers =
            embeddedHome;
        }

        if (
          Array.isArray(
            embeddedAway
          ) &&
          embeddedAway.length
        ) {
          awayPlayers =
            embeddedAway;
        }

        if (
          homePlayers.length < 11
        ) {
          const embedded =
            extractEmbeddedPlayers(
              homeClub,
              "home"
            );

          if (
            embedded.length
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
            embedded.length
          ) {
            awayPlayers =
              embedded;
          }
        }

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

        const engineConfig = {
          matchId: String(id),

          home: {
            ...homeClub,

            players:
              homePlayers,

            bench:
              Array.isArray(
                match?.home?.bench
              )
                ? match.home.bench
                : [],
          },

          away: {
            ...awayClub,

            players:
              awayPlayers,

            bench:
              Array.isArray(
                match?.away?.bench
              )
                ? match.away.bench
                : [],
          },
        };

        const engine =
          new MatchEngine(
            engineConfig
          );

        engineRef.current =
          engine;

        engine.subscribe(
          nextSnapshot => {
            if (cancelled) {
              return;
            }

            setSnapshot(
              nextSnapshot
            );

            setEvents(
              nextSnapshot.events ||
                []
            );

            if (
              nextSnapshot.status ===
              "finished"
            ) {
              setStarting(false);
            }
          }
        );

        await engine.ready;

        if (
          cancelled
        ) {
          engine.destroy();
          return;
        }

        setSnapshot(
          engine.getState()
        );

        setEvents(
          engine.getState()
            ?.events || []
        );

        setLoading(false);
      } catch (err) {
        console.error(err);

        if (!cancelled) {
          setError(
            err?.message ||
              "Failed to load match."
          );

          setLoading(false);
        }
      }
    }

    loadMatch();

    return () => {
      cancelled = true;

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
  ]);


  async function startMatch() {
    const engine =
      engineRef.current;

    if (!engine) {
      return;
    }

    try {
      setStarting(true);
      setError("");

      await engine.start();

      setSnapshot(
        engine.getState()
      );
    } catch (err) {
      console.error(err);

      setError(
        err?.message ||
          "Match ntiyatangiye."
      );

      setStarting(false);
    }
  }


  async function pauseMatch() {
    const engine =
      engineRef.current;

    if (!engine) {
      return;
    }

    try {
      await engine.pause();

      setSnapshot(
        engine.getState()
      );
    } catch (err) {
      console.error(err);
      setError(
        err?.message ||
          "Pause failed."
      );
    }
  }


  const home =
    snapshot?.home;

  const away =
    snapshot?.away;

  const score =
    snapshot?.score || {
      home: 0,
      away: 0,
    };

  const minute =
    Number(
      snapshot?.minute || 0
    );

  const second =
    Number(
      snapshot?.second || 0
    );


  const clock =
    `${String(
      minute
    ).padStart(2, "0")}:${String(
      second
    ).padStart(2, "0")}`;


  const status =
    snapshot?.status ||
    "created";


  const allPlayers = useMemo(
    () => [
      ...(home?.players || []).map(
        player => ({
          ...player,
          side: "home",
        })
      ),

      ...(away?.players || []).map(
        player => ({
          ...player,
          side: "away",
        })
      ),
    ],
    [
      home,
      away,
    ]
  );


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


  if (error && !snapshot) {
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

        <header
          className={
            styles.header
          }
        >
          <div>
            <span
              className={
                styles.liveDot
              }
            />

            {status ===
            "playing"
              ? "LIVE MATCH"
              : status.toUpperCase()}
          </div>

          <div
            className={
              styles.clock
            }
          >
            {clock}
          </div>
        </header>


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
              {score.home}
            </span>

            <small>
              -
            </small>

            <span>
              {score.away}
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
                  starting
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


        {error && (
          <div
            className={
              styles.errorBox
            }
          >
            {error}
          </div>
        )}


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


          {allPlayers.map(
            player => {
              const x =
                Number(
                  player.x ??
                    50
                );

              const y =
                Number(
                  player.y ??
                    30
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
                    left: `${x}%`,
                    top: `${y}%`,
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


          {snapshot?.ball && (
            <div
              className={
                styles.ball
              }
              style={{
                left: `${snapshot.ball.x}%`,
                top: `${snapshot.ball.y}%`,
              }}
            >
              ⚽
            </div>
          )}
        </section>


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
            </div>


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
                  .map(event => (
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

                      <p>
                        {event.text}
                      </p>
                    </div>
                  ))}

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
                    `${snapshot?.stats?.home?.possession || 0}%`,
                    `${snapshot?.stats?.away?.possession || 0}%`,
                  ],

                  [
                    "Shots",
                    snapshot?.stats?.home?.shots || 0,
                    snapshot?.stats?.away?.shots || 0,
                  ],

                  [
                    "Shots on target",
                    snapshot?.stats?.home?.shotsOnTarget || 0,
                    snapshot?.stats?.away?.shotsOnTarget || 0,
                  ],

                  [
                    "Passes",
                    snapshot?.stats?.home?.passes || 0,
                    snapshot?.stats?.away?.passes || 0,
                  ],

                  [
                    "Corners",
                    snapshot?.stats?.home?.corners || 0,
                    snapshot?.stats?.away?.corners || 0,
                  ],

                  [
                    "Tackles",
                    snapshot?.stats?.home?.tackles || 0,
                    snapshot?.stats?.away?.tackles || 0,
                  ],

                  [
                    "Interceptions",
                    snapshot?.stats?.home?.interceptions || 0,
                    snapshot?.stats?.away?.interceptions || 0,
                  ],

                  [
                    "Saves",
                    snapshot?.stats?.home?.saves || 0,
                    snapshot?.stats?.away?.saves || 0,
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
          </div>
        </section>

      </main>
    </>
  );
}
