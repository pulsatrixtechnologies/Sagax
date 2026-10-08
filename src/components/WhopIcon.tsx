import logo from "@/assets/whop/logo.png";

import { cn } from "@/lib/cn";

export function WhopIcon({ className = "size-10" }: { className?: string } = {}) {
  return <img src={logo} alt="" className={cn("shrink-0 rounded-xl object-contain", className)} />;
}
