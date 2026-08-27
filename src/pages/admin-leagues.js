// pages/club-manager.js

import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

import {
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../components/firebase";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

import styles from "./admin-leagues.module.css";

/* =========================================================
   HELPERS
========================================================= */

function toNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function formatMoney(value, currency = "EUR") {
  const amount = toNumber(value, 0);

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency || "EUR"}`;
  }
}

function formatNumber(value) {
  return toNumber(value, 0).toLocaleString();
}

/* =========================================================
   EMPTY FORM
========================================================= */

const EMPTY_FORM = {
  reputation: 50,
  balance: 0,
  transferBudget: 0,
  wageBudget: 0,
};

/* =========================================================
   PAGE
========================================================= */

export default function ClubManager() {
  const router = useRouter();

  const {
    user,
    userData,
    loading,
  } = useAuth();

  /* =======================================================
     AUTH
  ======================================================= */

  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

  /* =======================================================
     DATA
  ======================================================= */

  const [leagues, setLeagues] = useState([]);
  const [clubs, setClubs] = useState([]);

  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [selectedClubId, setSelectedClubId] = useState("");

  const [form, setForm] = useState(EMPTY_FORM);

  /* =======================================================
     UI
  ======================================================= */

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  /* =======================================================
     DISPLAY NAME
  ======================================================= */

  const displayName = useMemo(() => {
    return (
      userData?.displayName ||
      userData?.username ||
      user?.email?.split("@")[0] ||
      "Manager"
    );
  }, [userData, user]);

  /* =======================================================
     ADMIN CHECK
  ======================================================= */

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    const normalizedName = String(displayName)
      .trim()
      .toLowerCase();

    const admin =
      normalizedName === "navio" ||
      userData?.role === "admin" ||
      userData?.isAdmin === true;

    setIsAdmin(admin);
    setCheckingAdmin(false);

    if (!admin) {
      toast.error(
        "You are not authorized to access this page."
      );

      router.replace("/dashboard");
    }
  }, [
    user,
    userData,
    loading,
    displayName,
    router,
  ]);

  /* =======================================================
     LOAD LEAGUES + CLUBS
  ======================================================= */

  const loadData = useCallback(async () => {
    try {
      setIsLoadingData(true);

      const [
        leaguesSnapshot,
        clubsSnapshot,
      ] = await Promise.all([
        getDocs(
          collection(
            db,
            "leagues"
          )
        ),

        getDocs(
          collection(
            db,
            "clubs"
          )
        ),
      ]);

      const loadedLeagues =
        leaguesSnapshot.docs.map(
          (item) => ({
            id: item.id,
            ...item.data(),
          })
        );

      const loadedClubs =
        clubsSnapshot.docs.map(
          (item) => ({
            id: item.id,
            ...item.data(),
          })
        );

      loadedLeagues.sort((a, b) =>
        String(a.name || "").localeCompare(
          String(b.name || "")
        )
      );

      loadedClubs.sort((a, b) =>
        String(
          a.name ||
            a.clubName ||
            ""
        ).localeCompare(
          String(
            b.name ||
              b.clubName ||
              ""
          )
        )
      );

      setLeagues(loadedLeagues);
      setClubs(loadedClubs);
    } catch (error) {
      console.error(
        "Club manager loading error:",
        error
      );

      toast.error(
        "Failed to load leagues and clubs."
      );
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    loadData();
  }, [
    isAdmin,
    loadData,
  ]);

  /* =======================================================
     CLUBS OF SELECTED LEAGUE
  ======================================================= */

  const leagueClubs = useMemo(() => {
    if (!selectedLeagueId) {
      return [];
    }

    const selectedLeague =
      leagues.find(
        (league) =>
          league.id ===
          selectedLeagueId
      );

    const leagueName =
      String(
        selectedLeague?.name || ""
      )
        .trim()
        .toLowerCase();

    return clubs.filter((club) => {
      const clubLeagueId =
        String(
          club.leagueId || ""
        );

      const clubLeagueName =
        String(
          club.leagueName || ""
        )
          .trim()
          .toLowerCase();

      /*
       * Primary match:
       * leagueId
       */
      if (
        clubLeagueId &&
        clubLeagueId ===
          selectedLeagueId
      ) {
        return true;
      }

      /*
       * Fallback:
       * leagueName
       */
      if (
        leagueName &&
        clubLeagueName ===
          leagueName
      ) {
        return true;
      }

      return false;
    });
  }, [
    clubs,
    leagues,
    selectedLeagueId,
  ]);

  /* =======================================================
     SELECT LEAGUE
  ======================================================= */

  const handleLeagueChange = (
    event
  ) => {
    const leagueId =
      event.target.value;

    setSelectedLeagueId(
      leagueId
    );

    setSelectedClubId("");

    setForm(
      EMPTY_FORM
    );
  };

  /* =======================================================
     SELECT CLUB
  ======================================================= */

  const handleClubChange = (
    event
  ) => {
    const clubId =
      event.target.value;

    setSelectedClubId(
      clubId
    );

    const club =
      clubs.find(
        (item) =>
          item.id === clubId
      );

    if (!club) {
      setForm(
        EMPTY_FORM
      );

      return;
    }

    setForm({
      reputation: toNumber(
        club.reputation,
        50
      ),

      balance: toNumber(
        club.balance,
        0
      ),

      transferBudget: toNumber(
        club.transferBudget,
        0
      ),

      wageBudget: toNumber(
        club.wageBudget,
        0
      ),
    });
  };

  /* =======================================================
     INPUT CHANGE
  ======================================================= */

  const handleChange = (
    event
  ) => {
    const {
      name,
      value,
    } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  /* =======================================================
     SELECTED CLUB
  ======================================================= */

  const selectedClub = useMemo(() => {
    return (
      clubs.find(
        (club) =>
          club.id ===
          selectedClubId
      ) || null
    );
  }, [
    clubs,
    selectedClubId,
  ]);

  /* =======================================================
     SAVE CLUB
  ======================================================= */

  const saveClub = async (
    event
  ) => {
    event.preventDefault();

    if (!selectedClubId) {
      toast.error(
        "Please select a club first."
      );

      return;
    }

    if (!selectedClub) {
      toast.error(
        "Selected club was not found."
      );

      return;
    }

    const reputation =
      toNumber(
        form.reputation,
        50
      );

    const balance =
      toNumber(
        form.balance,
        0
      );

    const transferBudget =
      toNumber(
        form.transferBudget,
        0
      );

    const wageBudget =
      toNumber(
        form.wageBudget,
        0
      );

    if (
      reputation < 0 ||
      reputation > 100
    ) {
      toast.error(
        "Reputation must be between 0 and 100."
      );

      return;
    }

    if (balance < 0) {
      toast.error(
        "Balance cannot be negative."
      );

      return;
    }

    if (transferBudget < 0) {
      toast.error(
        "Transfer budget cannot be negative."
      );

      return;
    }

    if (wageBudget < 0) {
      toast.error(
        "Wage budget cannot be negative."
      );

      return;
    }

    try {
      setIsSaving(true);

      const clubRef =
        doc(
          db,
          "clubs",
          selectedClubId
        );

      await updateDoc(
        clubRef,
        {
          reputation,

          balance,

          transferBudget,

          wageBudget,

          updatedAt:
            serverTimestamp(),
        }
      );

      setClubs((previous) =>
        previous.map(
          (club) => {
            if (
              club.id !==
              selectedClubId
            ) {
              return club;
            }

            return {
              ...club,

              reputation,

              balance,

              transferBudget,

              wageBudget,
            };
          }
        )
      );

      toast.success(
        `${selectedClub.name || selectedClub.clubName} updated successfully.`
      );
    } catch (error) {
      console.error(
        "Club update error:",
        error
      );

      toast.error(
        error?.message ||
          "Failed to update club."
      );
    } finally {
      setIsSaving(false);
    }
  };

  /* =======================================================
     RESET
  ======================================================= */

  const resetForm = () => {
    if (!selectedClub) {
      setForm(
        EMPTY_FORM
      );

      return;
    }

    setForm({
      reputation: toNumber(
        selectedClub.reputation,
        50
      ),

      balance: toNumber(
        selectedClub.balance,
        0
      ),

      transferBudget: toNumber(
        selectedClub.transferBudget,
        0
      ),

      wageBudget: toNumber(
        selectedClub.wageBudget,
        0
      ),
    });
  };

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading ||
    checkingAdmin
  ) {
    return (
      <>
        <Head>
          <title>
            Club Manager
          </title>
        </Head>

        <main
          className={
            styles.page
          }
        >
          <div
            className={
              styles.loadingBox
            }
          >
            <div
              className={
                styles.spinner
              }
            />

            <p>
              Checking admin access...
            </p>
          </div>
        </main>
      </>
    );
  }

  if (!user || !isAdmin) {
    return null;
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          Club Manager | Virtual Football Manager
        </title>

        <meta
          name="description"
          content="Manage football league clubs, reputation, balance, transfer budget and wage budget."
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
                ADMIN PANEL
              </span>

              <h1
                className={
                  styles.title
                }
              >
                Club Manager
              </h1>

              <p
                className={
                  styles.subtitle
                }
              >
                Select a league, choose a club,
                then edit its financial and reputation
                settings.
              </p>
            </div>

            <div
              className={
                styles.adminBadge
              }
            >
              <span>
                Admin
              </span>

              <strong>
                {displayName}
              </strong>
            </div>
          </header>

          {/* =================================================
              LOADING DATA
          ================================================= */}

          {isLoadingData ? (
            <section
              className={
                styles.loadingCard
              }
            >
              <div
                className={
                  styles.spinner
                }
              />

              <p>
                Loading leagues and clubs...
              </p>
            </section>
          ) : (
            <>
              {/* =============================================
                  SELECTORS
              ============================================== */}

              <section
                className={
                  styles.selectionCard
                }
              >
                <div
                  className={
                    styles.sectionHeader
                  }
                >
                  <div>
                    <span
                      className={
                        styles.sectionLabel
                      }
                    >
                      STEP 1
                    </span>

                    <h2>
                      Choose League
                    </h2>
                  </div>
                </div>

                <div
                  className={
                    styles.field
                  }
                >
                  <label
                    htmlFor="league"
                  >
                    League
                  </label>

                  <select
                    id="league"
                    value={
                      selectedLeagueId
                    }
                    onChange={
                      handleLeagueChange
                    }
                    className={
                      styles.select
                    }
                  >
                    <option value="">
                      Select a league
                    </option>

                    {leagues.map(
                      (league) => (
                        <option
                          key={
                            league.id
                          }
                          value={
                            league.id
                          }
                        >
                          {league.name ||
                            "Unnamed League"}
                          {league.countryName
                            ? ` • ${league.countryName}`
                            : ""}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {selectedLeagueId && (
                  <div
                    className={
                      styles.leagueInfo
                    }
                  >
                    <span>
                      Clubs found
                    </span>

                    <strong>
                      {
                        leagueClubs.length
                      }
                    </strong>
                  </div>
                )}
              </section>

              {/* =============================================
                  CLUB SELECTOR
              ============================================== */}

              {selectedLeagueId && (
                <section
                  className={
                    styles.selectionCard
                  }
                >
                  <div
                    className={
                      styles.sectionHeader
                    }
                  >
                    <div>
                      <span
                        className={
                          styles.sectionLabel
                        }
                      >
                        STEP 2
                      </span>

                      <h2>
                        Choose Club
                      </h2>
                    </div>
                  </div>

                  {leagueClubs.length ===
                  0 ? (
                    <div
                      className={
                        styles.emptyState
                      }
                    >
                      <div
                        className={
                          styles.emptyIcon
                        }
                      >
                        ⚽
                      </div>

                      <h3>
                        No clubs found
                      </h3>

                      <p>
                        This league currently
                        has no clubs connected
                        through <code>leagueId</code>
                        or <code>leagueName</code>.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div
                        className={
                          styles.field
                        }
                      >
                        <label
                          htmlFor="club"
                        >
                          Club
                        </label>

                        <select
                          id="club"
                          value={
                            selectedClubId
                          }
                          onChange={
                            handleClubChange
                          }
                          className={
                            styles.select
                          }
                        >
                          <option value="">
                            Select a club
                          </option>

                          {leagueClubs.map(
                            (club) => (
                              <option
                                key={
                                  club.id
                                }
                                value={
                                  club.id
                                }
                              >
                                {club.name ||
                                  club.clubName ||
                                  "Unnamed Club"}
                              </option>
                            )
                          )}
                        </select>
                      </div>

                      {/* =======================================
                          CLUB LIST
                      ======================================== */}

                      <div
                        className={
                          styles.clubGrid
                        }
                      >
                        {leagueClubs.map(
                          (club) => {
                            const active =
                              club.id ===
                              selectedClubId;

                            return (
                              <button
                                type="button"
                                key={
                                  club.id
                                }
                                className={`${styles.clubCard} ${
                                  active
                                    ? styles.clubCardActive
                                    : ""
                                }`}
                                onClick={() => {
                                  handleClubChange(
                                    {
                                      target: {
                                        value:
                                          club.id,
                                      },
                                    }
                                  );
                                }}
                              >
                                <div
                                  className={
                                    styles.clubLogo
                                  }
                                >
                                  {club.logo ? (
                                    <img
                                      src={
                                        club.logo
                                      }
                                      alt={
                                        club.name ||
                                        club.clubName ||
                                        "Club logo"
                                      }
                                    />
                                  ) : (
                                    <span>
                                      ⚽
                                    </span>
                                  )}
                                </div>

                                <div
                                  className={
                                    styles.clubCardContent
                                  }
                                >
                                  <strong>
                                    {club.name ||
                                      club.clubName ||
                                      "Unnamed Club"}
                                  </strong>

                                  <span>
                                    Reputation:{" "}
                                    {toNumber(
                                      club.reputation,
                                      50
                                    )}
                                  </span>
                                </div>
                              </button>
                            );
                          }
                        )}
                      </div>
                    </>
                  )}
                </section>
              )}

              {/* =============================================
                  EDIT CLUB
              ============================================== */}

              {selectedClub && (
                <section
                  className={
                    styles.editorCard
                  }
                >
                  <div
                    className={
                      styles.editorHeader
                    }
                  >
                    <div
                      className={
                        styles.selectedClub
                      }
                    >
                      <div
                        className={
                          styles.selectedLogo
                        }
                      >
                        {selectedClub.logo ? (
                          <img
                            src={
                              selectedClub.logo
                            }
                            alt={
                              selectedClub.name ||
                              selectedClub.clubName ||
                              "Club logo"
                            }
                          />
                        ) : (
                          <span>
                            ⚽
                          </span>
                        )}
                      </div>

                      <div>
                        <span
                          className={
                            styles.sectionLabel
                          }
                        >
                          EDITING CLUB
                        </span>

                        <h2>
                          {selectedClub.name ||
                            selectedClub.clubName ||
                            "Unnamed Club"}
                        </h2>

                        <p>
                          {selectedClub.leagueName ||
                            "League"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* =========================================
                      CURRENT VALUES
                  ========================================== */}

                  <div
                    className={
                      styles.statsGrid
                    }
                  >
                    <div
                      className={
                        styles.statCard
                      }
                    >
                      <span>
                        Reputation
                      </span>

                      <strong>
                        {toNumber(
                          selectedClub.reputation,
                          50
                        )}
                      </strong>
                    </div>

                    <div
                      className={
                        styles.statCard
                      }
                    >
                      <span>
                        Balance
                      </span>

                      <strong>
                        {formatMoney(
                          selectedClub.balance,
                          selectedClub.currency
                        )}
                      </strong>
                    </div>

                    <div
                      className={
                        styles.statCard
                      }
                    >
                      <span>
                        Transfer Budget
                      </span>

                      <strong>
                        {formatMoney(
                          selectedClub.transferBudget,
                          selectedClub.currency
                        )}
                      </strong>
                    </div>

                    <div
                      className={
                        styles.statCard
                      }
                    >
                      <span>
                        Wage Budget
                      </span>

                      <strong>
                        {formatMoney(
                          selectedClub.wageBudget,
                          selectedClub.currency
                        )}
                      </strong>
                    </div>
                  </div>

                  {/* =========================================
                      FORM
                  ========================================== */}

                  <form
                    onSubmit={
                      saveClub
                    }
                    className={
                      styles.form
                    }
                  >
                    <div
                      className={
                        styles.formGrid
                      }
                    >
                      {/* REPUTATION */}

                      <div
                        className={
                          styles.field
                        }
                      >
                        <label
                          htmlFor="reputation"
                        >
                          Reputation
                        </label>

                        <input
                          id="reputation"
                          name="reputation"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={
                            form.reputation
                          }
                          onChange={
                            handleChange
                          }
                          className={
                            styles.input
                          }
                        />

                        <small>
                          Value from 0 to 100.
                        </small>
                      </div>

                      {/* BALANCE */}

                      <div
                        className={
                          styles.field
                        }
                      >
                        <label
                          htmlFor="balance"
                        >
                          Balance
                        </label>

                        <input
                          id="balance"
                          name="balance"
                          type="number"
                          min="0"
                          step="1"
                          value={
                            form.balance
                          }
                          onChange={
                            handleChange
                          }
                          className={
                            styles.input
                          }
                        />

                        <small>
                          Current club money.
                        </small>
                      </div>

                      {/* TRANSFER BUDGET */}

                      <div
                        className={
                          styles.field
                        }
                      >
                        <label
                          htmlFor="transferBudget"
                        >
                          Transfer Budget
                        </label>

                        <input
                          id="transferBudget"
                          name="transferBudget"
                          type="number"
                          min="0"
                          step="1"
                          value={
                            form.transferBudget
                          }
                          onChange={
                            handleChange
                          }
                          className={
                            styles.input
                          }
                        />

                        <small>
                          Money available for transfers.
                        </small>
                      </div>

                      {/* WAGE BUDGET */}

                      <div
                        className={
                          styles.field
                        }
                      >
                        <label
                          htmlFor="wageBudget"
                        >
                          Wage Budget
                        </label>

                        <input
                          id="wageBudget"
                          name="wageBudget"
                          type="number"
                          min="0"
                          step="1"
                          value={
                            form.wageBudget
                          }
                          onChange={
                            handleChange
                          }
                          className={
                            styles.input
                          }
                        />

                        <small>
                          Budget available for player wages.
                        </small>
                      </div>
                    </div>

                    {/* =======================================
                        ACTIONS
                    ======================================== */}

                    <div
                      className={
                        styles.actions
                      }
                    >
                      <button
                        type="button"
                        onClick={
                          resetForm
                        }
                        disabled={
                          isSaving
                        }
                        className={
                          styles.resetButton
                        }
                      >
                        Reset
                      </button>

                      <button
                        type="submit"
                        disabled={
                          isSaving
                        }
                        className={
                          styles.saveButton
                        }
                      >
                        {isSaving
                          ? "Saving..."
                          : "Save Changes"}
                      </button>
                    </div>
                  </form>

                  {/* =========================================
                      CLUB INFORMATION
                  ========================================== */}

                  <div
                    className={
                      styles.infoGrid
                    }
                  >
                    <div>
                      <span>
                        Country
                      </span>

                      <strong>
                        {selectedClub.countryName ||
                          "Not specified"}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Stadium
                      </span>

                      <strong>
                        {selectedClub.stadium ||
                          "Not specified"}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Currency
                      </span>

                      <strong>
                        {selectedClub.currency ||
                          "EUR"}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Players
                      </span>

                      <strong>
                        {formatNumber(
                          selectedClub.squadSize
                        )}
                      </strong>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
