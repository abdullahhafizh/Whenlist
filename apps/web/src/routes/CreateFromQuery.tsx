import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import Button from "../ui/Button";
import PageLoader from "../ui/PageLoader";
import {
  decodeShareParam,
  parseShareClipboard,
  readShareClipboard,
} from "../shareItem";
import {
  banner,
  btn,
  card,
  field,
  fieldMono,
  label,
  pageTitle,
} from "../ui/styles";

export default function CreateFromQuery() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialQ = params.get("q") ?? "";
  const initialItemParam = params.get("item") ?? "";

  const [text, setText] = useState(initialQ);
  const [labelValue, setLabelValue] = useState("");
  const [formula, setFormula] = useState("");
  const [completionMode, setCompletionMode] = useState<
    "once" | "while_valid"
  >("while_valid");
  const [allowRemind, setAllowRemind] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedOnce, setParsedOnce] = useState(false);
  const [fromShare, setFromShare] = useState(false);

  const applyShared = (payload: {
    label: string;
    formula: string;
    completionMode: "once" | "while_valid";
    allowRemind?: boolean;
  }) => {
    setLabelValue(payload.label);
    setFormula(payload.formula);
    setCompletionMode(payload.completionMode);
    setAllowRemind(Boolean(payload.allowRemind));
    setExplanation("Shared item loaded — review and save.");
    setFromShare(true);
    setParsedOnce(true);
    setError(null);
  };

  const runParse = async (source: string) => {
    const trimmed = source.trim();
    if (!trimmed) {
      setError("Enter what you want on the checklist.");
      return;
    }
    // Clipboard / share paste into the request box
    const shared = parseShareClipboard(trimmed);
    if (shared) {
      applyShared(shared);
      return;
    }
    setParsing(true);
    setError(null);
    setExplanation(null);
    setFromShare(false);
    try {
      const result = await api.parseNl(trimmed);
      setLabelValue(result.label);
      setFormula(result.formula);
      setCompletionMode(result.completionMode);
      setAllowRemind(result.allowRemind);
      setExplanation(result.explanation || null);
      setParsedOnce(true);
    } catch (e) {
      const err = e as Error & {
        partial?: {
          label: string;
          formula: string;
          completionMode: "once" | "while_valid";
          allowRemind: boolean;
          explanation?: string;
        };
      };
      if (err.partial) {
        setLabelValue(err.partial.label);
        setFormula(err.partial.formula);
        setCompletionMode(err.partial.completionMode);
        setAllowRemind(err.partial.allowRemind);
        setExplanation(err.partial.explanation || null);
      }
      setError(err.message);
      setParsedOnce(true);
    } finally {
      setParsing(false);
    }
  };

  useEffect(() => {
    if (initialItemParam) {
      const decoded = decodeShareParam(initialItemParam);
      if (decoded) {
        applyShared(decoded);
        return;
      }
      setError("This share link is invalid or outdated.");
      return;
    }
    if (initialQ.trim()) {
      void runParse(initialQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once from URL
  }, []);

  const remindAllowed = !(completionMode === "once" && !formula.trim());

  useEffect(() => {
    if (!remindAllowed && allowRemind) setAllowRemind(false);
  }, [remindAllowed, allowRemind]);

  const pasteFromClipboard = async () => {
    setPasting(true);
    setError(null);
    try {
      const payload = await readShareClipboard();
      if (!payload) {
        setError(
          "No Whenlist item in clipboard. Copy an item first (hold → Copy).",
        );
        return;
      }
      applyShared(payload);
    } catch (e) {
      setError((e as Error).message || "Could not read clipboard");
    } finally {
      setPasting(false);
    }
  };

  const save = async () => {
    if (!labelValue.trim()) {
      setError("Label is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { item } = await api.createItem({
        label: labelValue.trim(),
        formula: formula.trim(),
        completionMode,
        allowRemind: allowRemind && remindAllowed,
      });
      navigate(`/builder/${encodeURIComponent(item.id)}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative mx-auto max-w-lg space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={pageTitle}>
            {fromShare ? "Import shared item" : "Create from text"}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {fromShare
              ? "Review the name, schedule, and formula, then save."
              : "Describe an item in everyday language — or paste a shared Whenlist item."}
          </p>
        </div>
        <button
          type="button"
          className={`${btn.secondarySm} shrink-0`}
          disabled={pasting || parsing || saving}
          onClick={() => void pasteFromClipboard()}
        >
          {pasting ? "…" : "Paste"}
        </button>
      </div>

      {parsing && !parsedOnce ? (
        <PageLoader label="Parsing…" />
      ) : (
        <>
          {(parsing || saving) && (
            <PageLoader overlay label={saving ? "Saving…" : "Parsing…"} />
          )}

          {!fromShare && (
            <>
              <label className="block space-y-1.5">
                <span className={label}>Request</span>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  placeholder='e.g. "bayar listrik tiap tanggal 25" — or paste a shared item'
                  className={`${field} shadow-sm`}
                />
              </label>

              <Button
                className="w-full"
                disabled={parsing || saving || !text.trim()}
                onClick={() => void runParse(text)}
              >
                {parsing ? "Parsing…" : "Parse with AI"}
              </Button>
            </>
          )}

          {error && <p className={banner.error}>{error}</p>}

          {explanation && <p className={banner.info}>{explanation}</p>}

          {(parsedOnce || labelValue || formula) && (
            <div className={`${card} space-y-4 p-4`}>
              <label className="block space-y-1.5">
                <span className={label}>Label</span>
                <input
                  value={labelValue}
                  onChange={(e) => setLabelValue(e.target.value)}
                  className={field}
                />
              </label>

              <label className="block space-y-1.5">
                <span className={label}>Formula</span>
                <textarea
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  className={fieldMono}
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={completionMode === "once"}
                  onChange={(e) =>
                    setCompletionMode(
                      e.target.checked ? "once" : "while_valid",
                    )
                  }
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600/30"
                />
                Always visible (completion mode once)
              </label>

              <label
                className={`flex items-center gap-2 text-sm ${
                  remindAllowed ? "text-slate-700" : "text-slate-400"
                }`}
                title={
                  remindAllowed
                    ? undefined
                    : "Auto remind needs a formula window (not once forever with empty formula)"
                }
              >
                <input
                  type="checkbox"
                  checked={allowRemind && remindAllowed}
                  disabled={!remindAllowed}
                  onChange={(e) => setAllowRemind(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600/30 disabled:opacity-50"
                />
                Allow remind before due
              </label>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="flex-1"
                  disabled={saving || parsing || !labelValue.trim()}
                  onClick={() => void save()}
                >
                  {saving
                    ? "Saving…"
                    : fromShare
                      ? "Save imported item"
                      : "Save item"}
                </Button>
                <Link to="/builder" className={btn.secondary}>
                  Open builder
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
