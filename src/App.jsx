import { useCallback, useMemo, useState, useRef } from "react";
import Papa from "papaparse";
import {
  AlertCircle,
  CloudUpload,
  Database,
  Download,
  FileUp,
  FlaskConical,
  Loader2,
  Sparkles
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import Chatbot from "./components/Chatbot";
import DeviceTypePieChart from "./components/DeviceTypePieChart";
import {
  getCachedCount,
  getUncachedPairs,
  loadDeviceTypeCache,
  mergeIntoCache
} from "./lib/deviceTypeCache";
import { extractYear } from "./lib/extractYear";
import {
  extractUniquePairs,
  fetchDeviceTypesBatch,
  makePairKey
} from "./services/openai";

export { extractYear } from "./lib/extractYear";

const REQUIRED_COLUMNS = ["manufacturer", "model", "serial_number"];
const ALT_SERIAL_COLUMN = "serial number";

const getMonthFromWeek = (week) => {
  if (!week || Number.isNaN(week)) return null;
  const clamped = Math.max(1, Math.min(week, 53));
  return Math.min(12, Math.ceil(clamped / 4));
};

export const getExperimentalDateParts = (
  manufacturer,
  serialNumber,
  enabled
) => {
  if (!enabled) return null;
  if (!manufacturer || !serialNumber) return null;

  const mfg = manufacturer.toLowerCase();
  const sn = serialNumber.trim().toUpperCase().replace(/[- ()]/g, "");

  if (mfg.includes("jiangmen")) {
    const match = sn.match(/^WU(20\d{2})(\d{2})/);
    if (match) {
      return {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10)
      };
    }
  }

  if (mfg.includes("unico")) {
    const match = sn.match(/(20\d{2})(\d{2})(\d{2})/);
    if (match) {
      return {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10)
      };
    }
  }

  if (mfg.includes("cogentix")) {
    const match = sn.match(/^CS(\d{2})(\d{2})/);
    if (match) {
      return {
        year: 2000 + parseInt(match[1], 10),
        month: parseInt(match[2], 10)
      };
    }
  }

  if (mfg.includes("thermo")) {
    const match = sn.match(/^(\d{2})(\d{2})/);
    if (match) {
      const year = 2000 + parseInt(match[1], 10);
      const week = parseInt(match[2], 10);
      return {
        year,
        month: getMonthFromWeek(week),
        week
      };
    }
  }

  if (mfg.includes("exergen")) {
    const match = sn.match(/^A(\d{2})(\d{2})/);
    if (match) {
      const year = 2000 + parseInt(match[1], 10);
      const week = parseInt(match[2], 10);
      return {
        year,
        month: getMonthFromWeek(week),
        week
      };
    }
  }

  return null;
};

const riskTone = {
  Red: "bg-rose-100 text-rose-700 border-rose-200",
  Yellow: "bg-amber-100 text-amber-700 border-amber-200",
  Green: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Unknown: "bg-slate-100 text-slate-600 border-slate-200"
};

const getRiskStatus = (age) => {
  if (typeof age !== "number") return "Unknown";
  if (age > 10) return "Red";
  if (age >= 5) return "Yellow";
  return "Green";
};

const formatManufacturedDisplay = (row, experimentalEnabled) => {
  if (experimentalEnabled && row.experimental) {
    const { year, month, day, week } = row.experimental;
    if (year && month && day) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (year && month) {
      const base = `${year}-${String(month).padStart(2, "0")}`;
      return week ? `${base} (wk ${week})` : base;
    }
    if (year) return String(year);
  }
  return row.manufactured_date ?? "Unknown";
};

const enrichRowLocally = (normalized, experimentalEnabled) => {
  const { manufacturer, model, serial_number: serialNumber } = normalized;
  const manufactured_date = extractYear(manufacturer, serialNumber, model);
  const age =
    typeof manufactured_date === "number" ? 2026 - manufactured_date : "Unknown";
  const risk_status = getRiskStatus(age);
  const experimental = getExperimentalDateParts(
    manufacturer,
    serialNumber,
    experimentalEnabled
  );

  return {
    ...normalized,
    manufactured_date,
    age,
    risk_status,
    device_type: "Classifying...",
    mfg_date_known: manufactured_date !== "Unknown",
    ...(experimentalEnabled && experimental ? { experimental } : {})
  };
};

function aggregateTopCounts(rows, keyFn, limit = 12) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export default function App() {
  const [rawRows, setRawRows] = useState([]);
  const [enrichedRows, setEnrichedRows] = useState([]);
  const [deviceTypeMap, setDeviceTypeMap] = useState(() => loadDeviceTypeCache());
  const [uniquePairCount, setUniquePairCount] = useState(0);
  const [cachedPairCount, setCachedPairCount] = useState(0);
  const deviceTypeCacheRef = useRef(loadDeviceTypeCache());
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [experimentalEnabled, setExperimentalEnabled] = useState(false);

  const normalizeRow = (row) => {
    const manufacturer = row.manufacturer?.trim() || "";
    const model = row.model?.trim() || "";
    const serialNumber =
      row.serial_number?.trim() || row[ALT_SERIAL_COLUMN]?.trim() || "";

    return { manufacturer, model, serial_number: serialNumber };
  };

  const applyDeviceTypeMap = useCallback(
    (rows, typeMap, experimentalEnabledFlag) => {
      return rows.map((row) => {
        const key = makePairKey(row.manufacturer, row.model);
        const device_type =
          typeMap[key] || typeMap[key.toLowerCase()] || "Unclassified";
        const base = enrichRowLocally(
          {
            manufacturer: row.manufacturer,
            model: row.model,
            serial_number: row.serial_number
          },
          experimentalEnabledFlag
        );
        return { ...base, device_type };
      });
    },
    []
  );

  const runBatchEnrichment = async (rows, experimentalFlag) => {
    setAiError("");

    const normalizedRows = rows.map(normalizeRow);
    const locallyEnriched = normalizedRows.map((r) =>
      enrichRowLocally(r, experimentalFlag)
    );
    setEnrichedRows(locallyEnriched);

    const uniquePairs = extractUniquePairs(normalizedRows);
    setUniquePairCount(uniquePairs.length);

    const cache = deviceTypeCacheRef.current;
    const fromCache = getCachedCount(uniquePairs, cache);
    const uncachedPairs = getUncachedPairs(uniquePairs, cache);
    setCachedPairCount(fromCache);

    if (uncachedPairs.length === 0) {
      setEnrichedRows(
        applyDeviceTypeMap(normalizedRows, cache, experimentalFlag)
      );
      return;
    }

    setIsAiLoading(true);
    try {
      const freshMap = await fetchDeviceTypesBatch(uncachedPairs);
      const merged = mergeIntoCache(cache, freshMap);
      deviceTypeCacheRef.current = merged;
      setDeviceTypeMap(merged);
      setCachedPairCount(uniquePairs.length - uncachedPairs.length);
      setEnrichedRows(
        applyDeviceTypeMap(normalizedRows, merged, experimentalFlag)
      );
    } catch (err) {
      setAiError(err.message || "AI batch classification failed.");
      setEnrichedRows(
        normalizedRows.map((r) => ({
          ...enrichRowLocally(r, experimentalFlag),
          device_type: "Classification failed"
        }))
      );
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    setError("");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const fields = result.meta.fields || [];
        const hasAllColumns = REQUIRED_COLUMNS.every(
          (column) => fields.includes(column) || column === "serial_number"
        );
        const hasSerialColumn =
          fields.includes("serial_number") || fields.includes(ALT_SERIAL_COLUMN);

        if (!hasAllColumns || !hasSerialColumn) {
          setError(
            "CSV must include manufacturer, model, and serial number columns."
          );
          return;
        }

        setRawRows(result.data);
        runBatchEnrichment(result.data, experimentalEnabled);
      },
      error: () => setError("Could not parse the file. Please try again.")
    });
  };

  const handleExperimentalToggle = () => {
    const next = !experimentalEnabled;
    setExperimentalEnabled(next);
    if (rawRows.length) {
      if (Object.keys(deviceTypeMap).length) {
        setEnrichedRows(
          applyDeviceTypeMap(
            rawRows.map(normalizeRow),
            deviceTypeMap,
            next
          )
        );
      } else {
        setEnrichedRows(rawRows.map((r) => enrichRowLocally(normalizeRow(r), next)));
      }
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    handleFile(event.dataTransfer.files?.[0]);
  };

  const sortedRows = useMemo(() => {
    return [...enrichedRows].sort((a, b) => {
      const left =
        typeof a.manufactured_date === "number" ? a.manufactured_date : Infinity;
      const right =
        typeof b.manufactured_date === "number" ? b.manufactured_date : Infinity;
      return left - right;
    });
  }, [enrichedRows]);

  const riskData = useMemo(() => {
    const summary = { Red: 0, Yellow: 0, Green: 0, Unknown: 0 };
    enrichedRows.forEach((row) => {
      if (summary[row.risk_status] !== undefined) summary[row.risk_status] += 1;
    });
    return Object.entries(summary).map(([label, value]) => ({ label, value }));
  }, [enrichedRows]);

  const deviceTypeData = useMemo(() => {
    const counts = new Map();
    sortedRows.forEach((row) => {
      const key = row.device_type || "Unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const total = sortedRows.length || 1;
    return Array.from(counts.entries())
      .map(([label, value]) => ({
        label,
        value,
        percent: Math.round((value / total) * 100)
      }))
      .sort((a, b) => b.value - a.value);
  }, [sortedRows]);

  const manufacturerData = useMemo(
    () => aggregateTopCounts(enrichedRows, (r) => r.manufacturer || "Unknown", 14),
    [enrichedRows]
  );

  const uniqueProductData = useMemo(
    () =>
      aggregateTopCounts(
        enrichedRows,
        (r) => makePairKey(r.manufacturer, r.model),
        999
      ),
    [enrichedRows]
  );

  const yearData = useMemo(() => {
    const counts = new Map();
    enrichedRows.forEach((row) => {
      const y =
        typeof row.manufactured_date === "number"
          ? String(row.manufactured_date)
          : "Unknown";
      counts.set(y, (counts.get(y) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => {
        if (a.label === "Unknown") return 1;
        if (b.label === "Unknown") return -1;
        return Number(a.label) - Number(b.label);
      });
  }, [enrichedRows]);

  const mfgKnownData = useMemo(() => {
    let known = 0;
    let unknown = 0;
    enrichedRows.forEach((row) => {
      if (row.mfg_date_known) known += 1;
      else unknown += 1;
    });
    return [
      { label: "Known year", value: known },
      { label: "Unknown year", value: unknown }
    ];
  }, [enrichedRows]);

  const chatContext = useMemo(() => {
    if (!enrichedRows.length) return "No data loaded yet.";
    const risk = riskData.map((r) => `${r.label}: ${r.value}`).join(", ");
    const topMfg = manufacturerData
      .slice(0, 5)
      .map((m) => `${m.label} (${m.value})`)
      .join(", ");
    const topTypes = deviceTypeData
      .slice(0, 5)
      .map((d) => `${d.label} (${d.value})`)
      .join(", ");
    return [
      `Total rows: ${enrichedRows.length}`,
      `Unique manufacturer|model pairs sent to AI: ${uniquePairCount}`,
      `Risk distribution: ${risk}`,
      `Top manufacturers: ${topMfg}`,
      `Device types: ${topTypes}`,
      `Known manufacture years: ${mfgKnownData[0]?.value ?? 0}`,
      `Unknown manufacture years: ${mfgKnownData[1]?.value ?? 0}`,
      `Experimental month/day mode: ${experimentalEnabled ? "on" : "off"}`
    ].join("\n");
  }, [
    enrichedRows.length,
    riskData,
    manufacturerData,
    deviceTypeData,
    mfgKnownData,
    uniquePairCount,
    experimentalEnabled
  ]);

  const devicePalette = useMemo(() => {
    const count = Math.max(deviceTypeData.length, 1);
    return Array.from({ length: count }, (_, i) => {
      const hue = Math.round((i * 137.508) % 360);
      return `hsl(${hue}, 62%, 46%)`;
    });
  }, [deviceTypeData.length]);

  const handleExport = () => {
    if (!sortedRows.length) return;
    const exportRows = sortedRows.map((row) => ({
      manufacturer: row.manufacturer,
      model: row.model,
      serial_number: row.serial_number,
      manufactured_date:
        typeof row.manufactured_date === "number"
          ? row.manufactured_date
          : "Unknown",
      device_type: row.device_type
    }));
    const csv = Papa.unparse(exportRows, {
      columns: [
        "manufacturer",
        "model",
        "serial_number",
        "manufactured_date",
        "device_type"
      ]
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "enriched_equipment.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 shadow-sm shadow-emerald-200/70 animate-float">
              <Database className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">
                Equiply Enrichment
              </p>
              <h1 className="text-3xl font-semibold text-slate-900">
                Medical Equipment Data Pipeline
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">
              <FlaskConical className="h-4 w-4" />
              <span>Experimental date (month/day)</span>
              <button
                type="button"
                role="switch"
                aria-checked={experimentalEnabled}
                onClick={handleExperimentalToggle}
                className={`relative h-6 w-11 rounded-full transition ${
                  experimentalEnabled ? "bg-amber-500" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                    experimentalEnabled ? "left-5" : "left-0.5"
                  }`}
                />
              </button>
            </label>
            <button
              onClick={handleExport}
              disabled={!sortedRows.length}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-50"
            >
              Export enriched file
              <Download className="h-4 w-4" />
            </button>
          </div>
        </header>

        {isAiLoading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            <Loader2 className="h-5 w-5 animate-spin" />
            AI batch processing: classifying {uniquePairCount - cachedPairCount}{" "}
            new pair{uniquePairCount - cachedPairCount === 1 ? "" : "s"}
            {cachedPairCount > 0
              ? ` (${cachedPairCount} from cache)`
              : ""}{" "}
            — single API call…
          </div>
        ) : null}

        {aiError ? (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {aiError}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card animate-fade-in">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Upload intake</h2>
                <p className="text-sm text-slate-500">
                  Unique batch mapping: one OpenAI call for all distinct pairs.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <FileUp className="h-4 w-4" />
                CSV only
              </span>
            </div>

            {rawRows.length === 0 ? (
              <div
                className={`mt-6 flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-6 text-center transition ${
                  dragActive
                    ? "border-emerald-400 bg-emerald-50 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]"
                    : "border-slate-200 bg-slate-50"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 animate-pulse">
                  <CloudUpload className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Drag and drop your CSV file
                  </h3>
                  <p className="text-sm text-slate-500">
                    Try challenge_data-v1.csv — 801 rows, ~55 unique pairs.
                  </p>
                </div>
                <label className="cursor-pointer rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300">
                  Select file
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                </label>
                {error ? (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    Rows: {rawRows.length}
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Unique pairs: {uniquePairCount}
                    {cachedPairCount > 0 ? ` (${cachedPairCount} cached)` : ""}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/60 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <Sparkles className="h-4 w-4" />
                    {isAiLoading ? "AI classifying batch…" : "Enrichment complete"}
                  </span>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <div
                    className={`grid gap-4 bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 ${
                      experimentalEnabled
                        ? "grid-cols-[1.2fr_0.9fr_1fr_1fr_0.6fr_0.7fr_1fr]"
                        : "grid-cols-[1.4fr_1fr_1fr_0.9fr_0.7fr_0.8fr_1fr]"
                    }`}
                  >
                    <span>Manufacturer</span>
                    <span>Model</span>
                    <span>Serial</span>
                    <span>{experimentalEnabled ? "Date (exp.)" : "Manufactured"}</span>
                    <span>Age</span>
                    <span>Risk</span>
                    <span>Device type</span>
                  </div>
                  <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-100">
                    {sortedRows.map((row, index) => (
                      <div
                        key={`${row.serial_number}-${index}`}
                        className={`grid gap-4 px-4 py-3 text-sm text-slate-700 ${
                          experimentalEnabled
                            ? "grid-cols-[1.2fr_0.9fr_1fr_1fr_0.6fr_0.7fr_1fr]"
                            : "grid-cols-[1.4fr_1fr_1fr_0.9fr_0.7fr_0.8fr_1fr]"
                        }`}
                      >
                        <span className="font-medium text-slate-900">
                          {row.manufacturer || "-"}
                        </span>
                        <span>{row.model || "-"}</span>
                        <span className="font-mono text-xs text-slate-500">
                          {row.serial_number || "-"}
                        </span>
                        <span>
                          {formatManufacturedDisplay(row, experimentalEnabled)}
                        </span>
                        <span>{row.age ?? "-"}</span>
                        <span>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold ${
                              riskTone[row.risk_status]
                            }`}
                          >
                            {row.risk_status}
                          </span>
                        </span>
                        <span className="text-xs text-slate-600">
                          {isAiLoading ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {row.device_type}
                            </span>
                          ) : (
                            row.device_type
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <ChartCard title="Risk snapshot" subtitle="Aging device exposure">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={riskData} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="label" tick={{ fill: "#64748B", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#64748B", fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#10B981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Device type mix"
              subtitle="Hover slice or label to highlight"
            >
              <DeviceTypePieChart data={deviceTypeData} palette={devicePalette} />
            </ChartCard>

            <ChartCard title="Known vs unknown MFD" subtitle="Year extracted from serial">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={mfgKnownData}
                    dataKey="value"
                    nameKey="label"
                    outerRadius={60}
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    <Cell fill="#10B981" />
                    <Cell fill="#94A3B8" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </section>

        {enrichedRows.length > 0 ? (
          <section className="grid gap-6 md:grid-cols-2">
            <ChartCard
              title="Products by manufacture year"
              subtitle="Count per extracted year"
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={yearData} barSize={24}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#64748B", fontSize: 10 }}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis allowDecimals={false} tick={{ fill: "#64748B" }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#38BDF8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Top manufacturers"
              subtitle="Row counts by company"
            >
              <ResponsiveContainer
                width="100%"
                height={Math.max(280, manufacturerData.length * 26)}
              >
                <BarChart
                  data={manufacturerData}
                  layout="vertical"
                  barSize={16}
                  margin={{ left: 8, right: 12, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={150}
                    interval={0}
                    tick={{ fill: "#64748B", fontSize: 10 }}
                  />
                  <Tooltip />
                  <Bar dataKey="value" fill="#14B8A6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="md:col-span-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
              <h3 className="text-lg font-semibold text-slate-900">
                Unique products (manufacturer + model)
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Distinct SKU combinations and how many assets use each.
              </p>
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                <div className="grid grid-cols-[2fr_0.6fr] gap-4 bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <span>Product</span>
                  <span className="text-right">Count</span>
                </div>
                <div className="max-h-[280px] overflow-y-auto divide-y divide-slate-100">
                  {uniqueProductData.map((item) => (
                    <div
                      key={item.label}
                      className="grid grid-cols-[2fr_0.6fr] gap-4 px-4 py-2.5 text-sm"
                    >
                      <span className="text-slate-700">{item.label}</span>
                      <span className="text-right font-semibold text-slate-900">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <Chatbot
        dataContext={chatContext}
        disabled={!enrichedRows.length || isAiLoading}
      />
    </div>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card animate-fade-in">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <h3 className="mt-1 text-lg font-semibold text-slate-900">{subtitle}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}
