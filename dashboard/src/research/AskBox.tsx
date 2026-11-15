// The question box: the one composer of the app, used by Research and by the Overview so that the two cannot
// drift. A text area, the Effort control (Quick / Standard / Deep, when the engine has levels) and the Send button.
// It has no behaviour of its own beyond a composer's: Enter sends, Shift+Enter is a new line, Enter that confirms an
// input-method choice (Japanese, Chinese, Korean) does not send, and the text is capped at the engine's limit.
// What sending does is the caller's (`onSubmit`).
import type { ReactNode, Ref } from "react"
import "../design/research.css"
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input"
import type { Effort, EffortId } from "@/home/api"
import { MAX_MESSAGE } from "@/home/chat"
import { EffortPicker } from "@/home/EffortPicker"

export interface AskBoxProps {
  value: string
  onChange: (text: string) => void
  /** Send was pressed, or Enter. Called with the text as typed (also when it is empty, so the caller can say what to do). */
  onSubmit: (text: string) => void
  placeholder?: string
  /** The engine's effort levels; none: no Effort control is shown. */
  efforts?: Effort[]
  effort?: EffortId
  onEffort?: (id: EffortId) => void
  /** The question is being sent: Send says so and cannot be pressed again. */
  busy?: boolean
  disabled?: boolean
  autoFocus?: boolean
  rows?: number
  id?: string
  /** The name of the box for a screen reader. */
  label?: string
  /** The radio group's name: must differ between two boxes on one page. */
  name?: string
  invalid?: boolean
  describedBy?: string
  /** The cursor entered or left the box. */
  onFocusChange?: (focused: boolean) => void
  textareaRef?: Ref<HTMLTextAreaElement>
  /** Shown left of Send (Research's Stop). */
  beforeSend?: ReactNode
  /** The Send button's words and tooltip, when they are not the usual ones ("Send (queued)"). */
  sendLabel?: string
  sendTitle?: string
  /** Lines under the box (a status, an error, the limit line). */
  children?: ReactNode
}

export function AskBox({ value, onChange, onSubmit, placeholder = "Ask a research question…", efforts = [], effort, onEffort, busy = false, disabled = false, autoFocus, rows = 2, id, label = "Ask a research question",
  name = "ask-effort", invalid, describedBy, onFocusChange, textareaRef, beforeSend, sendLabel, sendTitle, children }: AskBoxProps) {
  const empty = !value.trim()
  return (
    <div className="search-composer">
      <PromptInput onSubmit={(message) => { onSubmit(message.text) }}>
        <PromptInputBody>
          <PromptInputTextarea id={id} ref={textareaRef} rows={rows} maxLength={MAX_MESSAGE + 200} value={value} autoFocus={autoFocus} disabled={disabled} aria-label={label} placeholder={placeholder}
            onChange={(e) => onChange(e.currentTarget.value)}
            onFocus={() => onFocusChange?.(true)} onBlur={() => onFocusChange?.(false)}
            onKeyDown={(e) => {
              // Enter on an empty box tells the caller, which says what to do, instead of doing nothing (Send is disabled then).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && empty) { e.preventDefault(); onSubmit(value) }
            }}
            aria-invalid={invalid} aria-describedby={describedBy} />
        </PromptInputBody>
        <PromptInputFooter className="search-foot">
          {/* Clicks in the toolbar stay in the toolbar: the input group would otherwise move the focus away from the control. */}
          <PromptInputTools className="search-tools" onClick={(e) => e.stopPropagation()}>
            {efforts.length > 0 && onEffort && <EffortPicker efforts={efforts} value={effort} onChange={onEffort} name={name} compact disabled={disabled} />}
          </PromptInputTools>
          <span className="search-send">
            {beforeSend}
            <PromptInputSubmit className="btn btn-primary" size="sm" aria-label={busy ? "Sending…" : "Send"} status={busy ? "submitted" : undefined}
              disabled={busy || disabled || empty} title={busy ? "Your question is being sent." : empty ? "Type a question first." : sendTitle}>
              {busy ? "Sending…" : sendLabel ?? "Send"}</PromptInputSubmit>
          </span>
        </PromptInputFooter>
      </PromptInput>
      {children}
    </div>
  )
}
