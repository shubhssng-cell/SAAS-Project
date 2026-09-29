import type { AutopsyResponse } from "../adapter/index.js";
import { Button } from "../design/index.js";

export function ConfirmationPrompt({ onRespond }: { onRespond: (response: AutopsyResponse) => void }) {
  return (
    <>
      <p className="confirm-question">Does that match what actually happened?</p>
      <div className="btn-row btn-row-flush">
        <Button onClick={() => onRespond("confirmed")}>Yes, that's it</Button>
        <Button variant="secondary" onClick={() => onRespond("rejected")}>
          No, that's not it
        </Button>
      </div>
    </>
  );
}
