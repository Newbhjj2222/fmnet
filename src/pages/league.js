// pages/league.js

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";

import Head from "next/head";
import { useRouter } from "next/router";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../components/firebase";
import { useAuth } from "../context/AuthContext";

import toast from "react-hot-toast";

import styles from "./league.module.css";

/* =========================================================
   CONSTANTS
========================================================= */

const MAX_LEAGUES = 500;
const FIRESTORE_BATCH_SIZE = 450;

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function displayName(value, fallback = "Unknown") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return String(value);
}

/* =========================================================
   LEAGUE HELPERS
========================================================= */

function getLeagueName(league) {
  return (
    league?.name ||
    league?.leagueName ||
    league?.title ||
    league?.displayName ||
    "Unnamed Competition"
  );
}

function getLeagueCountryId(league) {
  return (
    league?.countryId ||
    league?.countryID ||
    league?.nationId ||
    league?.nationalityId ||
    null
  );
}

function getLeagueCountryName(league, countries = []) {
  const direct =
    league?.countryName ||
    league?.country ||
    league?.nation ||
    league?.country_name;

  if (direct) {
    return displayName(direct);
  }

  const countryId = getLeagueCountryId(league);

  if (countryId) {
    const country = countries.find(
      (item) => String(item.id) === String(countryId)
    );

    if (country) {
      return (
        country.name ||
        country.countryName ||
        country.title ||
        "Unknown"
      );
    }
  }

  return "International";
}

function getLeagueType(league) {
  return (
    league?.type ||
    league?.leagueType ||
    league?.competitionType ||
    "league"
  );
}

function isCupCompetition(league) {
  return normalize(getLeagueType(league)) === "cup";
}

function isLeagueCompetition(league) {
  return !isCupCompetition(league);
}

function getLeagueLevel(league) {
  return safeNumber(
    league?.level ??
      league?.division ??
      league?.tier,
    1
  );
}

function getLeagueSeason(league) {
  return (
    league?.season ||
    league?.currentSeason ||
    league?.seasonName ||
    "Unknown Season"
  );
}

function getLeagueLogo(league) {
  return (
    league?.logo ||
    league?.logoUrl ||
    league?.image ||
    league?.imageUrl ||
    null
  );
}

function getLeagueDescription(league) {
  return (
    league?.description ||
    league?.shortDescription ||
    ""
  );
}

function getLeagueStatus(league) {
  return normalize(
    league?.status ||
      league?.state ||
      "active"
  );
}

/* =========================================================
   CLUB HELPERS
========================================================= */

function getClubLeagueId(club) {
  return (
    club?.leagueId ||
    club?.leagueID ||
    club?.currentLeague ||
    club?.currentLeagueId ||
    club?.competitionId ||
    null
  );
}

function getClubName(club) {
  return (
    club?.name ||
    club?.clubName ||
    club?.teamName ||
    "Unnamed Club"
  );
}

function getClubLogo(club) {
  return (
    club?.logo ||
    club?.logoUrl ||
    club?.image ||
    club?.imageUrl ||
    null
  );
}

function getClubLeagueName(club) {
  return (
    club?.leagueName ||
    club?.currentLeagueName ||
    ""
  );
}

function getClubLeague(club, league) {
  if (!league) return false;

  const leagueId = getClubLeagueId(club);

  if (
    leagueId &&
    String(leagueId) === String(league.id)
  ) {
    return true;
  }

  const leagueName = normalize(
    getClubLeagueName(club)
  );

  return (
    leagueName &&
    leagueName === normalize(getLeagueName(league))
  );
}

/* =========================================================
   PRIZE MONEY FROM DATABASE
========================================================= */

/*
  Supported database examples:

  1. Simple champion prize:

     prizeMoney: 5000000

  2. Array:

     prizeMoney: [
       5000000,
       3500000,
       2500000
     ]

  3. Object:

     prizeMoney: {
       "1": 5000000,
       "2": 3500000,
       "3": 2500000
     }

  4. Nested distribution:

     prizeMoney: {
       distribution: {
         "1": 5000000,
         "2": 3500000
       }
     }

  5. prizes:

     prizes: {
       "1": 5000000,
       "2": 3500000
     }
*/

function getPrizeConfig(league) {
  if (!league) return null;

  return (
    league.prizeMoney ??
    league.prizes ??
    league.prizeDistribution ??
    league.prizeMoneyDistribution ??
    null
  );
}

function getPrizeMoneyForPosition(league, position) {
  const config = getPrizeConfig(league);

  if (config === null || config === undefined) {
    return 0;
  }

  /* ---------------------------------------------
     NUMBER
  --------------------------------------------- */

  if (typeof config === "number") {
    return position === 1 ? safeNumber(config) : 0;
  }

  /* ---------------------------------------------
     STRING NUMBER
  --------------------------------------------- */

  if (
    typeof config === "string" &&
    config.trim() !== "" &&
    Number.isFinite(Number(config))
  ) {
    return position === 1
      ? safeNumber(config)
      : 0;
  }

  /* ---------------------------------------------
     ARRAY
  --------------------------------------------- */

  if (Array.isArray(config)) {
    return safeNumber(
      config[position - 1],
      0
    );
  }

  /* ---------------------------------------------
     OBJECT
  --------------------------------------------- */

  if (typeof config === "object") {
    const nested =
      config.distribution ||
      config.positions ||
      config.prizes ||
      config.amounts ||
      config.values;

    if (
      nested &&
      typeof nested === "object"
    ) {
      return safeNumber(
        nested[position] ??
          nested[String(position)],
        0
      );
    }

    return safeNumber(
      config[position] ??
        config[String(position)],
      0
    );
  }

  return 0;
}

function formatMoney(value) {
  const amount = safeNumber(value, 0);

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(amount);
}

/* =========================================================
   MATCH SCORE HELPERS
========================================================= */

function getMatchScore(match, side) {
  const result = match?.result || {};

  if (side === "home") {
    return safeNumber(
      result.homeScore ??
        result.homeGoals ??
        match?.homeScore ??
        match?.homeGoals,
      0
    );
  }

  return safeNumber(
    result.awayScore ??
      result.awayGoals ??
      match?.awayScore ??
      match?.awayGoals,
    0
  );
}

function isFinishedMatch(match) {
  const status = normalize(
    match?.status ||
      match?.state ||
      ""
  );

  return (
    status === "finished" ||
    status === "completed" ||
    status === "full_time" ||
    status === "ft" ||
    Boolean(match?.result)
  );
}

/* =========================================================
   NORMAL LEAGUE STANDINGS
========================================================= */

function createEmptyStanding(club) {
  return {
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
}

function sortStandings(standings) {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
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

    if (b.goalsFor !== a.goalsFor) {
      return b.goalsFor - a.goalsFor;
    }

    return String(a.clubName).localeCompare(
      String(b.clubName)
    );
  });
}

function calculateStandingsFromMatches(
  matches,
  leagueClubs
) {
  const standingsMap = {};

  leagueClubs.forEach((club) => {
    standingsMap[String(club.id)] =
      createEmptyStanding(club);
  });

  matches.forEach((match) => {
    if (!isFinishedMatch(match)) {
      return;
    }

    const homeId = String(
      match?.homeClubId ||
        match?.homeTeamId ||
        ""
    );

    const awayId = String(
      match?.awayClubId ||
        match?.awayTeamId ||
        ""
    );

    const homeStanding =
      standingsMap[homeId];

    const awayStanding =
      standingsMap[awayId];

    if (
      !homeStanding ||
      !awayStanding
    ) {
      return;
    }

    const homeScore =
      getMatchScore(match, "home");

    const awayScore =
      getMatchScore(match, "away");

    homeStanding.played += 1;
    awayStanding.played += 1;

    homeStanding.goalsFor +=
      homeScore;

    homeStanding.goalsAgainst +=
      awayScore;

    awayStanding.goalsFor +=
      awayScore;

    awayStanding.goalsAgainst +=
      homeScore;

    homeStanding.goalDifference =
      homeStanding.goalsFor -
      homeStanding.goalsAgainst;

    awayStanding.goalDifference =
      awayStanding.goalsFor -
      awayStanding.goalsAgainst;

    if (homeScore > awayScore) {
      homeStanding.wins += 1;
      homeStanding.points += 3;

      awayStanding.losses += 1;

      homeStanding.form.push("W");
      awayStanding.form.push("L");
    } else if (
      homeScore < awayScore
    ) {
      awayStanding.wins += 1;
      awayStanding.points += 3;

      homeStanding.losses += 1;

      homeStanding.form.push("L");
      awayStanding.form.push("W");
    } else {
      homeStanding.draws += 1;
      awayStanding.draws += 1;

      homeStanding.points += 1;
      awayStanding.points += 1;

      homeStanding.form.push("D");
      awayStanding.form.push("D");
    }
  });

  Object.values(standingsMap).forEach(
    (standing) => {
      standing.form =
        standing.form.slice(-5);
    }
  );

  return sortStandings(
    Object.values(standingsMap)
  );
}

/* =========================================================
   CUP GROUP HELPERS
========================================================= */

function getCupGroupName(match) {
  return (
    match?.groupName ||
    match?.cupGroupName ||
    match?.group ||
    null
  );
}

function getCupGroupId(match) {
  return (
    match?.groupId ||
    match?.cupGroupId ||
    null
  );
}

function getCupGroupFromClub(
  club,
  cupMatches
) {
  const clubId = String(club.id);

  const match = cupMatches.find((item) => {
    const homeId = String(
      item?.homeClubId ||
        item?.homeTeamId ||
        ""
    );

    const awayId = String(
      item?.awayClubId ||
        item?.awayTeamId ||
        ""
    );

    return (
      homeId === clubId ||
      awayId === clubId
    );
  });

  if (!match) {
    return null;
  }

  return {
    id: getCupGroupId(match),
    name: getCupGroupName(match),
  };
}

function calculateCupGroupStandings(
  cupMatches,
  groupClubs
) {
  const standingsMap = {};

  groupClubs.forEach((club) => {
    standingsMap[String(club.id)] =
      createEmptyStanding(club);
  });

  cupMatches.forEach((match) => {
    if (!isFinishedMatch(match)) {
      return;
    }

    const homeId = String(
      match?.homeClubId ||
        match?.homeTeamId ||
        ""
    );

    const awayId = String(
      match?.awayClubId ||
        match?.awayTeamId ||
        ""
    );

    const homeStanding =
      standingsMap[homeId];

    const awayStanding =
      standingsMap[awayId];

    if (
      !homeStanding ||
      !awayStanding
    ) {
      return;
    }

    const homeScore =
      getMatchScore(match, "home");

    const awayScore =
      getMatchScore(match, "away");

    homeStanding.played += 1;
    awayStanding.played += 1;

    homeStanding.goalsFor +=
      homeScore;

    homeStanding.goalsAgainst +=
      awayScore;

    awayStanding.goalsFor +=
      awayScore;

    awayStanding.goalsAgainst +=
      homeScore;

    homeStanding.goalDifference =
      homeStanding.goalsFor -
      homeStanding.goalsAgainst;

    awayStanding.goalDifference =
      awayStanding.goalsFor -
      awayStanding.goalsAgainst;

    if (homeScore > awayScore) {
      homeStanding.wins += 1;
      homeStanding.points += 3;

      awayStanding.losses += 1;

      homeStanding.form.push("W");
      awayStanding.form.push("L");
    } else if (
      awayScore > homeScore
    ) {
      awayStanding.wins += 1;
      awayStanding.points += 3;

      homeStanding.losses += 1;

      homeStanding.form.push("L");
      awayStanding.form.push("W");
    } else {
      homeStanding.draws += 1;
      awayStanding.draws += 1;

      homeStanding.points += 1;
      awayStanding.points += 1;

      homeStanding.form.push("D");
      awayStanding.form.push("D");
    }
  });

  Object.values(standingsMap).forEach(
    (standing) => {
      standing.form =
        standing.form.slice(-5);
    }
  );

  return sortStandings(
    Object.values(standingsMap)
  );
}

/* =========================================================
   GET CUP GROUPS
========================================================= */

function buildCupGroups(
  leagueClubs,
  cupMatches
) {
  const groupsMap = {};

  /*
    Primary source:
    groupId/groupName stored directly
    on generated cup fixtures.
  */

  cupMatches.forEach((match) => {
    const groupId =
      getCupGroupId(match);

    const groupName =
      getCupGroupName(match);

    if (!groupId && !groupName) {
      return;
    }

    const key = String(
      groupId || groupName
    );

    if (!groupsMap[key]) {
      groupsMap[key] = {
        id: groupId || key,
        name:
          groupName ||
          key,
        clubIds: new Set(),
      };
    }

    if (match.homeClubId) {
      groupsMap[key].clubIds.add(
        String(match.homeClubId)
      );
    }

    if (match.awayClubId) {
      groupsMap[key].clubIds.add(
        String(match.awayClubId)
      );
    }
  });

  /*
    Convert Set -> actual club objects
  */

  const groups = Object.values(
    groupsMap
  ).map((group) => {
    const groupClubs =
      leagueClubs.filter((club) =>
        group.clubIds.has(
          String(club.id)
        )
      );

    const groupMatches =
      cupMatches.filter((match) => {
        const matchGroupId =
          getCupGroupId(match);

        const matchGroupName =
          getCupGroupName(match);

        return (
          String(
            matchGroupId || ""
          ) === String(group.id) ||
          normalize(matchGroupName) ===
            normalize(group.name)
        );
      });

    const standings =
      calculateCupGroupStandings(
        groupMatches,
        groupClubs
      );

    return {
      ...group,
      clubs: groupClubs,
      matches: groupMatches,
      standings,
    };
  });

  return groups.sort((a, b) =>
    String(a.name).localeCompare(
      String(b.name),
      undefined,
      { numeric: true }
    )
  );
}

/* =========================================================
   CUP QUALIFICATION
========================================================= */

function getCupQualifiedTeams(
  cupGroups
) {
  const qualified = [];

  cupGroups.forEach((group) => {
    const first =
      group.standings[0] || null;

    const second =
      group.standings[1] || null;

    if (first) {
      qualified.push({
        ...first,
        groupName: group.name,
        groupPosition: 1,
        qualified: true,
      });
    }

    if (second) {
      qualified.push({
        ...second,
        groupName: group.name,
        groupPosition: 2,
        qualified: true,
      });
    }
  });

  return qualified;
}

/* =========================================================
   SEASON COMPLETION
========================================================= */

function processSeasonCompletion(
  leagues,
  clubs,
  standingsMap
) {
  const updates = [];

  const promotionMap = {};
  const relegationMap = {};

  const cafChampions = [];
  const cafConfederation = [];

  leagues.forEach((league) => {
    /*
      Cup competitions do not use
      normal league promotion/relegation.
    */

    if (isCupCompetition(league)) {
      return;
    }

    const leagueStandings =
      standingsMap[league.id] || [];

    if (
      leagueStandings.length === 0
    ) {
      return;
    }

    const sorted =
      sortStandings(
        leagueStandings
      );

    const champion =
      sorted[0];

    const runnerUp =
      sorted[1] || null;

    /*
      PRIZE MONEY FROM DATABASE
    */

    sorted.forEach(
      (team, index) => {
        const position = index + 1;

        const prize =
          getPrizeMoneyForPosition(
            league,
            position
          );

        if (
          team.clubId &&
          prize > 0
        ) {
          updates.push({
            clubId: team.clubId,
            prizeMoney: prize,
            position,
            leagueId: league.id,
          });
        }
      }
    );

    /*
      CAF
    */

    if (
      champion?.clubId
    ) {
      cafChampions.push(
        champion.clubId
      );
    }

    if (
      runnerUp?.clubId
    ) {
      cafConfederation.push(
        runnerUp.clubId
      );
    }

    /*
      PROMOTION / RELEGATION
    */

    const countryId =
      getLeagueCountryId(league);

    const leagueLevel =
      getLeagueLevel(league);

    if (countryId) {
      if (
        !promotionMap[countryId]
      ) {
        promotionMap[countryId] = {};
      }

      if (
        !relegationMap[countryId]
      ) {
        relegationMap[countryId] = {};
      }

      if (
        leagueLevel === 2
      ) {
        const promoted =
          sorted
            .slice(0, 2)
            .map(
              (team) =>
                team.clubId
            )
            .filter(Boolean);

        promotionMap[
          countryId
        ].fromLeagueId =
          league.id;

        promotionMap[
          countryId
        ].clubs = promoted;
      }

      if (
        leagueLevel === 1
      ) {
        const relegated =
          sorted
            .slice(-2)
            .map(
              (team) =>
                team.clubId
            )
            .filter(Boolean);

        relegationMap[
          countryId
        ].fromLeagueId =
          league.id;

        relegationMap[
          countryId
        ].clubs = relegated;
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
    const [
      leaguesSnapshot,
      clubsSnapshot,
      countriesSnapshot,
      matchesSnapshot,
    ] = await Promise.all([
      getDocs(
        collection(db, "leagues")
      ),

      getDocs(
        collection(db, "clubs")
      ),

      getDocs(
        collection(db, "countries")
      ),

      getDocs(
        collection(db, "matches")
      ),
    ]);

    const leagues =
      leaguesSnapshot.docs
        .map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }))
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

    const matches =
      matchesSnapshot.docs.map(
        (docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        })
      );

    return {
      props: {
        initialLeagues:
          JSON.parse(
            JSON.stringify(leagues)
          ),

        initialClubs:
          JSON.parse(
            JSON.stringify(clubs)
          ),

        initialCountries:
          JSON.parse(
            JSON.stringify(countries)
          ),

        initialMatches:
          JSON.parse(
            JSON.stringify(matches)
          ),
      },
    };
  } catch (error) {
    console.error(
      "League SSR error:",
      error
    );

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

  const {
    user,
    loading,
  } = useAuth();

  const [leagues] =
    useState(initialLeagues);

  const [clubs] =
    useState(initialClubs);

  const [countries] =
    useState(initialCountries);

  const [matches, setMatches] =
    useState(initialMatches);

  const [
    selectedLeague,
    setSelectedLeague,
  ] = useState(null);

  const [search, setSearch] =
    useState("");

  const [
    countryFilter,
    setCountryFilter,
  ] = useState("all");

  const [
    typeFilter,
    setTypeFilter,
  ] = useState("all");

  const [sortBy, setSortBy] =
    useState("name");

  const [
    activeView,
    setActiveView,
  ] = useState("leagues");

  const [
    selectedTab,
    setSelectedTab,
  ] = useState("overview");

  const [
    isProcessingSeason,
    setIsProcessingSeason,
  ] = useState(false);

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [
    loading,
    user,
    router,
  ]);

  /* =======================================================
     REALTIME MATCHES
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const unsubscribe =
      onSnapshot(
        collection(db, "matches"),
        (snapshot) => {
          const matchList =
            snapshot.docs.map(
              (docItem) => ({
                id: docItem.id,
                ...docItem.data(),
              })
            );

          setMatches(matchList);
        },
        (error) => {
          console.error(
            "Matches realtime error:",
            error
          );
        }
      );

    return () =>
      unsubscribe();
  }, [user]);

  /* =======================================================
     GET LEAGUE TEAMS
  ======================================================= */

  const getLeagueTeams =
    useCallback(
      (league) => {
        if (!league) return [];

        /*
          If Firestore has clubIds,
          preserve that exact order.
        */

        if (
          Array.isArray(
            league.clubIds
          ) &&
          league.clubIds.length > 0
        ) {
          const clubMap =
            new Map(
              clubs.map((club) => [
                String(club.id),
                club,
              ])
            );

          const ordered =
            league.clubIds
              .map((id) =>
                clubMap.get(
                  String(id)
                )
              )
              .filter(Boolean);

          if (
            ordered.length > 0
          ) {
            return ordered;
          }
        }

        return clubs.filter(
          (club) =>
            getClubLeague(
              club,
              league
            )
        );
      },
      [clubs]
    );

  /* =======================================================
     GET LEAGUE STANDINGS
  ======================================================= */

  const getLeagueStandings =
    useCallback(
      (league) => {
        if (!league) {
          return [];
        }

        /*
          CUP
          standings are handled
          per group.
        */

        if (
          isCupCompetition(league)
        ) {
          return [];
        }

        const leagueClubs =
          getLeagueTeams(league);

        if (
          leagueClubs.length === 0
        ) {
          return [];
        }

        const leagueMatches =
          matches.filter(
            (match) =>
              String(
                match?.leagueId ||
                  match?.leagueID ||
                  match?.competitionId ||
                  ""
              ) ===
              String(league.id)
          );

        /*
          Fallback by club IDs
        */

        if (
          leagueMatches.length === 0
        ) {
          const clubIds =
            new Set(
              leagueClubs.map(
                (club) =>
                  String(club.id)
              )
            );

          const clubMatches =
            matches.filter(
              (match) => {
                const homeId =
                  String(
                    match?.homeClubId ||
                      match?.homeTeamId ||
                      ""
                  );

                const awayId =
                  String(
                    match?.awayClubId ||
                      match?.awayTeamId ||
                      ""
                  );

                return (
                  clubIds.has(
                    homeId
                  ) ||
                  clubIds.has(
                    awayId
                  )
                );
              }
            );

          return calculateStandingsFromMatches(
            clubMatches,
            leagueClubs
          );
        }

        return calculateStandingsFromMatches(
          leagueMatches,
          leagueClubs
        );
      },
      [
        matches,
        getLeagueTeams,
      ]
    );

  /* =======================================================
     CUP MATCHES
  ======================================================= */

  const getCupMatches =
    useCallback(
      (league) => {
        if (!league) {
          return [];
        }

        return matches.filter(
          (match) =>
            String(
              match?.leagueId ||
                match?.leagueID ||
                match?.competitionId ||
                ""
            ) ===
            String(league.id) &&
            (
              normalize(
                match?.type
              ) === "cup" ||
              normalize(
                match?.competitionType
              ) === "cup" ||
              match?.stage ===
                "group_stage" ||
              match?.cupGroupId ||
              match?.groupId
            )
        );
      },
      [matches]
    );

  /* =======================================================
     CUP GROUPS
  ======================================================= */

  const getCupGroups =
    useCallback(
      (league) => {
        if (
          !league ||
          !isCupCompetition(league)
        ) {
          return [];
        }

        const leagueClubs =
          getLeagueTeams(league);

        const cupMatches =
          getCupMatches(league);

        return buildCupGroups(
          leagueClubs,
          cupMatches
        );
      },
      [
        getLeagueTeams,
        getCupMatches,
      ]
    );

  /* =======================================================
     ALL LEAGUE STANDINGS
  ======================================================= */

  const allLeagueStandings =
    useMemo(() => {
      const standingsMap = {};

      leagues.forEach(
        (league) => {
          if (
            isCupCompetition(
              league
            )
          ) {
            return;
          }

          standingsMap[
            league.id
          ] =
            getLeagueStandings(
              league
            );
        }
      );

      return standingsMap;
    }, [
      leagues,
      getLeagueStandings,
    ]);

  /* =======================================================
     COUNTRY OPTIONS
  ======================================================= */

  const countryOptions =
    useMemo(() => {
      const names = new Set();

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

      return [...names]
        .filter(Boolean)
        .sort((a, b) =>
          a.localeCompare(b)
        );
    }, [
      leagues,
      countries,
    ]);

  /* =======================================================
     CLUB COUNT
  ======================================================= */

  const getLeagueClubCount =
    useCallback(
      (league) => {
        const linked =
          getLeagueTeams(league);

        if (
          league?.teamCount !==
          undefined
        ) {
          return safeNumber(
            league.teamCount,
            linked.length
          );
        }

        return linked.length;
      },
      [getLeagueTeams]
    );

  /* =======================================================
     FILTERED LEAGUES
  ======================================================= */

  const filteredLeagues =
    useMemo(() => {
      let result = [
        ...leagues,
      ];

      const searchValue =
        normalize(search);

      if (searchValue) {
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
        "all"
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
        "all"
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
          switch (sortBy) {
            case "country":
              return getLeagueCountryName(
                a,
                countries
              ).localeCompare(
                getLeagueCountryName(
                  b,
                  countries
                )
              );

            case "teams":
              return (
                getLeagueClubCount(
                  b
                ) -
                getLeagueClubCount(
                  a
                )
              );

            case "level":
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
      getLeagueClubCount,
    ]);

  /* =======================================================
     SELECTED DATA
  ======================================================= */

  const selectedStandings =
    useMemo(() => {
      if (
        !selectedLeague ||
        isCupCompetition(
          selectedLeague
        )
      ) {
        return [];
      }

      return getLeagueStandings(
        selectedLeague
      );
    }, [
      selectedLeague,
      getLeagueStandings,
    ]);

  const selectedTeams =
    useMemo(
      () =>
        getLeagueTeams(
          selectedLeague
        ),
      [
        selectedLeague,
        getLeagueTeams,
      ]
    );

  const selectedCupMatches =
    useMemo(
      () =>
        getCupMatches(
          selectedLeague
        ),
      [
        selectedLeague,
        getCupMatches,
      ]
    );

  const selectedCupGroups =
    useMemo(
      () =>
        getCupGroups(
          selectedLeague
        ),
      [
        selectedLeague,
        getCupGroups,
      ]
    );

  const selectedCupQualified =
    useMemo(
      () =>
        getCupQualifiedTeams(
          selectedCupGroups
        ),
      [selectedCupGroups]
    );

  /* =======================================================
     LEAGUE STATS
  ======================================================= */

  const leagueStats =
    useMemo(() => {
      if (!selectedLeague) {
        return {
          teams: 0,
          matches: 0,
          goals: 0,
          leader: null,
          groups: 0,
          qualified: 0,
        };
      }

      if (
        isCupCompetition(
          selectedLeague
        )
      ) {
        const goals =
          selectedCupMatches.reduce(
            (total, match) =>
              total +
              getMatchScore(
                match,
                "home"
              ) +
              getMatchScore(
                match,
                "away"
              ),
            0
          );

        const finished =
          selectedCupMatches.filter(
            isFinishedMatch
          ).length;

        return {
          teams:
            selectedTeams.length,

          matches: finished,

          goals,

          leader:
            selectedCupGroups[0]
              ?.standings?.[0] ||
            null,

          groups:
            selectedCupGroups.length,

          qualified:
            selectedCupQualified.length,
        };
      }

      const teams =
        selectedTeams.length ||
        safeNumber(
          selectedLeague.teamCount
        );

      const totalGoals =
        selectedStandings.reduce(
          (total, team) =>
            total +
            team.goalsFor,
          0
        );

      const totalMatches =
        selectedStandings.reduce(
          (total, team) =>
            total +
            team.played,
          0
        ) / 2;

      return {
        teams,
        matches:
          Math.round(
            totalMatches
          ),
        goals: totalGoals,
        leader:
          selectedStandings[0] ||
          null,
        groups: 0,
        qualified: 0,
      };
    }, [
      selectedLeague,
      selectedTeams,
      selectedStandings,
      selectedCupMatches,
      selectedCupGroups,
      selectedCupQualified,
    ]);

  /* =======================================================
     OPEN / CLOSE
  ======================================================= */

  const openLeague = (
    league
  ) => {
    setSelectedLeague(
      league
    );

    setSelectedTab(
      "overview"
    );

    setActiveView(
      "details"
    );
  };

  const closeLeague = () => {
    setSelectedLeague(
      null
    );

    setActiveView(
      "leagues"
    );
  };

  /* =======================================================
     PROCESS SEASON END
  ======================================================= */

  const processSeasonEnd =
    useCallback(
      async () => {
        if (
          !user ||
          isProcessingSeason
        ) {
          return;
        }

        try {
          setIsProcessingSeason(
            true
          );

          const result =
            processSeasonCompletion(
              leagues,
              clubs,
              allLeagueStandings
            );

          const allUpdates =
            [];

          /*
            Prize money
          */

          result.updates.forEach(
            (update) => {
              allUpdates.push({
                type: "prize",
                clubId:
                  update.clubId,

                data: {
                  prizeMoney:
                    update.prizeMoney,

                  lastSeasonPosition:
                    update.position,

                  lastSeasonPrizeMoney:
                    update.prizeMoney,

                  updatedAt:
                    serverTimestamp(),
                },
              });
            }
          );

          /*
            Promotion
          */

          Object.values(
            result.promotionMap
          ).forEach(
            (info) => {
              if (
                info.clubs?.length
              ) {
                info.clubs.forEach(
                  (clubId) => {
                    allUpdates.push({
                      type:
                        "promotion",

                      clubId,

                      data: {
                        promotedFrom:
                          info.fromLeagueId,

                        updatedAt:
                          serverTimestamp(),
                      },
                    });
                  }
                );
              }
            }
          );

          /*
            Relegation
          */

          Object.values(
            result.relegationMap
          ).forEach(
            (info) => {
              if (
                info.clubs?.length
              ) {
                info.clubs.forEach(
                  (clubId) => {
                    allUpdates.push({
                      type:
                        "relegation",

                      clubId,

                      data: {
                        relegatedFrom:
                          info.fromLeagueId,

                        updatedAt:
                          serverTimestamp(),
                      },
                    });
                  }
                );
              }
            }
          );

          /*
            CAF Champions
          */

          result.cafChampions.forEach(
            (clubId) => {
              allUpdates.push({
                type: "caf",
                clubId,

                data: {
                  cafCompetition:
                    "champions-league",

                  updatedAt:
                    serverTimestamp(),
                },
              });
            }
          );

          /*
            CAF Confederation
          */

          result.cafConfederation.forEach(
            (clubId) => {
              allUpdates.push({
                type: "caf",
                clubId,

                data: {
                  cafCompetition:
                    "confederation-cup",

                  updatedAt:
                    serverTimestamp(),
                },
              });
            }
          );

          /*
            Write in Firestore batches
          */

          for (
            let i = 0;
            i <
            allUpdates.length;
            i +=
              FIRESTORE_BATCH_SIZE
          ) {
            const batch =
              writeBatch(db);

            const chunk =
              allUpdates.slice(
                i,
                i +
                  FIRESTORE_BATCH_SIZE
              );

            chunk.forEach(
              (update) => {
                const clubRef =
                  doc(
                    db,
                    "clubs",
                    update.clubId
                  );

                batch.update(
                  clubRef,
                  update.data
                );
              }
            );

            await batch.commit();
          }

          toast.success(
            `Season completed: ${result.updates.length} prize payments, ${result.cafChampions.length} CAF CL, ${result.cafConfederation.length} CAF Confed, promotions and relegations processed`
          );
        } catch (error) {
          console.error(
            "Season processing error:",
            error
          );

          toast.error(
            "Could not process season end"
          );
        } finally {
          setIsProcessingSeason(
            false
          );
        }
      },
      [
        user,
        isProcessingSeason,
        leagues,
        clubs,
        allLeagueStandings,
      ]
    );

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
      "details" &&
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

    const cup =
      isCupCompetition(
        selectedLeague
      );

    const championPrize =
      getPrizeMoneyForPosition(
        selectedLeague,
        1
      );

    return (
      <>
        <Head>
          <title>
            {leagueName} |
            League Center
          </title>

          <meta
            name="description"
            content={`${leagueName} standings, clubs and competition information.`}
          />
        </Head>

        <main
          className={
            styles.page
          }
        >
          {/* BACK */}

          <button
            type="button"
            className={
              styles.backButton
            }
            onClick={
              closeLeague
            }
          >
            ← Back to
            Leagues
          </button>

          {/* =================================================
              HERO
          ================================================= */}

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
                  src={getLeagueLogo(
                    selectedLeague
                  )}
                  alt={
                    leagueName
                  }
                />
              ) : (
                "🏆"
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
                {cup
                  ? "CUP COMPETITION"
                  : "GLOBAL FOOTBALL"}
              </span>

              <h1>
                {leagueName}
              </h1>

              <p>
                {getLeagueDescription(
                  selectedLeague
                ) ||
                  `Official competition center for ${leagueName}.`}
              </p>

              <div
                className={
                  styles.heroMeta
                }
              >
                <span>
                  🌍{" "}
                  {countryName}
                </span>

                <span>
                  📅{" "}
                  {getLeagueSeason(
                    selectedLeague
                  )}
                </span>

                <span>
                  🏆{" "}
                  {cup
                    ? "Cup"
                    : `Level ${getLeagueLevel(
                        selectedLeague
                      )}`}
                </span>

                {cup && (
                  <span>
                    👥{" "}
                    {
                      leagueStats.groups
                    }{" "}
                    Groups
                  </span>
                )}

                <span
                  className={
                    styles.activeBadge
                  }
                >
                  ●{" "}
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
                {cup
                  ? "GROUP LEADER"
                  : "CURRENT LEADER"}
              </small>

              {leagueStats.leader ? (
                <>
                  <strong>
                    {
                      leagueStats
                        .leader
                        .clubName
                    }
                  </strong>

                  <span>
                    {
                      leagueStats
                        .leader
                        .points
                    }{" "}
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

          {/* =================================================
              STATS
          ================================================= */}

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
                  {
                    leagueStats.teams
                  }
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
                  {cup
                    ? "MATCHES PLAYED"
                    : "MATCHES"}
                </small>

                <strong>
                  {
                    leagueStats.matches
                  }
                </strong>

                <p>
                  Matches recorded
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
                  {
                    leagueStats.goals
                  }
                </strong>

                <p>
                  Total goals
                </p>
              </div>
            </div>

            {cup ? (
              <div
                className={
                  styles.statCard
                }
              >
                <span>
                  🎟️
                </span>

                <div>
                  <small>
                    QUALIFIED
                  </small>

                  <strong>
                    {
                      leagueStats
                        .qualified
                    }
                  </strong>

                  <p>
                    Top 2 from
                    each group
                  </p>
                </div>
              </div>
            ) : (
              <div
                className={
                  styles.statCard
                }
              >
                <span>
                  💰
                </span>

                <div>
                  <small>
                    WINNER PRIZE
                  </small>

                  <strong>
                    {formatMoney(
                      championPrize
                    )}
                  </strong>

                  <p>
                    From database
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* =================================================
              TABS
          ================================================= */}

          <nav
            className={
              styles.detailTabs
            }
          >
            <button
              type="button"
              className={
                selectedTab ===
                "overview"
                  ? styles.activeTab
                  : ""
              }
              onClick={() =>
                setSelectedTab(
                  "overview"
                )
              }
            >
              🏆 Overview
            </button>

            <button
              type="button"
              className={
                selectedTab ===
                "standings"
                  ? styles.activeTab
                  : ""
              }
              onClick={() =>
                setSelectedTab(
                  "standings"
                )
              }
            >
              📊{" "}
              {cup
                ? "Groups & Standings"
                : "Standings"}
            </button>

            <button
              type="button"
              className={
                selectedTab ===
                "teams"
                  ? styles.activeTab
                  : ""
              }
              onClick={() =>
                setSelectedTab(
                  "teams"
                )
              }
            >
              👥 Teams
            </button>
          </nav>

          {/* =================================================
              SEASON COMPLETION
          ================================================= */}

          {!cup && (
            <section
              className={
                styles.seasonAction
              }
            >
              <button
                type="button"
                className={
                  styles.seasonButton
                }
                onClick={
                  processSeasonEnd
                }
                disabled={
                  isProcessingSeason
                }
              >
                {isProcessingSeason
                  ? "Processing..."
                  : "🏆 Complete Season - Process Prizes & Promotions"}
              </button>
            </section>
          )}

          {/* =================================================
              OVERVIEW
          ================================================= */}

          {selectedTab ===
            "overview" && (
            <section
              className={
                styles.overviewGrid
              }
            >
              {/* INFORMATION */}

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
                  COMPETITION
                  INFORMATION
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
                      {
                        countryName
                      }
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
                      {cup
                        ? "Groups"
                        : "Division"}
                    </span>

                    <strong>
                      {cup
                        ? leagueStats.groups
                        : `Level ${getLeagueLevel(
                            selectedLeague
                          )}`}
                    </strong>
                  </div>

                  {cup && (
                    <div>
                      <span>
                        Qualification
                      </span>

                      <strong>
                        Top 2
                        per group
                      </strong>
                    </div>
                  )}
                </div>
              </div>

              {/* TOP CLUB */}

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
                  {cup
                    ? "GROUP LEADERS"
                    : "TOP CLUB"}
                </span>

                {cup ? (
                  selectedCupGroups
                    .length >
                  0 ? (
                    <div
                      className={
                        styles.prizeList
                      }
                    >
                      {selectedCupGroups
                        .slice(
                          0,
                          5
                        )
                        .map(
                          (
                            group
                          ) => (
                            <div
                              key={
                                group.id
                              }
                              className={
                                styles.prizeRow
                              }
                            >
                              <span>
                                {group.name}
                              </span>

                              <strong>
                                {group
                                  .standings?.[0]
                                  ?.clubName ||
                                  "No leader"}
                              </strong>
                            </div>
                          )
                        )}
                    </div>
                  ) : (
                    <p
                      className={
                        styles.emptyText
                      }
                    >
                      No cup groups
                      found.
                    </p>
                  )
                ) : selectedStandings[0] ? (
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
                      {selectedStandings[0]
                        .logo ? (
                        <img
                          src={
                            selectedStandings[0]
                              .logo
                          }
                          alt=""
                        />
                      ) : (
                        "⚽"
                      )}
                    </div>

                    <div>
                      <strong>
                        {
                          selectedStandings[0]
                            .clubName
                        }
                      </strong>

                      <span>
                        {
                          selectedStandings[0]
                            .points
                        }{" "}
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
                    No standings
                    data available.
                  </p>
                )}
              </div>

              {/* PRIZE MONEY */}

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
                  PRIZE MONEY
                  DISTRIBUTION
                </span>

                <div
                  className={
                    styles.prizeList
                  }
                >
                  {(cup
                    ? Array.from(
                        {
                          length:
                            Math.min(
                              5,
                              selectedTeams.length
                            ),
                        },
                        (_, i) =>
                          i + 1
                      )
                    : selectedStandings
                        .slice(
                          0,
                          5
                        )
                        .map(
                          (_, i) =>
                            i + 1
                        )
                  ).map(
                    (position) => {
                      const prize =
                        getPrizeMoneyForPosition(
                          selectedLeague,
                          position
                        );

                      const team =
                        cup
                          ? selectedCupQualified[
                              position -
                                1
                            ]
                          : selectedStandings[
                              position -
                                1
                            ];

                      return (
                        <div
                          key={
                            position
                          }
                          className={
                            styles.prizeRow
                          }
                        >
                          <span>
                            {position}.
                            {" "}
                            {team
                              ?.clubName ||
                              `Position ${position}`}
                          </span>

                          <strong>
                            {formatMoney(
                              prize
                            )}
                          </strong>
                        </div>
                      );
                    }
                  )}

                  {getPrizeConfig(
                    selectedLeague
                  ) === null && (
                    <p
                      className={
                        styles.emptyText
                      }
                    >
                      No prize money
                      configured in
                      the database.
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* =================================================
              CUP GROUP STANDINGS
          ================================================= */}

          {selectedTab ===
            "standings" &&
            cup && (
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
                      {leagueName}
                    </span>

                    <h2>
                      Cup Group
                      Stage
                    </h2>

                    <p>
                      Each group has
                      four teams.
                      The top two
                      qualify for
                      the knockout
                      stage.
                    </p>
                  </div>

                  <strong>
                    {
                      selectedCupGroups.length
                    }{" "}
                    Groups
                  </strong>
                </div>

                {selectedCupGroups.length >
                0 ? (
                  <div
                    className={
                      styles.overviewGrid
                    }
                  >
                    {selectedCupGroups.map(
                      (group) => (
                        <div
                          key={
                            group.id
                          }
                          className={
                            styles.overviewCard
                          }
                        >
                          <span
                            className={
                              styles.cardLabel
                            }
                          >
                            {group.name}
                          </span>

                          <h2>
                            {
                              group.name
                            }
                          </h2>

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
                                </tr>
                              </thead>

                              <tbody>
                                {group.standings.length >
                                0 ? (
                                  group.standings.map(
                                    (
                                      team,
                                      index
                                    ) => {
                                      const qualified =
                                        index <
                                        2;

                                      return (
                                        <tr
                                          key={
                                            team.clubId
                                          }
                                          className={
                                            index ===
                                            0
                                              ? styles.championRow
                                              : index ===
                                                1
                                                ? styles.runnerUpRow
                                                : ""
                                          }
                                        >
                                          <td>
                                            <span
                                              className={
                                                index <
                                                2
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
                                                  "⚽"
                                                )}
                                              </div>

                                              <div>
                                                <strong>
                                                  {
                                                    team.clubName
                                                  }
                                                </strong>

                                                {qualified && (
                                                  <small>
                                                    ✓
                                                    Qualified
                                                  </small>
                                                )}
                                              </div>
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
                                                    : ""
                                              }
                                            >
                                              {team.goalDifference >
                                              0
                                                ? "+"
                                                : ""}
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
                                        </tr>
                                      );
                                    }
                                  )
                                ) : (
                                  <tr>
                                    <td
                                      colSpan="10"
                                      className={
                                        styles.noData
                                      }
                                    >
                                      No matches
                                      have been
                                      played in
                                      this group
                                      yet.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>

                          <div
                            className={
                              styles.leaderPreview
                            }
                          >
                            <div>
                              <small>
                                KNOCKOUT
                                QUALIFICATION
                              </small>

                              <strong>
                                Top 2
                                teams
                              </strong>
                            </div>

                            <span>
                              {
                                group.standings.filter(
                                  (
                                    _,
                                    index
                                  ) =>
                                    index <
                                    2
                                ).length
                              }{" "}
                              qualified
                            </span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <div
                    className={
                      styles.emptyState
                    }
                  >
                    <span>
                      🏆
                    </span>

                    <h3>
                      No cup groups
                      found
                    </h3>

                    <p>
                      Generate the
                      cup group-stage
                      fixtures first.
                    </p>
                  </div>
                )}

                {/* QUALIFIED TEAMS */}

                {selectedCupQualified.length >
                  0 && (
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
                      KNOCKOUT
                      QUALIFIERS
                    </span>

                    <h2>
                      Teams through
                      to Knockout
                    </h2>

                    <div
                      className={
                        styles.prizeList
                      }
                    >
                      {selectedCupQualified.map(
                        (
                          team
                        ) => (
                          <div
                            key={`${team.groupName}-${team.clubId}`}
                            className={
                              styles.prizeRow
                            }
                          >
                            <span>
                              {
                                team.groupName
                              }{" "}
                              •{" "}
                              {team.groupPosition ===
                              1
                                ? "1st"
                                : "2nd"}{" "}
                              •{" "}
                              {
                                team.clubName
                              }
                            </span>

                            <strong>
                              ✓ Qualified
                            </strong>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

          {/* =================================================
              NORMAL LEAGUE STANDINGS
          ================================================= */}

          {selectedTab ===
            "standings" &&
            !cup && (
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
                      League
                      Standings
                    </h2>
                  </div>

                  <strong>
                    {
                      selectedStandings.length
                    }{" "}
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
                          Prize
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
                          ) => {
                            const prize =
                              getPrizeMoneyForPosition(
                                selectedLeague,
                                index +
                                  1
                              );

                            const isChampion =
                              index ===
                              0;

                            const isRunnerUp =
                              index ===
                              1;

                            return (
                              <tr
                                key={
                                  team.clubId ||
                                  team.clubName ||
                                  index
                                }
                                className={
                                  isChampion
                                    ? styles.championRow
                                    : isRunnerUp
                                      ? styles.runnerUpRow
                                      : ""
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
                                        "⚽"
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
                                          : ""
                                    }
                                  >
                                    {team.goalDifference >
                                    0
                                      ? "+"
                                      : ""}
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
                                  <span
                                    className={
                                      styles.prizeAmount
                                    }
                                  >
                                    {formatMoney(
                                      prize
                                    )}
                                  </span>
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
                                              ""
                                          ).split(
                                            ""
                                          )
                                    )
                                      .slice(
                                        -5
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
                                                  "w" ||
                                                r ===
                                                  "win"
                                                  ? styles.formWin
                                                  : r ===
                                                      "d" ||
                                                    r ===
                                                      "draw"
                                                    ? styles.formDraw
                                                    : styles.formLoss
                                              }
                                            >
                                              {r ===
                                                "w" ||
                                              r ===
                                                "win"
                                                ? "W"
                                                : r ===
                                                    "d" ||
                                                  r ===
                                                    "draw"
                                                  ? "D"
                                                  : "L"}
                                            </span>
                                          );
                                        }
                                      )}
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                        )
                      ) : (
                        <tr>
                          <td
                            colSpan="12"
                            className={
                              styles.noData
                            }
                          >
                            No standings
                            available
                            for this
                            league.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

          {/* =================================================
              TEAMS
          ================================================= */}

          {selectedTab ===
            "teams" && (
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
                    {cup
                      ? "Cup Teams"
                      : "League Clubs"}
                  </h2>

                  <p>
                    {cup
                      ? "Every club registered in this cup competition."
                      : "Every club currently registered in this competition."}
                  </p>
                </div>

                <strong>
                  {
                    selectedTeams.length
                  }
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
                              alt={getClubName(
                                club
                              )}
                            />
                          ) : (
                            "⚽"
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
                              countryName}
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
                              "-"}
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
                      No clubs
                      found
                    </h3>

                    <p>
                      This
                      competition
                      has no
                      clubs
                      connected
                      to it yet.
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
          Leagues | Virtual
          Football Manager
        </title>

        <meta
          name="description"
          content="Explore football leagues, cups, standings, countries and clubs."
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        {/* =================================================
            HEADER
        ================================================= */}

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
              Explore leagues,
              cups, standings
              and clubs from
              around the
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
                {
                  leagues.length
                }
              </strong>

              <span>
                Competitions
              </span>
            </div>

            <div>
              <strong>
                {
                  countries.length
                }
              </strong>

              <span>
                Countries
              </span>
            </div>

            <div>
              <strong>
                {
                  clubs.length
                }
              </strong>

              <span>
                Clubs
              </span>
            </div>
          </div>
        </header>

        {/* =================================================
            GLOBAL STATS
        ================================================= */}

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
                COMPETITIONS
              </small>

              <strong>
                {
                  leagues.length
                }
              </strong>

              <p>
                Leagues & cups
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
                {
                  countryOptions.length
                }
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
                {
                  clubs.length
                }
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
                MATCHES
              </small>

              <strong>
                {
                  matches.length
                }
              </strong>

              <p>
                Matches recorded
              </p>
            </div>
          </div>
        </section>

        {/* =================================================
            FILTERS
        ================================================= */}

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
                  key={
                    country
                  }
                  value={
                    country
                  }
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
              All Competition
              Types
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

        {/* =================================================
            RESULTS HEADER
        ================================================= */}

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
              Football
              Leagues
            </h2>
          </div>

          <strong>
            {
              filteredLeagues.length
            }{" "}
            competitions
          </strong>
        </div>

        {/* =================================================
            LEAGUE GRID
        ================================================= */}

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

                const cup =
                  isCupCompetition(
                    league
                  );

                const leagueRows =
                  cup
                    ? []
                    : getLeagueStandings(
                        league
                      );

                const leader =
                  leagueRows[0];

                const winnerPrize =
                  getPrizeMoneyForPosition(
                    league,
                    1
                  );

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
                    {/* TOP */}

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
                          "🏆"
                        )}
                      </div>

                      <span
                        className={
                          styles.countryBadge
                        }
                      >
                        🌍{" "}
                        {
                          country
                        }
                      </span>
                    </div>

                    {/* CONTENT */}

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
                        {
                          getLeagueType(
                            league
                          )
                        }
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

                    {/* STATS */}

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
                          {
                            teamCount
                          }
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
                          {cup
                            ? "TYPE"
                            : "LEVEL"}
                        </span>

                        <strong>
                          {cup
                            ? "CUP"
                            : getLeagueLevel(
                                league
                              )}
                        </strong>
                      </div>
                    </div>

                    {/* LEADER */}

                    {leader && (
                      <div
                        className={
                          styles.leaderPreview
                        }
                      >
                        <div>
                          <small>
                            CURRENT
                            LEADER
                          </small>

                          <strong>
                            {
                              leader.clubName
                            }
                          </strong>
                        </div>

                        <span>
                          {
                            leader.points
                          }{" "}
                          pts
                        </span>
                      </div>
                    )}

                    {/* CUP INFO */}

                    {cup && (
                      <div
                        className={
                          styles.leaderPreview
                        }
                      >
                        <div>
                          <small>
                            CUP FORMAT
                          </small>

                          <strong>
                            Group
                            Stage →
                            Knockout
                          </strong>
                        </div>

                        <span>
                          Top 2
                        </span>
                      </div>
                    )}

                    {/* FOOTER */}

                    <div
                      className={
                        styles.cardFooter
                      }
                    >
                      <span>
                        View
                        competition
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
                No leagues
                found
              </h3>

              <p>
                Try changing
                your search or
                filters.
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
