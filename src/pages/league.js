// pages/league.js

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';

import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  writeBatch,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './league.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const MAX_LEAGUES = 500;
const FIRESTORE_BATCH_SIZE = 450;

/* =========================================================
   PRIZE MONEY CONFIGURATION
========================================================= */

const PRIZE_MONEY = {
  1: 5000000,
  2: 3500000,
  3: 2500000,
  4: 1800000,
  5: 1300000,
  6: 900000,
  7: 700000,
  8: 500000,
  9: 350000,
  10: 250000,
  11: 180000,
  12: 120000,
  13: 80000,
  14: 60000,
  15: 40000,
  16: 25000,
  17: 15000,
  18: 10000,
  19: 8000,
  20: 5000,
};

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function displayName(value, fallback = 'Unknown') {
  if (value === null || value === undefined || value === '') {
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

function getLeagueCountryName(league, countries = []) {
  const direct =
    league.countryName ||
    league.country ||
    league.nation ||
    league.country_name;

  if (direct) {
    return displayName(direct);
  }

  const countryId = getLeagueCountryId(league);

  if (countryId) {
    const country = countries.find((item) => item.id === countryId);
    if (country) {
      return country.name || country.countryName || country.title || 'Unknown';
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
  return safeNumber(league.level ?? league.division ?? league.tier, 1);
}

function getLeagueSeason(league) {
  return league.season || league.currentSeason || league.seasonName || '2026/27';
}

function getLeagueLogo(league) {
  return league.logo || league.logoUrl || league.image || league.imageUrl || null;
}

function getLeagueDescription(league) {
  return league.description || league.shortDescription || '';
}

function getLeagueStatus(league) {
  return normalize(league.status || league.state || 'active');
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
  return club.name || club.clubName || club.teamName || 'Unnamed Club';
}

function getClubLogo(club) {
  return club.logo || club.logoUrl || club.image || club.imageUrl || null;
}

function getClubLeagueName(club) {
  return club.leagueName || club.currentLeagueName || '';
}

function getClubLeague(club, league) {
  if (!league) return false;

  const leagueId = getClubLeagueId(club);

  if (leagueId && String(leagueId) === String(league.id)) {
    return true;
  }

  const leagueName = normalize(getClubLeagueName(club));

  return (
    leagueName &&
    leagueName === normalize(getLeagueName(league))
  );
}

/* =========================================================
   CALCULATE STANDINGS FROM MATCHES
========================================================= */

function calculateStandingsFromMatches(matches, leagueClubs, leagueId) {
  const standingsMap = {};

  // Initialize all clubs with zero stats
  leagueClubs.forEach((club) => {
    standingsMap[String(club.id)] = {
      clubId: club.id,
      clubName: getClubName(club),
      logo: getClubLogo(club),
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: [],
    };
  });

  // Process all matches for this league
  matches.forEach((match) => {
    if (!match.result && match.status !== 'finished') return;

    const result = match.result || {};
    const homeScore = safeNumber(result.homeScore ?? match.homeScore, 0);
    const awayScore = safeNumber(result.awayScore ?? match.awayScore, 0);

    const homeId = String(match.homeClubId || match.homeTeamId || '');
    const awayId = String(match.awayClubId || match.awayTeamId || '');

    const homeStanding = standingsMap[homeId];
    const awayStanding = standingsMap[awayId];

    if (!homeStanding || !awayStanding) return;

    // Update played
    homeStanding.played += 1;
    awayStanding.played += 1;

    // Update goals
    homeStanding.goalsFor += homeScore;
    homeStanding.goalsAgainst += awayScore;
    awayStanding.goalsFor += awayScore;
    awayStanding.goalsAgainst += homeScore;

    // Update goal difference
    homeStanding.goalDifference = homeStanding.goalsFor - homeStanding.goalsAgainst;
    awayStanding.goalDifference = awayStanding.goalsFor - awayStanding.goalsAgainst;

    // Update wins/draws/losses
    if (homeScore > awayScore) {
      homeStanding.wins += 1;
      homeStanding.points += 3;
      awayStanding.losses += 1;
      homeStanding.form.push('W');
      awayStanding.form.push('L');
    } else if (homeScore < awayScore) {
      awayStanding.wins += 1;
      awayStanding.points += 3;
      homeStanding.losses += 1;
      homeStanding.form.push('L');
      awayStanding.form.push('W');
    } else {
      homeStanding.draws += 1;
      homeStanding.points += 1;
      awayStanding.draws += 1;
      awayStanding.points += 1;
      homeStanding.form.push('D');
      awayStanding.form.push('D');
    }
  });

  // Limit form to last 5
  Object.values(standingsMap).forEach((standing) => {
    standing.form = standing.form.slice(-5);
  });

  // Convert to array and sort
  return sortStandings(Object.values(standingsMap));
}

function sortStandings(standings) {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return String(a.clubName).localeCompare(String(b.clubName));
  });
}

/* =========================================================
   SEASON COMPLETION LOGIC
========================================================= */

function processSeasonCompletion(leagues, clubs, standings) {
  const updates = [];
  const promotionMap = {};
  const relegationMap = {};
  const cafChampions = [];
  const cafConfederation = [];

  leagues.forEach((league) => {
    const leagueClubs = clubs.filter((club) => getClubLeague(club, league));
    const sorted = sortStandings(standings.filter((s) => {
      return leagueClubs.some((club) => String(club.id) === String(s.clubId));
    }));

    if (sorted.length === 0) return;

    const champion = sorted[0];
    const runnerUp = sorted[1] || null;

    // Prize money
    sorted.forEach((team, index) => {
      const position = index + 1;
      const prize = PRIZE_MONEY[position] || 0;

      if (team.clubId && prize > 0) {
        updates.push({
          clubId: team.clubId,
          prizeMoney: prize,
          position,
          leagueId: league.id,
        });
      }
    });

    // CAF Qualification
    if (champion && champion.clubId) {
      cafChampions.push(champion.clubId);
    }

    if (runnerUp && runnerUp.clubId) {
      cafConfederation.push(runnerUp.clubId);
    }

    // Promotion/Relegation
    const countryId = getLeagueCountryId(league);
    const leagueLevel = getLeagueLevel(league);

    if (countryId) {
      if (!promotionMap[countryId]) promotionMap[countryId] = {};
      if (!relegationMap[countryId]) relegationMap[countryId] = {};

      if (leagueLevel === 2) {
        const promoted = sorted.slice(0, 2).map((team) => team.clubId).filter(Boolean);
        promotionMap[countryId].fromLeagueId = league.id;
        promotionMap[countryId].clubs = promoted;
      }

      if (leagueLevel === 1) {
        const relegated = sorted.slice(-2).map((team) => team.clubId).filter(Boolean);
        relegationMap[countryId].fromLeagueId = league.id;
        relegationMap[countryId].clubs = relegated;
      }
    }
  });

  return {
    updates,
    promotionMap,
    relegationMap,
    cafChampions,
    cafConfederation,
  };
}

/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [leaguesSnapshot, clubsSnapshot, countriesSnapshot, matchesSnapshot] =
      await Promise.all([
        getDocs(collection(db, 'leagues')),
        getDocs(collection(db, 'clubs')),
        getDocs(collection(db, 'countries')),
        getDocs(collection(db, 'matches')),
      ]);

    const leagues = leaguesSnapshot.docs
      .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
      .slice(0, MAX_LEAGUES);

    const clubs = clubsSnapshot.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }));

    const countries = countriesSnapshot.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }));

    const matches = matchesSnapshot.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }));

    return {
      props: {
        initialLeagues: JSON.parse(JSON.stringify(leagues)),
        initialClubs: JSON.parse(JSON.stringify(clubs)),
        initialCountries: JSON.parse(JSON.stringify(countries)),
        initialMatches: JSON.parse(JSON.stringify(matches)),
      },
    };
  } catch (error) {
    console.error('League SSR error:', error);

    return {
      props: {
        initialLeagues: [],
        initialClubs: [],
        initialCountries: [],
        initialMatches: [],
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
  initialMatches = [],
}) {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [leagues] = useState(initialLeagues);
  const [clubs] = useState(initialClubs);
  const [countries] = useState(initialCountries);
  const [matches, setMatches] = useState(initialMatches);

  const [selectedLeague, setSelectedLeague] = useState(null);
  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [activeView, setActiveView] = useState('leagues');
  const [selectedTab, setSelectedTab] = useState('overview');
  const [isProcessingSeason, setIsProcessingSeason] = useState(false);

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  /* =======================================================
     REALTIME MATCHES
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collection(db, 'matches'),
      (snapshot) => {
        const matchList = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }));
        setMatches(matchList);
      },
      (error) => {
        console.error('Matches realtime error:', error);
      }
    );

    return () => unsubscribe();
  }, [user]);

  /* =======================================================
     GET LEAGUE STANDINGS FROM MATCHES
  ======================================================= */

  function getLeagueStandings(league) {
    if (!league) return [];

    const leagueClubs = clubs.filter((club) => getClubLeague(club, league));

    if (leagueClubs.length === 0) return [];

    const leagueMatches = matches.filter((match) => {
      return (
        match.leagueId === league.id ||
        match.leagueID === league.id ||
        match.competitionId === league.id
      );
    });

    // If no matches found by leagueId, try matching by club IDs
    if (leagueMatches.length === 0) {
      const clubIds = new Set(leagueClubs.map((club) => String(club.id)));
      const clubMatches = matches.filter((match) => {
        const homeId = String(match.homeClubId || match.homeTeamId || '');
        const awayId = String(match.awayClubId || match.awayTeamId || '');
        return clubIds.has(homeId) || clubIds.has(awayId);
      });
      return calculateStandingsFromMatches(clubMatches, leagueClubs, league.id);
    }

    return calculateStandingsFromMatches(leagueMatches, leagueClubs, league.id);
  }

  /* =======================================================
     GET ALL LEAGUE STANDINGS (for season completion)
  ======================================================= */

  const allLeagueStandings = useMemo(() => {
    const standingsMap = {};

    leagues.forEach((league) => {
      const leagueClubs = clubs.filter((club) => getClubLeague(club, league));
      if (leagueClubs.length === 0) return;

      const leagueMatches = matches.filter((match) => {
        const homeId = String(match.homeClubId || match.homeTeamId || '');
        const awayId = String(match.awayClubId || match.awayTeamId || '');
        const clubIds = new Set(leagueClubs.map((club) => String(club.id)));
        return clubIds.has(homeId) || clubIds.has(awayId);
      });

      const standings = calculateStandingsFromMatches(leagueMatches, leagueClubs, league.id);
      standingsMap[league.id] = standings;
    });

    return standingsMap;
  }, [leagues, clubs, matches]);

  /* =======================================================
     COUNTRY OPTIONS
  ======================================================= */

  const countryOptions = useMemo(() => {
    const names = new Set();

    leagues.forEach((league) => {
      names.add(getLeagueCountryName(league, countries));
    });

    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [leagues, countries]);

  /* =======================================================
     GET LEAGUE TEAMS
  ======================================================= */

  function getLeagueTeams(league) {
    return clubs.filter((club) => getClubLeague(club, league));
  }

  /* =======================================================
     GET LEAGUE CLUB COUNT
  ======================================================= */

  function getLeagueClubCount(league) {
    const linked = clubs.filter((club) => getClubLeague(club, league));

    if (league.teamCount !== undefined) {
      return safeNumber(league.teamCount, linked.length);
    }

    return linked.length;
  }

  /* =======================================================
     FILTERED LEAGUES
  ======================================================= */

  const filteredLeagues = useMemo(() => {
    let result = [...leagues];

    const searchValue = normalize(search);

    if (searchValue) {
      result = result.filter(
        (league) =>
          normalize(getLeagueName(league)).includes(searchValue) ||
          normalize(getLeagueCountryName(league, countries)).includes(searchValue)
      );
    }

    if (countryFilter !== 'all') {
      result = result.filter(
        (league) =>
          getLeagueCountryName(league, countries) === countryFilter
      );
    }

    if (typeFilter !== 'all') {
      result = result.filter(
        (league) =>
          normalize(getLeagueType(league)) === normalize(typeFilter)
      );
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'country':
          return getLeagueCountryName(a, countries).localeCompare(
            getLeagueCountryName(b, countries)
          );
        case 'teams':
          return getLeagueClubCount(b) - getLeagueClubCount(a);
        case 'level':
          return getLeagueLevel(a) - getLeagueLevel(b);
        default:
          return getLeagueName(a).localeCompare(getLeagueName(b));
      }
    });

    return result;
  }, [leagues, countries, clubs, search, countryFilter, typeFilter, sortBy]);

  /* =======================================================
     SELECTED DATA
  ======================================================= */

  const selectedStandings = useMemo(
    () => getLeagueStandings(selectedLeague),
    [selectedLeague, clubs, matches]
  );

  const selectedTeams = useMemo(
    () => getLeagueTeams(selectedLeague),
    [selectedLeague, clubs]
  );

  const leagueStats = useMemo(() => {
    if (!selectedLeague) {
      return { teams: 0, matches: 0, goals: 0, leader: null };
    }

    const teams = selectedTeams.length || safeNumber(selectedLeague.teamCount);

    const totalGoals = selectedStandings.reduce(
      (total, team) => total + team.goalsFor,
      0
    );

    const totalMatches = selectedStandings.reduce(
      (total, team) => total + team.played,
      0
    ) / 2;

    return {
      teams,
      matches: Math.round(totalMatches),
      goals: totalGoals,
      leader: selectedStandings[0] || null,
    };
  }, [selectedLeague, selectedTeams, selectedStandings]);

  /* =======================================================
     OPEN/CLOSE LEAGUE
  ======================================================= */

  const openLeague = (league) => {
    setSelectedLeague(league);
    setSelectedTab('overview');
    setActiveView('details');
  };

  const closeLeague = () => {
    setSelectedLeague(null);
    setActiveView('leagues');
  };

  /* =======================================================
     PROCESS SEASON END
  ======================================================= */

  const processSeasonEnd = useCallback(async () => {
    if (!user || isProcessingSeason) return;

    try {
      setIsProcessingSeason(true);

      const allStandings = [];
      Object.values(allLeagueStandings).forEach((standings) => {
        allStandings.push(...standings);
      });

      const result = processSeasonCompletion(leagues, clubs, allStandings);

      // Process in batches
      const allUpdates = [];

      // Prize money updates
      result.updates.forEach((update) => {
        allUpdates.push({
          type: 'prize',
          clubId: update.clubId,
          data: {
            prizeMoney: update.prizeMoney,
            lastSeasonPosition: update.position,
            totalPrizeMoney: update.prizeMoney,
            updatedAt: serverTimestamp(),
          },
        });
      });

      // Promotion updates
      Object.values(result.promotionMap).forEach((info) => {
        if (info.clubs && info.clubs.length > 0) {
          info.clubs.forEach((clubId) => {
            allUpdates.push({
              type: 'promotion',
              clubId,
              data: {
                promotedFrom: info.fromLeagueId,
                updatedAt: serverTimestamp(),
              },
            });
          });
        }
      });

      // Relegation updates
      Object.values(result.relegationMap).forEach((info) => {
        if (info.clubs && info.clubs.length > 0) {
          info.clubs.forEach((clubId) => {
            allUpdates.push({
              type: 'relegation',
              clubId,
              data: {
                relegatedFrom: info.fromLeagueId,
                updatedAt: serverTimestamp(),
              },
            });
          });
        }
      });

      // CAF Champions League
      result.cafChampions.forEach((clubId) => {
        allUpdates.push({
          type: 'caf',
          clubId,
          data: {
            cafCompetition: 'champions-league',
            updatedAt: serverTimestamp(),
          },
        });
      });

      // CAF Confederation Cup
      result.cafConfederation.forEach((clubId) => {
        allUpdates.push({
          type: 'caf',
          clubId,
          data: {
            cafCompetition: 'confederation-cup',
            updatedAt: serverTimestamp(),
          },
        });
      });

      // Batch update
      for (let i = 0; i < allUpdates.length; i += FIRESTORE_BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = allUpdates.slice(i, i + FIRESTORE_BATCH_SIZE);

        chunk.forEach((update) => {
          const clubRef = doc(db, 'clubs', update.clubId);
          batch.update(clubRef, update.data);
        });

        await batch.commit();
      }

      toast.success(
        `Season completed: ${result.updates.length} prize payments, ${result.cafChampions.length} CAF CL, ${result.cafConfederation.length} CAF Confed, promotions and relegations processed`
      );
    } catch (error) {
      console.error('Season processing error:', error);
      toast.error('Could not process season end');
    } finally {
      setIsProcessingSeason(false);
    }
  }, [user, isProcessingSeason, leagues, clubs, allLeagueStandings]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading || !user) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading leagues...</p>
      </div>
    );
  }

  /* =======================================================
     DETAILS VIEW
  ======================================================= */

  if (activeView === 'details' && selectedLeague) {
    const leagueName = getLeagueName(selectedLeague);
    const countryName = getLeagueCountryName(selectedLeague, countries);

    return (
      <>
        <Head>
          <title>{leagueName} | League Center</title>
          <meta
            name="description"
            content={`${leagueName} standings, clubs and league information.`}
          />
        </Head>

        <main className={styles.page}>
          <button
            type="button"
            className={styles.backButton}
            onClick={closeLeague}
          >
            ← Back to Leagues
          </button>

          {/* HERO */}
          <section className={styles.leagueHero}>
            <div className={styles.leagueHeroLogo}>
              {getLeagueLogo(selectedLeague) ? (
                <img src={getLeagueLogo(selectedLeague)} alt={leagueName} />
              ) : (
                '🏆'
              )}
            </div>

            <div className={styles.heroInfo}>
              <span className={styles.eyebrow}>{countryName}</span>
              <h1>{leagueName}</h1>
              <p>
                {getLeagueDescription(selectedLeague) ||
                  `Official league center for ${leagueName}.`}
              </p>

              <div className={styles.heroMeta}>
                <span>🌍 {countryName}</span>
                <span>📅 {getLeagueSeason(selectedLeague)}</span>
                <span>🏆 Level {getLeagueLevel(selectedLeague)}</span>
                <span className={styles.activeBadge}>
                  ● {getLeagueStatus(selectedLeague)}
                </span>
              </div>
            </div>

            <div className={styles.leaderBox}>
              <small>CURRENT LEADER</small>
              {leagueStats.leader ? (
                <>
                  <strong>{leagueStats.leader.clubName}</strong>
                  <span>{leagueStats.leader.points} pts</span>
                </>
              ) : (
                <strong>No standings</strong>
              )}
            </div>
          </section>

          {/* STATS */}
          <section className={styles.stats}>
            <div className={styles.statCard}>
              <span>👥</span>
              <div>
                <small>TEAMS</small>
                <strong>{leagueStats.teams}</strong>
                <p>Clubs competing</p>
              </div>
            </div>

            <div className={styles.statCard}>
              <span>⚽</span>
              <div>
                <small>MATCHES</small>
                <strong>{leagueStats.matches}</strong>
                <p>Matches played</p>
              </div>
            </div>

            <div className={styles.statCard}>
              <span>🥅</span>
              <div>
                <small>GOALS</small>
                <strong>{leagueStats.goals}</strong>
                <p>Total league goals</p>
              </div>
            </div>

            <div className={styles.statCard}>
              <span>💰</span>
              <div>
                <small>CHAMPION PRIZE</small>
                <strong>${(PRIZE_MONEY[1] / 1000000).toFixed(1)}M</strong>
                <p>League winner</p>
              </div>
            </div>
          </section>

          {/* TABS */}
          <nav className={styles.detailTabs}>
            <button
              className={selectedTab === 'overview' ? styles.activeTab : ''}
              onClick={() => setSelectedTab('overview')}
            >
              🏆 Overview
            </button>

            <button
              className={selectedTab === 'standings' ? styles.activeTab : ''}
              onClick={() => setSelectedTab('standings')}
            >
              📊 Standings
            </button>

            <button
              className={selectedTab === 'teams' ? styles.activeTab : ''}
              onClick={() => setSelectedTab('teams')}
            >
              👥 Teams
            </button>
          </nav>

          {/* SEASON COMPLETION BUTTON */}
          <section className={styles.seasonAction}>
            <button
              type="button"
              className={styles.seasonButton}
              onClick={processSeasonEnd}
              disabled={isProcessingSeason}
            >
              {isProcessingSeason
                ? 'Processing...'
                : '🏆 Complete Season - Process Prizes & Promotions'}
            </button>
          </section>

          {/* OVERVIEW */}
          {selectedTab === 'overview' && (
            <section className={styles.overviewGrid}>
              <div className={styles.overviewCard}>
                <span className={styles.cardLabel}>LEAGUE INFORMATION</span>
                <h2>{leagueName}</h2>

                <div className={styles.infoRows}>
                  <div>
                    <span>Country</span>
                    <strong>{countryName}</strong>
                  </div>
                  <div>
                    <span>Season</span>
                    <strong>{getLeagueSeason(selectedLeague)}</strong>
                  </div>
                  <div>
                    <span>Competition</span>
                    <strong>{getLeagueType(selectedLeague)}</strong>
                  </div>
                  <div>
                    <span>Division</span>
                    <strong>Level {getLeagueLevel(selectedLeague)}</strong>
                  </div>
                </div>
              </div>

              <div className={styles.overviewCard}>
                <span className={styles.cardLabel}>TOP CLUB</span>

                {selectedStandings[0] ? (
                  <div className={styles.topClub}>
                    <div className={styles.topClubLogo}>
                      {selectedStandings[0].logo ? (
                        <img src={selectedStandings[0].logo} alt="" />
                      ) : (
                        '⚽'
                      )}
                    </div>
                    <div>
                      <strong>{selectedStandings[0].clubName}</strong>
                      <span>{selectedStandings[0].points} points</span>
                    </div>
                  </div>
                ) : (
                  <p className={styles.emptyText}>No standings data available.</p>
                )}
              </div>

              <div className={styles.overviewCard}>
                <span className={styles.cardLabel}>PRIZE MONEY DISTRIBUTION</span>

                <div className={styles.prizeList}>
                  {selectedStandings.slice(0, 5).map((team, index) => (
                    <div key={team.clubId || index} className={styles.prizeRow}>
                      <span>
                        {index + 1}. {team.clubName}
                      </span>
                      <strong>
                        ${((PRIZE_MONEY[index + 1] || 0) / 1000000).toFixed(2)}M
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* STANDINGS */}
          {selectedTab === 'standings' && (
            <section className={styles.tableCard}>
              <div className={styles.tableHeader}>
                <div>
                  <span>{leagueName}</span>
                  <h2>League Standings</h2>
                </div>
                <strong>{selectedStandings.length} teams</strong>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.standingsTable}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Club</th>
                      <th>P</th>
                      <th>W</th>
                      <th>D</th>
                      <th>L</th>
                      <th>GF</th>
                      <th>GA</th>
                      <th>GD</th>
                      <th>PTS</th>
                      <th>Prize</th>
                      <th>Form</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedStandings.length > 0 ? (
                      selectedStandings.map((team, index) => {
                        const prize = PRIZE_MONEY[index + 1] || 0;
                        const isChampion = index === 0;
                        const isRunnerUp = index === 1;

                        return (
                          <tr
                            key={team.clubId || team.clubName || index}
                            className={
                              isChampion
                                ? styles.championRow
                                : isRunnerUp
                                  ? styles.runnerUpRow
                                  : ''
                            }
                          >
                            <td>
                              <span
                                className={
                                  index < 4
                                    ? styles.positionHighlight
                                    : styles.tablePosition
                                }
                              >
                                {index + 1}
                              </span>
                            </td>

                            <td>
                              <div className={styles.tableClub}>
                                <div className={styles.tableLogo}>
                                  {team.logo ? (
                                    <img src={team.logo} alt="" />
                                  ) : (
                                    '⚽'
                                  )}
                                </div>
                                <strong>{team.clubName}</strong>
                              </div>
                            </td>

                            <td>{team.played}</td>
                            <td>{team.wins}</td>
                            <td>{team.draws}</td>
                            <td>{team.losses}</td>
                            <td>{team.goalsFor}</td>
                            <td>{team.goalsAgainst}</td>

                            <td>
                              <strong
                                className={
                                  team.goalDifference > 0
                                    ? styles.positive
                                    : team.goalDifference < 0
                                      ? styles.negative
                                      : ''
                                }
                              >
                                {team.goalDifference > 0 ? '+' : ''}
                                {team.goalDifference}
                              </strong>
                            </td>

                            <td>
                              <strong className={styles.points}>{team.points}</strong>
                            </td>

                            <td>
                              <span className={styles.prizeAmount}>
                                ${(prize / 1000000).toFixed(2)}M
                              </span>
                            </td>

                            <td>
                              <div className={styles.form}>
                                {(Array.isArray(team.form)
                                  ? team.form
                                  : String(team.form || '').split('')
                                )
                                  .slice(-5)
                                  .map((result, formIndex) => {
                                    const r = normalize(result);
                                    return (
                                      <span
                                        key={formIndex}
                                        className={
                                          r === 'w' || r === 'win'
                                            ? styles.formWin
                                            : r === 'd' || r === 'draw'
                                              ? styles.formDraw
                                              : styles.formLoss
                                        }
                                      >
                                        {r === 'w' || r === 'win'
                                          ? 'W'
                                          : r === 'd' || r === 'draw'
                                            ? 'D'
                                            : 'L'}
                                      </span>
                                    );
                                  })}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="12" className={styles.noData}>
                          No standings available for this league.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* TEAMS */}
          {selectedTab === 'teams' && (
            <section className={styles.teamsSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <span>{countryName}</span>
                  <h2>League Clubs</h2>
                  <p>Every club currently registered in this competition.</p>
                </div>
                <strong>{selectedTeams.length}</strong>
              </div>

              <div className={styles.teamGrid}>
                {selectedTeams.length > 0 ? (
                  selectedTeams.map((club) => (
                    <article key={club.id} className={styles.teamCard}>
                      <div className={styles.teamLogo}>
                        {getClubLogo(club) ? (
                          <img src={getClubLogo(club)} alt={getClubName(club)} />
                        ) : (
                          '⚽'
                        )}
                      </div>

                      <div>
                        <span>CLUB</span>
                        <h3>{getClubName(club)}</h3>
                        <p>
                          {club.city ||
                            club.location ||
                            getLeagueCountryName(selectedLeague, countries)}
                        </p>
                      </div>

                      <div className={styles.teamMeta}>
                        <span>Founded</span>
                        <strong>{club.founded || club.yearFounded || '-'}</strong>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className={styles.emptyState}>
                    <span>⚽</span>
                    <h3>No clubs found</h3>
                    <p>This league has no clubs connected to it yet.</p>
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
        <title>Leagues | Virtual Football Manager</title>
        <meta
          name="description"
          content="Explore football leagues, standings, countries and clubs."
        />
      </Head>

      <main className={styles.page}>
        {/* HEADER */}
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>GLOBAL FOOTBALL</span>
            <h1>League Center</h1>
            <p>Explore leagues, standings and clubs from around the football world.</p>
          </div>

          <div className={styles.headerStats}>
            <div>
              <strong>{leagues.length}</strong>
              <span>Leagues</span>
            </div>
            <div>
              <strong>{countries.length}</strong>
              <span>Countries</span>
            </div>
            <div>
              <strong>{clubs.length}</strong>
              <span>Clubs</span>
            </div>
          </div>
        </header>

        {/* GLOBAL STATS */}
        <section className={styles.stats}>
          <div className={styles.statCard}>
            <span>🏆</span>
            <div>
              <small>LEAGUES</small>
              <strong>{leagues.length}</strong>
              <p>Competitions available</p>
            </div>
          </div>

          <div className={styles.statCard}>
            <span>🌍</span>
            <div>
              <small>COUNTRIES</small>
              <strong>{countryOptions.length}</strong>
              <p>Football nations</p>
            </div>
          </div>

          <div className={styles.statCard}>
            <span>👥</span>
            <div>
              <small>CLUBS</small>
              <strong>{clubs.length}</strong>
              <p>Registered clubs</p>
            </div>
          </div>

          <div className={styles.statCard}>
            <span>📊</span>
            <div>
              <small>MATCHES</small>
              <strong>{matches.length}</strong>
              <p>Matches recorded</p>
            </div>
          </div>
        </section>

        {/* FILTERS */}
        <section className={styles.filters}>
          <div className={styles.search}>
            🔎
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search leagues or countries..."
            />
          </div>

          <select
            value={countryFilter}
            onChange={(event) => setCountryFilter(event.target.value)}
          >
            <option value="all">🌍 All Countries</option>
            {countryOptions.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">All Competition Types</option>
            <option value="league">League</option>
            <option value="national">National</option>
            <option value="continental">Continental</option>
            <option value="cup">Cup</option>
          </select>

          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            <option value="name">Sort: Name</option>
            <option value="country">Sort: Country</option>
            <option value="teams">Sort: Teams</option>
            <option value="level">Sort: Division</option>
          </select>
        </section>

        {/* RESULTS HEADER */}
        <div className={styles.resultsHeader}>
          <div>
            <span>COMPETITIONS</span>
            <h2>Football Leagues</h2>
          </div>
          <strong>{filteredLeagues.length} leagues</strong>
        </div>

        {/* LEAGUE GRID */}
        <section className={styles.leagueGrid}>
          {filteredLeagues.length > 0 ? (
            filteredLeagues.map((league) => {
              const name = getLeagueName(league);
              const country = getLeagueCountryName(league, countries);
              const teamCount = getLeagueClubCount(league);
              const leagueRows = getLeagueStandings(league);
              const leader = leagueRows[0];

              return (
                <article
                  key={league.id}
                  className={styles.leagueCard}
                  onClick={() => openLeague(league)}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.leagueLogo}>
                      {getLeagueLogo(league) ? (
                        <img src={getLeagueLogo(league)} alt={name} />
                      ) : (
                        '🏆'
                      )}
                    </div>
                    <span className={styles.countryBadge}>🌍 {country}</span>
                  </div>

                  <div className={styles.cardContent}>
                    <span className={styles.cardType}>{getLeagueType(league)}</span>
                    <h3>{name}</h3>
                    <p>
                      {getLeagueDescription(league) ||
                        `${country} football competition`}
                    </p>
                  </div>

                  <div className={styles.cardStats}>
                    <div>
                      <span>TEAMS</span>
                      <strong>{teamCount}</strong>
                    </div>
                    <div>
                      <span>SEASON</span>
                      <strong>{getLeagueSeason(league)}</strong>
                    </div>
                    <div>
                      <span>LEVEL</span>
                      <strong>{getLeagueLevel(league)}</strong>
                    </div>
                  </div>

                  {leader && (
                    <div className={styles.leaderPreview}>
                      <div>
                        <small>CURRENT LEADER</small>
                        <strong>{leader.clubName}</strong>
                      </div>
                      <span>{leader.points} pts</span>
                    </div>
                  )}

                  <div className={styles.cardFooter}>
                    <span>View league</span>
                    <strong>→</strong>
                  </div>
                </article>
              );
            })
          ) : (
            <div className={styles.emptyState}>
              <span>🔎</span>
              <h3>No leagues found</h3>
              <p>Try changing your search or filters.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
