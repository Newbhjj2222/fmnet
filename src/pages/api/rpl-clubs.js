// pages/api/rpl-clubs.js

const RPL_BASE = "https://rwandapremierleague.rw";

const URLS = [
  `${RPL_BASE}/table`,
  `${RPL_BASE}/players`,
  `${RPL_BASE}/info/fixtures`,
];

const TIMEOUT = 20000;

/* =========================================================
   CURRENT RPL CLUBS
   ========================================================= */

const CURRENT_RPL_CLUBS = [
  "Al Hilal SC",
  "Al Merrikh SC",
  "Amagaju FC",
  "APR FC",
  "Bugesera FC",
  "Etincelles FC",
  "Etoile de l'Est",
  "Gasogi United",
  "Gicumbi FC",
  "Gorilla FC",
  "Kigali FC",
  "Kiyovu SC",
  "Marine FC",
  "Mukura VS",
  "Musanze FC",
  "Police FC",
  "Rayon Sports",
  "Sunrise FC",
];

/* =========================================================
   NORMALIZE CLUB NAME
   ========================================================= */

function normalizeClubName(name = "") {
  let value = String(name)
    .replace(/\s+/g, " ")
    .trim();

  const lower = value.toLowerCase();

  const aliases = {
    "kiyovu sports": "Kiyovu SC",
    "kiyovu sports fc": "Kiyovu SC",
    "kiyovu sc": "Kiyovu SC",

    "marines fc": "Marine FC",
    "marine fc": "Marine FC",

    "amagaju": "Amagaju FC",
    "amagaju fc": "Amagaju FC",

    "rayon sports fc": "Rayon Sports",
    "rayon sports": "Rayon Sports",

    "apr": "APR FC",
    "apr fc": "APR FC",

    "police": "Police FC",
    "police fc": "Police FC",

    "musanze": "Musanze FC",
    "musanze fc": "Musanze FC",

    "bugesera": "Bugesera FC",
    "bugesera fc": "Bugesera FC",

    "gicumbi": "Gicumbi FC",
    "gicumbi fc": "Gicumbi FC",

    "gorilla": "Gorilla FC",
    "gorilla fc": "Gorilla FC",

    "kigali": "Kigali FC",
    "kigali fc": "Kigali FC",

    "gasogi united fc": "Gasogi United",
    "gasogi united": "Gasogi United",

    "mukura victory sports": "Mukura VS",
    "mukura vs": "Mukura VS",

    "etincelles": "Etincelles FC",
    "etincelles fc": "Etincelles FC",

    "etoile de l'est fc": "Etoile de l'Est",
    "etoile de l'est": "Etoile de l'Est",

    "sunrise fc": "Sunrise FC",
    "sunrise": "Sunrise FC",

    "al hilal": "Al Hilal SC",
    "al hilal sc": "Al Hilal SC",

    "al merrikh": "Al Merrikh SC",
    "al merrikh sc": "Al Merrikh SC",
  };

  return aliases[lower] || value;
}

/* =========================================================
   SHORT NAME
   ========================================================= */

function getShortName(name) {
  const value = normalizeClubName(name);

  const special = {
    "Al Hilal SC": "ALH",
    "Al Merrikh SC": "ALM",
    "Amagaju FC": "AMG",
    "APR FC": "APR",
    "Bugesera FC": "BUG",
    "Etincelles FC": "ETI",
    "Etoile de l'Est": "ETO",
    "Gasogi United": "GAS",
    "Gicumbi FC": "GIC",
    "Gorilla FC": "GOR",
    "Kigali FC": "KIG",
    "Kiyovu SC": "KIY",
    "Marine FC": "MAR",
    "Mukura VS": "MUK",
    "Musanze FC": "MUS",
    "Police FC": "POL",
    "Rayon Sports": "RAY",
    "Sunrise FC": "SUN",
  };

  return (
    special[value] ||
    value
      .replace(/\bFC\b/gi, "")
      .replace(/\bSC\b/gi, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
      .slice(0, 5)
      .toUpperCase()
  );
}

/* =========================================================
   HTML CLEAN
   ========================================================= */

function cleanHtml(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   FETCH
   ========================================================= */

async function fetchPage(url) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT);

  try {
    const response = await fetch(url, {
      method: "GET",

      headers: {
        Accept:
          "text/html,application/xhtml+xml",

        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",

        "Accept-Language":
          "en-US,en;q=0.9",

        Referer:
          RPL_BASE,
      },

      redirect: "follow",

      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   EXTRACT POSSIBLE CLUB NAMES
   ========================================================= */

function extractPossibleClubs(html) {
  const found = [];

  const source = String(html);

  /*
   * Extract visible text from links.
   */

  const links =
    source.match(
      /<a\b[^>]*>[\s\S]*?<\/a>/gi
    ) || [];

  for (const link of links) {
    const text = cleanHtml(link);

    if (
      text.length >= 3 &&
      text.length <= 80
    ) {
      found.push(text);
    }
  }

  /*
   * Extract alt text.
   */

  const altRegex =
    /(?:alt|title)\s*=\s*["']([^"']+)["']/gi;

  let match;

  while (
    (match = altRegex.exec(source))
  ) {
    const text = cleanHtml(match[1]);

    if (
      text.length >= 3 &&
      text.length <= 80
    ) {
      found.push(text);
    }
  }

  return found;
}

/* =========================================================
   MATCH AGAINST KNOWN RPL CLUBS
   ========================================================= */

function findKnownClubs(html) {
  const source =
    String(html).toLowerCase();

  const clubs = [];

  for (
    const originalName
    of CURRENT_RPL_CLUBS
  ) {
    const normalized =
      normalizeClubName(
        originalName
      );

    const lower =
      normalized.toLowerCase();

    /*
     * Match exact club name.
     */

    if (
      source.includes(lower)
    ) {
      clubs.push(normalized);
      continue;
    }

    /*
     * Also match common variation.
     */

    const withoutSuffix =
      lower
        .replace(/\bfc\b/g, "")
        .replace(/\bsc\b/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (
      withoutSuffix &&
      source.includes(
        withoutSuffix
      )
    ) {
      clubs.push(normalized);
    }
  }

  return clubs;
}

/* =========================================================
   BUILD CLUB OBJECT
   ========================================================= */

function buildClub(name) {
  const normalized =
    normalizeClubName(name);

  return {
    name: normalized,

    shortName:
      getShortName(
        normalized
      ),

    logo: "",

    country: "Rwanda",

    league:
      "Rwanda Premier League",

    leagueShort:
      "RPL",

    season:
      "2026-2027",

    source:
      "rwanda-premier-league",

    sourceUrl:
      `${RPL_BASE}/table`,

    importedAt:
      new Date().toISOString(),
  };
}

/* =========================================================
   API
   ========================================================= */

export default async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    res.setHeader(
      "Allow",
      "GET"
    );

    return res.status(405).json({
      success: false,
      message:
        "Only GET is allowed.",
    });
  }

  try {
    const allFound = [];

    /*
     * Try all official RPL pages.
     */

    for (const url of URLS) {
      try {
        const html =
          await fetchPage(url);

        /*
         * First try direct matching
         * against known RPL clubs.
         */

        const known =
          findKnownClubs(
            html
          );

        allFound.push(
          ...known
        );

        /*
         * Then inspect extracted
         * visible/link names.
         */

        const possible =
          extractPossibleClubs(
            html
          );

        for (
          const item
          of possible
        ) {
          const normalized =
            normalizeClubName(
              item
            );

          const matched =
            CURRENT_RPL_CLUBS.find(
              (club) =>
                normalizeClubName(
                  club
                ).toLowerCase() ===
                normalized.toLowerCase()
            );

          if (matched) {
            allFound.push(
              matched
            );
          }
        }
      } catch (error) {
        console.error(
          `RPL source failed: ${url}`,
          error?.message
        );
      }
    }

    /*
     * =====================================================
     * IMPORTANT
     * =====================================================
     *
     * RPL page can change HTML structure.
     * If the official page is reachable but
     * parser cannot find names, do NOT return [].
     */

    let names = [
      ...new Set(
        allFound.map(
          normalizeClubName
        )
      ),
    ];

    let usedFallback = false;

    if (names.length < 1) {
      names =
        CURRENT_RPL_CLUBS.map(
          normalizeClubName
        );

      usedFallback = true;
    }

    /*
     * Sort alphabetically.
     */

    names.sort(
      (a, b) =>
        a.localeCompare(
          b
        )
    );

    const clubs =
      names.map(
        buildClub
      );

    return res.status(200).json({
      success: true,

      message:
        `${clubs.length} Rwanda Premier League clubs found.`,

      count:
        clubs.length,

      clubs,

      teams:
        clubs,

      season:
        "2026-2027",

      source:
        "rwanda-premier-league",

      sourceUrl:
        `${RPL_BASE}/table`,

      usedFallback,

      fetchedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "RPL import error:",
      error
    );

    /*
     * Never leave admin with an empty
     * club list because of an external
     * website parsing problem.
     */

    const clubs =
      CURRENT_RPL_CLUBS.map(
        buildClub
      );

    return res.status(200).json({
      success: true,

      count:
        clubs.length,

      clubs,

      teams:
        clubs,

      season:
        "2026-2027",

      source:
        "rwanda-premier-league",

      sourceUrl:
        `${RPL_BASE}/table`,

      usedFallback: true,

      warning:
        "RPL could not be parsed. Current RPL clubs were returned."
    });
  }
}
