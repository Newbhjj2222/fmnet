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

import styles from "./admin.module.css";

const EMPTY_COUNTRY = {
  name: "",
  code: "",
};

const EMPTY_LEAGUE = {
  name: "",
  country: "",
  countryId: "",
  season: "",
  level: 1,
  status: "active",
};

const EMPTY_CLUB = {
  name: "",
  shortName: "",
  country: "",
  countryId: "",
  league: "",
  leagueId: "",
  stadium: "",
  location: "",
  founded: "",
  budget: 0,
  balance: 0,
  coach: "",
  homeKit: "#1d4ed8",
  awayKit: "#ffffff",
  thirdKit: "#111827",
  status: "active",
  description: "",
};

const EMPTY_PLAYER = {
  name: "",
  firstName: "",
  lastName: "",
  nationality: "",
  countryId: "",
  clubId: "",
  position: "MF",
  shirtNumber: 1,
  age: 18,
  overall: 60,
  marketValue: 0,
  salary: 0,
  contractUntil: "",
  status: "active",
};

export default function AdminPage({ serverUser }) {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState("overview");

  const [countries, setCountries] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [players, setPlayers] = useState([]);

  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);

  const [countryForm, setCountryForm] = useState(EMPTY_COUNTRY);
  const [leagueForm, setLeagueForm] = useState(EMPTY_LEAGUE);
  const [clubForm, setClubForm] = useState(EMPTY_CLUB);
  const [playerForm, setPlayerForm] = useState(EMPTY_PLAYER);

  const [editingCountry, setEditingCountry] = useState(null);
  const [editingLeague, setEditingLeague] = useState(null);
  const [editingClub, setEditingClub] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);

  const [search, setSearch] = useState("");
  const [selectedClub, setSelectedClub] = useState(null);

  const [message, setMessage] = useState({
    type: "",
    text: "",
  });

  useEffect(() => {
    if (!serverUser || serverUser !== "Navio") {
      router.replace("/login");
      return;
    }

    loadAllData();
  }, [serverUser]);

  const notify = (type, text) => {
    setMessage({ type, text });

    setTimeout(() => {
      setMessage({ type: "", text: "" });
    }, 3500);
  };

  const loadAllData = async () => {
    try {
      setLoadingData(true);

      const [
        countriesSnap,
        leaguesSnap,
        clubsSnap,
        playersSnap,
      ] = await Promise.all([
        getDocs(collection(db, "countries")),
        getDocs(collection(db, "leagues")),
        getDocs(collection(db, "clubs")),
        getDocs(collection(db, "players")),
      ]);

      setCountries(
        countriesSnap.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );

      setLeagues(
        leaguesSnap.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );

      setClubs(
        clubsSnap.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );

      setPlayers(
        playersSnap.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );
    } catch (error) {
      console.error(error);
      notify("error", "Failed to load Firestore data.");
    } finally {
      setLoadingData(false);
    }
  };

  /* =========================================================
     COUNTRIES
  ========================================================= */

  const saveCountry = async (e) => {
    e.preventDefault();

    if (!countryForm.name.trim()) {
      notify("error", "Country name is required.");
      return;
    }

    try {
      setSaving(true);

      const data = {
        name: countryForm.name.trim(),
        code: countryForm.code.trim().toUpperCase(),
        updatedAt: serverTimestamp(),
      };

      if (editingCountry) {
        await updateDoc(doc(db, "countries", editingCountry), data);

        setCountries((prev) =>
          prev.map((item) =>
            item.id === editingCountry
              ? { ...item, ...data }
              : item
          )
        );

        notify("success", "Country updated successfully.");
      } else {
        const ref = await addDoc(collection(db, "countries"), {
          ...data,
          createdAt: serverTimestamp(),
        });

        setCountries((prev) => [
          ...prev,
          {
            id: ref.id,
            ...data,
          },
        ]);

        notify("success", "Country added successfully.");
      }

      setCountryForm(EMPTY_COUNTRY);
      setEditingCountry(null);
    } catch (error) {
      console.error(error);
      notify("error", "Could not save country.");
    } finally {
      setSaving(false);
    }
  };

  const deleteCountry = async (id) => {
    if (!window.confirm("Delete this country?")) return;

    try {
      await deleteDoc(doc(db, "countries", id));

      setCountries((prev) =>
        prev.filter((item) => item.id !== id)
      );

      notify("success", "Country deleted.");
    } catch (error) {
      console.error(error);
      notify("error", "Could not delete country.");
    }
  };

  /* =========================================================
     LEAGUES
  ========================================================= */

  const saveLeague = async (e) => {
    e.preventDefault();

    if (!leagueForm.name.trim()) {
      notify("error", "League name is required.");
      return;
    }

    try {
      setSaving(true);

      const data = {
        name: leagueForm.name.trim(),
        country: leagueForm.country,
        countryId: leagueForm.countryId,
        season: leagueForm.season,
        level: Number(leagueForm.level) || 1,
        status: leagueForm.status,
        updatedAt: serverTimestamp(),
      };

      if (editingLeague) {
        await updateDoc(doc(db, "leagues", editingLeague), data);

        setLeagues((prev) =>
          prev.map((item) =>
            item.id === editingLeague
              ? { ...item, ...data }
              : item
          )
        );

        notify("success", "League updated.");
      } else {
        const ref = await addDoc(collection(db, "leagues"), {
          ...data,
          createdAt: serverTimestamp(),
        });

        setLeagues((prev) => [
          ...prev,
          {
            id: ref.id,
            ...data,
          },
        ]);

        notify("success", "League added.");
      }

      setLeagueForm(EMPTY_LEAGUE);
      setEditingLeague(null);
    } catch (error) {
      console.error(error);
      notify("error", "Could not save league.");
    } finally {
      setSaving(false);
    }
  };

  const deleteLeague = async (id) => {
    if (!window.confirm("Delete this league?")) return;

    try {
      await deleteDoc(doc(db, "leagues", id));

      setLeagues((prev) =>
        prev.filter((item) => item.id !== id)
      );

      notify("success", "League deleted.");
    } catch (error) {
      console.error(error);
      notify("error", "Could not delete league.");
    }
  };

  /* =========================================================
     CLUBS
  ========================================================= */

  const saveClub = async (e) => {
    e.preventDefault();

    if (!clubForm.name.trim()) {
      notify("error", "Club name is required.");
      return;
    }

    try {
      setSaving(true);

      const data = {
        name: clubForm.name.trim(),
        shortName: clubForm.shortName.trim(),
        country: clubForm.country,
        countryId: clubForm.countryId,
        league: clubForm.league,
        leagueId: clubForm.leagueId,

        stadium: clubForm.stadium,
        location: clubForm.location,

        founded: Number(clubForm.founded) || null,

        budget: Number(clubForm.budget) || 0,
        balance: Number(clubForm.balance) || 0,

        coach: clubForm.coach,

        kits: {
          home: clubForm.homeKit,
          away: clubForm.awayKit,
          third: clubForm.thirdKit,
        },

        status: clubForm.status,
        description: clubForm.description,

        updatedAt: serverTimestamp(),
      };

      if (editingClub) {
        await updateDoc(doc(db, "clubs", editingClub), data);

        setClubs((prev) =>
          prev.map((item) =>
            item.id === editingClub
              ? { ...item, ...data }
              : item
          )
        );

        notify("success", "Club updated.");
      } else {
        const ref = await addDoc(collection(db, "clubs"), {
          ...data,
          playersCount: 0,
          createdAt: serverTimestamp(),
        });

        setClubs((prev) => [
          ...prev,
          {
            id: ref.id,
            ...data,
            playersCount: 0,
          },
        ]);

        notify("success", "Club added.");
      }

      setClubForm(EMPTY_CLUB);
      setEditingClub(null);
    } catch (error) {
      console.error(error);
      notify("error", "Could not save club.");
    } finally {
      setSaving(false);
    }
  };

  const deleteClub = async (id) => {
    if (
      !window.confirm(
        "Delete this club? Players connected to it will not automatically be deleted."
      )
    ) {
      return;
    }

    try {
      await deleteDoc(doc(db, "clubs", id));

      setClubs((prev) =>
        prev.filter((item) => item.id !== id)
      );

      notify("success", "Club deleted.");
    } catch (error) {
      console.error(error);
      notify("error", "Could not delete club.");
    }
  };

  /* =========================================================
     PLAYERS
  ========================================================= */

  const savePlayer = async (e) => {
    e.preventDefault();

    if (!playerForm.name.trim()) {
      notify("error", "Player name is required.");
      return;
    }

    if (!playerForm.clubId) {
      notify("error", "Select a club.");
      return;
    }

    try {
      setSaving(true);

      const selectedCountry = countries.find(
        (country) => country.id === playerForm.countryId
      );

      const selectedClub = clubs.find(
        (club) => club.id === playerForm.clubId
      );

      const data = {
        name: playerForm.name.trim(),

        firstName: playerForm.firstName.trim(),
        lastName: playerForm.lastName.trim(),

        nationality:
          selectedCountry?.name ||
          playerForm.nationality ||
          "",

        countryId: playerForm.countryId,

        clubId: playerForm.clubId,
        clubName: selectedClub?.name || "",

        position: playerForm.position,

        shirtNumber:
          Number(playerForm.shirtNumber) || 1,

        age:
          Number(playerForm.age) || 18,

        overall:
          Number(playerForm.overall) || 60,

        marketValue:
          Number(playerForm.marketValue) || 0,

        salary:
          Number(playerForm.salary) || 0,

        contractUntil:
          playerForm.contractUntil,

        status:
          playerForm.status,

        updatedAt: serverTimestamp(),
      };

      if (editingPlayer) {
        await updateDoc(
          doc(db, "players", editingPlayer),
          data
        );

        setPlayers((prev) =>
          prev.map((item) =>
            item.id === editingPlayer
              ? { ...item, ...data }
              : item
          )
        );

        notify("success", "Player updated.");
      } else {
        const ref = await addDoc(
          collection(db, "players"),
          {
            ...data,
            createdAt: serverTimestamp(),
          }
        );

        setPlayers((prev) => [
          ...prev,
          {
            id: ref.id,
            ...data,
          },
        ]);

        notify("success", "Player added.");
      }

      setPlayerForm(EMPTY_PLAYER);
      setEditingPlayer(null);
    } catch (error) {
      console.error(error);
      notify("error", "Could not save player.");
    } finally {
      setSaving(false);
    }
  };

  const deletePlayer = async (id) => {
    if (!window.confirm("Delete this player?")) return;

    try {
      await deleteDoc(doc(db, "players", id));

      setPlayers((prev) =>
        prev.filter((item) => item.id !== id)
      );

      notify("success", "Player deleted.");
    } catch (error) {
      console.error(error);
      notify("error", "Could not delete player.");
    }
  };

  /* =========================================================
     EDIT HELPERS
  ========================================================= */

  const editCountry = (item) => {
    setEditingCountry(item.id);

    setCountryForm({
      name: item.name || "",
      code: item.code || "",
    });

    setActiveTab("countries");
  };

  const editLeague = (item) => {
    setEditingLeague(item.id);

    setLeagueForm({
      name: item.name || "",
      country: item.country || "",
      countryId: item.countryId || "",
      season: item.season || "",
      level: item.level || 1,
      status: item.status || "active",
    });

    setActiveTab("leagues");
  };

  const editClub = (item) => {
    setEditingClub(item.id);

    setClubForm({
      name: item.name || "",
      shortName: item.shortName || "",
      country: item.country || "",
      countryId: item.countryId || "",
      league: item.league || "",
      leagueId: item.leagueId || "",
      stadium: item.stadium || "",
      location: item.location || "",
      founded: item.founded || "",
      budget: item.budget || 0,
      balance: item.balance || 0,
      coach: item.coach || "",
      homeKit: item.kits?.home || "#1d4ed8",
      awayKit: item.kits?.away || "#ffffff",
      thirdKit: item.kits?.third || "#111827",
      status: item.status || "active",
      description: item.description || "",
    });

    setActiveTab("clubs");
  };

  const editPlayer = (item) => {
    setEditingPlayer(item.id);

    setPlayerForm({
      name: item.name || "",
      firstName: item.firstName || "",
      lastName: item.lastName || "",
      nationality: item.nationality || "",
      countryId: item.countryId || "",
      clubId: item.clubId || "",
      position: item.position || "MF",
      shirtNumber: item.shirtNumber || 1,
      age: item.age || 18,
      overall: item.overall || 60,
      marketValue: item.marketValue || 0,
      salary: item.salary || 0,
      contractUntil: item.contractUntil || "",
      status: item.status || "active",
    });

    setActiveTab("players");
  };

  /* =========================================================
     FILTERING
  ========================================================= */

  const filteredClubs = useMemo(() => {
    const term = search.toLowerCase().trim();

    if (!term) return clubs;

    return clubs.filter((club) =>
      [
        club.name,
        club.shortName,
        club.country,
        club.league,
        club.stadium,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [clubs, search]);

  const filteredPlayers = useMemo(() => {
    const term = search.toLowerCase().trim();

    if (!term) return players;

    return players.filter((player) =>
      [
        player.name,
        player.nationality,
        player.clubName,
        player.position,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [players, search]);

  const stats = {
    countries: countries.length,
    leagues: leagues.length,
    clubs: clubs.length,
    players: players.length,
  };

  if (!serverUser || serverUser !== "Navio") {
    return null;
  }

  return (
    <>
      <Head>
        <title>Admin Control Center | Virtual Football Manager</title>

        <meta
          name="description"
          content="Football Manager administration control center"
        />
      </Head>

      <main className={styles.page}>

        <header className={styles.header}>
          <div>
            <div className={styles.badge}>
              ADMIN CONTROL CENTER
            </div>

            <h1>Football Database</h1>

            <p>
              Manage countries, leagues, clubs and players.
            </p>
          </div>

          <div className={styles.adminUser}>
            <span className={styles.adminDot}></span>
            <div>
              <strong>Navio</strong>
              <small>Administrator</small>
            </div>
          </div>
        </header>

        {message.text && (
          <div
            className={`${styles.message} ${
              message.type === "error"
                ? styles.error
                : styles.success
            }`}
          >
            {message.text}
          </div>
        )}

        <section className={styles.statsGrid}>

          <StatCard
            icon="🌍"
            label="Countries"
            value={stats.countries}
          />

          <StatCard
            icon="🏆"
            label="Leagues"
            value={stats.leagues}
          />

          <StatCard
            icon="⚽"
            label="Clubs"
            value={stats.clubs}
          />

          <StatCard
            icon="👤"
            label="Players"
            value={stats.players}
          />

        </section>

        <nav className={styles.tabs}>

          {[
            ["overview", "Overview"],
            ["countries", "Countries"],
            ["leagues", "Leagues"],
            ["clubs", "Clubs"],
            ["players", "Players"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={
                activeTab === id
                  ? styles.activeTab
                  : ""
              }
              onClick={() => {
                setActiveTab(id);
                setSearch("");
              }}
            >
              {label}
            </button>
          ))}

        </nav>

        {loadingData ? (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <p>Loading football database...</p>
          </div>
        ) : (
          <>

            {/* =================================================
                OVERVIEW
            ================================================= */}

            {activeTab === "overview" && (
              <section className={styles.overview}>

                <div className={styles.heroCard}>
                  <div>
                    <span>DATABASE STATUS</span>
                    <h2>Football World</h2>
                    <p>
                      Your football universe is ready
                      to be managed.
                    </p>
                  </div>

                  <div className={styles.bigBall}>
                    ⚽
                  </div>
                </div>

                <div className={styles.quickGrid}>

                  <button
                    onClick={() => setActiveTab("countries")}
                  >
                    <span>🌍</span>
                    <strong>Add Country</strong>
                    <small>
                      Create a football country
                    </small>
                  </button>

                  <button
                    onClick={() => setActiveTab("leagues")}
                  >
                    <span>🏆</span>
                    <strong>Add League</strong>
                    <small>
                      Create a competition
                    </small>
                  </button>

                  <button
                    onClick={() => setActiveTab("clubs")}
                  >
                    <span>⚽</span>
                    <strong>Add Club</strong>
                    <small>
                      Create a football club
                    </small>
                  </button>

                  <button
                    onClick={() => setActiveTab("players")}
                  >
                    <span>👤</span>
                    <strong>Add Player</strong>
                    <small>
                      Add player to a club
                    </small>
                  </button>

                </div>

              </section>
            )}

            {/* =================================================
                COUNTRIES
            ================================================= */}

            {activeTab === "countries" && (
              <section className={styles.section}>

                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Countries</h2>
                    <p>
                      Manage countries available in
                      your football world.
                    </p>
                  </div>
                </div>

                <div className={styles.contentGrid}>

                  <form
                    className={styles.formCard}
                    onSubmit={saveCountry}
                  >

                    <h3>
                      {editingCountry
                        ? "Edit Country"
                        : "Add Country"}
                    </h3>

                    <FormInput
                      label="Country Name"
                      value={countryForm.name}
                      onChange={(e) =>
                        setCountryForm({
                          ...countryForm,
                          name: e.target.value,
                        })
                      }
                      placeholder="Rwanda"
                    />

                    <FormInput
                      label="Country Code"
                      value={countryForm.code}
                      onChange={(e) =>
                        setCountryForm({
                          ...countryForm,
                          code: e.target.value,
                        })
                      }
                      placeholder="RW"
                      maxLength={3}
                    />

                    <button
                      className={styles.primaryButton}
                      disabled={saving}
                    >
                      {saving
                        ? "Saving..."
                        : editingCountry
                        ? "Update Country"
                        : "Add Country"}
                    </button>

                    {editingCountry && (
                      <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={() => {
                          setEditingCountry(null);
                          setCountryForm(
                            EMPTY_COUNTRY
                          );
                        }}
                      >
                        Cancel
                      </button>
                    )}

                  </form>

                  <div className={styles.listCard}>

                    <div className={styles.listHeader}>
                      <h3>Countries List</h3>
                      <span>
                        {countries.length}
                      </span>
                    </div>

                    {countries.length === 0 ? (
                      <EmptyState text="No countries added yet." />
                    ) : (
                      <div className={styles.list}>

                        {countries.map((country) => (
                          <div
                            className={styles.listItem}
                            key={country.id}
                          >
                            <div className={styles.itemIcon}>
                              🌍
                            </div>

                            <div className={styles.itemMain}>
                              <strong>
                                {country.name}
                              </strong>
                              <small>
                                {country.code || "--"}
                              </small>
                            </div>

                            <div className={styles.itemActions}>
                              <button
                                onClick={() =>
                                  editCountry(country)
                                }
                              >
                                Edit
                              </button>

                              <button
                                className={styles.danger}
                                onClick={() =>
                                  deleteCountry(
                                    country.id
                                  )
                                }
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}

                      </div>
                    )}

                  </div>

                </div>
              </section>
            )}

            {/* =================================================
                LEAGUES
            ================================================= */}

            {activeTab === "leagues" && (
              <section className={styles.section}>

                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Leagues</h2>
                    <p>
                      Create and manage football
                      competitions.
                    </p>
                  </div>
                </div>

                <div className={styles.contentGrid}>

                  <form
                    className={styles.formCard}
                    onSubmit={saveLeague}
                  >

                    <h3>
                      {editingLeague
                        ? "Edit League"
                        : "Add League"}
                    </h3>

                    <FormInput
                      label="League Name"
                      value={leagueForm.name}
                      onChange={(e) =>
                        setLeagueForm({
                          ...leagueForm,
                          name: e.target.value,
                        })
                      }
                      placeholder="Rwanda Premier League"
                    />

                    <FormSelect
                      label="Country"
                      value={leagueForm.countryId}
                      onChange={(e) => {
                        const country =
                          countries.find(
                            (item) =>
                              item.id ===
                              e.target.value
                          );

                        setLeagueForm({
                          ...leagueForm,
                          countryId:
                            e.target.value,
                          country:
                            country?.name || "",
                        });
                      }}
                    >
                      <option value="">
                        Select country
                      </option>

                      {countries.map((country) => (
                        <option
                          key={country.id}
                          value={country.id}
                        >
                          {country.name}
                        </option>
                      ))}
                    </FormSelect>

                    <FormInput
                      label="Season"
                      value={leagueForm.season}
                      onChange={(e) =>
                        setLeagueForm({
                          ...leagueForm,
                          season: e.target.value,
                        })
                      }
                      placeholder="2026/27"
                    />

                    <FormInput
                      label="Competition Level"
                      type="number"
                      value={leagueForm.level}
                      onChange={(e) =>
                        setLeagueForm({
                          ...leagueForm,
                          level: e.target.value,
                        })
                      }
                      min="1"
                    />

                    <FormSelect
                      label="Status"
                      value={leagueForm.status}
                      onChange={(e) =>
                        setLeagueForm({
                          ...leagueForm,
                          status: e.target.value,
                        })
                      }
                    >
                      <option value="active">
                        Active
                      </option>
                      <option value="inactive">
                        Inactive
                      </option>
                    </FormSelect>

                    <button
                      className={styles.primaryButton}
                      disabled={saving}
                    >
                      {saving
                        ? "Saving..."
                        : editingLeague
                        ? "Update League"
                        : "Add League"}
                    </button>

                  </form>

                  <div className={styles.listCard}>

                    <div className={styles.listHeader}>
                      <h3>League List</h3>
                      <span>
                        {leagues.length}
                      </span>
                    </div>

                    <div className={styles.list}>

                      {leagues.map((league) => (
                        <div
                          className={styles.listItem}
                          key={league.id}
                        >
                          <div className={styles.itemIcon}>
                            🏆
                          </div>

                          <div className={styles.itemMain}>
                            <strong>
                              {league.name}
                            </strong>

                            <small>
                              {league.country ||
                                "No country"}{" "}
                              •{" "}
                              {league.season ||
                                "No season"}
                            </small>
                          </div>

                          <div className={styles.itemActions}>
                            <button
                              onClick={() =>
                                editLeague(league)
                              }
                            >
                              Edit
                            </button>

                            <button
                              className={styles.danger}
                              onClick={() =>
                                deleteLeague(
                                  league.id
                                )
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}

                    </div>

                  </div>

                </div>

              </section>
            )}

            {/* =================================================
                CLUBS
            ================================================= */}

            {activeTab === "clubs" && (
              <section className={styles.section}>

                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Clubs</h2>
                    <p>
                      Manage clubs, finances,
                      stadiums and kits.
                    </p>
                  </div>

                  <input
                    className={styles.search}
                    placeholder="Search clubs..."
                    value={search}
                    onChange={(e) =>
                      setSearch(e.target.value)
                    }
                  />
                </div>

                <div className={styles.contentGrid}>

                  <form
                    className={styles.formCard}
                    onSubmit={saveClub}
                  >

                    <h3>
                      {editingClub
                        ? "Edit Club"
                        : "Add Club"}
                    </h3>

                    <FormInput
                      label="Club Name"
                      value={clubForm.name}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          name: e.target.value,
                        })
                      }
                      placeholder="APR FC"
                    />

                    <FormInput
                      label="Short Name"
                      value={clubForm.shortName}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          shortName:
                            e.target.value,
                        })
                      }
                      placeholder="APR"
                    />

                    <FormSelect
                      label="Country"
                      value={clubForm.countryId}
                      onChange={(e) => {
                        const country =
                          countries.find(
                            (item) =>
                              item.id ===
                              e.target.value
                          );

                        setClubForm({
                          ...clubForm,
                          countryId:
                            e.target.value,
                          country:
                            country?.name || "",
                        });
                      }}
                    >
                      <option value="">
                        Select country
                      </option>

                      {countries.map((country) => (
                        <option
                          key={country.id}
                          value={country.id}
                        >
                          {country.name}
                        </option>
                      ))}
                    </FormSelect>

                    <FormSelect
                      label="League"
                      value={clubForm.leagueId}
                      onChange={(e) => {
                        const league =
                          leagues.find(
                            (item) =>
                              item.id ===
                              e.target.value
                          );

                        setClubForm({
                          ...clubForm,
                          leagueId:
                            e.target.value,
                          league:
                            league?.name || "",
                        });
                      }}
                    >
                      <option value="">
                        Select league
                      </option>

                      {leagues.map((league) => (
                        <option
                          key={league.id}
                          value={league.id}
                        >
                          {league.name}
                        </option>
                      ))}
                    </FormSelect>

                    <FormInput
                      label="Stadium"
                      value={clubForm.stadium}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          stadium:
                            e.target.value,
                        })
                      }
                      placeholder="Amahoro Stadium"
                    />

                    <FormInput
                      label="Location"
                      value={clubForm.location}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          location:
                            e.target.value,
                        })
                      }
                      placeholder="Kigali, Rwanda"
                    />

                    <FormInput
                      label="Founded"
                      type="number"
                      value={clubForm.founded}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          founded:
                            e.target.value,
                        })
                      }
                      placeholder="1993"
                    />

                    <FormInput
                      label="Club Budget"
                      type="number"
                      value={clubForm.budget}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          budget:
                            e.target.value,
                        })
                      }
                    />

                    <FormInput
                      label="Current Balance"
                      type="number"
                      value={clubForm.balance}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          balance:
                            e.target.value,
                        })
                      }
                    />

                    <FormInput
                      label="Coach"
                      value={clubForm.coach}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          coach:
                            e.target.value,
                        })
                      }
                    />

                    <div className={styles.formGroup}>
                      <label>Home Kit</label>

                      <input
                        type="color"
                        value={clubForm.homeKit}
                        onChange={(e) =>
                          setClubForm({
                            ...clubForm,
                            homeKit:
                              e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Away Kit</label>

                      <input
                        type="color"
                        value={clubForm.awayKit}
                        onChange={(e) =>
                          setClubForm({
                            ...clubForm,
                            awayKit:
                              e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Third Kit</label>

                      <input
                        type="color"
                        value={clubForm.thirdKit}
                        onChange={(e) =>
                          setClubForm({
                            ...clubForm,
                            thirdKit:
                              e.target.value,
                          })
                        }
                      />
                    </div>

                    <FormSelect
                      label="Status"
                      value={clubForm.status}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          status: e.target.value,
                        })
                      }
                    >
                      <option value="active">
                        Active
                      </option>

                      <option value="inactive">
                        Inactive
                      </option>
                    </FormSelect>

                    <div className={styles.formGroup}>
                      <label>Description</label>

                      <textarea
                        value={
                          clubForm.description
                        }
                        onChange={(e) =>
                          setClubForm({
                            ...clubForm,
                            description:
                              e.target.value,
                          })
                        }
                        placeholder="Club description..."
                      />
                    </div>

                    <button
                      className={styles.primaryButton}
                      disabled={saving}
                    >
                      {saving
                        ? "Saving..."
                        : editingClub
                        ? "Update Club"
                        : "Add Club"}
                    </button>

                  </form>

                  <div className={styles.listCard}>

                    <div className={styles.listHeader}>
                      <h3>Club Database</h3>
                      <span>
                        {filteredClubs.length}
                      </span>
                    </div>

                    <div className={styles.clubList}>

                      {filteredClubs.map((club) => (
                        <div
                          className={styles.clubItem}
                          key={club.id}
                        >

                          <div
                            className={
                              styles.clubBadge
                            }
                            style={{
                              background:
                                club.kits?.home ||
                                "#1d4ed8",
                            }}
                          >
                            ⚽
                          </div>

                          <div
                            className={
                              styles.itemMain
                            }
                          >
                            <strong>
                              {club.name}
                            </strong>

                            <small>
                              {club.league ||
                                "No league"}{" "}
                              •{" "}
                              {club.country ||
                                "No country"}
                            </small>

                            <small>
                              💰{" "}
                              {Number(
                                club.balance || 0
                              ).toLocaleString()}{" "}
                              • 👤{" "}
                              {
                                players.filter(
                                  (p) =>
                                    p.clubId ===
                                    club.id
                                ).length
                              }{" "}
                              players
                            </small>
                          </div>

                          <div
                            className={
                              styles.itemActions
                            }
                          >
                            <button
                              onClick={() => {
                                setSelectedClub(
                                  club
                                );
                              }}
                            >
                              Details
                            </button>

                            <button
                              onClick={() =>
                                editClub(club)
                              }
                            >
                              Edit
                            </button>

                            <button
                              className={
                                styles.danger
                              }
                              onClick={() =>
                                deleteClub(
                                  club.id
                                )
                              }
                            >
                              Delete
                            </button>
                          </div>

                        </div>
                      ))}

                    </div>

                  </div>

                </div>

              </section>
            )}

            {/* =================================================
                PLAYERS
            ================================================= */}

            {activeTab === "players" && (
              <section className={styles.section}>

                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Players</h2>
                    <p>
                      Add and manage players
                      inside clubs.
                    </p>
                  </div>

                  <input
                    className={styles.search}
                    placeholder="Search players..."
                    value={search}
                    onChange={(e) =>
                      setSearch(e.target.value)
                    }
                  />
                </div>

                <div className={styles.contentGrid}>

                  <form
                    className={styles.formCard}
                    onSubmit={savePlayer}
                  >

                    <h3>
                      {editingPlayer
                        ? "Edit Player"
                        : "Add Player"}
                    </h3>

                    <FormInput
                      label="Player Name"
                      value={playerForm.name}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          name: e.target.value,
                        })
                      }
                      placeholder="Jean Bosco"
                    />

                    <div
                      className={
                        styles.twoColumns
                      }
                    >

                      <FormInput
                        label="First Name"
                        value={
                          playerForm.firstName
                        }
                        onChange={(e) =>
                          setPlayerForm({
                            ...playerForm,
                            firstName:
                              e.target.value,
                          })
                        }
                      />

                      <FormInput
                        label="Last Name"
                        value={
                          playerForm.lastName
                        }
                        onChange={(e) =>
                          setPlayerForm({
                            ...playerForm,
                            lastName:
                              e.target.value,
                          })
                        }
                      />

                    </div>

                    <FormSelect
                      label="Nationality"
                      value={
                        playerForm.countryId
                      }
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          countryId:
                            e.target.value,
                        })
                      }
                    >
                      <option value="">
                        Select country
                      </option>

                      {countries.map((country) => (
                        <option
                          key={country.id}
                          value={country.id}
                        >
                          {country.name}
                        </option>
                      ))}
                    </FormSelect>

                    <FormSelect
                      label="Club"
                      value={
                        playerForm.clubId
                      }
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          clubId:
                            e.target.value,
                        })
                      }
                    >
                      <option value="">
                        Select club
                      </option>

                      {clubs.map((club) => (
                        <option
                          key={club.id}
                          value={club.id}
                        >
                          {club.name}
                        </option>
                      ))}
                    </FormSelect>

                    <FormSelect
                      label="Position"
                      value={
                        playerForm.position
                      }
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          position:
                            e.target.value,
                        })
                      }
                    >
                      <option value="GK">
                        Goalkeeper
                      </option>

                      <option value="DF">
                        Defender
                      </option>

                      <option value="MF">
                        Midfielder
                      </option>

                      <option value="FW">
                        Forward
                      </option>
                    </FormSelect>

                    <div
                      className={
                        styles.twoColumns
                      }
                    >

                      <FormInput
                        label="Shirt Number"
                        type="number"
                        value={
                          playerForm.shirtNumber
                        }
                        onChange={(e) =>
                          setPlayerForm({
                            ...playerForm,
                            shirtNumber:
                              e.target.value,
                          })
                        }
                        min="1"
                        max="99"
                      />

                      <FormInput
                        label="Age"
                        type="number"
                        value={
                          playerForm.age
                        }
                        onChange={(e) =>
                          setPlayerForm({
                            ...playerForm,
                            age:
                              e.target.value,
                          })
                        }
                        min="15"
                        max="50"
                      />

                    </div>

                    <FormInput
                      label="Overall Rating"
                      type="number"
                      value={
                        playerForm.overall
                      }
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          overall:
                            e.target.value,
                        })
                      }
                      min="1"
                      max="99"
                    />

                    <FormInput
                      label="Market Value"
                      type="number"
                      value={
                        playerForm.marketValue
                      }
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          marketValue:
                            e.target.value,
                        })
                      }
                    />

                    <FormInput
                      label="Salary"
                      type="number"
                      value={
                        playerForm.salary
                      }
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          salary:
                            e.target.value,
                        })
                      }
                    />

                    <FormInput
                      label="Contract Until"
                      type="date"
                      value={
                        playerForm.contractUntil
                      }
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          contractUntil:
                            e.target.value,
                        })
                      }
                    />

                    <FormSelect
                      label="Status"
                      value={
                        playerForm.status
                      }
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          status:
                            e.target.value,
                        })
                      }
                    >
                      <option value="active">
                        Active
                      </option>

                      <option value="injured">
                        Injured
                      </option>

                      <option value="loan">
                        On Loan
                      </option>

                      <option value="retired">
                        Retired
                      </option>
                    </FormSelect>

                    <button
                      className={styles.primaryButton}
                      disabled={saving}
                    >
                      {saving
                        ? "Saving..."
                        : editingPlayer
                        ? "Update Player"
                        : "Add Player"}
                    </button>

                  </form>

                  <div className={styles.listCard}>

                    <div className={styles.listHeader}>
                      <h3>Players Database</h3>
                      <span>
                        {filteredPlayers.length}
                      </span>
                    </div>

                    <div className={styles.list}>

                      {filteredPlayers.map(
                        (player) => (
                          <div
                            className={
                              styles.listItem
                            }
                            key={player.id}
                          >

                            <div
                              className={
                                styles.playerAvatar
                              }
                            >
                              {player.name
                                ?.charAt(0)
                                ?.toUpperCase() ||
                                "P"}
                            </div>

                            <div
                              className={
                                styles.itemMain
                              }
                            >
                              <strong>
                                {player.name}
                              </strong>

                              <small>
                                {player.clubName ||
                                  "Free Agent"}{" "}
                                •{" "}
                                {player.position}
                              </small>

                              <small>
                                OVR{" "}
                                {player.overall ||
                                  0}{" "}
                                • #
                                {player.shirtNumber ||
                                  0}
                              </small>
                            </div>

                            <div
                              className={
                                styles.itemActions
                              }
                            >
                              <button
                                onClick={() =>
                                  editPlayer(
                                    player
                                  )
                                }
                              >
                                Edit
                              </button>

                              <button
                                className={
                                  styles.danger
                                }
                                onClick={() =>
                                  deletePlayer(
                                    player.id
                                  )
                                }
                              >
                                Delete
                              </button>
                            </div>

                          </div>
                        )
                      )}

                    </div>

                  </div>

                </div>

              </section>
            )}

          </>
        )}

        {/* =====================================================
            CLUB DETAILS MODAL
        ===================================================== */}

        {selectedClub && (
          <div
            className={styles.modalOverlay}
            onClick={() =>
              setSelectedClub(null)
            }
          >

            <div
              className={styles.modal}
              onClick={(e) =>
                e.stopPropagation()
              }
            >

              <button
                className={styles.closeButton}
                onClick={() =>
                  setSelectedClub(null)
                }
              >
                ×
              </button>

              <div
                className={styles.modalClubHeader}
              >

                <div
                  className={styles.largeClubBadge}
                  style={{
                    background:
                      selectedClub.kits?.home ||
                      "#1d4ed8",
                  }}
                >
                  ⚽
                </div>

                <div>
                  <span>CLUB PROFILE</span>

                  <h2>
                    {selectedClub.name}
                  </h2>

                  <p>
                    {selectedClub.league ||
                      "No League"}{" "}
                    •{" "}
                    {selectedClub.country ||
                      "No Country"}
                  </p>
                </div>

              </div>

              <div
                className={styles.detailGrid}
              >

                <Detail
                  label="Stadium"
                  value={
                    selectedClub.stadium ||
                    "Not specified"
                  }
                />

                <Detail
                  label="Location"
                  value={
                    selectedClub.location ||
                    "Not specified"
                  }
                />

                <Detail
                  label="Founded"
                  value={
                    selectedClub.founded ||
                    "Unknown"
                  }
                />

                <Detail
                  label="Coach"
                  value={
                    selectedClub.coach ||
                    "No coach"
                  }
                />

                <Detail
                  label="Budget"
                  value={`$${Number(
                    selectedClub.budget ||
                      0
                  ).toLocaleString()}`}
                />

                <Detail
                  label="Balance"
                  value={`$${Number(
                    selectedClub.balance ||
                      0
                  ).toLocaleString()}`}
                />

                <Detail
                  label="Players"
                  value={
                    players.filter(
                      (player) =>
                        player.clubId ===
                        selectedClub.id
                    ).length
                  }
                />

                <Detail
                  label="Status"
                  value={
                    selectedClub.status ||
                    "active"
                  }
                />

              </div>

              <div className={styles.kitSection}>
                <h3>Club Kits</h3>

                <div className={styles.kits}>

                  <Kit
                    name="Home"
                    color={
                      selectedClub.kits
                        ?.home
                    }
                  />

                  <Kit
                    name="Away"
                    color={
                      selectedClub.kits
                        ?.away
                    }
                  />

                  <Kit
                    name="Third"
                    color={
                      selectedClub.kits
                        ?.third
                    }
                  />

                </div>

              </div>

              <div
                className={
                  styles.squadSection
                }
              >
                <h3>Squad</h3>

                {players.filter(
                  (player) =>
                    player.clubId ===
                    selectedClub.id
                ).length === 0 ? (
                  <p
                    className={
                      styles.emptyText
                    }
                  >
                    No players registered.
                  </p>
                ) : (
                  <div
                    className={
                      styles.squadList
                    }
                  >
                    {players
                      .filter(
                        (player) =>
                          player.clubId ===
                          selectedClub.id
                      )
                      .map((player) => (
                        <div
                          key={player.id}
                          className={
                            styles.squadPlayer
                          }
                        >
                          <span>
                            #
                            {player.shirtNumber}
                          </span>

                          <strong>
                            {player.name}
                          </strong>

                          <small>
                            {player.position}
                          </small>

                          <b>
                            {player.overall}
                          </b>
                        </div>
                      ))}
                  </div>
                )}

              </div>

            </div>

          </div>
        )}

      </main>
    </>
  );
}

/* =============================================================
   COMPONENTS
============================================================= */

function StatCard({ icon, label, value }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statIcon}>
        {icon}
      </span>

      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function FormInput({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  ...props
}) {
  return (
    <div className={styles.formGroup}>
      <label>{label}</label>

      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...props}
      />
    </div>
  );
}

function FormSelect({
  label,
  value,
  onChange,
  children,
}) {
  return (
    <div className={styles.formGroup}>
      <label>{label}</label>

      <select
        value={value}
        onChange={onChange}
      >
        {children}
      </select>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className={styles.empty}>
      {text}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className={styles.detail}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function Kit({ name, color }) {
  return (
    <div className={styles.kit}>
      <div
        className={styles.kitShirt}
        style={{
          background: color || "#333",
        }}
      >
        👕
      </div>

      <strong>{name}</strong>

      <small>
        {color || "Not set"}
      </small>
    </div>
  );
}

/* =============================================================
   SSR
============================================================= */

export async function getServerSideProps({
  req,
}) {
  /*
   * IMPORTANT:
   *
   * Iyi page itegereje ko authentication system yawe
   * ibika username muri cookie yitwa "username".
   *
   * Niba AuthContext yawe ikoresha indi cookie,
   * hindura aha.
   */

  const username =
    req.cookies?.username || "";

  /*
   * Navio ni admin.
   */

  if (username !== "Navio") {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }

  return {
    props: {
      serverUser: username,
    },
  };
}
