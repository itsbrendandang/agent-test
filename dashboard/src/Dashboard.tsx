import App from "./App"
import { TooltipProvider } from "@/components/ui/tooltip"

export default function Dashboard() {
  return (
    <TooltipProvider>
      <App />
    </TooltipProvider>
  )
}
