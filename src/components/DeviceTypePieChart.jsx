import { useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip
} from "recharts";

const renderActiveShape = (props) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 8}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke="#fff"
      strokeWidth={2}
    />
  );
};

export default function DeviceTypePieChart({ data, palette }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const colors =
    palette?.length >= data.length
      ? palette
      : Array.from({ length: data.length }, (_, i) => {
          const hue = Math.round((i * 137.508) % 360);
          return `hsl(${hue}, 62%, 46%)`;
        });

  if (!data.length) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        Upload data to see device types
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ResponsiveContainer width="100%" height={168}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={68}
            paddingAngle={data.length > 12 ? 0.5 : 1}
            minAngle={2}
            stroke="#fff"
            strokeWidth={1}
            isAnimationActive={false}
            activeIndex={activeIndex ?? undefined}
            activeShape={renderActiveShape}
            onMouseEnter={(_, index) => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.label}
                fill={colors[index]}
                stroke="#fff"
                strokeWidth={1}
                opacity={
                  activeIndex === null || activeIndex === index ? 1 : 0.3
                }
                style={{ cursor: "pointer" }}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, item) => [
              `${value} devices (${item.payload.percent}%)`,
              item.payload.label
            ]}
            contentStyle={{
              borderRadius: 12,
              borderColor: "#E2E8F0",
              boxShadow: "0 10px 30px rgba(15, 23, 42, 0.12)"
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
        {data.map((entry, index) => {
          const isActive = activeIndex === index;
          return (
            <button
              key={entry.label}
              type="button"
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                isActive
                  ? "border-emerald-400 bg-emerald-50 font-semibold text-slate-900 ring-2 ring-emerald-200"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-200 hover:bg-white"
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white"
                  style={{
                    backgroundColor: colors[index],
                    boxShadow: isActive
                      ? `0 0 0 2px ${colors[index]}`
                      : undefined
                  }}
                />
                <span className="truncate" title={entry.label}>
                  {entry.label}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {entry.value} · {entry.percent}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
