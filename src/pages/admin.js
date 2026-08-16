import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
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
  continent: "",
};

const EMPTY_LEAGUE = {
  name: "",
  countryId: "",
  countryName: "",
  level: 1,
  logo: "",
};

const EMPTY_CLUB = {
  name: "",
  shortName: "",
  countryId: "",
  countryName: "",
  leagueId: "",
  leagueName: "",
  city: "",
  stadium: "",
  stadiumCapacity: "",
  logo: "",
  founded: "",
  manager: "",
  balance: 0,

  homeKit: "",
  awayKit: "",
  thirdKit: "",

  primaryColor: "#2563eb",
  secondaryColor: "#ffffff",

  transferBudget: 0,
  wageBudget: 0,
  debt: 0,

  status: "active",
};

const EMPTY_PLAYER = {
  firstName: "",
  lastName: "",
  clubId: "",
  clubName: "",
  countryId: "",
  countryName: "",
  position: "MID",
  shirtNumber: "",
  age: "",
  overall: 60,
  potential: 70,
  marketValue: 0,
  wage: 0,
  contractYears: 3,
  photo: "",

  pace: 60,
  shooting: 60,
  passing: 60,
  dribbling: 60,
  defending: 50,
  physical: 60,

  status: "active",
};

export default function Admin() {
  const { user, userData, loading } = useAuth();

  const [activeTab, setActiveTab] = useState("dashboard");

  const [countries, setCountries] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [players, setPlayers] = useState([]);

  const [countryForm, setCountryForm] = useState(EMPTY_COUNTRY);
  const [leagueForm, setLeagueForm] = useState(EMPTY_LEAGUE);
  const [clubForm, setClubForm] = useState(EMPTY_CLUB);
  const [playerForm, setPlayerForm] = useState(EMPTY_PLAYER);

  const [editingClub, setEditingClub] = useState(null);
  const [editingLeague, setEditingLeague] = useState(null);
  const [editingCountry, setEditingCountry] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);

  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  /*
   * ---------------------------------------------------------
   * ADMIN ACCESS
   * ---------------------------------------------------------
   */

  const isAdmin =
    userData?.role === "admin" ||
    userData?.isAdmin === true ||
    user?.email === "admin@newtalentsg.com";

  /*
   * ---------------------------------------------------------
   * LOAD DATABASE
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!loading && user && isAdmin) {
      loadDatabase();
    }
  }, [user, loading, isAdmin]);

  async function loadDatabase() {
    try {
      setIsLoading(true);

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
      toast.error("Failed to load football database.");
    } finally {
      setIsLoading(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * COUNTRY
   * ---------------------------------------------------------
   */

  async function saveCountry(e) {
    e.preventDefault();

    if (!countryForm.name.trim()) {
      toast.error("Country name is required.");
      return;
    }

    try {
      setIsSaving(true);

      const payload = {
        name: countryForm.name.trim(),
        code: countryForm.code.trim().toUpperCase(),
        continent: countryForm.continent.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingCountry) {
        await updateDoc(
          doc(db, "countries", editingCountry),
          payload
        );

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

      await loadDatabase();
    } catch (error) {
      console.error(error);
      toast.error("Could not save country.");
    } finally {
      setIsSaving(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * LEAGUE
   * ---------------------------------------------------------
   */

  async function saveLeague(e) {
    e.preventDefault();

    if (!leagueForm.name.trim()) {
      toast.error("League name is required.");
      return;
    }

    try {
      setIsSaving(true);

      const country = countries.find(
        (item) => item.id === leagueForm.countryId
      );

      const payload = {
        name: leagueForm.name.trim(),
        countryId: leagueForm.countryId || "",
        countryName:
          country?.name || leagueForm.countryName || "",
        level: Number(leagueForm.level) || 1,
        logo: leagueForm.logo.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingLeague) {
        await updateDoc(
          doc(db, "leagues", editingLeague),
          payload
        );

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

      await loadDatabase();
    } catch (error) {
      console.error(error);
      toast.error("Could not save league.");
    } finally {
      setIsSaving(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * CLUB
   * ---------------------------------------------------------
   */

  async function saveClub(e) {
    e.preventDefault();

    if (!clubForm.name.trim()) {
      toast.error("Club name is required.");
      return;
    }

    try {
      setIsSaving(true);

      const country = countries.find(
        (item) => item.id === clubForm.countryId
      );

      const league = leagues.find(
        (item) => item.id === clubForm.leagueId
      );

      const payload = {
        name: clubForm.name.trim(),
        shortName: clubForm.shortName.trim(),

        countryId: clubForm.countryId,
        countryName:
          country?.name || clubForm.countryName || "",

        leagueId: clubForm.leagueId,
        leagueName:
          league?.name || clubForm.leagueName || "",

        city: clubForm.city.trim(),

        stadium: clubForm.stadium.trim(),

        stadiumCapacity:
          Number(clubForm.stadiumCapacity) || 0,

        logo: clubForm.logo.trim(),

        founded:
          Number(clubForm.founded) || null,

        manager: clubForm.manager.trim(),

        balance:
          Number(clubForm.balance) || 0,

        transferBudget:
          Number(clubForm.transferBudget) || 0,

        wageBudget:
          Number(clubForm.wageBudget) || 0,

        debt:
          Number(clubForm.debt) || 0,

        homeKit: clubForm.homeKit.trim(),
        awayKit: clubForm.awayKit.trim(),
        thirdKit: clubForm.thirdKit.trim(),

        primaryColor: clubForm.primaryColor,
        secondaryColor: clubForm.secondaryColor,

        status: clubForm.status,

        updatedAt: serverTimestamp(),
      };

      if (editingClub) {
        await updateDoc(
          doc(db, "clubs", editingClub),
          payload
        );

        toast.success("Club updated.");
      } else {
        await addDoc(collection(db, "clubs"), {
          ...payload,

          playersCount: 0,
          trophies: 0,
          reputation: 50,

          createdAt: serverTimestamp(),
        });

        toast.success("Club created.");
      }

      setClubForm(EMPTY_CLUB);
      setEditingClub(null);

      await loadDatabase();
    } catch (error) {
      console.error(error);
      toast.error("Could not save club.");
    } finally {
      setIsSaving(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * PLAYER
   * ---------------------------------------------------------
   */

  async function savePlayer(e) {
    e.preventDefault();

    if (
      !playerForm.firstName.trim() ||
      !playerForm.lastName.trim()
    ) {
      toast.error("Player name is required.");
      return;
    }

    try {
      setIsSaving(true);

      const club = clubs.find(
        (item) => item.id === playerForm.clubId
      );

      const country = countries.find(
        (item) => item.id === playerForm.countryId
      );

      const payload = {
        firstName: playerForm.firstName.trim(),
        lastName: playerForm.lastName.trim(),

        clubId: playerForm.clubId,
        clubName: club?.name || "",

        countryId: playerForm.countryId,
        countryName: country?.name || "",

        position: playerForm.position,

        shirtNumber:
          Number(playerForm.shirtNumber) || 0,

        age:
          Number(playerForm.age) || 18,

        overall:
          Number(playerForm.overall) || 60,

        potential:
          Number(playerForm.potential) || 70,

        marketValue:
          Number(playerForm.marketValue) || 0,

        wage:
          Number(playerForm.wage) || 0,

        contractYears:
          Number(playerForm.contractYears) || 3,

        photo: playerForm.photo.trim(),

        pace: Number(playerForm.pace) || 0,
        shooting: Number(playerForm.shooting) || 0,
        passing: Number(playerForm.passing) || 0,
        dribbling: Number(playerForm.dribbling) || 0,
        defending: Number(playerForm.defending) || 0,
        physical: Number(playerForm.physical) || 0,

        status: playerForm.status,

        updatedAt: serverTimestamp(),
      };

      if (editingPlayer) {
        await updateDoc(
          doc(db, "players", editingPlayer),
          payload
        );

        toast.success("Player updated.");
      } else {
        await addDoc(collection(db, "players"), {
          ...payload,
          createdAt: serverTimestamp(),
        });

        toast.success("Player added.");
      }

      setPlayerForm(EMPTY_PLAYER);
      setEditingPlayer(null);

      await loadDatabase();
    } catch (error) {
      console.error(error);
      toast.error("Could not save player.");
    } finally {
      setIsSaving(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * DELETE
   * ---------------------------------------------------------
   */

  async function removeItem(collectionName, id) {
    const confirmed = window.confirm(
      "Are you sure you want to delete this item?"
    );

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, collectionName, id));

      toast.success("Deleted.");

      await loadDatabase();
    } catch (error) {
      console.error(error);
      toast.error("Could not delete item.");
    }
  }

  /*
   * ---------------------------------------------------------
   * EDIT HELPERS
   * ---------------------------------------------------------
   */

  function editCountry(item) {
    setCountryForm({
      name: item.name || "",
      code: item.code || "",
      continent: item.continent || "",
    });

    setEditingCountry(item.id);
    setActiveTab("countries");
  }

  function editLeague(item) {
    setLeagueForm({
      name: item.name || "",
      countryId: item.countryId || "",
      countryName: item.countryName || "",
      level: item.level || 1,
      logo: item.logo || "",
    });

    setEditingLeague(item.id);
    setActiveTab("leagues");
  }

  function editClub(item) {
    setClubForm({
      ...EMPTY_CLUB,
      ...item,
    });

    setEditingClub(item.id);
    setActiveTab("clubs");
  }

  function editPlayer(item) {
    setPlayerForm({
      ...EMPTY_PLAYER,
      ...item,
    });

    setEditingPlayer(item.id);
    setActiveTab("players");
  }

  /*
   * ---------------------------------------------------------
   * FILTER
   * ---------------------------------------------------------
   */

  const filteredClubs = useMemo(() => {
    const value = search.toLowerCase();

    return clubs.filter(
      (club) =>
        club.name?.toLowerCase().includes(value) ||
        club.countryName?.toLowerCase().includes(value) ||
        club.leagueName?.toLowerCase().includes(value)
    );
  }, [clubs, search]);

  const filteredPlayers = useMemo(() => {
    const value = search.toLowerCase();

    return players.filter((player) =>
      `${player.firstName} ${player.lastName}`
        .toLowerCase()
        .includes(value)
    );
  }, [players, search]);

  /*
   * ---------------------------------------------------------
   * ACCESS
   * ---------------------------------------------------------
   */

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Checking administrator access...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={styles.accessDenied}>
        <div className={styles.accessBox}>
          <span>🔐</span>
          <h1>Login Required</h1>
          <p>You must be logged in as an administrator.</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className={styles.accessDenied}>
        <div className={styles.accessBox}>
          <span>🚫</span>
          <h1>Access Denied</h1>
          <p>You do not have administrator permission.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading football database...</p>
      </div>
    );
  }

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */

  return (
    <>
      <Head>
        <title>Football Admin | New Talents Stories</title>
        <meta
          name="description"
          content="Football database administration"
        />
      </Head>

      <main className={styles.page}>

        {/* SIDEBAR */}

        <aside className={styles.sidebar}>

          <div className={styles.brand}>
            <div className={styles.brandIcon}>⚽</div>

            <div>
              <strong>Football Admin</strong>
              <small>Control Center</small>
            </div>
          </div>

          <nav className={styles.nav}>

            <button
              className={activeTab === "dashboard" ? styles.active : ""}
              onClick={() => setActiveTab("dashboard")}
            >
              <span>📊</span>
              Dashboard
            </button>

            <button
              className={activeTab === "countries" ? styles.active : ""}
              onClick={() => setActiveTab("countries")}
            >
              <span>🌍</span>
              Countries
            </button>

            <button
              className={activeTab === "leagues" ? styles.active : ""}
              onClick={() => setActiveTab("leagues")}
            >
              <span>🏆</span>
              Leagues
            </button>

            <button
              className={activeTab === "clubs" ? styles.active : ""}
              onClick={() => setActiveTab("clubs")}
            >
              <span>🏟️</span>
              Clubs
            </button>

            <button
              className={activeTab === "players" ? styles.active : ""}
              onClick={() => setActiveTab("players")}
            >
              <span>👤</span>
              Players
            </button>

          </nav>

        </aside>

        {/* MAIN */}

        <section className={styles.content}>

          <header className={styles.topbar}>

            <div>
              <h1>
                {activeTab === "dashboard"
                  ? "Football Database"
                  : activeTab.charAt(0).toUpperCase() +
                    activeTab.slice(1)}
              </h1>

              <p>
                Manage your football world from one place.
              </p>
            </div>

            <div className={styles.adminUser}>
              <div className={styles.avatar}>
                {(
                  userData?.displayName ||
                  user?.email ||
                  "A"
                )
                  .charAt(0)
                  .toUpperCase()}
              </div>

              <div>
                <strong>
                  {userData?.displayName || "Administrator"}
                </strong>
                <small>Administrator</small>
              </div>
            </div>

          </header>

          {/* DASHBOARD */}

          {activeTab === "dashboard" && (
            <section>

              <div className={styles.statGrid}>

                <StatCard
                  icon="🌍"
                  title="Countries"
                  value={countries.length}
                />

                <StatCard
                  icon="🏆"
                  title="Leagues"
                  value={leagues.length}
                />

                <StatCard
                  icon="🏟️"
                  title="Clubs"
                  value={clubs.length}
                />

                <StatCard
                  icon="👤"
                  title="Players"
                  value={players.length}
                />

              </div>

              <div className={styles.dashboardGrid}>

                <div className={styles.panel}>

                  <div className={styles.panelHeader}>
                    <div>
                      <h2>Recent Clubs</h2>
                      <p>Latest clubs in database</p>
                    </div>

                    <button
                      className={styles.smallButton}
                      onClick={() => setActiveTab("clubs")}
                    >
                      Manage
                    </button>
                  </div>

                  <div className={styles.clubList}>

                    {clubs.slice(0, 6).map((club) => (
                      <div
                        className={styles.clubRow}
                        key={club.id}
                      >

                        <div className={styles.clubLogo}>
                          {club.logo ? (
                            <img
                              src={club.logo}
                              alt=""
                            />
                          ) : (
                            "⚽"
                          )}
                        </div>

                        <div>
                          <strong>{club.name}</strong>

                          <span>
                            {club.leagueName ||
                              "No league"}{" "}
                            •{" "}
                            {club.countryName ||
                              "No country"}
                          </span>
                        </div>

                      </div>
                    ))}

                  </div>

                </div>

                <div className={styles.panel}>

                  <div className={styles.panelHeader}>
                    <div>
                      <h2>Database Overview</h2>
                      <p>Football world statistics</p>
                    </div>
                  </div>

                  <div className={styles.overview}>

                    <div>
                      <span>Clubs / League</span>
                      <strong>
                        {leagues.length
                          ? (
                              clubs.length /
                              leagues.length
                            ).toFixed(1)
                          : "0"}
                      </strong>
                    </div>

                    <div>
                      <span>Players / Club</span>
                      <strong>
                        {clubs.length
                          ? (
                              players.length /
                              clubs.length
                            ).toFixed(1)
                          : "0"}
                      </strong>
                    </div>

                  </div>

                </div>

              </div>

            </section>
          )}

          {/* COUNTRIES */}

          {activeTab === "countries" && (
            <section>

              <div className={styles.formPanel}>

                <div className={styles.panelHeader}>
                  <div>
                    <h2>
                      {editingCountry
                        ? "Edit Country"
                        : "Add Country"}
                    </h2>

                    <p>
                      Create countries for your football universe.
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={saveCountry}
                  className={styles.formGrid}
                >

                  <Input
                    label="Country Name"
                    value={countryForm.name}
                    onChange={(e) =>
                      setCountryForm({
                        ...countryForm,
                        name: e.target.value,
                      })
                    }
                    required
                  />

                  <Input
                    label="Country Code"
                    placeholder="RW"
                    value={countryForm.code}
                    onChange={(e) =>
                      setCountryForm({
                        ...countryForm,
                        code: e.target.value,
                      })
                    }
                  />

                  <Input
                    label="Continent"
                    placeholder="Africa"
                    value={countryForm.continent}
                    onChange={(e) =>
                      setCountryForm({
                        ...countryForm,
                        continent: e.target.value,
                      })
                    }
                  />

                  <div className={styles.formActions}>
                    <button
                      className={styles.primaryButton}
                      disabled={isSaving}
                    >
                      {isSaving
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
                          setCountryForm(EMPTY_COUNTRY);
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                </form>

              </div>

              <DataTable
                title="Countries"
                items={countries}
                columns={[
                  "name",
                  "code",
                  "continent",
                ]}
                onEdit={editCountry}
                onDelete={(item) =>
                  removeItem("countries", item.id)
                }
              />

            </section>
          )}

          {/* LEAGUES */}

          {activeTab === "leagues" && (
            <section>

              <div className={styles.formPanel}>

                <div className={styles.panelHeader}>
                  <div>
                    <h2>
                      {editingLeague
                        ? "Edit League"
                        : "Add League"}
                    </h2>

                    <p>
                      Manage domestic and international leagues.
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={saveLeague}
                  className={styles.formGrid}
                >

                  <Input
                    label="League Name"
                    value={leagueForm.name}
                    onChange={(e) =>
                      setLeagueForm({
                        ...leagueForm,
                        name: e.target.value,
                      })
                    }
                    required
                  />

                  <Select
                    label="Country"
                    value={leagueForm.countryId}
                    onChange={(e) =>
                      setLeagueForm({
                        ...leagueForm,
                        countryId: e.target.value,
                      })
                    }
                    options={countries.map((country) => ({
                      value: country.id,
                      label: country.name,
                    }))}
                  />

                  <Input
                    label="League Level"
                    type="number"
                    min="1"
                    value={leagueForm.level}
                    onChange={(e) =>
                      setLeagueForm({
                        ...leagueForm,
                        level: e.target.value,
                      })
                    }
                  />

                  <Input
                    label="League Logo URL"
                    value={leagueForm.logo}
                    onChange={(e) =>
                      setLeagueForm({
                        ...leagueForm,
                        logo: e.target.value,
                      })
                    }
                  />

                  <div className={styles.formActions}>

                    <button
                      className={styles.primaryButton}
                      disabled={isSaving}
                    >
                      {isSaving
                        ? "Saving..."
                        : editingLeague
                        ? "Update League"
                        : "Add League"}
                    </button>

                    {editingLeague && (
                      <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={() => {
                          setEditingLeague(null);
                          setLeagueForm(EMPTY_LEAGUE);
                        }}
                      >
                        Cancel
                      </button>
                    )}

                  </div>

                </form>

              </div>

              <DataTable
                title="Leagues"
                items={leagues}
                columns={[
                  "name",
                  "countryName",
                  "level",
                ]}
                onEdit={editLeague}
                onDelete={(item) =>
                  removeItem("leagues", item.id)
                }
              />

            </section>
          )}

          {/* CLUBS */}

          {activeTab === "clubs" && (
            <section>

              <div className={styles.formPanel}>

                <div className={styles.panelHeader}>
                  <div>
                    <h2>
                      {editingClub
                        ? "Edit Club"
                        : "Create Club"}
                    </h2>

                    <p>
                      Configure the complete identity and finances
                      of a football club.
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={saveClub}
                  className={styles.largeForm}
                >

                  <FormSection title="Club Identity">

                    <Input
                      label="Club Name"
                      value={clubForm.name}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          name: e.target.value,
                        })
                      }
                      required
                    />

                    <Input
                      label="Short Name"
                      placeholder="APR"
                      value={clubForm.shortName}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          shortName: e.target.value,
                        })
                      }
                    />

                    <Select
                      label="Country"
                      value={clubForm.countryId}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          countryId: e.target.value,
                        })
                      }
                      options={countries.map((country) => ({
                        value: country.id,
                        label: country.name,
                      }))}
                    />

                    <Select
                      label="League"
                      value={clubForm.leagueId}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          leagueId: e.target.value,
                        })
                      }
                      options={leagues.map((league) => ({
                        value: league.id,
                        label: league.name,
                      }))}
                    />

                    <Input
                      label="City"
                      value={clubForm.city}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          city: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Founded"
                      type="number"
                      value={clubForm.founded}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          founded: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Club Logo URL"
                      value={clubForm.logo}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          logo: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Manager"
                      value={clubForm.manager}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          manager: e.target.value,
                        })
                      }
                    />

                  </FormSection>

                  <FormSection title="Stadium">

                    <Input
                      label="Stadium Name"
                      value={clubForm.stadium}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          stadium: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Capacity"
                      type="number"
                      value={clubForm.stadiumCapacity}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          stadiumCapacity: e.target.value,
                        })
                      }
                    />

                  </FormSection>

                  <FormSection title="Club Finances">

                    <Input
                      label="Club Balance"
                      type="number"
                      value={clubForm.balance}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          balance: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Transfer Budget"
                      type="number"
                      value={clubForm.transferBudget}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          transferBudget: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Wage Budget"
                      type="number"
                      value={clubForm.wageBudget}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          wageBudget: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Debt"
                      type="number"
                      value={clubForm.debt}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          debt: e.target.value,
                        })
                      }
                    />

                  </FormSection>

                  <FormSection title="Kits & Colors">

                    <Input
                      label="Home Kit URL"
                      value={clubForm.homeKit}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          homeKit: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Away Kit URL"
                      value={clubForm.awayKit}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          awayKit: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Third Kit URL"
                      value={clubForm.thirdKit}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          thirdKit: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Primary Color"
                      type="color"
                      value={clubForm.primaryColor}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          primaryColor: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Secondary Color"
                      type="color"
                      value={clubForm.secondaryColor}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          secondaryColor: e.target.value,
                        })
                      }
                    />

                  </FormSection>

                  <FormSection title="Status">

                    <Select
                      label="Club Status"
                      value={clubForm.status}
                      onChange={(e) =>
                        setClubForm({
                          ...clubForm,
                          status: e.target.value,
                        })
                      }
                      options={[
                        {
                          value: "active",
                          label: "Active",
                        },
                        {
                          value: "inactive",
                          label: "Inactive",
                        },
                        {
                          value: "suspended",
                          label: "Suspended",
                        },
                      ]}
                    />

                  </FormSection>

                  <div className={styles.formActions}>

                    <button
                      className={styles.primaryButton}
                      disabled={isSaving}
                    >
                      {isSaving
                        ? "Saving..."
                        : editingClub
                        ? "Update Club"
                        : "Create Club"}
                    </button>

                    {editingClub && (
                      <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={() => {
                          setEditingClub(null);
                          setClubForm(EMPTY_CLUB);
                        }}
                      >
                        Cancel
                      </button>
                    )}

                  </div>

                </form>

              </div>

              <div className={styles.listPanel}>

                <div className={styles.panelHeader}>

                  <div>
                    <h2>Clubs Database</h2>
                    <p>
                      {clubs.length} clubs registered
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

                <div className={styles.clubCards}>

                  {filteredClubs.map((club) => (
                    <div
                      className={styles.clubCard}
                      key={club.id}
                    >

                      <div className={styles.clubCardLogo}>

                        {club.logo ? (
                          <img
                            src={club.logo}
                            alt={club.name}
                          />
                        ) : (
                          "⚽"
                        )}

                      </div>

                      <div className={styles.clubCardInfo}>

                        <h3>{club.name}</h3>

                        <p>
                          {club.leagueName ||
                            "No league"}
                        </p>

                        <span>
                          💰{" "}
                          {Number(
                            club.balance || 0
                          ).toLocaleString()}{" "}
                          RWF
                        </span>

                      </div>

                      <div className={styles.cardActions}>

                        <button
                          onClick={() => editClub(club)}
                        >
                          Edit
                        </button>

                        <button
                          className={styles.danger}
                          onClick={() =>
                            removeItem(
                              "clubs",
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

            </section>
          )}

          {/* PLAYERS */}

          {activeTab === "players" && (
            <section>

              <div className={styles.formPanel}>

                <div className={styles.panelHeader}>
                  <div>
                    <h2>
                      {editingPlayer
                        ? "Edit Player"
                        : "Add Player"}
                    </h2>

                    <p>
                      Create and manage football players.
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={savePlayer}
                  className={styles.largeForm}
                >

                  <FormSection title="Player Identity">

                    <Input
                      label="First Name"
                      value={playerForm.firstName}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          firstName: e.target.value,
                        })
                      }
                      required
                    />

                    <Input
                      label="Last Name"
                      value={playerForm.lastName}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          lastName: e.target.value,
                        })
                      }
                      required
                    />

                    <Select
                      label="Club"
                      value={playerForm.clubId}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          clubId: e.target.value,
                        })
                      }
                      options={clubs.map((club) => ({
                        value: club.id,
                        label: club.name,
                      }))}
                    />

                    <Select
                      label="Country"
                      value={playerForm.countryId}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          countryId: e.target.value,
                        })
                      }
                      options={countries.map((country) => ({
                        value: country.id,
                        label: country.name,
                      }))}
                    />

                    <Select
                      label="Position"
                      value={playerForm.position}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          position: e.target.value,
                        })
                      }
                      options={[
                        {
                          value: "GK",
                          label: "Goalkeeper",
                        },
                        {
                          value: "DEF",
                          label: "Defender",
                        },
                        {
                          value: "MID",
                          label: "Midfielder",
                        },
                        {
                          value: "ATT",
                          label: "Attacker",
                        },
                      ]}
                    />

                    <Input
                      label="Shirt Number"
                      type="number"
                      value={playerForm.shirtNumber}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          shirtNumber: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Age"
                      type="number"
                      value={playerForm.age}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          age: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Photo URL"
                      value={playerForm.photo}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          photo: e.target.value,
                        })
                      }
                    />

                  </FormSection>

                  <FormSection title="Player Rating">

                    <Input
                      label="Overall"
                      type="number"
                      min="1"
                      max="100"
                      value={playerForm.overall}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          overall: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Potential"
                      type="number"
                      min="1"
                      max="100"
                      value={playerForm.potential}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          potential: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Market Value"
                      type="number"
                      value={playerForm.marketValue}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          marketValue: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Weekly Wage"
                      type="number"
                      value={playerForm.wage}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          wage: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Contract Years"
                      type="number"
                      value={playerForm.contractYears}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          contractYears: e.target.value,
                        })
                      }
                    />

                  </FormSection>

                  <FormSection title="Attributes">

                    <Input
                      label="Pace"
                      type="number"
                      min="1"
                      max="100"
                      value={playerForm.pace}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          pace: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Shooting"
                      type="number"
                      min="1"
                      max="100"
                      value={playerForm.shooting}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          shooting: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Passing"
                      type="number"
                      min="1"
                      max="100"
                      value={playerForm.passing}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          passing: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Dribbling"
                      type="number"
                      min="1"
                      max="100"
                      value={playerForm.dribbling}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          dribbling: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Defending"
                      type="number"
                      min="1"
                      max="100"
                      value={playerForm.defending}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          defending: e.target.value,
                        })
                      }
                    />

                    <Input
                      label="Physical"
                      type="number"
                      min="1"
                      max="100"
                      value={playerForm.physical}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          physical: e.target.value,
                        })
                      }
                    />

                  </FormSection>

                  <div className={styles.formActions}>

                    <button
                      className={styles.primaryButton}
                      disabled={isSaving}
                    >
                      {isSaving
                        ? "Saving..."
                        : editingPlayer
                        ? "Update Player"
                        : "Add Player"}
                    </button>

                    {editingPlayer && (
                      <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={() => {
                          setEditingPlayer(null);
                          setPlayerForm(
                            EMPTY_PLAYER
                          );
                        }}
                      >
                        Cancel
                      </button>
                    )}

                  </div>

                </form>

              </div>

              <div className={styles.listPanel}>

                <div className={styles.panelHeader}>

                  <div>
                    <h2>Players Database</h2>
                    <p>
                      {players.length} players registered
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

                <div className={styles.playersList}>

                  {filteredPlayers.map((player) => (
                    <div
                      className={styles.playerRow}
                      key={player.id}
                    >

                      <div className={styles.playerPhoto}>

                        {player.photo ? (
                          <img
                            src={player.photo}
                            alt=""
                          />
                        ) : (
                          "👤"
                        )}

                      </div>

                      <div className={styles.playerInfo}>

                        <strong>
                          {player.firstName}{" "}
                          {player.lastName}
                        </strong>

                        <span>
                          {player.clubName ||
                            "Free Agent"}{" "}
                          •{" "}
                          {player.position}
                        </span>

                      </div>

                      <div className={styles.rating}>
                        {player.overall}
                      </div>

                      <div className={styles.cardActions}>

                        <button
                          onClick={() =>
                            editPlayer(player)
                          }
                        >
                          Edit
                        </button>

                        <button
                          className={styles.danger}
                          onClick={() =>
                            removeItem(
                              "players",
                              player.id
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

            </section>
          )}

        </section>

      </main>
    </>
  );
}

/*
|--------------------------------------------------------------------------
| COMPONENTS
|--------------------------------------------------------------------------
*/

function StatCard({ icon, title, value }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statIcon}>{icon}</div>

      <div>
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function Input({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required = false,
  min,
  max,
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>

      <input
        type={type}
        value={value ?? ""}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        min={min}
        max={max}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options = [],
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>

      <select value={value ?? ""} onChange={onChange}>
        <option value="">Select {label}</option>

        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FormSection({ title, children }) {
  return (
    <div className={styles.formSection}>

      <h3>{title}</h3>

      <div className={styles.formGrid}>
        {children}
      </div>

    </div>
  );
}

function DataTable({
  title,
  items,
  columns,
  onEdit,
  onDelete,
}) {
  return (
    <div className={styles.listPanel}>

      <div className={styles.panelHeader}>
        <div>
          <h2>{title}</h2>
          <p>{items.length} records</p>
        </div>
      </div>

      <div className={styles.tableWrapper}>

        <table className={styles.table}>

          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>
                  {column}
                </th>
              ))}

              <th>Actions</th>
            </tr>
          </thead>

          <tbody>

            {items.map((item) => (
              <tr key={item.id}>

                {columns.map((column) => (
                  <td key={column}>
                    {item[column] ?? "-"}
                  </td>
                ))}

                <td>
                  <div className={styles.tableActions}>

                    <button
                      onClick={() => onEdit(item)}
                    >
                      Edit
                    </button>

                    <button
                      className={styles.danger}
                      onClick={() =>
                        onDelete(item)
                      }
                    >
                      Delete
                    </button>

                  </div>
                </td>

              </tr>
            ))}

          </tbody>

        </table>

      </div>

    </div>
  );
}
