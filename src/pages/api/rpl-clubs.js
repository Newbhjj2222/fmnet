import { URL } from "url";

const RPL_BASE_URL =
  "https://rwandapremierleague.rw";

const RPL_TEAM_URL =
  `${RPL_BASE_URL}/info/team`;

const REQUEST_TIMEOUT = 20000;

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
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number(code);

      if (!Number.isFinite(number)) {
        return _;
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
      .replace(/<[^>]+>/g, " ")
  );
}

function clean(value = "") {
  return stripHtml(value)
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value) {
  if (!value) {
    return "";
  }

  try {
    return new URL(
      value,
      RPL_BASE_URL
    ).toString();
  } catch {
    return value;
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

  const match =
    String(tag).match(regex);

  return match
    ? decodeHtml(match[1])
    : "";
}

function getImage(tag = "") {
  return (
    getAttribute(tag, "src") ||
    getAttribute(tag, "data-src") ||
    getAttribute(
      tag,
      "data-lazy-src"
    ) ||
    getAttribute(
      tag,
      "data-original"
    ) ||
    ""
  );
}

function toNumber(
  value,
  fallback = 0
) {
  const match = String(
    value || ""
  ).match(
    /-?\d+(?:[.,]\d+)?/
  );

  if (!match) {
    return fallback;
  }

  const number = Number(
    match[0].replace(",", ".")
  );

  return Number.isFinite(number)
    ? number
    : fallback;
}

function extractTeamNames(html) {
  const names = [];

  const options =
    String(html).match(
      /<option\b[^>]*>[\s\S]*?<\/option>/gi
    ) || [];

  for (const option of options) {
    const name = clean(
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

    if (!name) continue;

    const lower =
      name.toLowerCase();

    if (
      lower === "club" ||
      lower === "clubs" ||
      lower === "select" ||
      lower.includes("select club") ||
      lower.includes("select team")
    ) {
      continue;
    }

    if (
      name.length < 2 ||
      name.length > 100
    ) {
      continue;
    }

    names.push(name);
  }

  /*
   * Look for common team-related
   * data attributes.
   */

  const attributeRegex =
    /(?:data-team-name|data-club-name|data-name|title|alt)\s*=\s*["']([^"']+)["']/gi;

  let match;

  while (
    (match =
      attributeRegex.exec(
        String(html)
      ))
  ) {
    const value = clean(
      match[1]
    );

    if (
      value.length >= 2 &&
      value.length <= 100
    ) {
      names.push(value);
    }
  }

  return [
    ...new Set(
      names.map(
        (name) => name.trim()
      )
    ),
  ];
}

function extractTeamLogo(
  html,
  teamName
) {
  const source =
    String(html);

  const index =
    source
      .toLowerCase()
      .indexOf(
        String(
          teamName
        ).toLowerCase()
      );

  let section = source;

  if (index !== -1) {
    section =
      source.slice(
        Math.max(
          0,
          index - 10000
        ),
        Math.min(
          source.length,
          index + 10000
        )
      );
  }

  const images =
    section.match(
      /<img\b[^>]*>/gi
    ) || [];

  /*
   * Prefer images whose alt/title
   * contains the club name.
   */

  for (const image of images) {
    const alt =
      getAttribute(
        image,
        "alt"
      ).toLowerCase();

    const title =
      getAttribute(
        image,
        "title"
      ).toLowerCase();

    const lowerName =
      String(
        teamName
      ).toLowerCase();

    if (
      alt.includes(lowerName) ||
      title.includes(lowerName)
    ) {
      const src =
        absoluteUrl(
          getImage(image)
        );

      if (src) {
        return src;
      }
    }
  }

  /*
   * Otherwise use the nearest useful
   * image.
   */

  for (
    let i =
      images.length - 1;
    i >= 0;
    i--
  ) {
    const src =
      absoluteUrl(
        getImage(
          images[i]
        )
      );

    if (src) {
      return src;
    }
  }

  return "";
}

function extractField(
  html,
  labels = []
) {
  const source =
    String(html);

  for (const label of labels) {
    const escaped =
      String(label).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const regex =
      new RegExp(
        `${escaped}\\s*(?:<[^>]+>\\s*){0,5}([^<]{1,250})`,
        "i"
      );

    const match =
      source.match(regex);

    if (match?.[1]) {
      const value =
        clean(match[1]);

      if (
        value &&
        value.toLowerCase() !==
          label.toLowerCase()
      ) {
        return value;
      }
    }
  }

  return "";
}

function extractEmail(html) {
  const match =
    String(html).match(
      /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i
    );

  return match
    ? match[0]
    : "";
}

function extractPhone(html) {
  const matches =
    String(html).match(
      /(?:\+250\s*)?07\d[\s-]?\d{3}[\s-]?\d{3}/g
    ) || [];

  return matches[0] || "";
}

function extractYear(html) {
  const patterns = [
    /(?:founded|established|est\.?)\s*[:\-]?\s*(\d{4})/i,
    /(\d{4})\s*(?:founded|established)/i,
  ];

  for (const pattern of patterns) {
    const match =
      String(html).match(
        pattern
      );

    if (match) {
      return Number(
        match[1]
      );
    }
  }

  return null;
}

function extractCurrentTeam(
  html
) {
  const source =
    String(html);

  /*
   * Try common heading structures.
   */

  const headingMatches =
    source.match(
      /<h[1-4]\b[^>]*>[\s\S]*?<\/h[1-4]>/gi
    ) || [];

  let teamName = "";

  for (
    const heading of headingMatches
  ) {
    const value =
      clean(heading);

    if (
      value.length >= 2 &&
      value.length <= 100 &&
      !/rwanda premier league/i.test(
        value
      ) &&
      !/club/i.test(value) === false
    ) {
      teamName = value;
      break;
    }
  }

  /*
   * Better fallback from title.
   */

  if (!teamName) {
    const titleMatch =
      source.match(
        /<title\b[^>]*>([\s\S]*?)<\/title>/i
      );

    if (titleMatch) {
      teamName =
        clean(
          titleMatch[1]
            .replace(
              /\|.*$/,
              ""
            )
        );
    }
  }

  if (!teamName) {
    return null;
  }

  const logo =
    extractTeamLogo(
      source,
      teamName
    );

  const founded =
    extractYear(source);

  const email =
    extractEmail(source);

  const phone =
    extractPhone(source);

  const stadium =
    extractField(
      source,
      [
        "Stadium",
        "Home Stadium",
      ]
    );

  const location =
    extractField(
      source,
      [
        "Location",
        "City",
      ]
    );

  const coach =
    extractField(
      source,
      [
        "Head Coach",
        "Coach",
        "Manager",
      ]
    );

  const president =
    extractField(
      source,
      [
        "President",
        "Chairman",
      ]
    );

  const captain =
    extractField(
      source,
      [
        "Captain",
      ]
    );

  const squadSize =
    toNumber(
      extractField(
        source,
        [
          "Squad",
          "Squad Size",
          "Players",
        ]
      ),
      0
    );

  return {
    name: teamName,

    shortName:
      teamName
        .replace(
          /\bFOOTBALL CLUB\b/gi,
          ""
        )
        .replace(
          /\bFC\b/gi,
          ""
        )
        .trim()
        .slice(0, 12),

    logo,

    stadium,
    location,
    founded,

    email,
    phone,

    coach,
    president,
    captain,

    squadSize,

    source:
      "rwanda-premier-league",

    sourceUrl:
      RPL_TEAM_URL,

    sourceClubName:
      teamName,
  };
}

async function fetchHtml() {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      REQUEST_TIMEOUT
    );

  try {
    const response =
      await fetch(
        RPL_TEAM_URL,
        {
          method: "GET",

          headers: {
            Accept:
              "text/html,application/xhtml+xml",

            "User-Agent":
              "Mozilla/5.0 (compatible; VirtualFootballManager/1.0)",
          },

          signal:
            controller.signal,
        }
      );

    if (!response.ok) {
      throw new Error(
        `RPL returned HTTP ${response.status}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message:
        "Method not allowed.",
    });
  }

  try {
    const html =
      await fetchHtml();

    const teamNames =
      extractTeamNames(
        html
      );

    const currentTeam =
      extractCurrentTeam(
        html
      );

    /*
     * Do not pretend that names extracted
     * from generic alt/title attributes
     * are definitely clubs.
     */

    const filteredNames =
      teamNames.filter(
        (name) => {
          const lower =
            name.toLowerCase();

          return (
            !lower.includes(
              "rwanda premier league"
            ) &&
            !lower.includes(
              "read more"
            ) &&
            !lower.includes(
              "home"
            ) &&
            !lower.includes(
              "menu"
            ) &&
            !lower.includes(
              "logo"
            )
          );
        }
      );

    const uniqueNames = [
      ...new Set(
        filteredNames
      ),
    ];

    /*
     * If the page exposes only one team,
     * currentTeam is still returned.
     */

    return res.status(200).json({
      success: true,

      source:
        RPL_TEAM_URL,

      teams:
        uniqueNames.map(
          (name) => ({
            name,
            source:
              "rwanda-premier-league",
            sourceUrl:
              RPL_TEAM_URL,
          })
        ),

      currentTeam,

      count:
        uniqueNames.length,

      fetchedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "RPL clubs fetch error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Unable to fetch RPL clubs.",
    });
  }
}
