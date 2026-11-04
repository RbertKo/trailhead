import {
  ArrowRight,
  Brain,
  Check,
  CircleDashed,
  CloudFog,
  History,
  MapPin,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { Copy } from "@/lib/trail/copy";
import type { TurnCallout } from "@/lib/trail/types";

function Row({
  icon: Icon,
  title,
  tone = "text-muted-foreground",
  children,
}: {
  icon: LucideIcon;
  title?: string;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <p
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-medium animate-in fade-in slide-in-from-left-1 duration-300 ${tone}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {title && <span>{title}</span>}
      {children}
    </p>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 text-foreground">
      {children}
    </span>
  );
}

const Arrow = () => <ArrowRight className="size-3" aria-hidden />;

/** What the system just did, shown as a fact next to the reply that follows it. */
export function TurnCalloutView({
  callout,
  copy,
}: {
  callout: TurnCallout;
  copy: Copy;
}) {
  const { kind, nodeLabel, focusLabel, reason, verdict, placed } = callout;

  return (
    <div className="flex flex-col gap-1">
      {callout.imageDescription && (
        <>
          <Row icon={ScanSearch} title={copy.imageReadTitle}>
            <span className="font-normal">{callout.imageDescription}</span>
          </Row>
          {placed.length > 0 && (
            <Row icon={MapPin} title={copy.placedTitle} tone="text-primary">
              {placed.map((label) => (
                <Label key={label}>{label}</Label>
              ))}
            </Row>
          )}
        </>
      )}

      {kind === "gap" && (
        <Row
          icon={CircleDashed}
          title={reason === "fuzzy" ? copy.fuzzyGapTitle : copy.gapTitle}
          tone="text-state-hole"
        >
          <Label>{nodeLabel}</Label>
          <Arrow />
          <Label>{focusLabel}</Label>
        </Row>
      )}

      {kind === "recall_ask" && (
        <Row icon={Brain} title={copy.recallAskTitle} tone="text-primary">
          <Label>{nodeLabel}</Label>
        </Row>
      )}

      {kind === "recall_result" && verdict && (
        <Row
          icon={verdict === "solid" ? Check : CloudFog}
          tone={verdict === "solid" ? "text-primary" : "text-state-fuzzy-ink"}
        >
          <Label>{nodeLabel}</Label>
          <Arrow />
          <span>{copy.recallResult(verdict)}</span>
        </Row>
      )}

      {kind === "revisit_offer" && (
        <Row icon={History} title={copy.revisitTitle}>
          <Label>{nodeLabel}</Label>
        </Row>
      )}
    </div>
  );
}
