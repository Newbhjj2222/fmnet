// pages/api/rpl-clubs.js

import { URL } from "url";

const RPL_BASE_URL = "https://rwandapremierleague.rw";

// Current RPL pages
const RPL_TABLE_URL = `${RPL_BASE_URL}/table`;
const RPL_HOME_URL = `${RPL_BASE_URL}/home`;
const RPL_TEAM_URL = `${RPL_BASE_URL}/info/team`;

const REQUEST_TIMEOUT = 20000;

/* =========================================================
   HELPERS
========================================================= */

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (full, code) => {
      const number = Number(code);

      if (!Number.isFinite(number)) {
        return full;
      }

      return String.fromCharCode(number);
    })
    .replace(/&#x([0-9a-f]+);/gi, (full, code) => {
      const number = parseInt(code, 16);

      if (!Number.isFinite(number)) {
        return full;
      }

      return String.fromCharCode(number);
    })
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value = "") {
  return decodeHtml(
    String(value)
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<noscript[\s\S]*?<\/noscript>/gi,
        " "
      )
      .replace(
        /<svg[\s\S]*?<\/svg>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  );
}

function clean(value = "") {
  return stripHtml(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value = "") {
  return clean(value)
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value = "") {
  if (!value) {
    return "";
  }

  try {
    return new URL(
      value,
      RPL_BASE_URL
    ).toString();
  } catch {
    return String(value);
  }
}

function getAttribute(
  tag = "",
  attribute = ""
) {
  const regex = new RegExp(
    `${attribute}\\s*=\\s*["']([^"']+)["']`,
    "i"
  );

  const match = String(tag).match(regex);

  return match
    ? decodeHtml(match[1])
    : "";
}

function getImage(tag = "") {
  return (
    getAttribute(tag, "src") ||
    getAttribute(tag, "data-src") ||
    getAttribute(tag, "data-lazy-src") ||
    getAttribute(tag, "data-original") ||
    getAttribute(tag, "data-image") ||
    ""
  );
}

function getLinks(html = "") {
  return (
    String(html).match(
      /<a\b[^>]*>[\s\S]*?<\/a>/gi
    ) || []
  );
}

function isValidClubName(name = "") {
  const value = normalizeName(name);

  if (!value) {
    return false;
  }

  if (value.length < 2 || value.length > 100) {
    return false;
  }

  const lower = value.toLowerCase();

  const ignored = [
    "club",
    "clubs",
    "team",
    "teams",
    "select",
    "select team",
    "select club",
    "all teams",
    "all clubs",
    "apply",
    "home",
    "away",
    "match",
    "matches",
    "fixtures",
    "results",
    "statistics",
    "table",
    "news",
    "read more",
    "download",
    "logo",
    "image",
    "menu",
    "search",
    "rwanda premier league",
  ];

  if (ignored.includes(lower)) {
    return false;
  }

  for (const item of ignored) {
    if (
      lower === item ||
      lower.startsWith(`${item}:`)
    ) {
      return false;
    }
  }

  if (
    /^(image|logo)\s*[:\-]/i.test(value)
  ) {
    return false;
  }

  return true;
}

function dedupeTeams(teams = []) {
  const map = new Map();

  for (const team of teams) {
    if (!team) continue;

    const name = normalizeName(
      typeof team === "string"
        ? team
        : team.name
    );

    if (!isValidClubName(name)) {
      continue;
    }

    const key = name
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        ...(
          typeof team === "object"
            ? team
            : {}
        ),
        name,
      });
      continue;
    }

    map.set(key, {
      ...existing,
      ...(
        typeof team === "object"
          ? team
          : {}
      ),
      name,
    });
  }

  return Array.from(map.values());
}

/* =========================================================
   KNOWN RPL TEAM NORMALIZATION
========================================================= */

function normalizeKnownClubName(name = "") {
  const value = normalizeName(name);
  const lower = value.toLowerCase();

  const aliases = {
    "rayon sports": "Rayon Sports",
    "rayon sports fc": "Rayon Sports",

    "apr fc": "APR FC",

    "kiyovu sports": "Kiyovu Sports",
    "sc kiyovu": "Kiyovu Sports",

    "police fc": "Police FC",

    "musanze fc": "Musanze FC",

    "marine fc": "Marine FC",
    "marines fc": "Marine FC",

    "bugesera fc": "Bugesera FC",

    "gicumbi fc": "Gicumbi FC",

    "gorilla fc": "Gorilla FC",

    "gasogi united": "Gasogi United",
    "gasogi united fc": "Gasogi United",

    "sunrise": "Sunrise FC",
    "sunrise fc": "Sunrise FC",

    "mukura vs": "Mukura VS",
    "mukura victory sports": "Mukura VS",

    "etincelles fc": "Etincelles FC",

    "amgaju fc": "Amagaju FC",
    "amagaju fc": "Amagaju FC",
    "amagaju": "Amagaju FC",

    "as muhanga": "AS Muhanga",
    "as muhanga fc": "AS Muhanga",

    "kigali fc": "Kigali FC",

    "etoile de l'est": "Etoile de l'Est",
    "etoile de l'est fc": "Etoile de l'Est",

    "al hilal sc": "Al Hilal SC",
    "al hilal": "Al Hilal SC",

    "al merrikh sc": "Al Merrikh SC",
    "al merrikh": "Al Merrikh SC",

    "rutsiro fc": "Rutsiro FC",
  };

  return (
    aliases[lower] ||
    value
  );
}

/* =========================================================
   IMAGE EXTRACTION
========================================================= */

function extractImages(html = "") {
  const images =
    String(html).match(
      /<img\b[^>]*>/gi
    ) || [];

  return images.map((tag) => ({
    tag,

    src: absoluteUrl(
      getImage(tag)
    ),

    alt: normalizeName(
      getAttribute(tag, "alt")
    ),

    title: normalizeName(
      getAttribute(tag, "title")
    ),
  }));
}

function findLogoForTeam(
  html = "",
  teamName = ""
) {
  const source = String(html);

  const images =
    extractImages(source);

  const normalizedTeam =
    normalizeName(teamName).toLowerCase();

  /*
   * 1. Strong match:
   * alt/title contains club name.
   */

  for (const image of images) {
    const alt =
      image.alt.toLowerCase();

    const title =
      image.title.toLowerCase();

    if (
      image.src &&
      (
        alt.includes(normalizedTeam) ||
        title.includes(normalizedTeam)
      )
    ) {
      return image.src;
    }
  }

  /*
   * 2. Search around the club name.
   */

  const index =
    source
      .toLowerCase()
      .indexOf(
        normalizedTeam
      );

  if (index !== -1) {
    const start =
      Math.max(
        0,
        index - 6000
      );

    const end =
      Math.min(
        source.length,
        index + 6000
      );

    const section =
      source.slice(
        start,
        end
      );

    const sectionImages =
      extractImages(
        section
      );

    for (
      const image of sectionImages
    ) {
      if (image.src) {
        return image.src;
      }
    }
  }

  return "";
}

/* =========================================================
   TABLE EXTRACTION
========================================================= */

function extractTeamsFromTable(
  html = ""
) {
  const teams = [];

  const source = String(html);

  /*
   * Try table rows first.
   */

  const rows =
    source.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    ) || [];

  for (const row of rows) {
    /*
     * Team names commonly appear
     * inside links or table cells.
     */

    const links =
      row.match(
        /<a\b[^>]*>[\s\S]*?<\/a>/gi
      ) || [];

    for (const link of links) {
      const text =
        clean(link);

      if (
        isValidClubName(text)
      ) {
        teams.push(text);
      }
    }

    const cells =
      row.match(
        /<td\b[^>]*>[\s\S]*?<\/td>/gi
      ) || [];

    for (const cell of cells) {
      const text =
        clean(cell);

      /*
       * Avoid numbers and huge cell contents.
       */

      if (
        isValidClubName(text) &&
        !/^\d+$/.test(text)
      ) {
        teams.push(text);
      }
    }
  }

  return dedupeTeams(
    teams.map((name) => ({
      name: normalizeKnownClubName(
        name
      ),
    }))
  );
}

/* =========================================================
   SELECT / OPTION EXTRACTION
========================================================= */

function extractTeamsFromOptions(
  html = ""
) {
  const teams = [];

  const options =
    String(html).match(
      /<option\b[^>]*>[\s\S]*?<\/option>/gi
    ) || [];

  for (const option of options) {
    const value =
      clean(
        option
          .replace(
            /<option\b[^>]*>/i,
            ""
          )
          .replace(
            /<\/option>/i,
            ""
          )
      );

    if (
      !isValidClubName(value)
    ) {
      continue;
    }

    teams.push({
      name:
        normalizeKnownClubName(
          value
        ),
    });
  }

  return dedupeTeams(
    teams
  );
}

/* =========================================================
   TEAM LINKS
========================================================= */

function extractTeamsFromLinks(
  html = ""
) {
  const teams = [];

  const links =
    getLinks(html);

  for (const link of links) {
    const text =
      clean(link);

    if (
      !isValidClubName(text)
    ) {
      continue;
    }

    const href =
      absoluteUrl(
        getAttribute(
          link,
          "href"
        )
      );

    const lowerHref =
      href.toLowerCase();

    /*
     * Only trust links that look
     * team/club related.
     */

    const looksLikeTeamLink =
      lowerHref.includes("team") ||
      lowerHref.includes("club") ||
      lowerHref.includes("squad") ||
      lowerHref.includes("standing");

    if (!looksLikeTeamLink) {
      continue;
    }

    teams.push({
      name:
        normalizeKnownClubName(
          text
        ),

      url: href,
    });
  }

  return dedupeTeams(
    teams
  );
}

/* =========================================================
   KNOWN RPL CLUBS FALLBACK
========================================================= */

function getKnownRPLClubs() {
  /*
   * This is a safety fallback.
   *
   * It prevents the admin import page
   * from becoming empty if the RPL website
   * changes its HTML/React rendering.
   */

  return [
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
    "Kiyovu Sports",
    "Marine FC",
    "Mukura VS",
    "Musanze FC",
    "Police FC",
    "Rayon Sports",
    "Sunrise FC",
  ].map((name) => ({
    name,
    source:
      "rwanda-premier-league",
    sourceUrl:
      RPL_TABLE_URL,
  }));
}

/* =========================================================
   LOGO MAP
========================================================= */

function enrichTeams(
  teams,
  html
) {
  return dedupeTeams(
    teams.map((team) => {
      const name =
        normalizeKnownClubName(
          team.name
        );

      const logo =
        team.logo ||
        findLogoForTeam(
          html,
          name
        );

      const shortName =
        createShortName(
          name
        );

      return {
        ...team,

        name,

        shortName,

        logo,

        source:
          "rwanda-premier-league",

        sourceUrl:
          team.url ||
          RPL_TABLE_URL,
      };
    })
  );
}

/* =========================================================
   SHORT NAME
========================================================= */

function createShortName(
  name = ""
) {
  const cleaned =
    normalizeName(name)
      .replace(
        /\bFOOTBALL CLUB\b/gi,
        ""
      )
      .replace(
        /\bFOOTBALL\b/gi,
        ""
      )
      .replace(
        /\bFC\b/gi,
        ""
      )
      .replace(
        /\bSC\b/gi,
        ""
      )
      .trim();

  if (!cleaned) {
    return name
      .slice(0, 12)
      .toUpperCase();
  }

  const words =
    cleaned.split(/\s+/);

  if (words.length === 1) {
    return words[0]
      .slice(0, 12)
      .toUpperCase();
  }

  return words
    .map(
      (word) =>
        word[0]
          ? word[0].toUpperCase()
          : ""
    )
    .join("")
    .slice(0, 8);
}

/* =========================================================
   HTTP FETCH
========================================================= */

async function fetchHtml(
  url
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT);

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",

            "Accept-Language":
              "en-US,en;q=0.9",

            Referer:
              RPL_BASE_URL,
          },

          redirect: "follow",

          signal:
            controller.signal,
        }
      );

    if (!response.ok) {
      throw new Error(
        `RPL returned HTTP ${response.status} for ${url}`
      );
    }

    const html =
      await response.text();

    if (
      !html ||
      html.trim().length < 100
    ) {
      throw new Error(
        `RPL returned an empty HTML response from ${url}`
      );
    }

    return html;
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================
   FETCH MULTIPLE SOURCES
========================================================= */

async function fetchRPLSources() {
  const results = [];

  const urls = [
    RPL_TABLE_URL,
    RPL_HOME_URL,
    RPL_TEAM_URL,
  ];

  for (const url of urls) {
    try {
      const html =
        await fetchHtml(url);

      results.push({
        url,
        html,
      });
    } catch (error) {
      console.error(
        `Failed to fetch ${url}:`,
        error?.message
      );
    }
  }

  return results;
}

/* =========================================================
   API HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  /*
   * Only GET.
   */

  if (req.method !== "GET") {
    res.setHeader(
      "Allow",
      "GET"
    );

    return res.status(405).json({
      success: false,
      message:
        "Method not allowed.",
    });
  }

  try {
    const sources =
      await fetchRPLSources();

    /*
     * We don't immediately fail if
     * one RPL page is unavailable.
     */

    let extractedTeams = [];

    let primaryHtml = "";

    /*
     * =====================================================
     * 1. TABLE PAGE
     * =====================================================
     */

    const tableSource =
      sources.find(
        (item) =>
          item.url ===
          RPL_TABLE_URL
      );

    if (tableSource) {
      primaryHtml =
        tableSource.html;

      const tableTeams =
        extractTeamsFromTable(
          tableSource.html
        );

      extractedTeams.push(
        ...tableTeams
      );

      const optionTeams =
        extractTeamsFromOptions(
          tableSource.html
        );

      extractedTeams.push(
        ...optionTeams
      );

      const linkTeams =
        extractTeamsFromLinks(
          tableSource.html
        );

      extractedTeams.push(
        ...linkTeams
      );
    }

    /*
     * =====================================================
     * 2. HOME PAGE
     * =====================================================
     */

    const homeSource =
      sources.find(
        (item) =>
          item.url ===
          RPL_HOME_URL
      );

    if (homeSource) {
      if (!primaryHtml) {
        primaryHtml =
          homeSource.html;
      }

      extractedTeams.push(
        ...extractTeamsFromTable(
          homeSource.html
        )
      );

      extractedTeams.push(
        ...extractTeamsFromOptions(
          homeSource.html
        )
      );

      extractedTeams.push(
        ...extractTeamsFromLinks(
          homeSource.html
        )
      );
    }

    /*
     * =====================================================
     * 3. TEAM PAGE
     * =====================================================
     */

    const teamSource =
      sources.find(
        (item) =>
          item.url ===
          RPL_TEAM_URL
      );

    if (teamSource) {
      if (!primaryHtml) {
        primaryHtml =
          teamSource.html;
      }

      extractedTeams.push(
        ...extractTeamsFromOptions(
          teamSource.html
        )
      );

      extractedTeams.push(
        ...extractTeamsFromLinks(
          teamSource.html
        )
      );
    }

    /*
     * =====================================================
     * CLEAN + ENRICH
     * =====================================================
     */

    let teams =
      enrichTeams(
        extractedTeams,
        primaryHtml
      );

    /*
     * =====================================================
     * FALLBACK
     * =====================================================
     *
     * If RPL changes its HTML and our
     * parser finds nothing, use the
     * current known RPL membership.
     *
     * This is much better than returning
     * "No clubs returned" while the website
     * visibly contains the clubs.
     */

    let usedFallback = false;

    if (teams.length === 0) {
      teams =
        getKnownRPLClubs();

      usedFallback = true;
    }

    /*
     * =====================================================
     * SORT
     * =====================================================
     */

    teams.sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
          "en",
          {
            sensitivity:
              "base",
          }
        )
    );

    /*
     * =====================================================
     * RESPONSE
     * =====================================================
     */

    return res.status(200).json({
      success: true,

      source:
        RPL_BASE_URL,

      sourceUrl:
        RPL_TABLE_URL,

      season:
        "2026-2027",

      teams,

      count:
        teams.length,

      usedFallback,

      fetchedSources:
        sources.map(
          (item) =>
            item.url
        ),

      fetchedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "RPL clubs API error:",
      error
    );

    /*
     * Even if the external website
     * temporarily fails, return known
     * current clubs instead of making
     * the admin page unusable.
     */

    const fallback =
      getKnownRPLClubs();

    return res.status(200).json({
      success: true,

      source:
        RPL_BASE_URL,

      sourceUrl:
        RPL_TABLE_URL,

      season:
        "2026-2027",

      teams:
        fallback,

      count:
        fallback.length,

      usedFallback: true,

      warning:
        error?.message ||
        "RPL website could not be fetched. Showing known current clubs.",

      fetchedAt:
        new Date().toISOString(),
    });
  }
}
