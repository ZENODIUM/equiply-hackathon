/**
 * Philips DE-prefix: digit immediately after DE.
 * 5–8 for IntelliVue MP / MP30 / MP50 / M3002A (2005–2008).
 * 3–4 for newer MX500 line (2013–2014) seen in dataset.
 */
const PHILIPS_DE_YEAR_DIGIT = {
  3: 2013,
  4: 2014,
  5: 2005,
  6: 2006,
  7: 2007,
  8: 2008
};

/** Philips MX40 (no DE): leading digit → year */
const PHILIPS_MX40_YEAR_DIGIT = {
  2: 2012,
  3: 2013
};

/** Mindray ePM12MA: AH9- + year digit after AH9 */
const MINDRAY_EPM_YEAR_DIGIT = {
  2: 2022,
  3: 2023
};

const mapTwoDigitYear = (yy) => {
  if (yy >= 0 && yy <= 26) return 2000 + yy;
  if (yy >= 50 && yy <= 99) return 1900 + yy;
  return null;
};

const extractPhilipsYear = (sn, model) => {
  const modelUp = (model || "").toUpperCase();

  if (sn.startsWith("DE")) {
    const digit = parseInt(sn.charAt(2), 10);
    if (PHILIPS_DE_YEAR_DIGIT[digit] !== undefined) {
      return PHILIPS_DE_YEAR_DIGIT[digit];
    }
  }

  if (modelUp.includes("MX40")) {
    const digit = parseInt(sn.charAt(0), 10);
    if (PHILIPS_MX40_YEAR_DIGIT[digit] !== undefined) {
      return PHILIPS_MX40_YEAR_DIGIT[digit];
    }
  }

  // MP50 / other IntelliVue without DE prefix (e.g. 82061692 → 8 = 2008)
  if (!sn.startsWith("DE")) {
    const digit = parseInt(sn.charAt(0), 10);
    if (PHILIPS_DE_YEAR_DIGIT[digit] !== undefined) {
      return PHILIPS_DE_YEAR_DIGIT[digit];
    }
  }

  return null;
};

const extractGeYear = (sn) => {
  const rt = sn.match(/^RT[S9](\d{2})/);
  if (rt) return 2000 + parseInt(rt[1], 10);

  const sa = sn.match(/^SA3(\d{2})/);
  if (sa) return 2000 + parseInt(sa[1], 10);

  const spx = sn.match(/^SPX(\d{2})/);
  if (spx) return 2000 + parseInt(spx[1], 10);

  return null;
};

/** Baxter Spectrum IQ: leading two digits encode year (37 → 2017, 38 → 2018) */
const extractBaxterYear = (sn) => {
  const match = sn.match(/^(\d{2})/);
  if (!match) return null;
  const prefix = parseInt(match[1], 10);
  if (prefix >= 30 && prefix <= 45) return 2000 + (prefix - 20);
  return null;
};

/** ARJO Flowtron: 21 + plant code + YY at positions 5–6 (1-based) */
const extractArjoYear = (sn) => {
  const match = sn.match(/^21\d{2}(\d{2})/);
  if (!match) return null;
  return mapTwoDigitYear(parseInt(match[1], 10));
};

/**
 * Olympus CV-190: 75 prefix, next two digits encode year.
 * 00–26 → 2000–2026; 40–59 → 2010–2029 (e.g. 50 → 2010).
 */
const extractOlympusYear = (sn) => {
  const match = sn.match(/^75(\d{2})/);
  if (!match) return null;
  const yy = parseInt(match[1], 10);
  if (yy <= 26) return 2000 + yy;
  if (yy >= 40 && yy <= 59) return 2000 + (yy - 40);
  return null;
};

const extractMindrayYear = (sn, model) => {
  const modelUp = (model || "").toUpperCase();
  if (!modelUp.includes("EPM12MA")) return null;

  const match = sn.match(/^AH9([23])/);
  if (!match) return null;
  return MINDRAY_EPM_YEAR_DIGIT[parseInt(match[1], 10)] ?? null;
};

export function extractYear(manufacturer, serialNumber, model = "") {
  if (!serialNumber) return "Unknown";

  const mfg = manufacturer.trim().toLowerCase();
  const sn = serialNumber.trim().toUpperCase().replace(/[- ()]/g, "");

  if (mfg.includes("philips")) {
    const year = extractPhilipsYear(sn, model);
    if (year !== null) return year;
  }

  if (mfg.includes("jiangmen")) {
    const match = sn.match(/WU(20\d{2})/);
    if (match) return parseInt(match[1], 10);
  }

  if (mfg.includes("stryker") || mfg.includes("linet")) {
    if (sn.startsWith("20")) return parseInt(sn.substring(0, 4), 10);
  }

  if (mfg.includes("unico")) {
    const match = sn.match(/(20\d{2})/);
    if (match) return parseInt(match[1], 10);
  }

  if (mfg.includes("edan") || mfg.includes("masimo")) {
    const match = sn.match(/[MK](\d{2})/);
    if (match) return 2000 + parseInt(match[1], 10);
  }

  if (mfg.includes("zoll")) {
    const match = sn.match(/^[0-9]*[A-Z]+(\d{2})/);
    if (match) return 2000 + parseInt(match[1], 10);
  }

  if (mfg.includes("hill")) {
    const suffixMatch = sn.match(/(19\d{2}|20\d{2})$/);
    if (suffixMatch) return parseInt(suffixMatch[1], 10);

    const prefixMatch = sn.match(/^[A-Z](\d{2})/);
    if (prefixMatch) return 2000 + parseInt(prefixMatch[1], 10);
  }

  if (mfg.includes("exergen")) {
    if (sn.startsWith("20")) return parseInt(sn.substring(0, 4), 10);
    const match = sn.match(/^A(\d{2})/);
    if (match) return 2000 + parseInt(match[1], 10);
  }

  // Welch Allyn: only A/20-prefix patterns; SURETEMPPLUS has no decode rule
  if (mfg.includes("welch")) {
    const modelUp = (model || "").toUpperCase();
    if (!modelUp.includes("SURETEMPPLUS")) {
      if (sn.startsWith("20")) return parseInt(sn.substring(0, 4), 10);
      const match = sn.match(/^A(\d{2})/);
      if (match) return 2000 + parseInt(match[1], 10);
    }
  }

  if (mfg.includes("cogentix")) {
    const match = sn.match(/^CS(\d{2})/);
    if (match) return 2000 + parseInt(match[1], 10);
  }

  if (mfg.includes("covidien")) {
    const match = sn.match(/^VL(\d{2})/);
    if (match) return 2000 + parseInt(match[1], 10);
  }

  if (mfg.includes("ge health")) {
    const year = extractGeYear(sn);
    if (year !== null) return year;
  }

  if (mfg.includes("mindray")) {
    const year = extractMindrayYear(sn, model);
    if (year !== null) return year;
    return "Unknown";
  }

  if (mfg.includes("baxter")) {
    const year = extractBaxterYear(sn);
    if (year !== null) return year;
  }

  if (mfg.includes("olympus")) {
    const year = extractOlympusYear(sn);
    if (year !== null) return year;
  }

  if (mfg.includes("arjo")) {
    const year = extractArjoYear(sn);
    if (year !== null) return year;
  }

  if (mfg.includes("hospira")) {
    const match = sn.match(/^(\d{2})/);
    if (match) {
      const mapped = mapTwoDigitYear(parseInt(match[1], 10));
      if (mapped !== null) return mapped;
    }
  }

  if (mfg.includes("thermo") || mfg.includes("lab corp") || mfg.includes("biosonic")) {
    const match = sn.match(/^(\d{2})/);
    if (match) {
      const mapped = mapTwoDigitYear(parseInt(match[1], 10));
      if (mapped !== null) return mapped;
    }
  }

  if (mfg.includes("american")) {
    const match = sn.match(/^C?(\d{2})/);
    if (match) {
      const mapped = mapTwoDigitYear(parseInt(match[1], 10));
      if (mapped !== null) return mapped;
    }
  }

  return "Unknown";
}
