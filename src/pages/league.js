import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  getDocs,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import styles from './league.module.css';


/* =========================================================
   CONSTANTS
========================================================= */

const MAX_LEAGUES = 500;

const LEAGUE_TYPES = [
  'all',
  'league',
  'national',
  'continental',
  'cup',
];

const SORT_OPTIONS = [
  'name',
  'country',
  'teams',
  'level',
];


/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}


function displayName(value, fallback = 'Unknown') {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return fallback;
  }

  return String(value);
}


function getLeagueName(league) {
  return (
    league.name ||
    league.leagueName ||
    league.title ||
    league.displayName ||
    'Unnamed League'
  );
}


function getLeagueCountryId(league) {
  return (
    league.countryId ||
    league.countryID ||
    league.nationId ||
    league.nationalityId ||
    null
  );
}


function getLeagueCountryName(
  league,
  countries = []
) {
  const direct =
    league.countryName ||
    league.country ||
    league.nation ||
    league.country_name;

  if (direct) {
    return displayName(direct);
  }

  const countryId =
    getLeagueCountryId(league);

  if (countryId) {
    const country =
      countries.find(
        (item) =>
          item.id === countryId
      );

    if (country) {
      return (
        country.name ||
        country.countryName ||
        country.title ||
        'Unknown'
      );
    }
  }

  return 'International';
}


function getLeagueType(league) {
  return (
    league.type ||
    league.leagueType ||
    league.competitionType ||
    'league'
  );
}


function getLeagueLevel(league) {
  return safeNumber(
    league.level ??
      league.division ??
      league.tier,
    1
  );
}


function getLeagueSeason(league) {
  return (
    league.season ||
    league.currentSeason ||
    league.seasonName ||
    '2026/27'
  );
}


function getLeagueLogo(league) {
  return (
    league.logo ||
    league.logoUrl ||
    league.image ||
    league.imageUrl ||
    null
  );
}


function getLeagueDescription(league) {
  return (
    league.description ||
    league.shortDescription ||
    ''
  );
}


function getLeagueStatus(league) {
  return normalize(
    league.status ||
    league.state ||
    'active'
  );
}


function getClubLeagueId(club) {
  return (
    club.leagueId ||
    club.leagueID ||
    club.currentLeague ||
    club.currentLeagueId ||
    club.competitionId ||
    null
  );
}


function getClubName(club) {
  return (
    club.name ||
    club.clubName ||
    club.teamName ||
    'Unnamed Club'
  );
}


function getClubLogo(club) {
  return (
    club.logo ||
    club.logoUrl ||
    club.image ||
    club.imageUrl ||
    null
  );
}


function getClubCountryId(club) {
  return (
    club.countryId ||
    club.countryID ||
    club.nationId ||
    null
  );
}


function getClubLeagueName(club) {
  return (
    club.leagueName ||
    club.currentLeagueName ||
    ''
  );
}


function getClubLeague(
  club,
  league
) {
  if (!league) return false;

  const leagueId =
    getClubLeagueId(club);

  if (
    leagueId &&
    String(leagueId) ===
      String(league.id)
  ) {
    return true;
  }

  const leagueName =
    normalize(
      getClubLeagueName(club)
    );

  return (
    leagueName &&
    leagueName ===
      normalize(
        getLeagueName(league)
      )
  );
}


function getStandingValue(
  standing,
  ...keys
) {
  for (const key of keys) {
    if (
      standing[key] !== undefined &&
      standing[key] !== null
    ) {
      return safeNumber(
        standing[key]
      );
    }
  }

  return 0;
}


function getStandingTeamId(
  standing
) {
  return (
    standing.clubId ||
    standing.clubID ||
    standing.teamId ||
    standing.teamID ||
    standing.club ||
    standing.team ||
    null
  );
}


function getStandingTeamName(
  standing
) {
  return (
    standing.clubName ||
    standing.teamName ||
    standing.name ||
    standing.team ||
    'Unknown Club'
  );
}


function calculateGoalDifference(
  standing
) {
  const explicit =
    standing.goalDifference ??
    standing.goalDiff ??
    standing.gd;

  if (
    explicit !== undefined &&
    explicit !== null
  ) {
    return safeNumber(explicit);
  }

  const goalsFor =
    getStandingValue(
      standing,
      'goalsFor',
      'gf',
      'scored'
    );

  const goalsAgainst =
    getStandingValue(
      standing,
      'goalsAgainst',
      'ga',
      'conceded'
    );

  return goalsFor - goalsAgainst;
}


function calculatePoints(
  standing
) {
  if (
    standing.points !== undefined
  ) {
    return safeNumber(
      standing.points
    );
  }

  const wins =
    getStandingValue(
      standing,
      'wins',
      'won',
      'w'
    );

  const draws =
    getStandingValue(
      standing,
      'draws',
      'drawn',
      'd'
    );

  return (
    wins * 3 +
    draws
  );
}


function buildStandingFromClub(
  club
) {
  const wins =
    getStandingValue(
      club,
      'wins',
      'won',
      'w'
    );

  const draws =
    getStandingValue(
      club,
      'draws',
      'drawn',
      'd'
    );

  const losses =
    getStandingValue(
      club,
      'losses',
      'lost',
      'l'
    );

  const played =
    getStandingValue(
      club,
      'played',
      'matchesPlayed',
      'gamesPlayed',
      'p'
    );

  const goalsFor =
    getStandingValue(
      club,
      'goalsFor',
      'gf',
      'scored'
    );

  const goalsAgainst =
    getStandingValue(
      club,
      'goalsAgainst',
      'ga',
      'conceded'
    );

  return {
    clubId: club.id,
    clubName: getClubName(club),
    logo: getClubLogo(club),

    played,
    wins,
    draws,
    losses,

    goalsFor,
    goalsAgainst,

    goalDifference:
      goalsFor - goalsAgainst,

    points:
      wins * 3 + draws,

    form:
      club.form ||
      club.recentForm ||
      [],
  };
}


function normalizeStanding(
  standing,
  clubs
) {
  const teamId =
    getStandingTeamId(
      standing
    );

  let club =
    teamId
      ? clubs.find(
          (item) =>
            String(item.id) ===
            String(teamId)
        )
      : null;

  if (!club) {
    const name =
      normalize(
        getStandingTeamName(
          standing
        )
      );

    club =
      clubs.find(
        (item) =>
          normalize(
            getClubName(item)
          ) === name
      );
  }

  const clubName =
    getStandingTeamName(
      standing
    ) !== 'Unknown Club'
      ? getStandingTeamName(
          standing
        )
      : club
        ? getClubName(club)
        : 'Unknown Club';

  return {
    ...standing,

    clubId:
      teamId ||
      club?.id ||
      null,

    clubName,

    logo:
      standing.logo ||
      standing.clubLogo ||
      standing.teamLogo ||
      getClubLogo(club),

    played:
      getStandingValue(
        standing,
        'played',
        'matchesPlayed',
        'gamesPlayed',
        'p'
      ),

    wins:
      getStandingValue(
        standing,
        'wins',
        'won',
        'w'
      ),

    draws:
      getStandingValue(
        standing,
        'draws',
        'drawn',
        'd'
      ),

    losses:
      getStandingValue(
        standing,
        'losses',
        'lost',
        'l'
      ),

    goalsFor:
      getStandingValue(
        standing,
        'goalsFor',
        'gf',
        'scored'
      ),

    goalsAgainst:
      getStandingValue(
        standing,
        'goalsAgainst',
        'ga',
        'conceded'
      ),

    goalDifference:
      calculateGoalDifference(
        standing
      ),

    points:
      calculatePoints(
        standing
      ),

    form:
      standing.form ||
      standing.recentForm ||
      [],
  };
}


function sortStandings(
  standings
) {
  return [...standings].sort(
    (a, b) => {
      if (
        b.points !==
        a.points
      ) {
        return (
          b.points -
          a.points
        );
      }

      if (
        b.goalDifference !==
        a.goalDifference
      ) {
        return (
          b.goalDifference -
          a.goalDifference
        );
      }

      if (
        b.goalsFor !==
        a.goalsFor
      ) {
        return (
          b.goalsFor -
          a.goalsFor
        );
      }

      return String(
        a.clubName
      ).localeCompare(
        String(
          b.clubName
        )
      );
    }
  );
}


/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [
      leaguesSnapshot,
      clubsSnapshot,
      countriesSnapshot,
      standingsSnapshot,
    ] = await Promise.all([
      getDocs(
        collection(
          db,
          'leagues'
        )
      ),

      getDocs(
        collection(
          db,
          'clubs'
        )
      ),

      getDocs(
        collection(
          db,
          'countries'
        )
      ),

      getDocs(
        collection(
          db,
          'standings'
        )
      ),
    ]);

    const leagues =
      leaguesSnapshot.docs
        .map(
          (docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          })
        )
        .slice(
          0,
          MAX_LEAGUES
        );

    const clubs =
      clubsSnapshot.docs.map(
        (docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        })
      );

    const countries =
      countriesSnapshot.docs.map(
        (docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        })
      );

    const standings =
      standingsSnapshot.docs.map(
        (docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        })
      );

    return {
      props: {
        initialLeagues:
          JSON.parse(
            JSON.stringify(
              leagues
            )
          ),

        initialClubs:
          JSON.parse(
            JSON.stringify(
              clubs
            )
          ),

        initialCountries:
          JSON.parse(
            JSON.stringify(
              countries
            )
          ),

        initialStandings:
          JSON.parse(
            JSON.stringify(
              standings
            )
          ),
      },
    };
  } catch (error) {
    console.error(
      'League SSR error:',
      error
    );

    return {
      props: {
        initialLeagues: [],
        initialClubs: [],
        initialCountries: [],
        initialStandings: [],
      },
    };
  }
}


/* =========================================================
   PAGE
========================================================= */

export default function LeaguePage({
  initialLeagues = [],
  initialClubs = [],
  initialCountries = [],
  initialStandings = [],
}) {
  const router =
    useRouter();

  const {
    user,
    loading,
  } = useAuth();

  const [leagues] =
    useState(
      initialLeagues
    );

  const [clubs] =
    useState(
      initialClubs
    );

  const [countries] =
    useState(
      initialCountries
    );

  const [standings] =
    useState(
      initialStandings
    );

  const [
    selectedLeague,
    setSelectedLeague,
  ] = useState(null);

  const [
    search,
    setSearch,
  ] = useState('');

  const [
    countryFilter,
    setCountryFilter,
  ] = useState('all');

  const [
    typeFilter,
    setTypeFilter,
  ] = useState('all');

  const [
    sortBy,
    setSortBy,
  ] = useState('name');

  const [
    activeView,
    setActiveView,
  ] = useState('leagues');

  const [
    selectedTab,
    setSelectedTab,
  ] = useState('overview');


  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (
      !loading &&
      !user
    ) {
      router.push(
        '/login'
      );
    }
  }, [
    loading,
    user,
    router,
  ]);


  /* =======================================================
     COUNTRIES
  ======================================================= */

  const countryOptions =
    useMemo(() => {
      const names =
        new Set();

      leagues.forEach(
        (league) => {
          names.add(
            getLeagueCountryName(
              league,
              countries
            )
          );
        }
      );

      return [
        ...names,
      ]
        .filter(Boolean)
        .sort(
          (a, b) =>
            a.localeCompare(
              b
            )
        );
    }, [
      leagues,
      countries,
    ]);


  /* =======================================================
     FILTERED LEAGUES
  ======================================================= */

  const filteredLeagues =
    useMemo(() => {
      let result =
        [...leagues];

      const searchValue =
        normalize(search);

      if (
        searchValue
      ) {
        result =
          result.filter(
            (league) =>
              normalize(
                getLeagueName(
                  league
                )
              ).includes(
                searchValue
              ) ||
              normalize(
                getLeagueCountryName(
                  league,
                  countries
                )
              ).includes(
                searchValue
              )
          );
      }

      if (
        countryFilter !==
        'all'
      ) {
        result =
          result.filter(
            (league) =>
              getLeagueCountryName(
                league,
                countries
              ) ===
              countryFilter
          );
      }

      if (
        typeFilter !==
        'all'
      ) {
        result =
          result.filter(
            (league) =>
              normalize(
                getLeagueType(
                  league
                )
              ) ===
              normalize(
                typeFilter
              )
          );
      }

      result.sort(
        (a, b) => {
          switch (
            sortBy
          ) {
            case 'country':
              return getLeagueCountryName(
                a,
                countries
              ).localeCompare(
                getLeagueCountryName(
                  b,
                  countries
                )
              );

            case 'teams':
              return (
                getLeagueClubCount(
                  b
                ) -
                getLeagueClubCount(
                  a
                )
              );

            case 'level':
              return (
                getLeagueLevel(
                  a
                ) -
                getLeagueLevel(
                  b
                )
              );

            default:
              return getLeagueName(
                a
              ).localeCompare(
                getLeagueName(
                  b
                )
              );
          }
        }
      );

      return result;
    }, [
      leagues,
      countries,
      search,
      countryFilter,
      typeFilter,
      sortBy,
    ]);


  /* =======================================================
     LEAGUE CLUB COUNT
  ======================================================= */

  function getLeagueClubCount(
    league
  ) {
    const linked =
      clubs.filter(
        (club) =>
          getClubLeague(
            club,
            league
          )
      );

    if (
      league.teamCount !==
        undefined
    ) {
      return safeNumber(
        league.teamCount,
        linked.length
      );
    }

    return linked.length;
  }


  /* =======================================================
     LEAGUE STANDINGS
  ======================================================= */

  function getLeagueStandings(
    league
  ) {
    if (!league) {
      return [];
    }

    const direct =
      Array.isArray(
        league.standings
      )
        ? league.standings
        : [];

    const collectionRows =
      standings.filter(
        (standing) => {
          const id =
            standing.leagueId ||
            standing.leagueID ||
            standing.competitionId;

          return (
            id &&
            String(id) ===
              String(
                league.id
              )
          );
        }
      );

    let rows =
      direct.length
        ? direct
        : collectionRows;

    if (
      !rows.length
    ) {
      rows =
        clubs
          .filter(
            (club) =>
              getClubLeague(
                club,
                league
              )
          )
          .map(
            buildStandingFromClub
          );
    }

    return sortStandings(
      rows.map(
        (row) =>
          normalizeStanding(
            row,
            clubs
          )
      )
    );
  }


  /* =======================================================
     LEAGUE TEAMS
  ======================================================= */

  function getLeagueTeams(
    league
  ) {
    return clubs.filter(
      (club) =>
        getClubLeague(
          club,
          league
        )
    );
  }


  /* =======================================================
     SELECT LEAGUE
  ======================================================= */

  const openLeague =
    (league) => {
      setSelectedLeague(
        league
      );

      setSelectedTab(
        'overview'
      );

      setActiveView(
        'details'
      );
    };


  const closeLeague =
    () => {
      setSelectedLeague(
        null
      );

      setActiveView(
        'leagues'
      );
    };


  /* =======================================================
     SELECTED DATA
  ======================================================= */

  const selectedStandings =
    useMemo(
      () =>
        getLeagueStandings(
          selectedLeague
        ),
      [
        selectedLeague,
        clubs,
        standings,
      ]
    );

  const selectedTeams =
    useMemo(
      () =>
        getLeagueTeams(
          selectedLeague
        ),
      [
        selectedLeague,
        clubs,
      ]
    );


  const leagueStats =
    useMemo(() => {
      if (
        !selectedLeague
      ) {
        return {
          teams: 0,
          matches: 0,
          goals: 0,
          leader: null,
        };
      }

      const teams =
        selectedTeams.length ||
        safeNumber(
          selectedLeague.teamCount
        );

      const matches =
        safeNumber(
          selectedLeague.matchesPlayed ??
            selectedLeague.playedMatches ??
            selectedLeague.totalMatches
        );

      const goals =
        safeNumber(
          selectedLeague.totalGoals ??
            selectedLeague.goals
        );

      return {
        teams,
        matches,
        goals,
        leader:
          selectedStandings[0] ||
          null,
      };
    }, [
      selectedLeague,
      selectedTeams,
      selectedStandings,
    ]);


  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading ||
    !user
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
          Loading leagues...
        </p>
      </div>
    );
  }


  /* =======================================================
     DETAILS VIEW
  ======================================================= */

  if (
    activeView ===
      'details' &&
    selectedLeague
  ) {
    const leagueName =
      getLeagueName(
        selectedLeague
      );

    const countryName =
      getLeagueCountryName(
        selectedLeague,
        countries
      );

    return (
      <>
        <Head>
          <title>
            {leagueName} | League Center
          </title>

          <meta
            name="description"
            content={`${leagueName} standings, clubs and league information.`}
          />
        </Head>

        <main
          className={
            styles.page
          }
        >

          <button
            type="button"
            className={
              styles.backButton
            }
            onClick={
              closeLeague
            }
          >
            ← Back to Leagues
          </button>


          {/* HERO */}

          <section
            className={
              styles.leagueHero
            }
          >

            <div
              className={
                styles.leagueHeroLogo
              }
            >
              {getLeagueLogo(
                selectedLeague
              ) ? (
                <img
                  src={
                    getLeagueLogo(
                      selectedLeague
                    )
                  }
                  alt={
                    leagueName
                  }
                />
              ) : (
                '🏆'
              )}
            </div>


            <div
              className={
                styles.heroInfo
              }
            >
              <span
                className={
                  styles.eyebrow
                }
              >
                {countryName}
              </span>

              <h1>
                {leagueName}
              </h1>

              <p>
                {getLeagueDescription(
                  selectedLeague
                ) ||
                  `Official league center for ${leagueName}.`}
              </p>

              <div
                className={
                  styles.heroMeta
                }
              >
                <span>
                  🌍 {countryName}
                </span>

                <span>
                  📅 {getLeagueSeason(
                    selectedLeague
                  )}
                </span>

                <span>
                  🏆 Level{' '}
                  {getLeagueLevel(
                    selectedLeague
                  )}
                </span>

                <span
                  className={
                    styles.activeBadge
                  }
                >
                  ●{' '}
                  {getLeagueStatus(
                    selectedLeague
                  )}
                </span>
              </div>
            </div>


            <div
              className={
                styles.leaderBox
              }
            >
              <small>
                CURRENT LEADER
              </small>

              {leagueStats.leader ? (
                <>
                  <strong>
                    {leagueStats.leader.clubName}
                  </strong>

                  <span>
                    {leagueStats.leader.points}{' '}
                    pts
                  </span>
                </>
              ) : (
                <strong>
                  No standings
                </strong>
              )}
            </div>

          </section>


          {/* STATS */}

          <section
            className={
              styles.stats
            }
          >

            <div
              className={
                styles.statCard
              }
            >
              <span>
                👥
              </span>

              <div>
                <small>
                  TEAMS
                </small>

                <strong>
                  {leagueStats.teams}
                </strong>

                <p>
                  Clubs competing
                </p>
              </div>
            </div>


            <div
              className={
                styles.statCard
              }
            >
              <span>
                ⚽
              </span>

              <div>
                <small>
                  MATCHES
                </small>

                <strong>
                  {leagueStats.matches}
                </strong>

                <p>
                  Matches played
                </p>
              </div>
            </div>


            <div
              className={
                styles.statCard
              }
            >
              <span>
                🥅
              </span>

              <div>
                <small>
                  GOALS
                </small>

                <strong>
                  {leagueStats.goals}
                </strong>

                <p>
                  Total league goals
                </p>
              </div>
            </div>


            <div
              className={
                styles.statCard
              }
            >
              <span>
                📊
              </span>

              <div>
                <small>
                  SEASON
                </small>

                <strong>
                  {getLeagueSeason(
                    selectedLeague
                  )}
                </strong>

                <p>
                  Current campaign
                </p>
              </div>
            </div>

          </section>


          {/* TABS */}

          <nav
            className={
              styles.detailTabs
            }
          >
            <button
              className={
                selectedTab ===
                'overview'
                  ? styles.activeTab
                  : ''
              }
              onClick={() =>
                setSelectedTab(
                  'overview'
                )
              }
            >
              🏆 Overview
            </button>

            <button
              className={
                selectedTab ===
                'standings'
                  ? styles.activeTab
                  : ''
              }
              onClick={() =>
                setSelectedTab(
                  'standings'
                )
              }
            >
              📊 Standings
            </button>

            <button
              className={
                selectedTab ===
                'teams'
                  ? styles.activeTab
                  : ''
              }
              onClick={() =>
                setSelectedTab(
                  'teams'
                )
              }
            >
              👥 Teams
            </button>
          </nav>


          {/* OVERVIEW */}

          {selectedTab ===
            'overview' && (
            <section
              className={
                styles.overviewGrid
              }
            >

              <div
                className={
                  styles.overviewCard
                }
              >
                <span
                  className={
                    styles.cardLabel
                  }
                >
                  LEAGUE INFORMATION
                </span>

                <h2>
                  {leagueName}
                </h2>

                <div
                  className={
                    styles.infoRows
                  }
                >
                  <div>
                    <span>
                      Country
                    </span>

                    <strong>
                      {countryName}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Season
                    </span>

                    <strong>
                      {getLeagueSeason(
                        selectedLeague
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Competition
                    </span>

                    <strong>
                      {getLeagueType(
                        selectedLeague
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Division
                    </span>

                    <strong>
                      Level{' '}
                      {getLeagueLevel(
                        selectedLeague
                      )}
                    </strong>
                  </div>
                </div>
              </div>


              <div
                className={
                  styles.overviewCard
                }
              >
                <span
                  className={
                    styles.cardLabel
                  }
                >
                  TOP CLUB
                </span>

                {selectedStandings[0] ? (
                  <div
                    className={
                      styles.topClub
                    }
                  >
                    <div
                      className={
                        styles.topClubLogo
                      }
                    >
                      {selectedStandings[0].logo ? (
                        <img
                          src={
                            selectedStandings[0].logo
                          }
                          alt=""
                        />
                      ) : (
                        '⚽'
                      )}
                    </div>

                    <div>
                      <strong>
                        {selectedStandings[0].clubName}
                      </strong>

                      <span>
                        {selectedStandings[0].points}{' '}
                        points
                      </span>
                    </div>
                  </div>
                ) : (
                  <p
                    className={
                      styles.emptyText
                    }
                  >
                    No standings data
                    available.
                  </p>
                )}
              </div>


              <div
                className={
                  styles.overviewCard
                }
              >
                <span
                  className={
                    styles.cardLabel
                  }
                >
                  PARTICIPATING CLUBS
                </span>

                <div
                  className={
                    styles.miniClubGrid
                  }
                >
                  {selectedTeams
                    .slice(
                      0,
                      8
                    )
                    .map(
                      (club) => (
                        <div
                          key={
                            club.id
                          }
                          className={
                            styles.miniClub
                          }
                        >
                          <div>
                            {getClubLogo(
                              club
                            ) ? (
                              <img
                                src={getClubLogo(
                                  club
                                )}
                                alt=""
                              />
                            ) : (
                              '⚽'
                            )}
                          </div>

                          <span>
                            {getClubName(
                              club
                            )}
                          </span>
                        </div>
                      )
                    )}
                </div>

                {selectedTeams.length >
                  8 && (
                  <button
                    type="button"
                    className={
                      styles.textButton
                    }
                    onClick={() =>
                      setSelectedTab(
                        'teams'
                      )
                    }
                  >
                    View all{' '}
                    {
                      selectedTeams.length
                    } teams →
                  </button>
                )}
              </div>

            </section>
          )}


          {/* STANDINGS */}

          {selectedTab ===
            'standings' && (
            <section
              className={
                styles.tableCard
              }
            >

              <div
                className={
                  styles.tableHeader
                }
              >
                <div>
                  <span>
                    {leagueName}
                  </span>

                  <h2>
                    League Standings
                  </h2>
                </div>

                <strong>
                  {selectedStandings.length}{' '}
                  teams
                </strong>
              </div>


              <div
                className={
                  styles.tableWrapper
                }
              >
                <table
                  className={
                    styles.standingsTable
                  }
                >
                  <thead>
                    <tr>
                      <th>
                        #
                      </th>

                      <th>
                        Club
                      </th>

                      <th>
                        P
                      </th>

                      <th>
                        W
                      </th>

                      <th>
                        D
                      </th>

                      <th>
                        L
                      </th>

                      <th>
                        GF
                      </th>

                      <th>
                        GA
                      </th>

                      <th>
                        GD
                      </th>

                      <th>
                        PTS
                      </th>

                      <th>
                        Form
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {selectedStandings.length >
                    0 ? (
                      selectedStandings.map(
                        (
                          team,
                          index
                        ) => (
                          <tr
                            key={
                              team.clubId ||
                              team.clubName ||
                              index
                            }
                            className={
                              index ===
                              0
                                ? styles.leaderRow
                                : ''
                            }
                          >
                            <td>
                              <span
                                className={
                                  index <
                                  4
                                    ? styles.positionHighlight
                                    : styles.tablePosition
                                }
                              >
                                {index +
                                  1}
                              </span>
                            </td>

                            <td>
                              <div
                                className={
                                  styles.tableClub
                                }
                              >
                                <div
                                  className={
                                    styles.tableLogo
                                  }
                                >
                                  {team.logo ? (
                                    <img
                                      src={
                                        team.logo
                                      }
                                      alt=""
                                    />
                                  ) : (
                                    '⚽'
                                  )}
                                </div>

                                <strong>
                                  {
                                    team.clubName
                                  }
                                </strong>
                              </div>
                            </td>

                            <td>
                              {
                                team.played
                              }
                            </td>

                            <td>
                              {
                                team.wins
                              }
                            </td>

                            <td>
                              {
                                team.draws
                              }
                            </td>

                            <td>
                              {
                                team.losses
                              }
                            </td>

                            <td>
                              {
                                team.goalsFor
                              }
                            </td>

                            <td>
                              {
                                team.goalsAgainst
                              }
                            </td>

                            <td>
                              <strong
                                className={
                                  team.goalDifference >
                                  0
                                    ? styles.positive
                                    : team.goalDifference <
                                      0
                                    ? styles.negative
                                    : ''
                                }
                              >
                                {team.goalDifference >
                                0
                                  ? '+'
                                  : ''}
                                {
                                  team.goalDifference
                                }
                              </strong>
                            </td>

                            <td>
                              <strong
                                className={
                                  styles.points
                                }
                              >
                                {
                                  team.points
                                }
                              </strong>
                            </td>

                            <td>
                              <div
                                className={
                                  styles.form
                                }
                              >
                                {(
                                  Array.isArray(
                                    team.form
                                  )
                                    ? team.form
                                    : String(
                                        team.form ||
                                          ''
                                      )
                                        .split(
                                          ''
                                        )
                                )
                                  .slice(
                                    0,
                                    5
                                  )
                                  .map(
                                    (
                                      result,
                                      formIndex
                                    ) => {
                                      const r =
                                        normalize(
                                          result
                                        );

                                      return (
                                        <span
                                          key={
                                            formIndex
                                          }
                                          className={
                                            r ===
                                              'w' ||
                                            r ===
                                              'win'
                                              ? styles.formWin
                                              : r ===
                                                  'd' ||
                                                r ===
                                                  'draw'
                                              ? styles.formDraw
                                              : styles.formLoss
                                          }
                                        >
                                          {r ===
                                            'w' ||
                                          r ===
                                            'win'
                                            ? 'W'
                                            : r ===
                                                'd' ||
                                              r ===
                                                'draw'
                                            ? 'D'
                                            : 'L'}
                                        </span>
                                      );
                                    }
                                  )}
                              </div>
                            </td>
                          </tr>
                        )
                      )
                    ) : (
                      <tr>
                        <td
                          colSpan="11"
                          className={
                            styles.noData
                          }
                        >
                          No standings
                          available for
                          this league.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </section>
          )}


          {/* TEAMS */}

          {selectedTab ===
            'teams' && (
            <section
              className={
                styles.teamsSection
              }
            >

              <div
                className={
                  styles.sectionHeading
                }
              >
                <div>
                  <span>
                    {countryName}
                  </span>

                  <h2>
                    League Clubs
                  </h2>

                  <p>
                    Every club currently
                    registered in this
                    competition.
                  </p>
                </div>

                <strong>
                  {selectedTeams.length}
                </strong>
              </div>


              <div
                className={
                  styles.teamGrid
                }
              >
                {selectedTeams.length >
                0 ? (
                  selectedTeams.map(
                    (club) => (
                      <article
                        key={
                          club.id
                        }
                        className={
                          styles.teamCard
                        }
                      >
                        <div
                          className={
                            styles.teamLogo
                          }
                        >
                          {getClubLogo(
                            club
                          ) ? (
                            <img
                              src={getClubLogo(
                                club
                              )}
                              alt={
                                getClubName(
                                  club
                                )
                              }
                            />
                          ) : (
                            '⚽'
                          )}
                        </div>

                        <div>
                          <span>
                            CLUB
                          </span>

                          <h3>
                            {getClubName(
                              club
                            )}
                          </h3>

                          <p>
                            {club.city ||
                              club.location ||
                              getLeagueCountryName(
                                selectedLeague,
                                countries
                              )}
                          </p>
                        </div>

                        <div
                          className={
                            styles.teamMeta
                          }
                        >
                          <span>
                            Founded
                          </span>

                          <strong>
                            {club.founded ||
                              club.yearFounded ||
                              '-'}
                          </strong>
                        </div>
                      </article>
                    )
                  )
                ) : (
                  <div
                    className={
                      styles.emptyState
                    }
                  >
                    <span>
                      ⚽
                    </span>

                    <h3>
                      No clubs found
                    </h3>

                    <p>
                      This league has no
                      clubs connected to it
                      yet.
                    </p>
                  </div>
                )}
              </div>

            </section>
          )}

        </main>
      </>
    );
  }


  /* =======================================================
     MAIN LEAGUES VIEW
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          Leagues | Virtual Football Manager
        </title>

        <meta
          name="description"
          content="Explore football leagues, standings, countries and clubs."
        />
      </Head>


      <main
        className={
          styles.page
        }
      >

        {/* HEADER */}

        <header
          className={
            styles.header
          }
        >
          <div>
            <span
              className={
                styles.eyebrow
              }
            >
              GLOBAL FOOTBALL
            </span>

            <h1>
              League Center
            </h1>

            <p>
              Explore leagues, standings
              and clubs from around the
              football world.
            </p>
          </div>


          <div
            className={
              styles.headerStats
            }
          >
            <div>
              <strong>
                {leagues.length}
              </strong>

              <span>
                Leagues
              </span>
            </div>

            <div>
              <strong>
                {countries.length}
              </strong>

              <span>
                Countries
              </span>
            </div>

            <div>
              <strong>
                {clubs.length}
              </strong>

              <span>
                Clubs
              </span>
            </div>
          </div>
        </header>


        {/* GLOBAL STATS */}

        <section
          className={
            styles.stats
          }
        >
          <div
            className={
              styles.statCard
            }
          >
            <span>
              🏆
            </span>

            <div>
              <small>
                LEAGUES
              </small>

              <strong>
                {leagues.length}
              </strong>

              <p>
                Competitions available
              </p>
            </div>
          </div>


          <div
            className={
              styles.statCard
            }
          >
            <span>
              🌍
            </span>

            <div>
              <small>
                COUNTRIES
              </small>

              <strong>
                {countryOptions.length}
              </strong>

              <p>
                Football nations
              </p>
            </div>
          </div>


          <div
            className={
              styles.statCard
            }
          >
            <span>
              👥
            </span>

            <div>
              <small>
                CLUBS
              </small>

              <strong>
                {clubs.length}
              </strong>

              <p>
                Registered clubs
              </p>
            </div>
          </div>


          <div
            className={
              styles.statCard
            }
          >
            <span>
              📊
            </span>

            <div>
              <small>
                STANDINGS
              </small>

              <strong>
                {standings.length}
              </strong>

              <p>
                Ranking records
              </p>
            </div>
          </div>
        </section>


        {/* FILTERS */}

        <section
          className={
            styles.filters
          }
        >

          <div
            className={
              styles.search
            }
          >
            🔎

            <input
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              placeholder="Search leagues or countries..."
            />
          </div>


          <select
            value={
              countryFilter
            }
            onChange={(event) =>
              setCountryFilter(
                event.target.value
              )
            }
          >
            <option value="all">
              🌍 All Countries
            </option>

            {countryOptions.map(
              (country) => (
                <option
                  key={country}
                  value={country}
                >
                  {country}
                </option>
              )
            )}
          </select>


          <select
            value={
              typeFilter
            }
            onChange={(event) =>
              setTypeFilter(
                event.target.value
              )
            }
          >
            <option value="all">
              All Competition Types
            </option>

            <option value="league">
              League
            </option>

            <option value="national">
              National
            </option>

            <option value="continental">
              Continental
            </option>

            <option value="cup">
              Cup
            </option>
          </select>


          <select
            value={sortBy}
            onChange={(event) =>
              setSortBy(
                event.target.value
              )
            }
          >
            <option value="name">
              Sort: Name
            </option>

            <option value="country">
              Sort: Country
            </option>

            <option value="teams">
              Sort: Teams
            </option>

            <option value="level">
              Sort: Division
            </option>
          </select>

        </section>


        {/* RESULTS HEADER */}

        <div
          className={
            styles.resultsHeader
          }
        >
          <div>
            <span>
              COMPETITIONS
            </span>

            <h2>
              Football Leagues
            </h2>
          </div>

          <strong>
            {filteredLeagues.length}{' '}
            leagues
          </strong>
        </div>


        {/* LEAGUE GRID */}

        <section
          className={
            styles.leagueGrid
          }
        >

          {filteredLeagues.length >
          0 ? (
            filteredLeagues.map(
              (league) => {
                const name =
                  getLeagueName(
                    league
                  );

                const country =
                  getLeagueCountryName(
                    league,
                    countries
                  );

                const teamCount =
                  getLeagueClubCount(
                    league
                  );

                const leagueRows =
                  getLeagueStandings(
                    league
                  );

                const leader =
                  leagueRows[0];

                return (
                  <article
                    key={
                      league.id
                    }
                    className={
                      styles.leagueCard
                    }
                    onClick={() =>
                      openLeague(
                        league
                      )
                    }
                  >

                    <div
                      className={
                        styles.cardTop
                      }
                    >

                      <div
                        className={
                          styles.leagueLogo
                        }
                      >
                        {getLeagueLogo(
                          league
                        ) ? (
                          <img
                            src={getLeagueLogo(
                              league
                            )}
                            alt={
                              name
                            }
                          />
                        ) : (
                          '🏆'
                        )}
                      </div>

                      <span
                        className={
                          styles.countryBadge
                        }
                      >
                        🌍 {country}
                      </span>

                    </div>


                    <div
                      className={
                        styles.cardContent
                      }
                    >
                      <span
                        className={
                          styles.cardType
                        }
                      >
                        {getLeagueType(
                          league
                        )}
                      </span>

                      <h3>
                        {name}
                      </h3>

                      <p>
                        {getLeagueDescription(
                          league
                        ) ||
                          `${country} football competition`}
                      </p>
                    </div>


                    <div
                      className={
                        styles.cardStats
                      }
                    >
                      <div>
                        <span>
                          TEAMS
                        </span>

                        <strong>
                          {teamCount}
                        </strong>
                      </div>

                      <div>
                        <span>
                          SEASON
                        </span>

                        <strong>
                          {getLeagueSeason(
                            league
                          )}
                        </strong>
                      </div>

                      <div>
                        <span>
                          LEVEL
                        </span>

                        <strong>
                          {getLeagueLevel(
                            league
                          )}
                        </strong>
                      </div>
                    </div>


                    {leader && (
                      <div
                        className={
                          styles.leaderPreview
                        }
                      >
                        <div>
                          <small>
                            CURRENT LEADER
                          </small>

                          <strong>
                            {leader.clubName}
                          </strong>
                        </div>

                        <span>
                          {leader.points}{' '}
                          pts
                        </span>
                      </div>
                    )}


                    <div
                      className={
                        styles.cardFooter
                      }
                    >
                      <span>
                        View league
                      </span>

                      <strong>
                        →
                      </strong>
                    </div>

                  </article>
                );
              }
            )
          ) : (
            <div
              className={
                styles.emptyState
              }
            >
              <span>
                🔎
              </span>

              <h3>
                No leagues found
              </h3>

              <p>
                Try changing your search
                or filters.
              </p>
            </div>
          )}

        </section>

      </main>
    </>
  );
}
