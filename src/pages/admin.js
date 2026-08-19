// pages/admin.js

import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";

import { db } from "../components/firebase";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

import styles from "./admin.module.css";

const EMPTY_COUNTRY = {
  name: "",
  code: "",
  flag: "",
};

const EMPTY_LEAGUE = {
  name: "",
  countryId: "",
  countryName: "",
  logo: "",
  level: 1,
  season: "",
};

const EMPTY_CLUB = {
  name: "",
  shortName: "",
  countryId: "",
  countryName: "",
  leagueId: "",
  leagueName: "",
  logo: "",
  stadium: "",
  location: "",
  founded: "",
  capacity: "",
  owner: "",
  coach: "",
  currency: "EUR",
  balance: 0,
  homeKit: "",
  awayKit: "",
  thirdKit: "",
  colors: "",
  description: "",
};

const EMPTY_PLAYER = {
  name: "",
  firstName: "",
  lastName: "",
  clubId: "",
  clubName: "",
  countryId: "",
  countryName: "",
  position: "MID",
  shirtNumber: "",
  age: "",
  nationality: "",
  overall: 60,
  value: 0,
  wage: 0,
  contractYears: 3,
  photo: "",
};

/* =========================================================
   PLAYER GENERATION
========================================================= */

const FIRST_NAMES = [
  "Alex", "Sam", "Jordan", "Chris", "Ryan", "Kevin", "David", "Mike",
  "Daniel", "James", "John", "Paul", "Mark", "Luke", "Ethan", "Noah",
  "Liam", "Mason", "Lucas", "Oliver", "Aiden", "Caleb", "Elijah", "Isaiah",
  "Emmanuel", "Jean", "Pierre", "Eric", "Patrick", "Olivier", "Claude",
  "Didier", "Samuel", "Yves", "Alain", "Cedric", "Fabrice", "Herve",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
  "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White",
  "Nguyen", "Kim", "Park", "Mukiza", "Ndayishimiye", "Uwimana",
  "Habimana", "Bizimana", "Niyonzima", "Mugisha", "Nsengiyumva",
  "Kwizera", "Ishimwe", "Uwase", "Mutoni", "Ingabire", "Umwali",
];

const NATIONALITIES = [
  "Rwanda", "Burundi", "DR Congo", "Uganda", "Tanzania", "Kenya",
  "Nigeria", "Ghana", "Ivory Coast", "Senegal", "Cameroon", "Mali",
  "France", "Belgium", "England", "Spain", "Portugal", "Brazil",
  "Argentina", "Colombia", "Morocco", "Egypt", "Tunisia", "Algeria",
];

const POSITIONS = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"];

function generatePlayersForClub(club, count, existingCount = 0) {
  const players = [];

  for (let i = 0; i < count; i++) {
    const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const position = POSITIONS[Math.floor(Math.random() * POSITIONS.length)];
    const age = 17 + Math.floor(Math.random() * 18); // 17-34
    const overall = 45 + Math.floor(Math.random() * 40); // 45-84
    const shirtNumber = (existingCount + i) % 99 + 1;

    const player = {
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      clubId: club.id,
      clubName: club.name || club.clubName,
      countryId: club.countryId || "",
      countryName: club.countryName || "",
      position,
      shirtNumber,
      age,
      nationality: NATIONALITIES[Math.floor(Math.random() * NATIONALITIES.length)],
      overall,
      value: overall * 50000,
      wage: 500 + Math.floor(Math.random() * 5000),
      contractYears: 1 + Math.floor(Math.random() * 5),
      photo: "",
      status: "active",
      goals: 0,
      assists: 0,
      appearances: 0,
      yellowCards: 0,
      redCards: 0,
      isGenerated: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    players.push(player);
  }

  return players;
}

export default function Admin() {
  const router = useRouter();
  const { user, userData, loading } = useAuth();

  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

  const [activeTab, setActiveTab] = useState("overview");

  const [countries, setCountries] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [players, setPlayers] = useState([]);

  const [countryForm, setCountryForm] = useState(EMPTY_COUNTRY);
  const [leagueForm, setLeagueForm] = useState(EMPTY_LEAGUE);
  const [clubForm, setClubForm] = useState(EMPTY_CLUB);
  const [playerForm, setPlayerForm] = useState(EMPTY_PLAYER);

  const [editingCountry, setEditingCountry] = useState(null);
  const [editingLeague, setEditingLeague] = useState(null);
  const [editingClub, setEditingClub] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);

  const [isFetchingRplPlayers, setIsFetchingRplPlayers] = useState(false);
  const [rplFetchProgress, setRplFetchProgress] = useState({
    current: 0,
    total: 0,
  });

  const [showGeneratePlayers, setShowGeneratePlayers] = useState(false);
  const [generatePlayerForm, setGeneratePlayerForm] = useState({
    clubId: "",
    count: 20,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);

  /* =========================================================
     NAME NORMALIZATION
  ========================================================= */

  const normalizePlayerName = (value = "") => {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  };

  const normalizeClubName = (value = "") => {
    return String(value)
      .toLowerCase()
      .replace(/\bfootball club\b/g, "")
      .replace(/\bfc\b/g, "")
      .replace(/\bsc\b/g, "")
      .replace(/\bsports\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  const findMatchingClub = (rplClubName) => {
    const normalizedRplClub = normalizeClubName(rplClubName);

    return (
      clubs.find((club) => {
        const normalizedClub = normalizeClubName(club.name);

        return (
          normalizedClub === normalizedRplClub ||
          normalizedClub.includes(normalizedRplClub) ||
          normalizedRplClub.includes(normalizedClub)
        );
      }) || null
    );
  };

  const findCountryByName = (name) => {
    const normalized = String(name || "").toLowerCase().trim();

    return (
      countries.find(
        (country) =>
          String(country.name || "").toLowerCase().trim() === normalized
      ) || null
    );
  };

  const convertRplPosition = (position) => {
    const value = String(position || "").toLowerCase().trim();

    if (value.includes("goalkeeper") || value === "gk" || value.includes("keeper")) {
      return "GK";
    }

    if (value.includes("defender") || value.includes("defence") || value.includes("defense")) {
      return "DEF";
    }

    if (value.includes("midfielder") || value.includes("midfield")) {
      return "MID";
    }

    if (value.includes("forward") || value.includes("striker") || value.includes("attacker")) {
      return "FWD";
    }

    return "MID";
  };

  const splitPlayerName = (fullName = "") => {
    const parts = String(fullName).trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      return { firstName: "", lastName: "" };
    }

    if (parts.length === 1) {
      return { firstName: parts[0], lastName: "" };
    }

    return {
      firstName: parts.slice(0, -1).join(" "),
      lastName: parts[parts.length - 1],
    };
  };

  /* =========================================================
     USER NAME
  ========================================================= */

  const displayName = useMemo(() => {
    return userData?.displayName || user?.email?.split("@")[0] || "Manager";
  }, [userData, user]);

  /* =========================================================
     ADMIN CHECK
  ========================================================= */

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    const normalizedName = displayName.trim().toLowerCase();
    const admin =
      normalizedName === "navio" ||
      userData?.role === "admin" ||
      userData?.isAdmin === true;

    setIsAdmin(admin);
    setCheckingAdmin(false);

    if (!admin) {
      toast.error("You are not authorized to access this page.");
      router.replace("/dashboard");
    }
  }, [user, userData, loading, displayName, router]);

  /* =========================================================
     LOAD FIRESTORE DATA
  ========================================================= */

  useEffect(() => {
    if (!isAdmin) return;
    loadAllData();
  }, [isAdmin]);

  const loadAllData = async () => {
    try {
      setIsLoadingData(true);

      const [countriesSnapshot, leaguesSnapshot, clubsSnapshot, playersSnapshot] =
        await Promise.all([
          getDocs(collection(db, "countries")),
          getDocs(collection(db, "leagues")),
          getDocs(collection(db, "clubs")),
          getDocs(collection(db, "players")),
        ]);

      setCountries(
        countriesSnapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );

      setLeagues(
        leaguesSnapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );

      setClubs(
        clubsSnapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );

      setPlayers(
        playersSnapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );
    } catch (error) {
      console.error("Admin data loading error:", error);
      toast.error("Failed to load admin data.");
    } finally {
      setIsLoadingData(false);
    }
  };

  /* =========================================================
     RPL IMPORT
  ========================================================= */

  const fetchAndImportRplPlayers = async () => {
    if (isFetchingRplPlayers) return;

    try {
      setIsFetchingRplPlayers(true);
      setRplFetchProgress({ current: 0, total: 0 });

      toast.loading("Fetching Rwanda Premier League players...", {
        id: "rpl-import",
      });

      const response = await fetch("/api/rpl-players");

      if (!response.ok) {
        throw new Error(`RPL API returned ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch RPL players.");
      }

      const fetchedPlayers = Array.isArray(result.players) ? result.players : [];

      if (fetchedPlayers.length === 0) {
        throw new Error("No players were returned by Rwanda Premier League.");
      }

      setRplFetchProgress({ current: 0, total: fetchedPlayers.length });

      const existingSnapshot = await getDocs(collection(db, "players"));
      const existingPlayers = existingSnapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));

      const existingKeys = new Set(
        existingPlayers.map((player) => {
          return `${normalizePlayerName(player.name)}::${normalizeClubName(player.clubName)}`;
        })
      );

      const playersToCreate = [];
      let skippedDuplicates = 0;
      let skippedUnknownClubs = 0;

      for (let index = 0; index < fetchedPlayers.length; index++) {
        const rplPlayer = fetchedPlayers[index];
        const name = String(rplPlayer.name || "").trim();
        const rplClubName = String(rplPlayer.clubName || rplPlayer.club || "").trim();

        if (!name || !rplClubName) continue;

        const club = findMatchingClub(rplClubName);

        if (!club) {
          skippedUnknownClubs++;
          continue;
        }

        const playerKey = `${normalizePlayerName(name)}::${normalizeClubName(club.name)}`;

        if (existingKeys.has(playerKey)) {
          skippedDuplicates++;
          continue;
        }

        existingKeys.add(playerKey);

        const countryName = rplPlayer.nationality || rplPlayer.countryName || "";
        const country = findCountryByName(countryName);
        const position = convertRplPosition(rplPlayer.position);
        const { firstName, lastName } = splitPlayerName(name);

        const payload = {
          name,
          firstName: rplPlayer.firstName || firstName,
          lastName: rplPlayer.lastName || lastName,
          clubId: club.id,
          clubName: club.name,
          countryId: country?.id || "",
          countryName: country?.name || countryName,
          position,
          shirtNumber: Number(rplPlayer.shirtNumber) || 0,
          age: Number(rplPlayer.age) || 18,
          nationality: rplPlayer.nationality || countryName,
          overall: Number(rplPlayer.overall) || 60,
          value: Number(rplPlayer.value) || 0,
          wage: Number(rplPlayer.wage) || 0,
          contractYears: Number(rplPlayer.contractYears) || 3,
          photo: rplPlayer.photo || "",
          status: "active",
          goals: Number(rplPlayer.goals) || 0,
          assists: Number(rplPlayer.assists) || 0,
          appearances: Number(rplPlayer.appearances) || 0,
          yellowCards: Number(rplPlayer.yellowCards) || 0,
          redCards: Number(rplPlayer.redCards) || 0,
          source: "rwanda-premier-league",
          sourceClubName: rplClubName,
          importedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        };

        playersToCreate.push(payload);
        setRplFetchProgress({ current: index + 1, total: fetchedPlayers.length });
      }

      let created = 0;

      for (const player of playersToCreate) {
        await addDoc(collection(db, "players"), player);
        created++;
      }

      toast.success(
        `RPL import complete. ${created} players added, ${skippedDuplicates} duplicates skipped.${
          skippedUnknownClubs
            ? ` ${skippedUnknownClubs} players skipped because their club was not found.`
            : ""
        }`,
        { id: "rpl-import", duration: 6000 }
      );

      await loadAllData();
    } catch (error) {
      console.error("RPL player import error:", error);
      toast.error(error?.message || "Failed to import RPL players.", {
        id: "rpl-import",
        duration: 6000,
      });
    } finally {
      setIsFetchingRplPlayers(false);
    }
  };

  /* =========================================================
     GENERATE PLAYERS
  ========================================================= */

  const generatePlayers = async (e) => {
    e.preventDefault();

    if (!generatePlayerForm.clubId) {
      toast.error("Select a club.");
      return;
    }

    const count = Number(generatePlayerForm.count) || 20;

    if (count <= 0 || count > 100) {
      toast.error("Player count must be between 1 and 100.");
      return;
    }

    const club = clubs.find((item) => item.id === generatePlayerForm.clubId);

    if (!club) {
      toast.error("Club not found.");
      return;
    }

    try {
      setIsSubmitting(true);

      const playersToGenerate = generatePlayersForClub(club, count);

      for (const player of playersToGenerate) {
        await addDoc(collection(db, "players"), player);
      }

      toast.success(`${count} players generated for ${club.name}.`);
      setShowGeneratePlayers(false);
      setGeneratePlayerForm({ clubId: "", count: 20 });

      await loadAllData();
    } catch (error) {
      console.error("Generate players error:", error);
      toast.error("Failed to generate players.");
    } finally {
      setIsSubmitting(false);
    }
  };

  /* =========================================================
     COUNTRY
  ========================================================= */

  const saveCountry = async (e) => {
    e.preventDefault();

    if (!countryForm.name.trim()) {
      toast.error("Country name is required.");
      return;
    }

    try {
      setIsSubmitting(true);

      const payload = {
        name: countryForm.name.trim(),
        code: countryForm.code.trim().toUpperCase(),
        flag: countryForm.flag.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingCountry) {
        await updateDoc(doc(db, "countries", editingCountry), payload);
        toast.success("Country updated.");
      } else {
        await addDoc(collection(db, "countries"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast.success("Country added.");
      }

      setCountryForm(EMPTY_COUNTRY);
      setEditingCountry(null);
      await loadAllData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to save country.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const editCountry = (country) => {
    setCountryForm({
      name: country.name || "",
      code: country.code || "",
      flag: country.flag || "",
    });
    setEditingCountry(country.id);
    setActiveTab("countries");
  };

  const removeCountry = async (id) => {
    if (!window.confirm("Delete this country?")) return;

    try {
      await deleteDoc(doc(db, "countries", id));
      toast.success("Country deleted.");
      await loadAllData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete country.");
    }
  };

  /* =========================================================
     LEAGUE
  ========================================================= */

  const saveLeague = async (e) => {
    e.preventDefault();

    if (!leagueForm.name.trim()) {
      toast.error("League name is required.");
      return;
    }

    if (!leagueForm.countryId) {
      toast.error("Select a country.");
      return;
    }

    const country = countries.find((item) => item.id === leagueForm.countryId);

    try {
      setIsSubmitting(true);

      const payload = {
        name: leagueForm.name.trim(),
        countryId: leagueForm.countryId,
        countryName: country?.name || leagueForm.countryName || "",
        logo: leagueForm.logo.trim(),
        level: Number(leagueForm.level) || 1,
        season: leagueForm.season.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingLeague) {
        await updateDoc(doc(db, "leagues", editingLeague), payload);
        toast.success("League updated.");
      } else {
        await addDoc(collection(db, "leagues"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast.success("League added.");
      }

      setLeagueForm(EMPTY_LEAGUE);
      setEditingLeague(null);
      await loadAllData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to save league.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const editLeague = (league) => {
    setLeagueForm({
      name: league.name || "",
      countryId: league.countryId || "",
      countryName: league.countryName || "",
      logo: league.logo || "",
      level: league.level || 1,
      season: league.season || "",
    });
    setEditingLeague(league.id);
    setActiveTab("leagues");
  };

  const removeLeague = async (id) => {
    if (!window.confirm("Delete this league?")) return;

    try {
      await deleteDoc(doc(db, "leagues", id));
      toast.success("League deleted.");
      await loadAllData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete league.");
    }
  };

  /* =========================================================
     CLUB
  ========================================================= */

  const saveClub = async (e) => {
    e.preventDefault();

    if (!clubForm.name.trim()) {
      toast.error("Club name is required.");
      return;
    }

    if (!clubForm.countryId) {
      toast.error("Select a country.");
      return;
    }

    if (!clubForm.leagueId) {
      toast.error("Select a league.");
      return;
    }

    const country = countries.find((item) => item.id === clubForm.countryId);
    const league = leagues.find((item) => item.id === clubForm.leagueId);

    try {
      setIsSubmitting(true);

      const payload = {
        name: clubForm.name.trim(),
        shortName: clubForm.shortName.trim(),
        countryId: clubForm.countryId,
        countryName: country?.name || clubForm.countryName || "",
        leagueId: clubForm.leagueId,
        leagueName: league?.name || clubForm.leagueName || "",
        logo: clubForm.logo.trim(),
        stadium: clubForm.stadium.trim(),
        location: clubForm.location.trim(),
        founded: Number(clubForm.founded) || null,
        capacity: Number(clubForm.capacity) || 0,
        owner: clubForm.owner.trim(),
        coach: clubForm.coach.trim(),
        currency: clubForm.currency || "EUR",
        balance: Number(clubForm.balance) || 0,
        homeKit: clubForm.homeKit.trim(),
        awayKit: clubForm.awayKit.trim(),
        thirdKit: clubForm.thirdKit.trim(),
        colors: clubForm.colors.trim(),
        description: clubForm.description.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingClub) {
        await updateDoc(doc(db, "clubs", editingClub), payload);
        toast.success("Club updated.");
      } else {
        await addDoc(collection(db, "clubs"), {
          ...payload,
          reputation: 50,
          totalMatches: 0,
          totalWins: 0,
          totalDraws: 0,
          totalLosses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          createdAt: serverTimestamp(),
        });
        toast.success("Club created.");
      }

      setClubForm(EMPTY_CLUB);
      setEditingClub(null);
      await loadAllData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to save club.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const editClub = (club) => {
    setClubForm({
      name: club.name || "",
      shortName: club.shortName || "",
      countryId: club.countryId || "",
      countryName: club.countryName || "",
      leagueId: club.leagueId || "",
      leagueName: club.leagueName || "",
      logo: club.logo || "",
      stadium: club.stadium || "",
      location: club.location || "",
      founded: club.founded || "",
      capacity: club.capacity || "",
      owner: club.owner || "",
      coach: club.coach || "",
      currency: club.currency || "EUR",
      balance: club.balance || 0,
      homeKit: club.homeKit || "",
      awayKit: club.awayKit || "",
      thirdKit: club.thirdKit || "",
      colors: club.colors || "",
      description: club.description || "",
    });
    setEditingClub(club.id);
    setActiveTab("clubs");
  };

  const removeClub = async (id) => {
    if (!window.confirm("Delete this club? This does not automatically delete its players.")) {
      return;
    }

    try {
      await deleteDoc(doc(db, "clubs", id));
      toast.success("Club deleted.");
      await loadAllData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete club.");
    }
  };

  /* =========================================================
     PLAYER
  ========================================================= */

  const savePlayer = async (e) => {
    e.preventDefault();

    if (!playerForm.name.trim()) {
      toast.error("Player name is required.");
      return;
    }

    if (!playerForm.clubId) {
      toast.error("Select a club.");
      return;
    }

    const club = clubs.find((item) => item.id === playerForm.clubId);
    const country = countries.find((item) => item.id === playerForm.countryId);

    try {
      setIsSubmitting(true);

      const payload = {
        name: playerForm.name.trim(),
        firstName: playerForm.firstName.trim(),
        lastName: playerForm.lastName.trim(),
        clubId: playerForm.clubId,
        clubName: club?.name || playerForm.clubName || "",
        countryId: playerForm.countryId,
        countryName: country?.name || playerForm.countryName || "",
        position: playerForm.position,
        shirtNumber: Number(playerForm.shirtNumber) || 0,
        age: Number(playerForm.age) || 18,
        nationality: playerForm.nationality.trim(),
        overall: Number(playerForm.overall) || 60,
        value: Number(playerForm.value) || 0,
        wage: Number(playerForm.wage) || 0,
        contractYears: Number(playerForm.contractYears) || 1,
        photo: playerForm.photo.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingPlayer) {
        await updateDoc(doc(db, "players", editingPlayer), payload);
        toast.success("Player updated.");
      } else {
        await addDoc(collection(db, "players"), {
          ...payload,
          status: "active",
          goals: 0,
          assists: 0,
          appearances: 0,
          yellowCards: 0,
          redCards: 0,
          createdAt: serverTimestamp(),
        });
        toast.success("Player added to club.");
      }

      setPlayerForm(EMPTY_PLAYER);
      setEditingPlayer(null);
      await loadAllData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to save player.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const editPlayer = (player) => {
    setPlayerForm({
      name: player.name || "",
      firstName: player.firstName || "",
      lastName: player.lastName || "",
      clubId: player.clubId || "",
      clubName: player.clubName || "",
      countryId: player.countryId || "",
      countryName: player.countryName || "",
      position: player.position || "MID",
      shirtNumber: player.shirtNumber || "",
      age: player.age || "",
      nationality: player.nationality || "",
      overall: player.overall || 60,
      value: player.value || 0,
      wage: player.wage || 0,
      contractYears: player.contractYears || 1,
      photo: player.photo || "",
    });
    setEditingPlayer(player.id);
    setActiveTab("players");
  };

  const removePlayer = async (id) => {
    if (!window.confirm("Delete this player?")) return;

    try {
      await deleteDoc(doc(db, "players", id));
      toast.success("Player deleted.");
      await loadAllData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete player.");
    }
  };

  /* =========================================================
     HELPERS
  ========================================================= */

  const cancelEditing = () => {
    setEditingCountry(null);
    setEditingLeague(null);
    setEditingClub(null);
    setEditingPlayer(null);
    setCountryForm(EMPTY_COUNTRY);
    setLeagueForm(EMPTY_LEAGUE);
    setClubForm(EMPTY_CLUB);
    setPlayerForm(EMPTY_PLAYER);
  };

  const formatMoney = (amount, currency = "EUR") => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(Number(amount) || 0);
    } catch {
      return `${currency} ${Number(amount) || 0}`;
    }
  };

  /* =========================================================
     LOADING
  ========================================================= */

  if (loading || checkingAdmin || (user && !isAdmin)) {
    return (
      <div className={styles.loadingPage}>
        <div className={styles.spinner}></div>
        <p>Checking administrator access...</p>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return null;
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <>
      <Head>
        <title>Admin Panel | Virtual Football Manager</title>
        <meta name="description" content="Virtual Football Manager administration panel" />
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <main className={styles.page}>
        {/* HEADER */}
        <header className={styles.header}>
          <div>
            <div className={styles.adminBadge}>⚡ ADMIN CONTROL</div>
            <h1 className={styles.title}>Football Manager Admin</h1>
            <p className={styles.subtitle}>
              Welcome, <strong>{displayName}</strong>. Manage the entire football universe from here.
            </p>
          </div>

          <div className={styles.adminUser}>
            <div className={styles.avatar}>{displayName.charAt(0).toUpperCase()}</div>
            <div>
              <strong>{displayName}</strong>
              <span>Administrator</span>
            </div>
          </div>
        </header>

        {/* NAVIGATION */}
        <nav className={styles.tabs}>
          <button className={activeTab === "overview" ? styles.activeTab : ""} onClick={() => setActiveTab("overview")}>
            📊 Overview
          </button>
          <button className={activeTab === "countries" ? styles.activeTab : ""} onClick={() => setActiveTab("countries")}>
            🌍 Countries
          </button>
          <button className={activeTab === "leagues" ? styles.activeTab : ""} onClick={() => setActiveTab("leagues")}>
            🏆 Leagues
          </button>
          <button className={activeTab === "clubs" ? styles.activeTab : ""} onClick={() => setActiveTab("clubs")}>
            ⚽ Clubs
          </button>
          <button className={activeTab === "players" ? styles.activeTab : ""} onClick={() => setActiveTab("players")}>
            👤 Players
          </button>
        </nav>

        {/* CONTENT */}
        <section className={styles.content}>
          {isLoadingData ? (
            <div className={styles.loadingBox}>
              <div className={styles.spinner}></div>
              <p>Loading football database...</p>
            </div>
          ) : (
            <>
              {/* OVERVIEW */}
              {activeTab === "overview" && (
                <div>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2>Football Database</h2>
                      <p>Overview of your football world.</p>
                    </div>
                    <button className={styles.refreshButton} onClick={loadAllData}>
                      ↻ Refresh
                    </button>
                  </div>

                  <div className={styles.statsGrid}>
                    <div className={styles.statCard}>
                      <span className={styles.statIcon}>🌍</span>
                      <span className={styles.statLabel}>Countries</span>
                      <strong>{countries.length}</strong>
                    </div>
                    <div className={styles.statCard}>
                      <span className={styles.statIcon}>🏆</span>
                      <span className={styles.statLabel}>Leagues</span>
                      <strong>{leagues.length}</strong>
                    </div>
                    <div className={styles.statCard}>
                      <span className={styles.statIcon}>⚽</span>
                      <span className={styles.statLabel}>Clubs</span>
                      <strong>{clubs.length}</strong>
                    </div>
                    <div className={styles.statCard}>
                      <span className={styles.statIcon}>👤</span>
                      <span className={styles.statLabel}>Players</span>
                      <strong>{players.length}</strong>
                    </div>
                  </div>

                  <div className={styles.quickGrid}>
                    <button onClick={() => setActiveTab("countries")} className={styles.quickCard}>
                      <span>🌍</span>
                      <strong>Add Country</strong>
                      <small>Create a football nation</small>
                    </button>
                    <button onClick={() => setActiveTab("leagues")} className={styles.quickCard}>
                      <span>🏆</span>
                      <strong>Add League</strong>
                      <small>Create a competition</small>
                    </button>
                    <button onClick={() => setActiveTab("clubs")} className={styles.quickCard}>
                      <span>⚽</span>
                      <strong>Add Club</strong>
                      <small>Create a football club</small>
                    </button>
                    <button onClick={() => setActiveTab("players")} className={styles.quickCard}>
                      <span>👤</span>
                      <strong>Add Player</strong>
                      <small>Add a player to a club</small>
                    </button>
                  </div>

                  <div className={styles.databaseCard}>
                    <h3>Club Database</h3>
                    {clubs.length === 0 ? (
                      <div className={styles.empty}>No clubs have been created yet.</div>
                    ) : (
                      <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Club</th>
                              <th>League</th>
                              <th>Country</th>
                              <th>Balance</th>
                              <th>Stadium</th>
                            </tr>
                          </thead>
                          <tbody>
                            {clubs.slice(0, 10).map((club) => (
                              <tr key={club.id}>
                                <td>
                                  <div className={styles.clubCell}>
                                    {club.logo ? <img src={club.logo} alt="" /> : <span>⚽</span>}
                                    <strong>{club.name}</strong>
                                  </div>
                                </td>
                                <td>{club.leagueName || "-"}</td>
                                <td>{club.countryName || "-"}</td>
                                <td>{formatMoney(club.balance, club.currency)}</td>
                                <td>{club.stadium || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* COUNTRIES */}
              {activeTab === "countries" && (
                <div>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2>{editingCountry ? "Edit Country" : "Add Country"}</h2>
                      <p>Manage countries available in the game.</p>
                    </div>
                  </div>

                  <form className={styles.formCard} onSubmit={saveCountry}>
                    <div className={styles.formGrid}>
                      <Input
                        label="Country Name"
                        value={countryForm.name}
                        onChange={(e) => setCountryForm({ ...countryForm, name: e.target.value })}
                        placeholder="Rwanda"
                        required
                      />
                      <Input
                        label="Country Code"
                        value={countryForm.code}
                        onChange={(e) => setCountryForm({ ...countryForm, code: e.target.value })}
                        placeholder="RW"
                      />
                      <Input
                        label="Flag URL"
                        value={countryForm.flag}
                        onChange={(e) => setCountryForm({ ...countryForm, flag: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                    <FormButtons editing={editingCountry} loading={isSubmitting} onCancel={cancelEditing} />
                  </form>

                  <DataTable
                    title="Countries"
                    data={countries}
                    empty="No countries yet."
                    columns={[
                      {
                        title: "Country",
                        render: (item) => (
                          <div className={styles.clubCell}>
                            {item.flag ? <img src={item.flag} alt="" /> : <span>🌍</span>}
                            <strong>{item.name}</strong>
                          </div>
                        ),
                      },
                      { title: "Code", render: (item) => item.code || "-" },
                    ]}
                    onEdit={editCountry}
                    onDelete={removeCountry}
                  />
                </div>
              )}

              {/* LEAGUES */}
              {activeTab === "leagues" && (
                <div>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2>{editingLeague ? "Edit League" : "Add League"}</h2>
                      <p>Create and manage football competitions.</p>
                    </div>
                  </div>

                  <form className={styles.formCard} onSubmit={saveLeague}>
                    <div className={styles.formGrid}>
                      <Input
                        label="League Name"
                        value={leagueForm.name}
                        onChange={(e) => setLeagueForm({ ...leagueForm, name: e.target.value })}
                        placeholder="Premier League"
                        required
                      />
                      <Select
                        label="Country"
                        value={leagueForm.countryId}
                        onChange={(e) => setLeagueForm({ ...leagueForm, countryId: e.target.value })}
                        options={countries.map((country) => ({ value: country.id, label: country.name }))}
                        placeholder="Select country"
                      />
                      <Input
                        label="Logo URL"
                        value={leagueForm.logo}
                        onChange={(e) => setLeagueForm({ ...leagueForm, logo: e.target.value })}
                        placeholder="https://..."
                      />
                      <Input
                        label="Season"
                        value={leagueForm.season}
                        onChange={(e) => setLeagueForm({ ...leagueForm, season: e.target.value })}
                        placeholder="2026/27"
                      />
                      <Input
                        label="League Level"
                        type="number"
                        min="1"
                        value={leagueForm.level}
                        onChange={(e) => setLeagueForm({ ...leagueForm, level: e.target.value })}
                      />
                    </div>
                    <FormButtons editing={editingLeague} loading={isSubmitting} onCancel={cancelEditing} />
                  </form>

                  <DataTable
                    title="Leagues"
                    data={leagues}
                    empty="No leagues yet."
                    columns={[
                      {
                        title: "League",
                        render: (item) => (
                          <div className={styles.clubCell}>
                            {item.logo ? <img src={item.logo} alt="" /> : <span>🏆</span>}
                            <strong>{item.name}</strong>
                          </div>
                        ),
                      },
                      { title: "Country", render: (item) => item.countryName || "-" },
                      { title: "Season", render: (item) => item.season || "-" },
                      { title: "Level", render: (item) => item.level || 1 },
                    ]}
                    onEdit={editLeague}
                    onDelete={removeLeague}
                  />
                </div>
              )}

              {/* CLUBS */}
              {activeTab === "clubs" && (
                <div>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2>{editingClub ? "Edit Club" : "Create Football Club"}</h2>
                      <p>Manage clubs, finances, stadiums and kits.</p>
                    </div>
                  </div>

                  <form className={styles.formCard} onSubmit={saveClub}>
                    <h3 className={styles.formSectionTitle}>⚽ Club Identity</h3>
                    <div className={styles.formGrid}>
                      <Input
                        label="Club Name"
                        value={clubForm.name}
                        onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })}
                        placeholder="Manchester United"
                        required
                      />
                      <Input
                        label="Short Name"
                        value={clubForm.shortName}
                        onChange={(e) => setClubForm({ ...clubForm, shortName: e.target.value })}
                        placeholder="MUN"
                      />
                      <Input
                        label="Club Logo URL"
                        value={clubForm.logo}
                        onChange={(e) => setClubForm({ ...clubForm, logo: e.target.value })}
                        placeholder="https://..."
                      />
                      <Select
                        label="Country"
                        value={clubForm.countryId}
                        onChange={(e) => setClubForm({ ...clubForm, countryId: e.target.value })}
                        options={countries.map((country) => ({ value: country.id, label: country.name }))}
                        placeholder="Select country"
                      />
                      <Select
                        label="League"
                        value={clubForm.leagueId}
                        onChange={(e) => setClubForm({ ...clubForm, leagueId: e.target.value })}
                        options={leagues.map((league) => ({ value: league.id, label: league.name }))}
                        placeholder="Select league"
                      />
                    </div>

                    <h3 className={styles.formSectionTitle}>🏟️ Stadium & Location</h3>
                    <div className={styles.formGrid}>
                      <Input
                        label="Stadium"
                        value={clubForm.stadium}
                        onChange={(e) => setClubForm({ ...clubForm, stadium: e.target.value })}
                        placeholder="Old Trafford"
                      />
                      <Input
                        label="Location"
                        value={clubForm.location}
                        onChange={(e) => setClubForm({ ...clubForm, location: e.target.value })}
                        placeholder="Manchester, England"
                      />
                      <Input
                        label="Capacity"
                        type="number"
                        value={clubForm.capacity}
                        onChange={(e) => setClubForm({ ...clubForm, capacity: e.target.value })}
                        placeholder="75000"
                      />
                      <Input
                        label="Founded"
                        type="number"
                        value={clubForm.founded}
                        onChange={(e) => setClubForm({ ...clubForm, founded: e.target.value })}
                        placeholder="1878"
                      />
                    </div>

                    <h3 className={styles.formSectionTitle}>💰 Club Finance</h3>
                    <div className={styles.formGrid}>
                      <Input
                        label="Currency"
                        value={clubForm.currency}
                        onChange={(e) => setClubForm({ ...clubForm, currency: e.target.value.toUpperCase() })}
                        placeholder="EUR"
                      />
                      <Input
                        label="Starting Balance"
                        type="number"
                        min="0"
                        value={clubForm.balance}
                        onChange={(e) => setClubForm({ ...clubForm, balance: e.target.value })}
                        placeholder="100000000"
                      />
                      <Input
                        label="Owner"
                        value={clubForm.owner}
                        onChange={(e) => setClubForm({ ...clubForm, owner: e.target.value })}
                        placeholder="Club Owner"
                      />
                      <Input
                        label="Current Coach"
                        value={clubForm.coach}
                        onChange={(e) => setClubForm({ ...clubForm, coach: e.target.value })}
                        placeholder="Available / None"
                      />
                    </div>

                    <h3 className={styles.formSectionTitle}>👕 Club Kits</h3>
                    <div className={styles.formGrid}>
                      <Input
                        label="Home Kit"
                        value={clubForm.homeKit}
                        onChange={(e) => setClubForm({ ...clubForm, homeKit: e.target.value })}
                        placeholder="Kit description or image URL"
                      />
                      <Input
                        label="Away Kit"
                        value={clubForm.awayKit}
                        onChange={(e) => setClubForm({ ...clubForm, awayKit: e.target.value })}
                        placeholder="Kit description or image URL"
                      />
                      <Input
                        label="Third Kit"
                        value={clubForm.thirdKit}
                        onChange={(e) => setClubForm({ ...clubForm, thirdKit: e.target.value })}
                        placeholder="Kit description or image URL"
                      />
                      <Input
                        label="Club Colors"
                        value={clubForm.colors}
                        onChange={(e) => setClubForm({ ...clubForm, colors: e.target.value })}
                        placeholder="Red, White, Black"
                      />
                    </div>

                    <div className={styles.fullField}>
                      <label>Club Description</label>
                      <textarea
                        value={clubForm.description}
                        onChange={(e) => setClubForm({ ...clubForm, description: e.target.value })}
                        placeholder="Club history and details..."
                        rows={5}
                      />
                    </div>

                    <FormButtons editing={editingClub} loading={isSubmitting} onCancel={cancelEditing} />
                  </form>

                  <DataTable
                    title="Clubs"
                    data={clubs}
                    empty="No clubs created yet."
                    columns={[
                      {
                        title: "Club",
                        render: (item) => (
                          <div className={styles.clubCell}>
                            {item.logo ? <img src={item.logo} alt="" /> : <span>⚽</span>}
                            <strong>{item.name}</strong>
                          </div>
                        ),
                      },
                      { title: "League", render: (item) => item.leagueName || "-" },
                      { title: "Country", render: (item) => item.countryName || "-" },
                      { title: "Balance", render: (item) => formatMoney(item.balance, item.currency) },
                      { title: "Stadium", render: (item) => item.stadium || "-" },
                    ]}
                    onEdit={editClub}
                    onDelete={removeClub}
                  />
                </div>
              )}

              {/* PLAYERS */}
              {activeTab === "players" && (
                <div>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2>{editingPlayer ? "Edit Player" : "Players"}</h2>
                      <p>Add players, import Rwanda Premier League players, or generate players for a club.</p>
                    </div>

                    <div className={styles.playerTools}>
                      <button
                        type="button"
                        className={styles.rplImportButton}
                        onClick={fetchAndImportRplPlayers}
                        disabled={isFetchingRplPlayers}
                      >
                        {isFetchingRplPlayers ? "⏳ Importing..." : "🇷🇼 Import RPL Players"}
                      </button>

                      <button
                        type="button"
                        className={styles.generateButton}
                        onClick={() => setShowGeneratePlayers(true)}
                        disabled={isFetchingRplPlayers}
                      >
                        ⚡ Generate Players
                      </button>
                    </div>
                  </div>

                  {isFetchingRplPlayers && (
                    <div className={styles.importProgressCard}>
                      <div>
                        <strong>Importing Rwanda Premier League players</strong>
                        <span>
                          {rplFetchProgress.current} / {rplFetchProgress.total || "..."}
                        </span>
                      </div>

                      <div className={styles.progressBar}>
                        <div
                          className={styles.progressFill}
                          style={{
                            width:
                              rplFetchProgress.total > 0
                                ? `${(rplFetchProgress.current / rplFetchProgress.total) * 100}%`
                                : "0%",
                          }}
                        />
                      </div>

                      <small>Existing players are automatically skipped.</small>
                    </div>
                  )}

                  {showGeneratePlayers && (
                    <div
                      className={styles.modalOverlay}
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget && !isSubmitting) {
                          setShowGeneratePlayers(false);
                        }
                      }}
                    >
                      <div className={styles.generateModal}>
                        <div className={styles.modalHeader}>
                          <div>
                            <span className={styles.modalEyebrow}>PLAYER GENERATOR</span>
                            <h3>Generate Players</h3>
                            <p>Create a squad automatically and save it directly to Firestore.</p>
                          </div>

                          <button
                            type="button"
                            className={styles.modalClose}
                            onClick={() => !isSubmitting && setShowGeneratePlayers(false)}
                          >
                            ×
                          </button>
                        </div>

                        <form onSubmit={generatePlayers} className={styles.generateForm}>
                          <Select
                            label="Select Club"
                            value={generatePlayerForm.clubId}
                            onChange={(e) =>
                              setGeneratePlayerForm({ ...generatePlayerForm, clubId: e.target.value })
                            }
                            options={clubs.map((club) => ({ value: club.id, label: club.name }))}
                            placeholder="Choose a club"
                          />

                          <Input
                            label="Number of Players"
                            type="number"
                            min="1"
                            max="100"
                            value={generatePlayerForm.count}
                            onChange={(e) =>
                              setGeneratePlayerForm({ ...generatePlayerForm, count: e.target.value })
                            }
                            placeholder="20"
                            required
                          />

                          {generatePlayerForm.clubId && (
                            <div className={styles.generatorInfo}>
                              <span>Selected Club</span>
                              <strong>
                                {clubs.find((club) => club.id === generatePlayerForm.clubId)?.name}
                              </strong>
                              <small>
                                Players will automatically receive positions, shirt numbers, ages, ratings, values and wages.
                              </small>
                            </div>
                          )}

                          <div className={styles.modalActions}>
                            <button
                              type="button"
                              className={styles.cancelButton}
                              onClick={() => setShowGeneratePlayers(false)}
                              disabled={isSubmitting}
                            >
                              Cancel
                            </button>

                            <button
                              type="submit"
                              className={styles.generateButton}
                              disabled={isSubmitting}
                            >
                              {isSubmitting ? "Generating..." : "⚡ Generate & Save"}
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  <form className={styles.formCard} onSubmit={savePlayer}>
                    <h3 className={styles.formSectionTitle}>👤 Player Information</h3>
                    <div className={styles.formGrid}>
                      <Input
                        label="Full Name"
                        value={playerForm.name}
                        onChange={(e) => setPlayerForm({ ...playerForm, name: e.target.value })}
                        placeholder="Player Name"
                        required
                      />
                      <Input
                        label="First Name"
                        value={playerForm.firstName}
                        onChange={(e) => setPlayerForm({ ...playerForm, firstName: e.target.value })}
                      />
                      <Input
                        label="Last Name"
                        value={playerForm.lastName}
                        onChange={(e) => setPlayerForm({ ...playerForm, lastName: e.target.value })}
                      />
                      <Input
                        label="Age"
                        type="number"
                        min="15"
                        value={playerForm.age}
                        onChange={(e) => setPlayerForm({ ...playerForm, age: e.target.value })}
                      />
                      <Input
                        label="Nationality"
                        value={playerForm.nationality}
                        onChange={(e) => setPlayerForm({ ...playerForm, nationality: e.target.value })}
                      />
                      <Select
                        label="Country"
                        value={playerForm.countryId}
                        onChange={(e) => setPlayerForm({ ...playerForm, countryId: e.target.value })}
                        options={countries.map((country) => ({ value: country.id, label: country.name }))}
                        placeholder="Select country"
                      />
                    </div>

                    <h3 className={styles.formSectionTitle}>⚽ Club & Position</h3>
                    <div className={styles.formGrid}>
                      <Select
                        label="Club"
                        value={playerForm.clubId}
                        onChange={(e) => setPlayerForm({ ...playerForm, clubId: e.target.value })}
                        options={clubs.map((club) => ({ value: club.id, label: club.name }))}
                        placeholder="Select club"
                      />
                      <Select
                        label="Position"
                        value={playerForm.position}
                        onChange={(e) => setPlayerForm({ ...playerForm, position: e.target.value })}
                        options={[
                          { value: "GK", label: "Goalkeeper" },
                          { value: "DEF", label: "Defender" },
                          { value: "MID", label: "Midfielder" },
                          { value: "FWD", label: "Forward" },
                        ]}
                      />
                      <Input
                        label="Shirt Number"
                        type="number"
                        min="1"
                        max="99"
                        value={playerForm.shirtNumber}
                        onChange={(e) => setPlayerForm({ ...playerForm, shirtNumber: e.target.value })}
                      />
                      <Input
                        label="Overall Rating"
                        type="number"
                        min="1"
                        max="100"
                        value={playerForm.overall}
                        onChange={(e) => setPlayerForm({ ...playerForm, overall: e.target.value })}
                      />
                    </div>

                    <h3 className={styles.formSectionTitle}>💰 Contract & Value</h3>
                    <div className={styles.formGrid}>
                      <Input
                        label="Player Value"
                        type="number"
                        min="0"
                        value={playerForm.value}
                        onChange={(e) => setPlayerForm({ ...playerForm, value: e.target.value })}
                      />
                      <Input
                        label="Weekly Wage"
                        type="number"
                        min="0"
                        value={playerForm.wage}
                        onChange={(e) => setPlayerForm({ ...playerForm, wage: e.target.value })}
                      />
                      <Input
                        label="Contract Years"
                        type="number"
                        min="1"
                        max="10"
                        value={playerForm.contractYears}
                        onChange={(e) => setPlayerForm({ ...playerForm, contractYears: e.target.value })}
                      />
                      <Input
                        label="Player Photo URL"
                        value={playerForm.photo}
                        onChange={(e) => setPlayerForm({ ...playerForm, photo: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>

                    <FormButtons editing={editingPlayer} loading={isSubmitting} onCancel={cancelEditing} />
                  </form>

                  <DataTable
                    title="Players"
                    data={players}
                    empty="No players yet."
                    columns={[
                      {
                        title: "Player",
                        render: (item) => (
                          <div className={styles.playerCell}>
                            {item.photo ? <img src={item.photo} alt="" /> : <span>👤</span>}
                            <div>
                              <strong>{item.name}</strong>
                              <small>#{item.shirtNumber || "-"}</small>
                            </div>
                          </div>
                        ),
                      },
                      { title: "Club", render: (item) => item.clubName || "-" },
                      { title: "Position", render: (item) => item.position || "-" },
                      { title: "Overall", render: (item) => <span className={styles.rating}>{item.overall || 0}</span> },
                      { title: "Value", render: (item) => formatMoney(item.value) },
                    ]}
                    onEdit={editPlayer}
                    onDelete={removePlayer}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}

/* =========================================================
   INPUT
========================================================= */

function Input({ label, value, onChange, type = "text", placeholder = "", required = false, min, max }) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        min={min}
        max={max}
      />
    </div>
  );
}

/* =========================================================
   SELECT
========================================================= */

function Select({ label, value, onChange, options = [], placeholder }) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      <select value={value} onChange={onChange}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* =========================================================
   FORM BUTTONS
========================================================= */

function FormButtons({ editing, loading, onCancel }) {
  return (
    <div className={styles.formActions}>
      {editing && (
        <button type="button" className={styles.cancelButton} onClick={onCancel} disabled={loading}>
          Cancel
        </button>
      )}
      <button type="submit" className={styles.submitButton} disabled={loading}>
        {loading ? "Saving..." : editing ? "✓ Update" : "＋ Create"}
      </button>
    </div>
  );
}

/* =========================================================
   DATA TABLE
========================================================= */

function DataTable({ title, data, empty, columns, onEdit, onDelete }) {
  return (
    <div className={styles.databaseCard}>
      <div className={styles.tableHeader}>
        <h3>{title}</h3>
        <span>
          {data.length} item{data.length === 1 ? "" : "s"}
        </span>
      </div>

      {data.length === 0 ? (
        <div className={styles.empty}>{empty}</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={index}>{column.title}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.id}>
                  {columns.map((column, index) => (
                    <td key={index}>{column.render(item)}</td>
                  ))}
                  <td>
                    <div className={styles.actions}>
                      <button className={styles.editButton} onClick={() => onEdit(item)}>
                        ✏️
                      </button>
                      <button className={styles.deleteButton} onClick={() => onDelete(item.id)}>
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
