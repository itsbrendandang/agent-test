import { useRef, useState } from "react"
import type { ChatStatus } from "ai"
import { Buddy } from "./Buddy"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { respond, type CopilotContext } from "@/agent/copilot"

interface ChatMessage {
  id: number
  role: "user" | "assistant"
  text: string
}

const SUGGESTIONS = ["Status", "Show parameters", "Pause", "Reset"]

export function CopilotPanel({ context }: { context: CopilotContext }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>("ready")
  const nextId = useRef(0)
  const ctxRef = useRef(context)
  ctxRef.current = context

  const send = async (text: string) => {
    if (!text.trim() || status !== "ready") return
    setMessages((m) => [...m, { id: nextId.current++, role: "user", text }])
    setStatus("submitted")
    const reply = await respond(text, ctxRef.current)
    setMessages((m) => [...m, { id: nextId.current++, role: "assistant", text: reply }])
    setStatus("ready")
  }

  return (
    <div className="copilot">
      <Conversation className="copilot-conversation">
        <ConversationContent className="gap-4 p-0">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Buddy species="flame" mood="happy" size={72} />}
              title="Simulation copilot"
              description="Ask about the run or control it in plain language."
            />
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent>
                  <MessageResponse>{m.text}</MessageResponse>
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <Suggestions className="py-2">
        {SUGGESTIONS.map((s) => (
          <Suggestion key={s} suggestion={s} onClick={send} />
        ))}
      </Suggestions>

      <PromptInput onSubmit={(msg) => send(msg.text ?? "")}>
        <PromptInputBody>
          <PromptInputTextarea placeholder="e.g. status, pause, set speed to 2" className="min-h-10 text-sm" />
        </PromptInputBody>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit status={status} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
