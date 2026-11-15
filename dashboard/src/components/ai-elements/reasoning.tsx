"use client";

// AI Elements' Reasoning (https://ai-sdk.dev/elements/components/reasoning), copied in like the other files here, with
// three changes: the content is plain text (no Streamdown, so the Agent Log does not load the Markdown renderers), there
// is no "Thinking…" shimmer or timer, and it starts closed. The Agent Log shows stored reasoning, not a live stream.

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { createContext, useContext, useState } from "react";

type ReasoningContextValue = { isOpen: boolean };

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible>;

export const Reasoning = ({
  className,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ReasoningProps) => {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const handleOpenChange = (next: boolean) => {
    if (open === undefined) setInner(next);
    onOpenChange?.(next);
  };
  return (
    <ReasoningContext.Provider value={{ isOpen }}>
      <Collapsible
        className={cn("not-prose", className)}
        onOpenChange={handleOpenChange}
        open={isOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
};

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  /** The label, from whether the reasoning is shown. Default: "Show thinking" / "Hide thinking". */
  getThinkingMessage?: (isOpen: boolean) => string;
};

export const ReasoningTrigger = ({
  className,
  children,
  getThinkingMessage = (isOpen) => (isOpen ? "Hide thinking" : "Show thinking"),
  ...props
}: ReasoningTriggerProps) => {
  const { isOpen } = useReasoning();
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-fit items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <BrainIcon aria-hidden className="size-3.5" />
          <span>{getThinkingMessage(isOpen)}</span>
          <ChevronDownIcon
            aria-hidden
            className={cn("size-3.5 transition-transform", isOpen ? "rotate-180" : "rotate-0")}
          />
        </>
      )}
    </CollapsibleTrigger>
  );
};

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent>;

export const ReasoningContent = ({
  className,
  children,
  ...props
}: ReasoningContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-2 text-muted-foreground text-xs",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  >
    {children}
  </CollapsibleContent>
);
