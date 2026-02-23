import React from "react";
import { useNavigate } from "react-router-dom";
import { getGatewayToken, setGatewayToken } from "../../core/api/gatewayAuth";

export function GatewayTokenView(props: { onAuthed: () => void }) {
  const { onAuthed } = props;
  const navigate = useNavigate();

  const [token, setTokenState] = React.useState(() => "");
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const delay = (ms: number) => ({ ["--motion-delay" as any]: `${ms}ms` }) as React.CSSProperties;

  const validateAndSave = React.useCallback(async () => {
    if (busy) return;

    const t = token.trim();
    if (!t) {
      setErr("Token is required.");
      return;
    }

    setBusy(true);
    setErr(null);

    try {
      const resp = await fetch("/api/config", {
        method: "GET",
        headers: { Authorization: `Bearer ${t}` }
      });

      if (resp.status === 401) {
        setErr("Invalid token.");
        return;
      }
      if (!resp.ok) {
        setErr(`Gateway error (${resp.status}).`);
        return;
      }

      setGatewayToken(t);
      onAuthed();
      navigate("/", { replace: true });
    } catch {
      setErr("Gateway unavailable. Start the gateway and try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, token, navigate, onAuthed]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void validateAndSave();
    }
  };

  return (
    <div className="landing">
      <div className="brand brand-lg motion-item" style={delay(0)} data-text="ECLIA">
        ECLIA
      </div>


      <div className="promptbar motion-item" style={delay(150)}>
        <input
          className="prompt-input"
          value={token}
          onChange={(e) => setTokenState(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Paste gateway token…"
          spellCheck={false}
          autoFocus
          aria-label="Gateway token"
        />
        <button
          className="prompt-send"
          onClick={() => void validateAndSave()}
          aria-label="Continue"
          disabled={busy}
        >
          {busy ? "…" : "↗"}
        </button>
      </div>

      {err ? (
        <div className="form-error motion-item" style={delay(210)}>
          {err}
        </div>
      ) : null}

      <div className="landing-hint motion-item" style={delay(90)}>
        Gateway token required. Paste the token printed in the gateway terminal to continue.
      </div>
      <div className="landing-hint motion-item" style={delay(270)}>
        Token is stored at <code>.eclia/gateway.token</code> and is only saved in your browser.
      </div>
    </div>
  );
}
