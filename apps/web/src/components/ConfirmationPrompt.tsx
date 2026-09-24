import type { AutopsyResponse } from "../adapter/index.js";

export function ConfirmationPrompt({ onRespond }: { onRespond: (response: AutopsyResponse) => void }) {
  return (
    <>
      <p className="confirm-question">Does that match what actually happened?</p>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button type="button" className="btn btn-primary" onClick={() => onRespond("confirmed")}>
          Yes, that's it
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onRespond("rejected")}>
          No, that's not it
        </button>
      </div>
    </>
  );
}
