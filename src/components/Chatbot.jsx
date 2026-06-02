import { useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { askDataAssistant } from "../services/openai";

export default function Chatbot({ dataContext, disabled }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Ask me about manufacturers, device types, risk levels, years, or anything in your uploaded dataset."
    }
  ]);
  const [loading, setLoading] = useState(false);

  const send = async () => {
    const question = input.trim();
    if (!question || loading || disabled) return;

    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "" }
    ]);
    setLoading(true);

    try {
      const answer = await askDataAssistant(question, dataContext);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: answer };
        return next;
      });
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: `Sorry, I could not reach the assistant. ${err.message}`
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-700"
        aria-label="Open data assistant"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open ? (
        <div className="fixed bottom-24 right-6 z-50 flex h-[420px] w-[min(100vw-2rem,380px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Data assistant</p>
            <p className="text-xs text-slate-500">Context-aware Q&amp;A on your upload</p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((msg, i) => (
              <div
                key={`${msg.role}-${i}`}
                className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "ml-auto bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {msg.content ||
                  (loading && i === messages.length - 1 ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Thinking...
                    </span>
                  ) : null)}
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 p-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  disabled ? "Upload CSV first..." : "Ask about the data..."
                }
                disabled={disabled || loading}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-300"
              />
              <button
                type="submit"
                disabled={disabled || loading || !input.trim()}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-white disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
