import type { AutopsyResponse } from "../adapter/index.js";
import { Button } from "../design/index.js";

/** `disabled` (Product Phase 1 Unit 11) is set by the route while a response is being recorded, so a double-click can never record two responses. */
export function ConfirmationPrompt({ onRespond, disabled = false }: { onRespond: (response: AutopsyResponse) => void; disabled?: boolean }) {
  return (
    <>
      <p className="confirm-question" id="confirm-question">
        Does that match what actually happened?
      </p>
      <div className="btn-row btn-row-flush" role="group" aria-labelledby="confirm-question">
        <Button disabled={disabled} onClick={() => onRespond("confirmed")}>
          Yes, that's it
        </Button>
        <Button variant="secondary" disabled={disabled} onClick={() => onRespond("rejected")}>
          No, that's not it
        </Button>
      </div>
    </>
  );
}
