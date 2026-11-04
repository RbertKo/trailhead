import {
  Check,
  CircleDashed,
  CloudFog,
  Footprints,
  type LucideIcon,
} from "lucide-react";

import type { NodeState } from "@/lib/trail/types";

export const STATE_ICONS: Record<NodeState, LucideIcon> = {
  solid: Check,
  seen: Footprints,
  fuzzy: CloudFog,
  unseen: CircleDashed,
};
