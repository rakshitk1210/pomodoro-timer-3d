import React, { useEffect, useRef, useState } from "react";
import { PencilIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { fmtClock, fmtDuration } from "@/lib/time";

/* one accent per timer, so a glance at the day shows which object was used */
const TINT = {
  "time-timer": { bg: "oklch(0.955 0.035 145)", bar: "oklch(0.62 0.11 148)" },
  cassette: { bg: "oklch(0.955 0.035 75)", bar: "oklch(0.66 0.12 68)" },
  hourglass: { bg: "oklch(0.955 0.035 265)", bar: "oklch(0.62 0.11 268)" },
};
const FALLBACK = { bg: "oklch(0.96 0 0)", bar: "oklch(0.6 0 0)" };

export default function SessionBlock({
  block,
  onRename,
  editing,
  onEdit,
  onEndEdit,
}) {
  const { session, from, till, ms, top, height, live, nudged } = block;
  const [text, setText] = useState(session.name);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      setText(session.name);
      inputRef.current?.select();
    }
  }, [editing, session.name]);

  const tint = TINT[session.timerId] || FALLBACK;
  /* 15px title + 13px detail + 3px padding: below that only the name fits */
  const roomy = height >= 31;

  const commit = () => {
    const next = text.trim();
    if (next && next !== session.name) onRename(session.id, next);
    onEndEdit();
  };

  return (
    <div
      className={cn(
        "group absolute left-0 right-2 overflow-hidden rounded-md py-px pl-2 pr-1.5 text-left",
        live && "animate-pulse"
      )}
      style={{
        top,
        height,
        background: tint.bg,
        boxShadow: `inset 3px 0 0 0 ${tint.bar}`,
        borderBottom:
          session.status === "stopped"
            ? `1px dashed ${tint.bar}`
            : "1px solid transparent",
      }}
      title={`${session.name} · ${fmtClock(from)} – ${fmtClock(till)} · ${fmtDuration(ms)}`}
    >
      {editing ? (
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            /* Escape is handled by the Sheet, which owns `editing`: Radix
               listens for it on document in the capture phase, so a handler
               here could never stop the drawer closing along with the edit. */
          }}
          className="h-4 border-0 bg-white/80 px-1 py-0 text-[11px] leading-4 shadow-none focus-visible:ring-1"
        />
      ) : (
        <button
          type="button"
          onClick={() => onEdit(session.id)}
          className="flex w-full items-center gap-1 text-left"
        >
          <span className="truncate text-[11px] font-medium leading-[15px]">
            {session.name}
          </span>
          <PencilIcon className="size-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-45" />
        </button>
      )}

      {roomy && !editing && (
        <div className="tab truncate text-[10px] leading-[13px] opacity-55">
          {fmtClock(from)} – {fmtClock(till)}
          <span className="opacity-70"> · {fmtDuration(ms)}</span>
          {live && <span className="opacity-70"> · running</span>}
        </div>
      )}

      {/* the min-height clamp pushed this block down off its true time */}
      {nudged && (
        <span
          className="absolute -left-1 top-0 h-full w-px opacity-40"
          style={{ background: tint.bar }}
        />
      )}
    </div>
  );
}
